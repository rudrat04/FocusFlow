import { useRef, useState } from "react";
import { player, usePlayer, usePosition } from "../lib/player";
import { fmtTime } from "../lib/format";
import { Icon } from "../components/Icons";
import { Slider } from "../components/bits";
import { Artwork, Eq } from "../components/Artwork";
import { SoundMenu } from "../components/StageControls";

/** The progress bar: the only part of Now Playing that updates every half second. */
function SeekRow({ loaded, fallbackDuration }: { loaded: boolean; fallbackDuration: number }) {
  const { duration } = usePlayer();
  const position = usePosition();
  const max = Math.max(duration || fallbackDuration, 1);
  const shown = loaded ? position : 0;
  return (
    <div className="progress" style={{ width: "min(520px, 100%)" }}>
      <span>{fmtTime(shown)}</span>
      <Slider label="Seek" value={Math.min(shown, max)} max={max} step={0.1} disabled={!loaded} onChange={(v) => void player.seek(v)} />
      <span>-{fmtTime(Math.max(0, max - shown))}</span>
    </div>
  );
}

export function NowPlaying() {
  const listRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  /** Pointer-based reordering (works regardless of the webview's native drag-and-drop). */
  const rowAt = (y: number, fallback: number) => {
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>(".q-item") ?? [])];
    for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (y >= r.top && y <= r.bottom) return i; }
    if (rows.length && y < rows[0].getBoundingClientRect().top) return 0;
    if (rows.length && y > rows[rows.length - 1].getBoundingClientRect().bottom) return rows.length - 1;
    return fallback;
  };
  const { queue, tracks, settings, status, engineLoaded } = usePlayer();
  const cur = queue.index >= 0 ? tracks.find((t) => t.id === queue.items[queue.index]) : undefined;
  const loaded = !!cur && engineLoaded;

  if (tracks.length === 0) {
    return (
      <div className="np2"><div className="np2-main" style={{ justifyContent: "center", textAlign: "center" }}>
        <h1 className="np-title">FocusFlow</h1>
        <div className="np-sub">Deep work, scored by you</div>
        <p className="empty-hero" style={{ margin: "26px auto 0" }}>
          Your library is empty. Add music you own or are licensed to use: drop audio files onto this window,
          or import a file, a folder, or a link.
        </p>
        <div className="row-actions">
          <button className="btn primary" onClick={() => void player.pickFiles()}><Icon name="plus" />Import files</button>
          <button className="btn" onClick={() => void player.pickFolder()}><Icon name="folder" />Import folder</button>
          <button className="btn" onClick={() => player.setImportLinkOpen(true)}><Icon name="link" />Add from link</button>
        </div>
      </div></div>
    );
  }

  return (
    <div className="np2">
      <section className="np2-main">
        <div className="stage"><Artwork track={cur} radius={22} className="stage-art" /></div>
        <div className="np2-meta">
          <div style={{ minWidth: 0 }}>
            <button className="np2-title" disabled={!cur} onClick={() => cur && player.openTrack(cur.id)}>{cur?.title ?? "Nothing playing"}</button>
            <div className="np2-sub">{cur ? ([cur.artist, cur.album].filter(Boolean).join(" — ") || "Local file") : "Press play to start"}</div>
          </div>
          {cur && <button className={`icon-btn ${cur.favorite ? "on" : ""}`} aria-label="Favorite" onClick={() => void player.toggleFavorite(cur.id)}><Icon name={cur.favorite ? "heartFill" : "heart"} /></button>}
        </div>
        <SeekRow loaded={loaded} fallbackDuration={cur?.duration ?? 0} />
        <div className="buttons" style={{ marginTop: 6 }}>
          <SoundMenu />
          <button className={`icon-btn ${settings.shuffle ? "on" : ""}`} aria-label="Shuffle" aria-pressed={settings.shuffle} onClick={() => player.toggleShuffle()}><Icon name="shuffle" /></button>
          <button className="icon-btn" aria-label="Previous" onClick={() => void player.prev()}><Icon name="prev" /></button>
          <button className="play-btn" aria-label={status === "playing" ? "Pause" : "Play"} onClick={() => void player.togglePlay()}><Icon name={status === "playing" ? "pause" : "play"} /></button>
          <button className="icon-btn" aria-label="Next" onClick={() => void player.next()}><Icon name="next" /></button>
          <button className={`icon-btn ${settings.repeat !== "off" ? "on" : ""}`} aria-label={`Repeat ${settings.repeat}`} onClick={() => player.cycleRepeat()}>
            <Icon name="repeat" />{settings.repeat === "one" && <span className="badge">1</span>}
          </button>
          <span className="icon-btn" aria-hidden="true" style={{ visibility: "hidden" }} />
        </div>
      </section>

      <aside className="glass queue" aria-label="Queue">
        <h3>Up next <span>{queue.items.length}</span></h3>
        <div className="q-list" ref={listRef}>
          {queue.items.length === 0 && <div className="note" style={{ padding: 14 }}>The queue is empty. Play something from your library.</div>}
          {queue.items.map((id, i) => {
            const t = tracks.find((x) => x.id === id);
            if (!t) return null;
            const isCur = i === queue.index && engineLoaded;
            return (
              <div key={`${id}-${i}`} className={`q-item ${i === queue.index ? "cur" : ""} ${t.missing ? "bad" : ""} ${drag?.from === i ? "dragging" : ""} ${drag && drag.over === i && drag.from !== i ? (drag.over > drag.from ? "drop-after" : "drop-before") : ""}`} onDoubleClick={() => void player.playFromQueue(i)}>
                <span className="q-grip" role="button" aria-label={`Drag to reorder ${t.title}`} title="Drag to reorder"
                  onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDrag({ from: i, over: i }); }}
                  onPointerMove={(e) => { if (drag?.from === i) setDrag({ from: i, over: rowAt(e.clientY, drag.over) }); }}
                  onPointerUp={(e) => { if (drag?.from === i) { const to = rowAt(e.clientY, drag.over); setDrag(null); if (to !== i) player.moveInQueue(i, to); } }}
                  onPointerCancel={() => setDrag(null)}>
                  <Icon name="grip" />
                </span>
                <Artwork track={t} size={36} radius={6} />
                <div style={{ minWidth: 0 }}><div className="tt">{t.title}</div><div className="ss">{t.artist || t.album || "—"}</div></div>
                {isCur ? <Eq playing={status === "playing"} /> : <span className="dur">{fmtTime(t.duration)}</span>}
                <span className="acts" role="group" aria-label={`Actions for ${t.title}`}>
                  <button aria-label="Move up" title="Move up" disabled={i === 0} onClick={() => player.moveInQueue(i, i - 1)}><Icon name="up" /></button>
                  <button aria-label="Move down" title="Move down" disabled={i === queue.items.length - 1} onClick={() => player.moveInQueue(i, i + 1)}><Icon name="down" /></button>
                  <button className="rm" aria-label="Remove from queue" title="Remove from queue" onClick={() => player.removeFromQueue(i)}><Icon name="x" /></button>
                </span>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
