import { useEffect, useState, type ReactNode } from "react";

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)} />;
}

export function Slider({ value, min = 0, max = 1, step = 0.001, onChange, label, disabled, onCommit }: {
  value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; label: string; disabled?: boolean; onCommit?: (v: number) => void;
}) {
  const p = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range" className="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled}
      style={{ ["--p" as string]: `${p}%` }}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      onPointerUp={(e) => onCommit?.(parseFloat((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => onCommit?.(parseFloat((e.target as HTMLInputElement).value))}
    />
  );
}

export function Setting({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="l"><b>{title}</b>{hint && <span>{hint}</span>}</div>
      <div className="r">{children}</div>
    </div>
  );
}

export function artStyle(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const a = h % 360, b = (a + 40 + (h >> 8) % 60) % 360;
  return { background: `radial-gradient(circle at 30% 25%, hsl(${a} 60% 62% / .9), transparent 55%), linear-gradient(145deg, hsl(${b} 45% 22%), hsl(${a} 55% 10%))` };
}
