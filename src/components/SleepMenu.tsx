import { useEffect, useRef, useState } from "react";
import { player, usePlayer } from "../lib/player";
import { Icon } from "./Icons";
import { useNow } from "./bits";
import { sleepRemainingMs } from "../lib/timers";
import { fmtClock } from "../lib/format";

export function SleepMenu() {
  const { sleep, settings, fading } = usePlayer();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const now = useNow(sleep ? 1000 : 60000);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className={`icon-btn ${sleep ? "on" : ""}`} aria-label="Sleep timer" title="Sleep timer" onClick={() => setOpen(!open)}><Icon name="moon" /></button>
      {open && (
        <div className="menu up">
          <div className="lbl">Sleep timer</div>
          {sleep ? (
            <>
              <div style={{ padding: "4px 10px 8px", fontSize: 22, fontWeight: 300, fontVariantNumeric: "tabular-nums" }}>{fmtClock(sleepRemainingMs(sleep, now))}</div>
              <div className="note" style={{ padding: "0 10px 8px" }}>{fading ? "Fading out…" : `Fades over ${Math.round(sleep.fadeMs / 1000)} s, then stops.`}</div>
              <button onClick={() => { player.cancelSleepTimer(); setOpen(false); }}>Cancel timer</button>
            </>
          ) : (
            <>
              {[15, 30, 45, 60, 90].map((m) => <button key={m} onClick={() => { player.startSleepTimer(m); setOpen(false); }}>{m} minutes</button>)}
              <div className="sep" />
              <div className="note" style={{ padding: "2px 10px 6px" }}>Fade length is set in Settings ({settings.sleepFadeSecs} s).</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
