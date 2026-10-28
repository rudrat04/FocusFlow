import { useSyncExternalStore } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, onEngine, onMedia, onTray, onYtProgress, type MediaAction, type YtProgress } from "./api";
import { advance, createQueue, currentId, emptyQueue, enqueue, jumpTo, move, previous, removeAt, removeId, setRepeat, setShuffle, type QueueState } from "./queue";
import { decideTrackChanged } from "./transition";
import { THEME_BY_ID } from "../themes";
import { startSleep, tickSleep, type SleepTimer } from "./timers";
import { DEFAULT_SETTINGS, type EngineEvent, type ErrorLogEntry, type Playlist, type Repeat, type Settings, type Track } from "./types";

export type Status = "idle" | "loading" | "playing" | "paused";
export type View = "now" | "library" | "albums" | "playlists" | "favorites" | "settings" | "track";

export interface Toast { id: number; kind: "info" | "ok" | "error"; text: string }
export interface YtJob extends YtProgress { status: "queued" | "running" | "done" | "error" }

export interface PlayerState {
  ready: boolean;
  view: View;
  tracks: Track[];
  playlists: Playlist[];
  errors: ErrorLogEntry[];
  queue: QueueState;
  status: Status;
  engineLoaded: boolean;
  position: number;
  duration: number;
  settings: Settings;
  search: string;
  trackPageId: number | null;
  sleep: SleepTimer | null;
  toasts: Toast[];
  ytJobs: YtJob[];
  engineError: string | null;
  device: string;
  libraryDir: string;
  tools: { ytdlp: string | null; ffmpeg: string | null } | null;
  awakeActive: boolean;
  importing: boolean;
  showImportLink: boolean;
  fading: boolean;
  outputChannels: number;
}

const SKIP_FADE = 0.35;

class Player {
  s: PlayerState = {
    ready: false,
    view: "now",
    tracks: [],
    playlists: [],
    errors: [],
    queue: emptyQueue(DEFAULT_SETTINGS.shuffle, DEFAULT_SETTINGS.repeat),
    status: "idle",
    engineLoaded: false,
    position: 0,
    duration: 0,
    settings: DEFAULT_SETTINGS,
    search: "",
    trackPageId: null,
    sleep: null,
    toasts: [],
    ytJobs: [],
    engineError: null,
    device: "",
    libraryDir: "",
    tools: null,
    awakeActive: false,
    importing: false,
    showImportLink: false,
    fading: false,
    outputChannels: 2,
  };

  private listeners = new Set<() => void>();
  private byId = new Map<number, Track>();
  private badIds = new Set<number>();
  private playToken = 0;
  private nextToken = 0;
  private chain: Promise<void> = Promise.resolve();
  private pendingPlayPath: string | null = null;
  private seenSerial = 0;
  private preview: { id: number; queue: QueueState; path: string } | null = null;
  private lastTickAt = 0;
  private lastSave = 0;
  private toastSeq = 1;
  private awakeWanted = false;
  private inited = false;
  private mediaKey = "";
  private lastStatus: Status = "idle";

  // ---------------------------------------------------------------- store plumbing

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.s;

  /** Playback position has its own subscription, so a progress tick re-renders only the progress bars. */
  private posListeners = new Set<() => void>();
  subscribePos = (fn: () => void) => {
    this.posListeners.add(fn);
    return () => this.posListeners.delete(fn);
  };
  getPosition = () => this.s.position;

  private set(patch: Partial<PlayerState>) {
    this.s = { ...this.s, ...patch };
    for (const l of this.listeners) l();
    for (const l of this.posListeners) l();
    if (this.s.status !== this.lastStatus) {
      this.lastStatus = this.s.status;
      this.syncAwake();
    }
    this.syncMedia();
  }

  /** Keeps macOS Now Playing (media keys, earbuds, Control Center) in step with what is playing. */
  private syncMedia(force = false) {
    const cur = currentId(this.s.queue);
    const playing = this.s.status === "playing";
    const key = `${cur}|${playing}|${this.s.engineLoaded}`;
    if (!force && key === this.mediaKey) return;
    this.mediaKey = key;
    void api.mediaSetNowPlaying(cur, playing, this.s.engineLoaded, this.s.position).catch(() => {});
  }

