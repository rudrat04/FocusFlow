import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Playlist, Track } from "../lib/types";

/** Browser-only stand-in for the Rust backend so the interface can be previewed without Tauri. */
export async function installMock() {
  mockWindows("main");
  const mk = (id: number, title: string, artist: string, album: string, duration: number, fav = false, missing = false): Track => ({
    id, path: `/demo/${id}.mp3`, title, artist, album, duration, format: "MP3", size: duration * 40000, sampleRate: 44100, channels: 2, addedAt: 0, missing, favorite: fav, sourceUrl: null, hasArt: false,
  });
  const tracks: Track[] = [
    { ...mk(1, "Cornfield Chase (demo)", "Demo Artist", "Deep Work Mix", 248, true), hasArt: true },
    { ...mk(2, "Event Horizon", "Demo Artist", "Deep Work Mix", 312), hasArt: true },
    mk(3, "Slow Orbit", "Demo Artist", "Deep Work Mix", 401, true),
    mk(4, "Night Shift", "Demo Artist", "Quiet Hours", 285),
    mk(5, "Lost File", "Demo Artist", "Quiet Hours", 190, false, true),
  ];
  const playlists: Playlist[] = [{ id: 1, name: "Deep Work", trackIds: [1, 3] }];
  const kv: Record<string, unknown> = {};
  mockIPC((cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "lib_list_tracks": return tracks;
      case "pl_list": return playlists;
      case "err_list": return [];
      case "lib_get_art": {
        const hue = (a.id as number) * 70;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},60%,45%)"/><stop offset="1" stop-color="hsl(${hue + 60},60%,15%)"/></linearGradient></defs><rect width="200" height="200" fill="url(#g)"/><circle cx="100" cy="100" r="46" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="3"/></svg>`;
        return (a.id as number) <= 2 ? "data:image/svg+xml;base64," + btoa(svg) : null;
      }
      case "get_paths": return { libraryDir: "/Users/you/Music/FocusFlow", dataDir: "/tmp" };
      case "engine_status": return { available: true, error: null, device: "MacBook Air Speakers", channels: 2 };
      case "yt_tools": return { ytdlp: "2026.10.26", ffmpeg: "ffmpeg 9.0.2" };
      case "kv_load": return kv[a.name as string] ?? null;
      case "kv_save": kv[a.name as string] = a.value; return null;
      case "lib_refresh_missing": return 1;
      case "engine_play": return { serial: 1, duration: tracks.find((t) => t.path === a.path)?.duration ?? 200 };
      case "set_keep_awake": return a.on;
      default: return null;
    }
  }, { shouldMockEvents: true });
}
