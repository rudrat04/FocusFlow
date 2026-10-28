import { emit } from "@tauri-apps/api/event";
import { player } from "../lib/player";

/**
 * Dev-only: puts the UI into a named state from the URL (?shot=now&theme=forest) so screenshots for the
 * README can be captured with headless Chrome and the demo data from mock.ts.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const click = async (sel: string, text?: string) => {
  const els = [...document.querySelectorAll<HTMLElement>(sel)];
  (text ? els.find((e) => e.textContent?.includes(text)) : els[0])?.click();
  await wait(250);
};
const nav = (label: string) => click(".nav", label);

export async function run() {
  const q = new URLSearchParams(location.search);
  const shot = q.get("shot");
  if (!shot) return;
  while (!player.getSnapshot().ready) await wait(100);
  await player.setSettings({ theme: (q.get("theme") ?? "stargazing") as never, volume: 0.8, spatialMode: shot === "sound" ? "orbit" : "off" });
  const ids = player.getSnapshot().tracks.map((t) => t.id);
  if (["now", "sound", "songs", "queue"].includes(shot)) {
    await player.playList(ids, 4); // "Slow Orbit"
    await wait(300);
    const cur = player.getSnapshot().tracks.find((t) => t.id === ids[4])!;
    await emit("engine", { type: "tick", serial: 1, path: cur.path, position: 96, duration: cur.duration, state: "playing", device: "MacBook Air Speakers" });
  }
  switch (shot) {
    case "now": await nav("Now Playing"); break;
    case "sound": await nav("Now Playing"); await click('button[aria-label^="Sound"]'); break;
    case "songs": await nav("Songs"); break;
    case "albums": await nav("Albums"); break;
    case "album": await nav("Albums"); await click(".album-card", "Quiet Hours"); break;
    case "track": player.openTrack(ids[4]); break;
    case "playlists": await nav("Playlists"); break;
    case "settings": await nav("Settings"); break;
    case "link": await nav("Songs"); await click("button", "From link"); await click(".dest .seg button", "New album"); break;
  }
  await wait(900);
  document.title = "ready";
}