  track(id: number | null | undefined): Track | undefined {
    return id == null ? undefined : this.byId.get(id);
  }

  toast(kind: Toast["kind"], text: string) {
    const id = this.toastSeq++;
    this.set({ toasts: [...this.s.toasts.slice(-3), { id, kind, text }] });
    setTimeout(() => this.dismissToast(id), kind === "error" ? 8000 : 4500);
  }
  dismissToast(id: number) {
    this.set({ toasts: this.s.toasts.filter((t) => t.id !== id) });
  }

  setView(view: View) {
    this.set({ view });
  }
  openTrack(id: number) {
    this.set({ view: "track", trackPageId: id });
  }
  setSearch(q: string) {
    this.set({ search: q, view: q ? "library" : this.s.view });
  }

  private playable = (id: number) => {
    const t = this.byId.get(id);
    return !!t && !t.missing && !this.badIds.has(id);
  };

  // ---------------------------------------------------------------- init

  async init() {
    if (this.inited) return;
    this.inited = true;
    await onEngine((e) => this.onEngine(e));
    await onTray((a) => this.onTray(a));
    await onYtProgress((p) => this.onYt(p));
    await onMedia((a) => this.onMediaAction(a));
    try {
      await getCurrentWebview().onDragDropEvent((ev) => {
        if (ev.payload.type === "drop" && ev.payload.paths.length) void this.importPaths(ev.payload.paths);
      });
    } catch { /* drag and drop is optional */ }

    const st = await api.engineStatus().catch(() => ({ available: false, error: "engine status failed", device: "", channels: 2 }));
    const saved = (await api.load<Partial<Settings>>("settings").catch(() => null)) ?? {};
    const settings: Settings = { ...DEFAULT_SETTINGS, ...saved };
    if (!THEME_BY_ID[settings.theme]) settings.theme = DEFAULT_SETTINGS.theme; // e.g. a theme that was removed
    const paths = await api.getPaths().catch(() => ({ libraryDir: "", dataDir: "" }));
    this.set({ settings, engineError: st.available ? null : st.error, device: st.device, outputChannels: st.channels, libraryDir: paths.libraryDir });
    void api.ytTools().then((tools) => this.set({ tools })).catch(() => {});

    await api.refreshMissing().catch(() => 0);
    await this.reloadLibrary();
    await this.pushSettingsToEngine();

    const pb = await api.load<PlaybackSave>("playback").catch(() => null);
    if (pb && settings.resumeOnLaunch) this.restorePlayback(pb);
    if (this.s.queue.items.length === 0 && this.s.tracks.length > 0) {
      const ids = this.s.tracks.filter((t) => !t.missing).map((t) => t.id);
      this.set({ queue: createQueue(ids, 0, settings.shuffle, settings.repeat) });
    }
    this.set({ ready: true });
    setInterval(() => void this.watchdog(), 5000);
  }

  private restorePlayback(pb: PlaybackSave) {
    const valid = (ids: number[]) => ids.filter((id) => this.byId.has(id));
    const items = valid(pb.items ?? []);
    if (items.length === 0) return;
    const cur = pb.currentId != null && this.byId.has(pb.currentId) ? pb.currentId : items[0];
    const idx = Math.max(0, items.indexOf(cur));
    const q: QueueState = {
      items, original: valid(pb.original ?? items), index: idx,
      shuffle: this.s.settings.shuffle, repeat: this.s.settings.repeat,
    };
    this.set({ queue: q, position: pb.position ?? 0, duration: this.byId.get(cur)?.duration ?? 0, status: "paused", engineLoaded: false });
    this.restoredPosition = pb.position ?? 0;
    void this.refreshNext();
  }
  private restoredPosition = 0;

  // ---------------------------------------------------------------- library

  async reloadLibrary() {
    const [tracks, playlists, errors] = await Promise.all([api.listTracks(), api.listPlaylists(), api.listErrors().catch(() => [])]);
    this.byId = new Map(tracks.map((t) => [t.id, t]));
    this.set({ tracks, playlists, errors });
  }

