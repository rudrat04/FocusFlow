import { useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { player, usePlayer } from "../lib/player";
import { fmtSize, fmtTime } from "../lib/format";
import { Icon } from "../components/Icons";
import { Artwork, Eq } from "../components/Artwork";
import { RowMenu } from "../components/TrackTable";

export function TrackPage() {
  const { trackPageId, tracks, queue, status, engineLoaded, playlists } = usePlayer();
  const [edit, setEdit] = useState<{ title: string; artist: string; album: string } | null>(null);
  const t = tracks.find((x) => x.id === trackPageId);
  if (!t) {
    return <div className="page"><button className="btn" onClick={() => player.setView("library")}>← Library</button><div className="glass empty" style={{ marginTop: 16 }}><p>That track is no longer in your library.</p></div></div>;
  }
  const curId = queue.index >= 0 ? queue.items[queue.index] : null;
  const isCur = t.id === curId && engineLoaded;
  const playing = isCur && status === "playing";
  const inLists = playlists.filter((p) => p.trackIds.includes(t.id));
  const allIds = tracks.filter((x) => !x.missing).map((x) => x.id);
  const rows: [string, string][] = [
    ["Duration", fmtTime(t.duration)],
    ["Format", t.format || "—"],
    ["Sample rate", t.sampleRate ? `${(t.sampleRate / 1000).toFixed(1)} kHz` : "—"],
    ["Channels", t.channels === 1 ? "Mono" : t.channels === 2 ? "Stereo" : String(t.channels)],
    ["File size", fmtSize(t.size)],
    ["Added", t.addedAt ? new Date(t.addedAt * 1000).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "—"],
    ["In playlists", inLists.length ? inLists.map((p) => p.name).join(", ") : "None"],
  ];

  return (
    <div className="page">
      <button className="back" onClick={() => player.setView("library")}>‹ Library</button>
      <div className="song-head">
        <div className="song-art"><Artwork track={t} radius={18} className="stage-art" /></div>
        <div className="song-info">
          <div className="eyebrow">{t.missing ? "File missing" : isCur ? (playing ? "Now playing" : "Paused") : "Song"}</div>
          {edit ? (
            <div className="edit-fields">
              <input className="input title-input" aria-label="Title" autoFocus value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
              <div className="two-fields">
                <input className="input" aria-label="Artist" placeholder="Artist" value={edit.artist} onChange={(e) => setEdit({ ...edit, artist: e.target.value })} />
                <input className="input" aria-label="Album" placeholder="Album" value={edit.album} onChange={(e) => setEdit({ ...edit, album: e.target.value })} />
              </div>
              <div className="toolbar" style={{ marginBottom: 0 }}>
                <button className="btn primary" onClick={async () => { if (await player.updateTrack(t.id, edit.title, edit.artist, edit.album)) setEdit(null); }}>Save</button>
                <button className="btn" onClick={() => setEdit(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <h1>{t.title}</h1>
              <div className="song-sub">{[t.artist, t.album].filter(Boolean).join(" — ") || "Unknown artist"}</div>
            </>
          )}
          <div className="toolbar" style={{ marginTop: 20 }}>
            <button className="btn primary" disabled={t.missing} onClick={() => (isCur ? void player.togglePlay() : void player.playList(allIds, allIds.indexOf(t.id)))}>
              {playing ? <Icon name="pause" /> : <Icon name="play" />}{playing ? "Pause" : "Play"}
            </button>
            <button className="btn" onClick={() => player.enqueue([t.id], "next")}>Play next</button>
            <button className="btn" onClick={() => player.enqueue([t.id], "end")}>Add to queue</button>
            <button className={`icon-btn ${t.favorite ? "on" : ""}`} aria-label={t.favorite ? "Remove favorite" : "Add favorite"} onClick={() => void player.toggleFavorite(t.id)}><Icon name={t.favorite ? "heartFill" : "heart"} /></button>
            <RowMenu track={t} />
            {!edit && <button className="icon-btn" aria-label="Edit title, artist and album" title="Edit details" onClick={() => setEdit({ title: t.title, artist: t.artist, album: t.album })}><Icon name="edit" /></button>}
            {isCur && <Eq playing={playing} />}
          </div>
        </div>
      </div>

      <div className="glass card" style={{ marginTop: 22 }}>
        <h3>Details</h3>
        {rows.map(([k, v]) => <div key={k} className="detail"><span>{k}</span><b>{v}</b></div>)}
        <div className="detail"><span>File</span><b className="path">{t.path}</b></div>
        {t.sourceUrl && <div className="detail"><span>Source</span><b className="path">{t.sourceUrl}</b></div>}
        <div className="toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
          <button className="btn" onClick={() => void revealItemInDir(t.path).catch(() => player.toast("error", "The file is not there any more."))}>Show in Finder</button>
        </div>
      </div>
    </div>
  );
}
