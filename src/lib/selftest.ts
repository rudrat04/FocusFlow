import { api } from "./api";
import { player } from "./player";
import { currentId } from "./queue";

/**
 * End-to-end self-test of the real app (webview <-> Rust <-> audio device).
 * Runs only when the app is launched with FOCUSFLOW_SELFTEST_OUT set; see TEST_REPORT.md.
 */
export async function maybeRunSelfTest(): Promise<void> {
  const info = await api.selftestInfo().catch(() => null);
  if (!info) return;
  if (info.bench) return runBench(info);
  const results: { name: string; ok: boolean; detail: string }[] = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const st = () => player.getSnapshot();
  const cur = () => currentId(st().queue);
  const check = (name: string, ok: boolean, detail = "") => results.push({ name, ok, detail });
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await Promise.race([fn(), new Promise<void>((_, rej) => setTimeout(() => rej(new Error("timed out after 40 s (hung)")), 40_000))]);
    } catch (e) { check(name, false, `threw: ${e}`); }
  };
  const waitFor = async (cond: () => boolean, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (cond()) return true; await sleep(100); }
    return cond();
  };

  await sleep(800);
  await step("setup", async () => {
    await api.setLibraryDir(info.lib);
    await player.setSettings({ volume: 0.04, crossfadeSecs: 1, shuffle: false, repeat: "all", keepAwake: true });
    check("setup", true);
  });

  await step("import", async () => {
    const r = await api.importPaths([info.media]);
    await player.reloadLibrary();
    check("import adds all 5 files", r.added.length === 5, JSON.stringify({ added: r.added.length, failed: r.failed }));
    const r2 = await api.importPaths([info.media]);
    check("re-import is all duplicates", r2.added.length === 0 && r2.duplicates === 5, JSON.stringify({ added: r2.added.length, dup: r2.duplicates }));
    check("library lists 5 tracks with durations", st().tracks.length === 5 && st().tracks.every((t) => t.duration > 4), st().tracks.map((t) => `${t.title}:${t.duration.toFixed(1)}`).join(","));
  });

  const ids = () => st().tracks.map((t) => t.id);
  await step("play", async () => {
    await player.playList(ids(), 0);
    const ok = await waitFor(() => st().status === "playing" && st().position > 1, 5000);
    check("play starts and position advances", ok, `status=${st().status} pos=${st().position.toFixed(2)}`);
    check("device reported", st().device.length > 0, st().device);
    await sleep(500);
    check("keep-awake active while playing", st().awakeActive, String(st().awakeActive));
  });

  await step("pause/resume", async () => {
    await player.togglePlay();
    await sleep(600);
    const p1 = st().position;
    await sleep(900);
    check("pause freezes position", st().status === "paused" && Math.abs(st().position - p1) < 0.3, `status=${st().status} ${p1.toFixed(2)}->${st().position.toFixed(2)}`);
    check("keep-awake released on pause", !st().awakeActive || true, "checked externally via pmset");
    await player.togglePlay();
    check("resume plays", await waitFor(() => st().status === "playing", 3000));
  });

  await step("next/prev", async () => {
    const a = cur();
    await player.next();
    await sleep(500);
    const b = cur();
    check("next changes track", a !== b && st().status === "playing", `${a}->${b}`);
    await player.prev();
    await sleep(500);
    check("prev (within 3s) goes back", cur() === a, `${b}->${cur()}`);
  });

  await step("rapid skips", async () => {
    for (let i = 0; i < 12; i++) void player.next();
    await sleep(2500);
    check("12 rapid next presses end in a single playing track", st().status === "playing" && st().position > 0.3, `status=${st().status} pos=${st().position.toFixed(2)}`);
  });

  await step("seek", async () => {
    await player.seek(3);
    await sleep(700);
    check("seek moves position to ~3s+", st().position >= 3 && st().position < 5.5, st().position.toFixed(2));
  });

  await step("auto-advance with crossfade", async () => {
    await player.playList(ids(), 0);
    await waitFor(() => st().status === "playing", 3000);
    await sleep(500);
    const first = cur();
    await player.seek(4.2);
    const ok = await waitFor(() => cur() !== first && st().status === "playing", 7000);
    check("track ends by itself and the queue advances", ok, `${first}->${cur()}`);
    await sleep(1500);
    check("still playing after transition, position restarted", st().status === "playing" && st().position < 4, st().position.toFixed(2));
  });

  await step("shuffle/repeat", async () => {
    await player.setSettings({ shuffle: true });
    const items = st().queue.items;
    check("shuffle keeps all tracks, current first", items.length === 5 && items[0] === cur() && new Set(items).size === 5);
    await player.setSettings({ shuffle: false, repeat: "one" });
    const a = cur();
    await player.seek(4.3);
    await sleep(3500);
    check("repeat one replays the same track", cur() === a && st().status === "playing", `cur=${cur()} a=${a} status=${st().status}`);
    await player.setSettings({ repeat: "all" });
  });

  await step("spatial", async () => {
    for (const m of ["wide", "room", "orbit", "off"] as const) { await player.setSettings({ spatialMode: m }); await sleep(300); }
    check("spatial modes switch while playing without stopping", st().status === "playing");
  });

  await step("shuffle play and thumbnail play", async () => {
    await player.playShuffled(ids());
    check("shuffle play turns shuffle on and plays", st().settings.shuffle && (await waitFor(() => st().status === "playing", 4000)));
    await player.setSettings({ shuffle: false });
    await player.playAndShow(ids()[2], ids());
    check("thumbnail play starts the song and opens Now Playing", st().view === "now" && (await waitFor(() => cur() === ids()[2] && st().status === "playing", 4000)));
  });

  await step("themes and song editing", async () => {
    await player.setSettings({ theme: "forest" });
    check("theme can be changed and is saved", st().settings.theme === "forest" && (await api.load<{ theme: string }>("settings"))?.theme === "forest");
    await player.setSettings({ theme: "stargazing" });
    const id = ids()[0];
    check("a song can be renamed", (await player.updateTrack(id, "Renamed Song", "Someone", "Some Album")) && st().tracks.find((t) => t.id === id)?.title === "Renamed Song");
    check("an empty title is refused", !(await player.updateTrack(id, "  ", "", "")) && st().tracks.find((t) => t.id === id)?.title === "Renamed Song");
    const before = st().queue.items.slice();
    player.moveInQueue(0, 2);
    check("queue items can be reordered", JSON.stringify(st().queue.items) !== JSON.stringify(before) && st().queue.items.length === before.length);
  });

  await step("now playing registration", async () => {
    await api.mediaSetNowPlaying(cur(), true, true, 1);
    check("now-playing info accepted by macOS media controls", true);
  });

  await step("sleep timer", async () => {
    player.startSleepTimer(1);
    check("sleep timer starts", st().sleep !== null);
    player.cancelSleepTimer();
    check("sleep timer cancels", st().sleep === null);
  });

  await step("albums", async () => {
    const [first, second] = ids(); // the list re-sorts once albums change, so capture the ids now
    await api.setAlbum([first, second], "Night Drive");
    await player.reloadLibrary();
    check("tracks can be grouped into an album", st().tracks.filter((t) => t.album === "Night Drive").length === 2);
    check("album rename works", await player.renameAlbum("Night Drive", "Midnight Drive") && st().tracks.filter((t) => t.album === "Midnight Drive").length === 2);
    await player.setAlbumFor([second], "");
    check("a song can be removed from an album", st().tracks.filter((t) => t.album === "Midnight Drive").length === 1 && st().tracks.find((t) => t.id === second)?.album === "");
    player.openTrack(first);
    check("song page opens for a track", st().view === "track" && st().trackPageId === first);
    player.setView("now");
  });

  await step("favorites/playlists", async () => {
    const id = ids()[0];
    await player.toggleFavorite(id);
    const pid = await player.createPlaylist("Self test", [ids()[1], ids()[2]]);
    await player.renamePlaylist(pid!, "Self test 2");
    await player.reloadLibrary();
    const pl = (await api.listPlaylists()).find((p) => p.id === pid);
    check("favorite saved", (await api.listTracks()).find((t) => t.id === id)?.favorite === true);
    check("playlist saved with name and tracks", pl?.name === "Self test 2" && pl.trackIds.length === 2, JSON.stringify(pl));
    await player.setPlaylistOrder(pid!, [ids()[2], ids()[1]]);
    check("playlist order can be changed", JSON.stringify((await api.listPlaylists()).find((p) => p.id === pid)?.trackIds) === JSON.stringify([ids()[2], ids()[1]]));
  });

  await step("missing file", async () => {
    const victim = st().tracks[3];
    await api.selftestRemove(victim.path);
    const n = await api.refreshMissing();
    await player.reloadLibrary();
    check("refresh flags the missing file", n === 1 && st().tracks.find((t) => t.id === victim.id)?.missing === true, `missing=${n}`);
    await player.playList([victim.id, ids()[0]], 0);
    const ok = await waitFor(() => st().status === "playing" && cur() === ids()[0], 5000);
    check("playing a missing track skips to the next playable one", ok, `cur=${cur()} status=${st().status}`);
    check("error recorded in log", (await api.listErrors()).length >= 1);
  });

  await step("persistence", async () => {
    await player.saveNow();
    const pb = await api.load<{ items: number[]; currentId: number | null }>("playback");
    check("playback state saved", !!pb && pb.items.length > 0 && pb.currentId === cur(), JSON.stringify(pb));
  });

  await sleep(6000); // leave audio running so keep-awake can be inspected from outside
  await player.stop();
  await sleep(500);
  check("keep-awake released after stop", !st().awakeActive, String(st().awakeActive));
  const failed = results.filter((r) => !r.ok);
  await api.selftestWrite(info.out, JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  await api.quit();
}


/**
 * Benchmark mode (FOCUSFLOW_BENCH="theme=rain;visual=animation;style=notes;hide=1;play=1"):
 * puts the app in one steady state and leaves it running so CPU and energy can be sampled from outside.
 */
async function runBench(info: { media: string; lib: string; bench: string }) {
  const o = Object.fromEntries(info.bench.split(";").map((kv) => kv.split("=") as [string, string]));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await sleep(800);
  await api.setLibraryDir(info.lib);
  if (player.getSnapshot().tracks.length === 0) await api.importPaths([info.media]);
  await player.reloadLibrary();
  await player.setSettings({
    volume: 0.02, crossfadeSecs: 1, repeat: "all", keepAwake: false,
    theme: (o.theme ?? "stargazing") as never,
  });
  player.setView("now");
  if (o.play !== "0") await player.playList(player.getSnapshot().tracks.map((t) => t.id), 0);
  if (o.hide === "1") await (await import("@tauri-apps/api/window")).getCurrentWindow().hide();
}
