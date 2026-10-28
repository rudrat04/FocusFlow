import { useEffect, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { api } from "./lib/api";
import type { EngineEvent } from "./lib/types";
import { THEME_BY_ID, type ThemeId } from "./themes";
import { fmtTime } from "./lib/format";
import { Icon } from "./components/Icons";
import { Slider } from "./components/bits";

export interface MiniMeta { id: number | null; path: string | null; title: string; artist: string; album: string; favorite: boolean; art: string | null; theme: ThemeId }
interface Tick { path: string | null; position: number; duration: number; state: "playing" | "paused" | "stopped" }

/** The small floating player. It owns no playback state: the main window tells it what is playing. */
export function MiniApp() {
  const [meta, setMeta] = useState<MiniMeta | null>(null);
  const [tick, setTick] = useState<Tick>({ path: null, position: 0, duration: 0, state: "stopped" });
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const subs: Promise<() => void>[] = [];
    subs.push(listen<MiniMeta>("mini-state", (e) => {
      setMeta(e.payload);
      void emit("mini-ack", { title: e.payload.title });
    }));
    subs.push(listen<EngineEvent>("engine", (e) => {
      if (e.payload.type === "tick") setTick({ path: e.payload.path, position: e.payload.position, duration: e.payload.duration, state: e.payload.state });
    }));
    void emit("mini-hello");
    const visible = () => void api.engineSetUiActive("mini", !document.hidden).catch(() => {});
    document.addEventListener("visibilitychange", visible);
    visible();
    return () => {
      document.removeEventListener("visibilitychange", visible);
      void api.engineSetUiActive("mini", false).catch(() => {});
      subs.forEach((p) => void p.then((un) => un()));
    };
  }, []);

  // Theme colours
  const theme = THEME_BY_ID[meta?.theme ?? "stargazing"] ?? THEME_BY_ID.stargazing;
  useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty("--accent", theme.accent);
    const n = parseInt(theme.accent.slice(1), 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    r.setProperty("--on-accent", lum > 0.62 ? "#0b1018" : "#ffffff");
  }, [theme]);

  const mine = meta?.path != null && tick.path === meta.path;
  const playing = mine && tick.state === "playing";
  const position = mine ? tick.position : 0;
  const duration = mine ? tick.duration : 0;

  const toggle = () => {
    if (tick.state === "stopped") void emit("mini-cmd", "toggle"); // the main window has to choose a track
    else if (tick.state === "playing") void api.enginePause();
    else void api.engineCancelFade().then(() => api.engineResume());
  };
  const cmd = (c: string) => void emit("mini-cmd", c);

  return (
    <div className="mini" style={{ background: `linear-gradient(160deg, ${theme.sky[1]}, ${theme.sky[theme.sky.length - 1]})` }}>
      <div className="mini-art" style={meta?.art ? undefined : { background: "rgba(255,255,255,0.08)" }}>
        {meta?.art ? <img src={meta.art} alt="" draggable={false} /> : <span>♪</span>}
      </div>
      <div className="mini-body">
        <div className="mini-text" data-tauri-drag-region>
          <b>{meta?.title ?? "Nothing playing"}</b>
          <small>{meta ? ([meta.artist, meta.album].filter(Boolean).join(" — ") || "Local file") : "Start something in FocusFlow"}</small>
        </div>
        <div className="mini-progress">
          <span>{fmtTime(position)}</span>
          <Slider label="Seek" value={Math.min(position, Math.max(duration, 1))} max={Math.max(duration, 1)} step={0.1} disabled={!mine} onChange={(v) => void api.engineSeek(v)} />
          <span>-{fmtTime(Math.max(0, duration - position))}</span>
        </div>
        <div className="mini-controls">
          <button className={`icon-btn sm ${meta?.favorite ? "on" : ""}`} aria-label="Favorite" disabled={!meta?.id} onClick={() => cmd("fav")}><Icon name={meta?.favorite ? "heartFill" : "heart"} /></button>
          <button className="icon-btn" aria-label="Previous" onClick={() => cmd("prev")}><Icon name="prev" /></button>
          <button className="icon-btn big" aria-label={playing ? "Pause" : "Play"} onClick={toggle}><Icon name={playing ? "pause" : "play"} /></button>
          <button className="icon-btn" aria-label="Next" onClick={() => cmd("next")}><Icon name="next" /></button>
          <button className={`icon-btn sm ${pinned ? "on" : ""}`} aria-label={pinned ? "Unpin from top" : "Keep on top"} title={pinned ? "Floating above other windows" : "Not floating"} onClick={() => { setPinned(!pinned); void api.miniSetPinned(!pinned); }}><Icon name="pin" /></button>
          <button className="icon-btn sm" aria-label="Open FocusFlow" title="Open FocusFlow" onClick={() => cmd("open")}><Icon name="expand" /></button>
        </div>
      </div>
    </div>
  );
}