  async importPaths(paths: string[]) {
    this.set({ importing: true });
    try {
      const r = await api.importPaths(paths);
      await this.reloadLibrary();
      this.badIds.clear();
      const parts = [`${r.added.length} added`];
      if (r.duplicates) parts.push(`${r.duplicates} duplicate${r.duplicates > 1 ? "s" : ""} skipped`);
      if (r.failed.length) parts.push(`${r.failed.length} failed`);
      this.toast(r.failed.length ? "error" : "ok", `Import: ${parts.join(", ")}.` + (r.failed.length ? ` ${r.failed[0][0].split("/").pop()}: ${r.failed[0][1]}` : ""));
      if (this.s.queue.items.length === 0 && r.added.length) this.set({ queue: createQueue(this.s.tracks.map((t) => t.id), 0, this.s.settings.shuffle, this.s.settings.repeat) });
    } catch (e) {
      this.toast("error", `Import failed: ${e}`);
    } finally {
      this.set({ importing: false });
    }
  }

  async pickFiles() {
    const sel = await open({ multiple: true, filters: [{ name: "Audio", extensions: ["mp3", "m4a", "aac", "wav", "flac", "ogg"] }] });
    if (sel) await this.importPaths(Array.isArray(sel) ? sel : [sel]);
  }
  async pickFolder() {
    const sel = await open({ directory: true });
    if (sel) await this.importPaths([sel as string]);
  }
  async rescan() {
    this.set({ importing: true });
    try {
      await api.refreshMissing();
      const r = await api.scan();
      await this.reloadLibrary();
      this.badIds.clear();
      this.toast("ok", `Library scanned: ${r.added.length} new, ${this.s.tracks.filter((t) => t.missing).length} missing.`);
    } catch (e) {
      this.toast("error", `Scan failed: ${e}`);
    } finally {
      this.set({ importing: false });
    }
  }
  async chooseLibraryDir() {
    const sel = await open({ directory: true });
    if (!sel) return;
    try {
      await api.setLibraryDir(sel as string);
      this.set({ libraryDir: sel as string });
      this.toast("ok", "Library folder changed. New imports go there; existing tracks stay where they are.");
    } catch (e) {
      this.toast("error", String(e));
    }
  }

  async removeTrack(id: number, deleteFile: boolean) {
    await api.removeTrack(id, deleteFile);
    let q = this.s.queue;
    const wasCurrent = currentId(q) === id;
    q = removeId(q, id);
    this.set({ queue: q });
    await this.reloadLibrary();
    if (wasCurrent && this.s.engineLoaded) {
      const nid = currentId(q);
      if (nid !== null && this.s.status === "playing") await this.startTrack(nid, 0, SKIP_FADE);
      else await this.stop();
    }
    void this.refreshNext();
  }

  async toggleFavorite(id: number) {
    const t = this.byId.get(id);
    if (!t) return;
    await api.setFavorite(id, !t.favorite);
    const updated = { ...t, favorite: !t.favorite };
    this.byId.set(id, updated);
    this.set({ tracks: this.s.tracks.map((x) => (x.id === id ? updated : x)) });
  }

  // ---------------------------------------------------------------- playlists

  async createPlaylist(name: string, trackIds: number[] = []) {
    try {
      const id = await api.createPlaylist(name);
      if (trackIds.length) await api.setPlaylistTracks(id, trackIds);
      await this.reloadLibrary();
      return id;
    } catch (e) {
      this.toast("error", String(e));
      return null;
    }
  }
  async renamePlaylist(id: number, name: string) {
    try { await api.renamePlaylist(id, name); await this.reloadLibrary(); } catch (e) { this.toast("error", String(e)); }
  }
  async deletePlaylist(id: number) {
    await api.deletePlaylist(id);
    await this.reloadLibrary();
  }
  async addToPlaylist(id: number, trackIds: number[]) {
    const pl = this.s.playlists.find((p) => p.id === id);
    if (!pl) return;
    const merged = [...pl.trackIds, ...trackIds.filter((t) => !pl.trackIds.includes(t))];
    await api.setPlaylistTracks(id, merged);
    await this.reloadLibrary();
    this.toast("ok", `Added to ${pl.name}.`);
  }
  async removeFromPlaylist(id: number, trackId: number) {
    const pl = this.s.playlists.find((p) => p.id === id);
    if (!pl) return;
    await api.setPlaylistTracks(id, pl.trackIds.filter((t) => t !== trackId));
    await this.reloadLibrary();
  }

