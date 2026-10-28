import { useMemo, useState } from "react";
import { usePlayer } from "../lib/player";
import { fmtTime } from "../lib/format";
import { Icon } from "./Icons";
import { Artwork } from "./Artwork";

/** Modal list of library songs with checkboxes, used to add songs to an album or playlist. */
export function SongPicker({ title, exclude, onClose, onAdd, nameLabel }: { title: string; exclude: Set<number>; onClose: () => void; onAdd: (ids: number[], name: string) => void; nameLabel?: string }) {
  const { tracks } = usePlayer();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [name, setName] = useState("");
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tracks.filter((t) => !exclude.has(t.id) && (!needle || `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(needle)));
  }, [tracks, exclude, q]);
  const toggle = (id: number) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass modal" role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        {nameLabel && <input className="input" style={{ width: "100%", marginBottom: 10 }} placeholder={nameLabel} aria-label={nameLabel} value={name} onChange={(e) => setName(e.target.value)} />}
        <div className="search" style={{ marginBottom: 10 }}><Icon name="search" /><input autoFocus placeholder="Search your songs" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search songs" /></div>
        <div className="picker-list">
          {list.length === 0 && <div className="note" style={{ padding: 16 }}>{tracks.length === 0 ? "Your library is empty." : "No songs to add."}</div>}
          {list.map((t) => (
            <label key={t.id} className={`pick ${sel.has(t.id) ? "on" : ""}`}>
              <input type="checkbox" checked={sel.has(t.id)} onChange={() => toggle(t.id)} />
              <span className="check" aria-hidden="true">{sel.has(t.id) && <Icon name="check" />}</span>
              <Artwork track={t} size={36} radius={6} />
              <span className="pick-text"><b>{t.title}</b><small>{[t.artist, t.album].filter(Boolean).join(" — ") || "—"}</small></span>
              <span className="dur">{fmtTime(t.duration)}</span>
            </label>
          ))}
        </div>
        <div className="row-actions" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={sel.size === 0 || (!!nameLabel && !name.trim())} onClick={() => { onAdd([...sel], name.trim()); onClose(); }}>{nameLabel ? "Create" : "Add"} {sel.size || ""} song{sel.size === 1 ? "" : "s"}</button>
        </div>
      </div>
    </div>
  );
}
