import { useMemo, useState } from "react";
import { player, usePlayer } from "../lib/player";
import { Icon } from "../components/Icons";
import { TrackTable } from "../components/TrackTable";

export function EmptyLibrary() {
  const { libraryDir } = usePlayer();
  return (
    <div className="glass empty">
      <h2>Your library is empty</h2>
      <p>FocusFlow plays audio files stored on this Mac. It ships with no music, so add tracks you own or are licensed to use.</p>
      <div className="steps">
        <div>1. Click <b>Import files</b> or <b>Import folder</b>, or drag audio files onto this window.</div>
        <div>2. Or drop files into your library folder and press <b>Rescan</b>:</div>
        <div style={{ margin: "6px 0 6px 16px" }}><span className="code">{libraryDir || "~/Music/FocusFlow"}</span></div>
        <div>3. Or use <b>Add from link</b> to download a long mix and split it by its chapter timestamps (needs <span className="code">yt-dlp</span> and <span className="code">ffmpeg</span>).</div>
      </div>
      <div className="row-actions">
        <button className="btn primary" onClick={() => void player.pickFiles()}><Icon name="plus" />Import files</button>
        <button className="btn" onClick={() => void player.pickFolder()}><Icon name="folder" />Import folder</button>
        <button className="btn" onClick={() => player.setImportLinkOpen(true)}><Icon name="link" />Add from link</button>
      </div>
      <p className="note" style={{ marginTop: 18 }}>MP3, M4A/AAC, WAV and FLAC are supported. Duplicates are detected by content and skipped.</p>
    </div>
  );
}

export function Library() {
  const { tracks, importing, search: q } = usePlayer();
  const setQ = (v: string) => player.setSearch(v);
  const [filter, setFilter] = useState<"all" | "favorites" | "missing">("all");
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tracks.filter((t) => {
      if (filter === "favorites" && !t.favorite) return false;
      if (filter === "missing" && !t.missing) return false;
      return !needle || `${t.title} ${t.artist} ${t.album} ${t.format}`.toLowerCase().includes(needle);
    });
  }, [tracks, q, filter]);
  const missing = tracks.filter((t) => t.missing).length;

  return (
    <div className="page">
      <h1>Songs</h1>
      <p className="lead">{tracks.length} track{tracks.length === 1 ? "" : "s"}{missing ? ` · ${missing} missing` : ""}</p>
      <div className="toolbar">
        <div className="search"><Icon name="search" /><input placeholder="Search title, artist, album" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search library" /></div>
        <div className="seg">
          {(["all", "favorites", "missing"] as const).map((f) => <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>)}
        </div>
        <button className="btn" disabled={importing} onClick={() => void player.pickFiles()}><Icon name="plus" />Files</button>
        <button className="btn" disabled={importing} onClick={() => void player.pickFolder()}><Icon name="folder" />Folder</button>
        <button className="btn" onClick={() => player.setImportLinkOpen(true)}><Icon name="link" />From link</button>
        <button className="btn" disabled={importing} onClick={() => void player.rescan()}><Icon name="refresh" />{importing ? "Working…" : "Rescan"}</button>
      </div>
      {tracks.length === 0 ? <EmptyLibrary /> : list.length === 0 ? <div className="glass empty"><p>No tracks match your search.</p></div> : (
        <>
          <div className="toolbar">
            <button className="btn primary" onClick={() => void player.playList(list.map((t) => t.id), 0)}><Icon name="play" />Play {list.length === tracks.length ? "all" : "these"}</button>
            <button className="btn" onClick={() => player.enqueue(list.map((t) => t.id), "end")}>Add all to queue</button>
          </div>
          <TrackTable tracks={list} />
        </>
      )}
    </div>
  );
}