  // ---------------------------------------------------------------- playback

  /** Starts a list from `start`, replacing the queue. */
  async playList(ids: number[], start = 0) {
    const playable = ids.filter((id) => this.byId.has(id));
    if (playable.length === 0) return;
    const s = this.s.settings;
    const idx = Math.max(0, playable.indexOf(ids[start]));
    const q = createQueue(playable, idx, s.shuffle, s.repeat);
    this.set({ queue: q });
    this.badIds.delete(ids[start]);
    await this.startTrack(currentId(q)!, 0, SKIP_FADE, { manual: true });
  }

  /** Plays a list in random order, starting from a random song. */
  async playShuffled(ids: number[]) {
    const playable = ids.filter((id) => this.byId.has(id) && !this.byId.get(id)!.missing);
    if (playable.length === 0) return;
    await this.setSettings({ shuffle: true });
    await this.playList(playable, Math.floor(Math.random() * playable.length));
  }

  /** Thumbnail click: start that song (unless it is already loaded) and show Now Playing. */
  async playAndShow(id: number, list: number[]) {
    this.set({ view: "now" });
    if (currentId(this.s.queue) === id && this.s.engineLoaded) {
      if (this.s.status !== "playing") await this.togglePlay();
      return;
    }
    await this.playList(list, Math.max(0, list.indexOf(id)));
  }

  // ---------------------------------------------------------------- album and playlist editing

  async renameAlbum(oldName: string, newName: string) {
    const name = newName.trim();
    if (!name) { this.toast("error", "An album needs a name."); return false; }
    const ids = this.s.tracks.filter((t) => (t.album.trim() || "Unknown album") === oldName).map((t) => t.id);
    await api.setAlbum(ids, name);
    await this.reloadLibrary();
    return true;
  }
  async updateTrack(id: number, title: string, artist: string, album: string) {
    try {
      await api.updateTrack(id, title, artist, album);
      await this.reloadLibrary();
      return true;
    } catch (e) {
      this.toast("error", String(e));
      return false;
    }
  }
  async setAlbumFor(ids: number[], album: string) {
    await api.setAlbum(ids, album);
    await this.reloadLibrary();
  }
  async setPlaylistOrder(id: number, trackIds: number[]) {
    await api.setPlaylistTracks(id, trackIds);
    await this.reloadLibrary();
  }

  async playFromQueue(index: number) {
    const q = jumpTo(this.s.queue, index);
    this.set({ queue: q });
    const id = currentId(q);
    if (id !== null) {
      this.badIds.delete(id);
      await this.startTrack(id, 0, SKIP_FADE, { manual: true });
    }
  }

  /** Serialises engine play requests so rapid skips cannot land out of order. */
  async startTrack(id: number, start: number, fade: number, opts: { manual?: boolean; attempts?: number } = {}) {
    const t = this.byId.get(id);
    const token = ++this.playToken;
    ++this.nextToken;
    if (!t) return;
    this.pendingPlayPath = t.path;
    this.set({ status: "loading", queue: this.s.queue });
    const run = async () => {
      if (token !== this.playToken) return; // a newer request supersedes this one
      try {
        if (t.missing) throw new Error("file is missing");
        const info = await api.enginePlay(t.path, start, this.s.status === "playing" || this.s.engineLoaded ? fade : 0.02, t.duration);
        this.seenSerial = Math.max(this.seenSerial, info.serial - 1);
        if (token === this.playToken) this.pendingPlayPath = null;
        this.set({ status: "playing", engineLoaded: true, position: start, duration: info.duration || t.duration, fading: false });
        this.preview = null;
        this.syncAwake();
        void this.saveNow();
        void this.refreshNext();
      } catch (err) {
        if (token !== this.playToken) return;
        this.pendingPlayPath = null;
        // Not awaited: the follow-up play request queues behind this one on `chain`, so waiting
        // for it here would deadlock the player.
        void this.onPlayFailure(id, String(err), opts.attempts ?? 0);
      }
    };
    this.chain = this.chain.then(run, run);
    await this.chain;
  }

