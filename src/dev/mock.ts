import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { Playlist, Track } from "../lib/types";

/** Browser-only stand-in for the Rust backend so the interface can be previewed without Tauri. */
export async function installMock() {
  mockWindows("main");
  const mk = (id: number, title: string, album: string, duration: number, fav = false, missing = false): Track => ({
    id, path: `/demo/${id}.mp3`, title, artist: "FocusFlow Demo", album, duration, format: "MP3", size: duration * 40000, sampleRate: 44100, channels: 2,
    addedAt: 1793000000 + id * 86400, missing, favorite: fav, sourceUrl: null, hasArt: true,
  });
  const tracks: Track[] = [
    mk(1, "Glass Harbor", "Deep Work", 251, true),
    mk(2, "Long Exposure", "Deep Work", 318),
    mk(3, "Paper Moons", "Deep Work", 277, true),
    mk(4, "Low Tide", "Deep Work", 392),
    mk(5, "Slow Orbit", "Quiet Hours", 331, true),
    mk(6, "Night Shift", "Quiet Hours", 286),
    mk(7, "Event Horizon", "Quiet Hours", 364),
    mk(8, "Winter Light", "Quiet Hours", 243),
    mk(9, "Neon Rain", "Night Drive", 307),
    mk(10, "Highway Hush", "Night Drive", 268, true),
    mk(11, "Last Exit", "Night Drive", 355),
    mk(12, "Afterglow", "Night Drive", 229),
  ];
  const playlists: Playlist[] = [{ id: 1, name: "Deep Focus", trackIds: [1, 5, 3, 10] }, { id: 2, name: "Evening Wind-down", trackIds: [8, 12, 7] }];
  /** Generated abstract covers, one look per album. */
  const cover = (album: string) => {
    const art: Record<string, string> = {
      "Deep Work": `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b6cb0"/><stop offset="1" stop-color="#0b1b3a"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/>${[40, 70, 100, 130].map((r, i) => `<circle cx="150" cy="170" r="${r}" fill="none" stroke="rgba(255,255,255,${0.55 - i * 0.1})" stroke-width="2"/>`).join("")}<circle cx="150" cy="170" r="14" fill="#9bd1ff"/>`,
      "Quiet Hours": `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1b5e"/><stop offset="1" stop-color="#7b3f8f"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="210" cy="95" r="34" fill="#f6e9ff"/><circle cx="224" cy="86" r="30" fill="#4a2c7a"/>${[190, 215, 240, 265].map((y, i) => `<rect x="0" y="${y}" width="300" height="${3 + i}" fill="rgba(255,255,255,${0.18 - i * 0.03})"/>`).join("")}`,
      "Night Drive": `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a0b2e"/><stop offset="0.6" stop-color="#b3365f"/><stop offset="1" stop-color="#ff9a5a"/></linearGradient></defs><rect width="300" height="300" fill="url(#g)"/><circle cx="150" cy="170" r="70" fill="#ffd27a"/>${[150, 170, 188, 204, 218].map((y, i) => `<rect x="70" y="${y}" width="160" height="${2 + i}" fill="#7a2a55"/>`).join("")}<rect x="0" y="232" width="300" height="68" fill="#12061f"/>`,
    };
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">${art[album] ?? art["Deep Work"]}</svg>`;
  };
  const kv: Record<string, unknown> = {};
  mockIPC((cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    switch (cmd) {
      case "lib_list_tracks": return tracks;
      case "pl_list": return playlists;
      case "err_list": return [];
      case "lib_get_art": {
        const t = tracks.find((x) => x.id === a.id);
        return t ? "data:image/svg+xml;base64," + btoa(cover(t.album)) : null;
      }
      case "get_paths": return { libraryDir: "/Users/you/Music/FocusFlow", dataDir: "/tmp" };
      case "engine_status": return { available: true, error: null, device: "MacBook Air Speakers", channels: 2 };
      case "yt_tools": return { ytdlp: "2026.10.26", ffmpeg: "ffmpeg 9.0.2" };
      case "kv_load": return kv[a.name as string] ?? null;
      case "kv_save": kv[a.name as string] = a.value; return null;
      case "lib_refresh_missing": return 0;
      case "engine_play": return { serial: 1, duration: tracks.find((t) => t.path === a.path)?.duration ?? 200 };
      case "set_keep_awake": return a.on;
      default: return null;
    }
  }, { shouldMockEvents: true });
}
