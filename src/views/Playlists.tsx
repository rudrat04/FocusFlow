import { useEffect, useState } from "react";
import { player, usePlayer } from "../lib/player";
import { Icon } from "../components/Icons";
import { TrackTable } from "../components/TrackTable";
import { SongPicker } from "../components/SongPicker";
import { fmtTime } from "../lib/format";

export function Playlists() {
  const { playlists, tracks } = usePlayer();
  const [sel, setSel] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [picker, setPicker] = useState(false);
  useEffect(() => { if (sel === null || !playlists.some((p) => p.id === sel)) { setSel(playlists[0]?.id ?? null); setEditing(false); } }, [playlists, sel]);
  const pl = playlists.find((p) => p.id === sel);
  const plTracks = pl ? pl.trackIds.map((id) => tracks.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t) : [];
  const ids = plTracks.filter((t) => !t.missing).map((t) => t.id);

  const create = async () => {
    if (!name.trim()) return;
    const id = await player.createPlaylist(name);
    if (id !== null) { setName(""); setSel(id); setEditing(false); }
  };
  const save = async () => {
    if (!pl) return;
    if (!draft.trim()) { player.toast("error", "A playlist needs a name."); return; }
    if (draft.trim() !== pl.name) await player.renamePlaylist(pl.id, draft);
    setEditing(false);
  };
  const move = (from: number, to: number) => {
    if (!pl || to < 0 || to >= pl.trackIds.length) return;
    const next = pl.trackIds.slice();
    const [m] = next.splice(from, 1);
    next.splice(to, 0, m);
    void player.setPlaylistOrder(pl.id, next);
  };

  return (
    <div className="page">
      <h1>Playlists</h1>
      <p className="lead">Group songs for different kinds of work.</p>
      <div className="split">
        <div className="glass card side-list">
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input className="input" style={{ flex: 1, minWidth: 0 }} placeholder="New playlist" value={name} aria-label="New playlist name"
              onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
            <button className="icon-btn" aria-label="Create playlist" onClick={() => void create()}><Icon name="plus" /></button>
          </div>
          {playlists.length === 0 && <div className="note" style={{ padding: 8 }}>No playlists yet.</div>}
          {playlists.map((p) => (
            <button key={p.id} className={`pl-item ${p.id === sel ? "on" : ""}`} onClick={() => { setSel(p.id); setEditing(false); }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span><small>{p.trackIds.length}</small>
            </button>
          ))}
        </div>
        <div>
          {!pl ? <div className="glass empty"><p>Create a playlist, then add songs from the “…” menu in Songs.</p></div> : (
            <>
              <div className="pl-head">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="eyebrow">Playlist</div>
                  {editing ? <input className="input title-input" aria-label="Playlist name" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} />
                    : <h2 className="pl-title">{pl.name}</h2>}
                  <div className="song-sub" style={{ fontSize: 15 }}>{plTracks.length} song{plTracks.length === 1 ? "" : "s"} · {fmtTime(plTracks.reduce((s, t) => s + t.duration, 0))}</div>
                </div>
              </div>
              <div className="toolbar">
                {!editing ? (
                  <>
                    <button className="btn primary" disabled={ids.length === 0} onClick={() => void player.playList(ids, 0)}><Icon name="play" />Play</button>
                    <button className="btn" disabled={ids.length === 0} onClick={() => void player.playShuffled(ids)}><Icon name="shuffle" />Shuffle</button>
                    <button className="btn" onClick={() => { setDraft(pl.name); setEditing(true); }}><Icon name="edit" />Edit</button>
                  </>
                ) : (
                  <>
                    <button className="btn primary" onClick={() => void save()}>Done</button>
                    <button className="btn" onClick={() => setPicker(true)}><Icon name="plus" />Add songs</button>
                    <button className="btn danger" onClick={() => { if (confirm(`Delete playlist “${pl.name}”? Songs stay in your library.`)) void player.deletePlaylist(pl.id); }}><Icon name="trash" />Delete playlist</button>
                    <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
                  </>
                )}
              </div>
              {plTracks.length === 0 ? <div className="glass empty"><p>This playlist is empty. {editing ? "Use “Add songs”." : "Press Edit, then Add songs."}</p></div>
                : <TrackTable tracks={plTracks} onRemoveFromList={(t) => void player.removeFromPlaylist(pl.id, t.id)}
                    edit={editing ? { onRemove: (t) => void player.removeFromPlaylist(pl.id, t.id), onMove: move } : undefined} />}
              {picker && <SongPicker title={`Add songs to “${pl.name}”`} exclude={new Set(pl.trackIds)} onClose={() => setPicker(false)} onAdd={(add) => void player.addToPlaylist(pl.id, add)} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