  private async onPlayFailure(id: number, message: string, attempts: number) {
    const t = this.byId.get(id);
    this.badIds.add(id);
    if (t) {
      void api.logError(id, t.path, message).then(() => api.listErrors()).then((errors) => this.set({ errors })).catch(() => {});
      if (/missing|cannot open|No such file/i.test(message)) {
        void api.markMissing(id, true);
        this.byId.set(id, { ...t, missing: true });
        this.set({ tracks: this.s.tracks.map((x) => (x.id === id ? { ...x, missing: true } : x)) });
      }
      this.toast("error", `Can't play "${t.title}": ${message.replace(/^Error: /, "")}`);
    }
    if (attempts >= this.s.queue.items.length) {
      this.set({ status: "paused", engineLoaded: false });
      this.toast("error", "No playable tracks found in the queue.");
      return;
    }
    const step = advance(this.s.queue, false, this.playable);
    if (step.id === null) {
      this.set({ status: "paused", engineLoaded: false });
      return;
    }
    this.set({ queue: step.queue });
    await this.startTrack(step.id, 0, SKIP_FADE, { attempts: attempts + 1 });
  }

  async togglePlay() {
    const { status, engineLoaded } = this.s;
    if (status === "playing") {
      await api.enginePause().catch(() => {});
      this.set({ status: "paused" });
      this.syncAwake();
      void this.saveNow();
      return;
    }
    if (status === "loading") return;
    if (status === "paused" && engineLoaded) {
      await api.engineCancelFade().catch(() => {});
      await api.engineResume().catch(() => {});
      this.set({ status: "playing" });
      this.syncAwake();
      return;
    }
    let id = currentId(this.s.queue);
    if (id === null) {
      const ids = this.s.tracks.filter((t) => !t.missing).map((t) => t.id);
      if (ids.length === 0) { this.toast("info", "Import some music first."); return; }
      await this.playList(ids, 0);
      return;
    }
    const start = this.restoredPosition;
    this.restoredPosition = 0;
    await this.startTrack(id, start, 0.02, { manual: true });
  }

  async next(manual = true) {
    const step = advance(this.s.queue, !manual, this.playable);
    if (step.id === null) { await this.stop(); return; }
    this.set({ queue: step.queue });
    await this.startTrack(step.id, 0, SKIP_FADE, { manual });
  }

  async prev() {
    const step = previous(this.s.queue, this.s.position, this.playable);
    if (step.id === null) return;
    this.set({ queue: step.queue });
    if (step.restart && this.s.engineLoaded) await this.seek(0);
    else await this.startTrack(step.id, 0, SKIP_FADE, { manual: true });
  }

  async seek(secs: number) {
    const dur = this.s.duration || 0;
    const t = Math.max(0, dur > 1 ? Math.min(secs, dur - 0.5) : secs);
    this.set({ position: t });
    this.restoredPosition = t;
    if (!this.s.engineLoaded) return;
    try { await api.engineSeek(t); this.syncMedia(true); } catch (e) { this.toast("error", `Seek failed: ${e}`); }
  }

  async stop() {
    ++this.playToken;
    this.pendingPlayPath = null;
    await api.engineStop().catch(() => {});
    this.set({ status: "paused", engineLoaded: false, position: 0, fading: false });
    this.restoredPosition = 0;
    this.syncAwake();
    void this.saveNow();
  }

  /** Works out the next track and preloads it into the engine. */
  async refreshNext() {
    const token = ++this.nextToken;
    for (let guard = 0; guard < 50; guard++) {
      if (token !== this.nextToken || !this.s.engineLoaded) return;
      const step = advance(this.s.queue, true, this.playable);
      const t = step.id !== null ? this.byId.get(step.id) : undefined;
      if (!t || step.id === null) {
        this.preview = null;
        await api.engineSetNext(null, 0).catch(() => {});
        return;
      }
      try {
        await api.engineSetNext(t.path, t.duration);
        if (token !== this.nextToken) return;
        this.preview = { id: step.id, queue: step.queue, path: t.path };
        return;
      } catch (e) {
        this.badIds.add(t.id);
        void api.logError(t.id, t.path, String(e)).catch(() => {});
        this.toast("error", `Skipping "${t.title}": ${String(e)}`);
      }
    }
  }

