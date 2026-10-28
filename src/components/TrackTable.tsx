import { useEffect, useRef, useState } from "react";
import { player, usePlayer } from "../lib/player";
import { fmtTime } from "../lib/format";
import type { Track } from "../lib/types";
import { Icon } from "./Icons";
import { Artwork, Eq } from "./Artwork";

export function RowMenu({ track, onRemoveFromList }: { track: Track; onRemoveFromList?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { playlists } = usePlayer();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="icon-btn sm" aria-label="More" onClick={() => setOpen(!open)}><Icon name="more" /></button>
      {open && (
        <div className="menu">
          <button onClick={run(() => player.openTrack(track.id))}>Song info</button>
          <button onClick={run(() => player.enqueue([track.id], "next"))}>Play next</button>
          <button onClick={run(() => player.enqueue([track.id], "end"))}>Add to queue</button>
          <div className="sep" /><div className="lbl">Add to playlist</div>
          {playlists.length === 0 && <button disabled style={{ color: "var(--ink-3)" }}>No playlists yet</button>}
          {playlists.map((p) => <button key={p.id} onClick={run(() => void player.addToPlaylist(p.id, [track.id]))}>{p.name}</button>)}
          <div className="sep" />
          {onRemoveFromList && <button onClick={run(onRemoveFromList)}>Remove from this playlist</button>}
          <button onClick={run(() => void player.removeTrack(track.id, false))}>Remove from library</button>
          <button style={{ color: "var(--danger)" }} onClick={run(() => { if (confirm(`Delete the file for "${track.title}" from disk?`)) void player.removeTrack(track.id, true); })}>Delete file too…</button>
        </div>
      )}
    </div>
  );
}

export interface EditOps {
  onRemove: (t: Track) => void;
  /** Present when order matters (playlists). */
  onMove?: (from: number, to: number) => void;
}

export function TrackTable({ tracks, onRemoveFromList, edit }: { tracks: Track[]; onRemoveFromList?: (t: Track) => void; edit?: EditOps }) {
  const { queue, status, engineLoaded } = usePlayer();
  const curId = queue.index >= 0 ? queue.items[queue.index] : null;
  const ids = tracks.map((t) => t.id);
  const press = (t: Track, i: number) => {
    // Pressing play on the track that is already loaded toggles pause instead of restarting it.
    if (t.id === curId && engineLoaded) void player.togglePlay();
    else void player.playList(ids, i);
  };
  return (
    <div className="table" role="table">
      <div className="row head" role="row">
        <span>#</span><span>Song</span><span>Artist / Album</span><span>Time</span><span>Type</span><span />
      </div>
      {tracks.map((t, i) => {
        const isCur = t.id === curId && engineLoaded; // highlighted only once it has really been started
        const playing = isCur && status === "playing";
        return (
          <div key={`${t.id}-${i}`} role="row" className={`row ${t.missing ? "missing" : ""} ${isCur ? "current" : ""}`} onDoubleClick={() => press(t, i)}>
            <div className="lead-cell">
              <span className="idx">{isCur ? <Eq playing={playing} /> : i + 1}</span>
              <button className="icon-btn sm hov" aria-label={playing ? `Pause ${t.title}` : `Play ${t.title}`} onClick={() => press(t, i)}><Icon name={playing ? "pause" : "play"} /></button>
            </div>
            <div className="cell song" title={t.path}>
              <button className="thumb-btn" aria-label={`Open ${t.title} in Now Playing`} title="Play and open Now Playing" onClick={() => void player.playAndShow(t.id, ids)}>
                <Artwork track={t} size={40} radius={6} />
              </button>
              <div style={{ minWidth: 0 }}>
                <button className="title-link" onClick={() => player.openTrack(t.id)}>{t.title}</button>
                <div className="sub">{t.missing ? <span className="tag warn">File missing</span> : <>{t.artist || "Unknown artist"}</>}</div>
              </div>
            </div>
            <div className="cell">{t.album || "—"}</div>
            <div className="cell dur">{fmtTime(t.duration)}</div>
            <div className="cell"><span className="tag">{t.format || "?"}</span></div>
            <div className="acts">
              {edit?.onMove && (
                <>
                  <button className="icon-btn sm" aria-label="Move up" disabled={i === 0} onClick={() => edit.onMove!(i, i - 1)}><Icon name="up" /></button>
                  <button className="icon-btn sm" aria-label="Move down" disabled={i === tracks.length - 1} onClick={() => edit.onMove!(i, i + 1)}><Icon name="down" /></button>
                </>
              )}
              {edit && <button className="icon-btn sm danger" aria-label={`Remove ${t.title}`} onClick={() => edit.onRemove(t)}><Icon name="minus" /></button>}
              {!edit && <button className={`icon-btn sm ${t.favorite ? "on" : ""}`} aria-label={t.favorite ? "Remove favorite" : "Add favorite"} onClick={() => void player.toggleFavorite(t.id)}><Icon name={t.favorite ? "heartFill" : "heart"} /></button>}
              {!edit && <RowMenu track={t} onRemoveFromList={onRemoveFromList ? () => onRemoveFromList(t) : undefined} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
