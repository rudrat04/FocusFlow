import { useMemo, useState } from "react";
import { player, usePlayer } from "../lib/player";
import { fmtTime } from "../lib/format";
import { Icon } from "../components/Icons";
import { Artwork } from "../components/Artwork";
import { TrackTable } from "../components/TrackTable";
import { SongPicker } from "../components/SongPicker";
import type { Track } from "../lib/types";

const UNKNOWN = "Unknown album";

export function Albums() {
  const { tracks } = usePlayer();
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [picker, setPicker] = useState<"add" | "new" | null>(null);

  const albums = useMemo(() => {
    const m = new Map<string, Track[]>();
    for (const t of tracks) {
      const k = t.album.trim() || UNKNOWN;
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [tracks]);

  const list = sel ? albums.find(([n]) => n === sel)?.[1] : undefined;
  const leave = () => { setSel(null); setEditing(false); };

  if (sel && !list && !picker) {
    // The album emptied out (every song removed or renamed away).
    queueMicrotask(leave);
    return null;
  }
  if (sel && list) {
    const ids = list.filter((t) => !t.missing).map((t) => t.id);
    const total = list.reduce((s, t) => s + t.duration, 0);
    const save = async () => {
      const n = name.trim();
      if (n && n !== sel) { if (await player.renameAlbum(sel, n)) setSel(n); } else if (!n) { player.toast("error", "An album needs a name."); return; }
      setEditing(false);
    };
    return (
      <div className="page">
        <button className="back" onClick={leave}>‹ Albums</button>
        <div className="song-head">
          <div className="song-art" style={{ width: 220 }}><Artwork track={list.find((t) => t.hasArt) ?? list[0]} radius={16} className="stage-art" /></div>
          <div className="song-info">
            <div className="eyebrow">Album</div>
            {editing ? (
              <input className="input title-input" aria-label="Album name" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} />
            ) : <h1>{sel}</h1>}
            <div className="song-sub">{list.length} song{list.length === 1 ? "" : "s"} · {fmtTime(total)}</div>
            <div className="toolbar" style={{ marginTop: 18 }}>
              {!editing ? (
                <>
                  <button className="btn primary" disabled={ids.length === 0} onClick={() => void player.playList(ids, 0)}><Icon name="play" />Play</button>
                  <button className="btn" disabled={ids.length === 0} onClick={() => void player.playShuffled(ids)}><Icon name="shuffle" />Shuffle</button>
                  <button className="btn" disabled={ids.length === 0} onClick={() => player.enqueue(ids, "end")}>Add to queue</button>
                  <button className="btn" onClick={() => { setName(sel === UNKNOWN ? "" : sel); setEditing(true); }}><Icon name="edit" />Edit</button>
                </>
              ) : (
                <>
                  <button className="btn primary" onClick={() => void save()}>Done</button>
                  <button className="btn" onClick={() => setPicker("add")}><Icon name="plus" />Add songs</button>
                  <button className="btn danger" onClick={() => { if (confirm(`Delete the album “${sel}”? Its ${list.length} songs stay in your library.`)) { void player.setAlbumFor(list.map((t) => t.id), ""); leave(); } }}><Icon name="trash" />Delete album</button>
                  <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
                </>
              )}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 18 }}>
          <TrackTable tracks={list} edit={editing ? { onRemove: (t) => void player.setAlbumFor([t.id], "") } : undefined} />
        </div>
        {picker === "add" && <SongPicker title={`Add songs to “${sel}”`} exclude={new Set(list.map((t) => t.id))} onClose={() => setPicker(null)} onAdd={(add) => void player.setAlbumFor(add, sel)} />}
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Albums</h1>
          <p className="lead">{albums.length} album{albums.length === 1 ? "" : "s"}. Imported links can be saved straight into an album.</p></div>
        <button className="btn" onClick={() => setPicker("new")} disabled={tracks.length === 0}><Icon name="plus" />New album</button>
      </div>
      {albums.length === 0 ? <div className="glass empty"><p>No music yet. Import something from Songs.</p></div> : (
        <div className="grid-albums">
          {albums.map(([n, ts]) => (
            <button key={n} className="album-card" onClick={() => setSel(n)}>
              <Artwork track={ts.find((t) => t.hasArt) ?? ts[0]} radius={12} className="stage-art" />
              <div className="album-name">{n}</div>
              <div className="album-sub">{ts.length} song{ts.length === 1 ? "" : "s"}</div>
            </button>
          ))}
        </div>
      )}
      {picker === "new" && (
        <SongPicker title="New album" nameLabel="Album name" exclude={new Set()} onClose={() => setPicker(null)}
          onAdd={(ids, nm) => void player.setAlbumFor(ids, nm).then(() => setSel(nm))} />
      )}
    </div>
  );
}