  // ---------------------------------------------------------------- engine events

  private onEngine(ev: EngineEvent) {
    switch (ev.type) {
      case "tick": {
        const now = Date.now();
        const gap = this.lastTickAt ? now - this.lastTickAt : 0;
        this.lastTickAt = now;
        if (gap > 20_000 && this.s.status === "playing") {
          this.toast("info", `The Mac was asleep or busy for ${Math.round(gap / 60000)} min. Playback continued afterwards.`);
        }
        const cur = this.track(currentId(this.s.queue));
        if (cur && ev.path === cur.path && this.pendingPlayPath === null && this.s.engineLoaded) {
          const status: Status = ev.state === "playing" ? "playing" : ev.state === "paused" ? "paused" : this.s.status;
          const duration = ev.duration || cur.duration;
          // Re-render only when something visible changed (a paused player sends identical ticks).
          if (status !== this.s.status || ev.device !== this.s.device || duration !== this.s.duration) {
            this.set({ position: ev.position, duration, status, device: ev.device });
          } else if (Math.abs(ev.position - this.s.position) >= 0.45) {
            // Position only: update quietly and wake just the progress bars.
            this.s = { ...this.s, position: ev.position };
            for (const l of this.posListeners) l();
          }
        } else if (ev.device !== this.s.device) {
          this.set({ device: ev.device });
        }
        this.runTimers(now);
        if (now - this.lastSave > 5000) void this.saveNow();
        break;
      }
      case "trackChanged": {
        const d = decideTrackChanged(
          { pendingPlayPath: this.pendingPlayPath, currentPath: this.track(currentId(this.s.queue))?.path ?? null, previewPath: this.preview?.path ?? null, seenSerial: this.seenSerial },
          ev,
        );
        this.seenSerial = Math.max(this.seenSerial, ev.serial);
        if (d.kind === "adopt-preview" && this.preview) {
          const p = this.preview;
          this.preview = null;
            this.set({ queue: p.queue, position: 0, duration: ev.duration || this.byId.get(p.id)?.duration || 0, status: "playing" });
          void this.refreshNext();
          void this.saveNow();
        } else if (d.kind === "resync") {
          const t = this.s.tracks.find((x) => x.path === d.path);
          if (t) {
            const idx = this.s.queue.items.indexOf(t.id);
            if (idx >= 0) this.set({ queue: jumpTo(this.s.queue, idx), position: 0, duration: ev.duration });
            void this.refreshNext();
          }
        }
        break;
      }
      case "ended": {
        this.set({ status: "paused", engineLoaded: false, position: 0 });
        this.restoredPosition = 0;
        this.syncAwake();
        this.toast("info", "Reached the end of the queue.");
        break;
      }
      case "trackError": {
        const t = this.s.tracks.find((x) => x.path === ev.path);
        if (t) {
          this.badIds.add(t.id);
          void api.logError(t.id, ev.path, ev.message).then(() => api.listErrors()).then((errors) => this.set({ errors })).catch(() => {});
          this.toast("error", `"${t.title}" stopped: ${ev.message}`);
        }
        if (ev.preload) void this.refreshNext();
        break;
      }
      case "devicePaused":
        this.set({ status: "paused" });
        this.toast("info", "Paused because the audio device was disconnected.");
        break;
      case "fadeComplete": {
        this.set({ status: "paused", engineLoaded: false, fading: false });
        this.syncAwake();
        break;
      }
      case "outputChanged":
        this.set({ device: ev.device });
        void api.engineStatus().then((st) => this.set({ outputChannels: st.channels })).catch(() => {});
        this.toast("info", "Audio output changed. Playback continues on the new device.");
        break;
    }
  }

  /** Media keys, earbud buttons and Control Center. Play/pause is already applied by the engine. */
  private onMediaAction(a: MediaAction) {
    switch (a.action) {
      case "state":
        if (this.s.engineLoaded) this.set({ status: a.playing ? "playing" : "paused" });
        this.syncMedia(true);
        break;
      case "play":
      case "toggle":
        void this.togglePlay();
        break;
      case "next": void this.next(); break;
      case "previous": void this.prev(); break;
      case "stop": void this.stop(); break;
    }
  }

