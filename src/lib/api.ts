import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { EngineEvent, ErrorLogEntry, ImportReport, Playlist, Track } from "./types";

export interface PlayInfo { serial: number; duration: number }
export interface Paths { libraryDir: string; dataDir: string }
export interface ToolStatus { ytdlp: string | null; ffmpeg: string | null; ytdlpAgeDays: number | null; ytdlpOutdated: boolean; canUpdate: boolean }
export interface YtProgress { url: string; stage: string; percent: number | null; message: string }

export const api = {
  enginePlay: (path: string, start: number, fadeSecs: number, durationHint: number, gainDb: number) =>
    invoke<PlayInfo>("engine_play", { path, start, fadeSecs, durationHint, gainDb }),
  engineSetNext: (path: string | null, durationHint: number, gainDb: number) => invoke<void>("engine_set_next", { path, durationHint, gainDb }),
  engineSetNormalize: (on: boolean) => invoke<void>("engine_set_normalize", { on }),
  analyzePending: () => invoke<void>("lib_analyze_pending"),
  enginePause: () => invoke<void>("engine_pause"),
  engineResume: () => invoke<void>("engine_resume"),
  engineStop: () => invoke<void>("engine_stop"),
  engineSeek: (secs: number) => invoke<void>("engine_seek", { secs }),
  engineSetVolume: (volume: number, muted: boolean) => invoke<void>("engine_set_volume", { volume, muted }),
  engineSetCrossfade: (secs: number) => invoke<void>("engine_set_crossfade", { secs }),
  engineSetSpatial: (mode: string, amount: number) => invoke<void>("engine_set_spatial", { mode, amount }),
  engineFadeOut: (secs: number) => invoke<void>("engine_fade_out", { secs }),
  engineCancelFade: () => invoke<void>("engine_cancel_fade"),
  engineSetResumeAfterWake: (on: boolean) => invoke<void>("engine_set_resume_after_wake", { on }),
  engineSetUiActive: (window: string, active: boolean) => invoke<void>("engine_set_ui_active", { window, active }),
  miniOpen: () => invoke<void>("mini_open"),
  miniClose: () => invoke<void>("mini_close"),
  miniExists: () => invoke<boolean>("mini_exists"),
  miniSetPinned: (pinned: boolean) => invoke<void>("mini_set_pinned", { pinned }),
  setTrayTitle: (title: string | null) => invoke<void>("set_tray_title", { title }),
  engineStatus: () => invoke<{ available: boolean; error: string | null; device: string; channels: number }>("engine_status"),
  mediaSetNowPlaying: (trackId: number | null, playing: boolean, loaded: boolean, position: number) => invoke<void>("media_set_now_playing", { trackId, playing, loaded, position }),

  getPaths: () => invoke<Paths>("get_paths"),
  setLibraryDir: (path: string) => invoke<void>("set_library_dir", { path }),
  listTracks: () => invoke<Track[]>("lib_list_tracks"),
  importPaths: (paths: string[]) => invoke<ImportReport>("lib_import", { paths }),
  scan: () => invoke<ImportReport>("lib_scan"),
  removeTrack: (id: number, deleteFile: boolean) => invoke<void>("lib_remove", { id, deleteFile }),
  setFavorite: (id: number, favorite: boolean) => invoke<void>("lib_set_favorite", { id, favorite }),
  setAlbum: (ids: number[], album: string) => invoke<void>("lib_set_album", { ids, album }),
  getArt: (id: number) => invoke<string | null>("lib_get_art", { id }),
  refreshMissing: () => invoke<number>("lib_refresh_missing"),
  markMissing: (id: number, missing: boolean) => invoke<void>("lib_mark_missing", { id, missing }),

  listPlaylists: () => invoke<Playlist[]>("pl_list"),
  createPlaylist: (name: string) => invoke<number>("pl_create", { name }),
  renamePlaylist: (id: number, name: string) => invoke<void>("pl_rename", { id, name }),
  deletePlaylist: (id: number) => invoke<void>("pl_delete", { id }),
  setPlaylistTracks: (id: number, trackIds: number[]) => invoke<void>("pl_set_tracks", { id, trackIds }),

  logError: (trackId: number | null, path: string, message: string) => invoke<void>("err_log", { trackId, path, message }),
  listErrors: () => invoke<ErrorLogEntry[]>("err_list"),
  clearErrors: () => invoke<void>("err_clear"),

  load: <T,>(name: string) => invoke<T | null>("kv_load", { name }),
  save: (name: string, value: unknown) => invoke<void>("kv_save", { name, value }),

  setKeepAwake: (on: boolean) => invoke<boolean>("set_keep_awake", { on }),
  setHideOnClose: (on: boolean) => invoke<void>("set_hide_on_close", { on }),
  quit: () => invoke<void>("quit_app"),
  selftestInfo: () => invoke<{ out: string; media: string; lib: string; bench: string } | null>("selftest_info"),
  selftestWrite: (out: string, text: string) => invoke<void>("selftest_write", { out, text }),
  selftestRemove: (path: string) => invoke<void>("selftest_remove", { path }),
  ytTools: () => invoke<ToolStatus>("yt_tools"),
  ytUpdate: () => invoke<string>("yt_update"),
  ytImport: (url: string, manualChapters: string | null, autoSplit: boolean) => invoke<number[]>("yt_import", { url, manualChapters, autoSplit }),
  updateTrack: (id: number, title: string, artist: string, album: string) => invoke<void>("lib_update_track", { id, title, artist, album }),
};

export function onEngine(cb: (e: EngineEvent) => void): Promise<UnlistenFn> {
  return listen<EngineEvent>("engine", (e) => cb(e.payload));
}
export function onTray(cb: (action: string) => void): Promise<UnlistenFn> {
  return listen<string>("tray-action", (e) => cb(e.payload));
}
export function onYtProgress(cb: (p: YtProgress) => void): Promise<UnlistenFn> {
  return listen<YtProgress>("yt-progress", (e) => cb(e.payload));
}

export type MediaAction = { action: "state"; playing: boolean } | { action: "play" | "toggle" | "next" | "previous" | "stop" };
export function onMedia(cb: (a: MediaAction) => void): Promise<UnlistenFn> {
  return listen<MediaAction>("media", (e) => cb(e.payload));
}

export function onAnalysis(cb: (p: { done: number; total: number } | "done") => void): Promise<UnlistenFn[]> {
  return Promise.all([
    listen<{ done: number; total: number }>("analysis", (e) => cb(e.payload)),
    listen<number>("analysis-done", () => cb("done")),
  ]);
}
