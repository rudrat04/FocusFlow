import { useState } from "react";
import { player, usePlayer, type ImportDest } from "../lib/player";
import { Icon } from "./Icons";

export function ImportLink() {
  const { showImportLink, ytJobs, tools } = usePlayer();
  const [links, setLinks] = useState("");
  const [manual, setManual] = useState("");
  const [kind, setKind] = useState<ImportDest["kind"]>("library");
  const [name, setName] = useState("");
  const [auto, setAuto] = useState(true);
  if (!showImportLink) return null;
  const busy = ytJobs.some((j) => j.status === "running" || j.status === "queued");
  const missing = tools && (!tools.ytdlp || !tools.ffmpeg);
  const urls = links.split(/\s+/).filter(Boolean);
  const needName = kind !== "library";
  const dest: ImportDest = kind === "library" ? { kind } : { kind, name };
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) player.setImportLinkOpen(false); }}>
      <div className="glass modal" role="dialog" aria-label="Add music from a link">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div><h2>Add from link</h2>
            <p className="note" style={{ margin: "0 0 14px" }}>Downloads the audio, splits it at the video’s chapter timestamps, and saves each part as its own MP3 track. Only import audio you have the right to keep; downloading may be against a site’s terms.</p></div>
          <button className="icon-btn" aria-label="Close" onClick={() => player.setImportLinkOpen(false)}><Icon name="x" /></button>
        </div>
        {missing && <div className="toast error" style={{ marginBottom: 12, cursor: "default" }}>Needs {!tools?.ytdlp && "yt-dlp"}{!tools?.ytdlp && !tools?.ffmpeg && " and "}{!tools?.ffmpeg && "ffmpeg"}. In Terminal run: <span className="code">brew install yt-dlp ffmpeg</span></div>}
        <label className="note" htmlFor="links">Links (one per line)</label>
        <textarea id="links" className="input" rows={4} placeholder="https://www.youtube.com/watch?v=…" value={links} onChange={(e) => setLinks(e.target.value)} />
        <label className="check-row">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span className="check-box" aria-hidden="true">{auto && <Icon name="check" />}</span>
          <span><b>Find the tracks automatically</b>
            <small>If a video has no chapters, FocusFlow looks for a track list in the description or top comments, then for silence between tracks. Album and playlist links (such as YouTube Music albums) are always split into their own tracks.</small></span>
        </label>
        <label className="note" htmlFor="chap" style={{ display: "block", marginTop: 12 }}>Your own timestamps (optional; used first when a video has no chapters)</label>
        <textarea id="chap" className="input" rows={4} placeholder={"0:00 Opening\n4:32 Second piece\n9:10 Third piece"} value={manual} onChange={(e) => setManual(e.target.value)} />
        <div className="dest">
          <div className="note" style={{ marginBottom: 8 }}>Where should the new tracks go?</div>
          <div className="seg" role="group" aria-label="Destination">
            <button className={kind === "library" ? "on" : ""} onClick={() => setKind("library")}>Music library</button>
            <button className={kind === "album" ? "on" : ""} onClick={() => setKind("album")}>New album</button>
            <button className={kind === "playlist" ? "on" : ""} onClick={() => setKind("playlist")}>New playlist</button>
          </div>
          {needName && <input className="input" style={{ width: "100%", marginTop: 10 }} aria-label={kind === "album" ? "Album name" : "Playlist name"}
            placeholder={kind === "album" ? "Album name" : "Playlist name"} value={name} onChange={(e) => setName(e.target.value)} />}
          <div className="note" style={{ marginTop: 8 }}>
            {kind === "library" ? "Tracks are added to your library only." : kind === "album" ? "Every track from these links gets this album name." : "Every track from these links is also added to a new playlist with this name."}
          </div>
        </div>
        <div className="row-actions" style={{ justifyContent: "flex-end" }}>
          <button className="btn" onClick={() => player.clearJobs()} disabled={ytJobs.length === 0}>Clear finished</button>
          <button className="btn primary" disabled={busy || urls.length === 0 || !!missing || (needName && !name.trim())} onClick={() => { void player.importLinks(urls, manual.trim() || null, dest, auto); setLinks(""); }}>
            <Icon name="link" />{busy ? "Working…" : `Import ${urls.length || ""} link${urls.length === 1 ? "" : "s"}`}
          </button>
        </div>
        {ytJobs.map((j) => (
          <div key={j.url} className={`job ${j.status}`}>
            <div className="u">{j.url}</div>
            {j.status === "running" && <div className="bar" style={{ margin: "8px 0 0", maxWidth: "none" }}><i style={{ width: `${j.percent ?? 4}%` }} /></div>}
            <div className="m">{j.status === "queued" ? "Waiting…" : j.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