  private onTray(action: string) {
    if (action === "toggle") void this.togglePlay();
    else if (action === "next") void this.next();
    else if (action === "prev") void this.prev();
  }

  /** If the engine thinks we're playing but nothing is heard from it, say so. */
  private async watchdog() {
    if (this.s.status === "playing" && this.lastTickAt && Date.now() - this.lastTickAt > 15_000) {
      this.toast("error", "The audio engine has not reported for a while. Playback may have stopped.");
    }
  }

  // ---------------------------------------------------------------- timers

  private runTimers(now: number) {
    // Sleep timer
    const sl = this.s.sleep;
    if (sl) {
      const r = tickSleep(sl, now);
      if (r.action === "fade") {
        this.set({ sleep: r.timer, fading: true });
        void api.engineFadeOut(Math.max(1, (sl.endsAt - now) / 1000));
      } else if (r.action === "stop") {
        this.set({ sleep: null, fading: false });
        void this.stop();
        this.toast("ok", "Sleep timer finished. Playback stopped.");
      }
    }
  }
  startSleepTimer(minutes?: number) {
    const s = this.s.settings;
    this.set({ sleep: startSleep(Date.now(), minutes ?? s.sleepMinutes, s.sleepFadeSecs) });
    this.toast("ok", `Sleep timer set for ${minutes ?? s.sleepMinutes} min.`);
  }
  cancelSleepTimer() {
    if (this.s.fading) void api.engineCancelFade();
    this.set({ sleep: null, fading: false });
  }

  // ---------------------------------------------------------------- settings & controls

  private async pushSettingsToEngine() {
    const s = this.s.settings;
    await Promise.allSettled([
      api.engineSetVolume(s.volume, s.muted),
      api.engineSetCrossfade(s.crossfadeSecs),
      api.engineSetSpatial(s.spatialMode, s.spatialAmount),
      api.setHideOnClose(s.hideOnClose),
    ]);
    this.set({ queue: setRepeat(setShuffle(this.s.queue, s.shuffle), s.repeat) });
  }

  async setSettings(patch: Partial<Settings>) {
    const prev = this.s.settings;
    const settings = { ...prev, ...patch };
    this.set({ settings });
    void api.save("settings", settings).catch(() => {});
    if ("volume" in patch || "muted" in patch) void api.engineSetVolume(settings.volume, settings.muted);
    if ("crossfadeSecs" in patch) void api.engineSetCrossfade(settings.crossfadeSecs);
    if ("spatialMode" in patch || "spatialAmount" in patch) void api.engineSetSpatial(settings.spatialMode, settings.spatialAmount);
    if ("hideOnClose" in patch) void api.setHideOnClose(settings.hideOnClose);
    if ("keepAwake" in patch) this.syncAwake();
    if ("shuffle" in patch) {
      this.set({ queue: setShuffle(this.s.queue, settings.shuffle) });
      void this.refreshNext();
    }
    if ("repeat" in patch) {
      this.set({ queue: setRepeat(this.s.queue, settings.repeat) });
      void this.refreshNext();
    }
  }

  toggleShuffle() { void this.setSettings({ shuffle: !this.s.settings.shuffle }); }
  cycleRepeat() {
    const order: Repeat[] = ["off", "all", "one"];
    void this.setSettings({ repeat: order[(order.indexOf(this.s.settings.repeat) + 1) % 3] });
  }
  setVolume(v: number) { void this.setSettings({ volume: Math.min(1, Math.max(0, v)), muted: false }); }
  toggleMute() { void this.setSettings({ muted: !this.s.settings.muted }); }

  enqueue(ids: number[], where: "end" | "next") {
    const q = enqueue(this.s.queue, ids.filter((i) => this.byId.has(i)), where);
    this.set({ queue: q });
    this.toast("ok", where === "next" ? "Playing next." : "Added to queue.");
    if (this.s.engineLoaded) void this.refreshNext();
  }
  removeFromQueue(i: number) {
    const wasCurrent = i === this.s.queue.index;
    const q = removeAt(this.s.queue, i);
    this.set({ queue: q });
    if (wasCurrent && this.s.status === "playing") {
      const id = currentId(q);
      if (id !== null) void this.startTrack(id, 0, SKIP_FADE, { manual: true });
      else void this.stop();
    } else void this.refreshNext();
  }
  moveInQueue(from: number, to: number) {
    this.set({ queue: move(this.s.queue, from, to) });
    void this.refreshNext();
  }
  clearQueue() {
    void this.stop();
    this.set({ queue: emptyQueue(this.s.settings.shuffle, this.s.settings.repeat) });
  }

