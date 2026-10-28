import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icons";

/** An icon button that opens a menu. Closes on outside click or Escape. */
export function PopMenu({ icon, label, active, align = "center", children }: { icon: string; label: string; active?: boolean; align?: "center" | "left" | "right"; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="pop-wrap">
      <button className={`icon-btn ${active ? "on" : ""} ${open ? "open" : ""}`} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={icon} />
      </button>
      {open && <div className={`menu up pop ${align}`} role="menu" aria-label={label}>{children(() => setOpen(false))}</div>}
    </div>
  );
}