  // ---------------------------------------------------------------- misc

  async clearErrors() {
    await api.clearErrors();
    this.set({ errors: [] });
    this.badIds.clear();
  }

  setImportLinkOpen(open: boolean) { this.set({ showImportLink: open }); }

  private syncAwake() {
    const want = this.s.settings.keepAwake && this.s.status === "playing";
    if (want === this.awakeWanted) return;
    this.awakeWanted = want;
    api.setKeepAwake(want).then((active) => this.set({ awakeActive: active })).catch((e) => {
      this.awakeWanted = false;
      this.toast("error", `Keep-awake failed: ${e}`);
    });
  }

  async saveNow() {
    this.lastSave = Date.now();
    const q = this.s.queue;
    const save: PlaybackSave = { items: q.items, original: q.original, currentId: currentId(q), position: this.s.position };
    await api.save("playback", save).catch(() => {});
  }

  // ---------------------------------------------------------------- YouTube links

  private onYt(p: YtProgress) {
    this.set({ ytJobs: this.s.ytJobs.map((j) => (j.url === p.url && j.status === "running" ? { ...j, ...p } : j)) });
  }

  /** Imports links, then optionally groups every new track into an album or a playlist. */
  async importLinks(urls: string[], manual: string | null, dest: ImportDest = { kind: "library" }, autoSplit = true) {
    const clean = urls.map((u) => u.trim()).filter(Boolean);
    const jobs: YtJob[] = clean.map((url) => ({ url, stage: "queued", percent: null, message: "Waiting…", status: "queued" }));
    this.set({ ytJobs: [...this.s.ytJobs.filter((j) => j.status === "running"), ...jobs] });
    const added: number[] = [];
    for (const url of clean) {
      this.set({ ytJobs: this.s.ytJobs.map((j) => (j.url === url ? { ...j, status: "running", message: "Starting…" } : j)) });
      try {
        const ids = await api.ytImport(url, manual, autoSplit);
        added.push(...ids);
        this.set({ ytJobs: this.s.ytJobs.map((j) => (j.url === url ? { ...j, status: "done", percent: 100, message: `Added ${ids.length} track${ids.length === 1 ? "" : "s"}` } : j)) });
      } catch (e) {
        this.set({ ytJobs: this.s.ytJobs.map((j) => (j.url === url ? { ...j, status: "error", message: String(e) } : j)) });
      }
    }
    const name = dest.kind === "library" ? "" : dest.name.trim();
    if (added.length && dest.kind === "album" && name) {
      try { await api.setAlbum(added, name); this.toast("ok", `${added.length} tracks added to the album “${name}”.`); } catch (e) { this.toast("error", String(e)); }
    } else if (added.length && dest.kind === "playlist" && name) {
      const pid = await this.createPlaylist(name, added);
      if (pid !== null) this.toast("ok", `${added.length} tracks added to the playlist “${name}”.`);
    } else if (added.length) {
      this.toast("ok", `${added.length} tracks added to your library.`);
    }
    await this.reloadLibrary();
    if (this.s.queue.items.length === 0 && this.s.tracks.length) {
      this.set({ queue: createQueue(this.s.tracks.map((t) => t.id), 0, this.s.settings.shuffle, this.s.settings.repeat) });
    }
  }
  clearJobs() { this.set({ ytJobs: this.s.ytJobs.filter((j) => j.status === "running" || j.status === "queued") }); }
}

export type ImportDest = { kind: "library" } | { kind: "album"; name: string } | { kind: "playlist"; name: string };

interface PlaybackSave { items: number[]; original: number[]; currentId: number | null; position: number }

export const player = new Player();

export function usePlayer(): PlayerState {
  return useSyncExternalStore(player.subscribe, player.getSnapshot);
}

export function usePosition(): number {
  return useSyncExternalStore(player.subscribePos, player.getPosition);
}
