import { useEffect, useMemo, useRef } from "react";
import { THEME_BY_ID, layerPath, type ThemeId } from "../themes";

/**
 * Generated landscape; no photographs, so nothing is licensed or copied.
 * Everything is static (the stars are painted once), so the scene costs no CPU or GPU while music plays.
 */

function useStars(show: boolean, milkyway: boolean | undefined) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const g = c.getContext("2d")!;
    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth, h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (!show) return;
      let seed = 1337;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      const count = Math.floor((w * h) / 1500);
      for (let i = 0; i < count; i++) {
        const x = rnd() * w, y = rnd() * h * 0.72;
        if (milkyway) {
          const d = Math.abs(y - h * 0.34 + (x - w * 0.5) * 0.45) / (h * 0.3);
          if (rnd() > 0.35 + 0.65 * Math.exp(-d * d * 2.2)) continue;
        } else if (rnd() > 0.55) continue;
        const r = rnd() < 0.04 ? 1.3 : rnd() * 0.75 + 0.2;
        const a = 0.25 + rnd() * 0.75;
        g.fillStyle = rnd() < 0.25 ? `rgba(255,226,190,${a})` : `rgba(210,225,255,${a})`;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(c);
    return () => ro.disconnect();
  }, [show, milkyway]);
  return ref;
}

export function Scene({ themeId }: { themeId: ThemeId }) {
  const theme = THEME_BY_ID[themeId] ?? THEME_BY_ID.stargazing;
  const canvas = useStars(theme.particles === "stars", theme.milkyway);
  // Each landscape layer becomes a cached bitmap, so complex outlines (pines) are never re-rasterised.
  const images = useMemo(
    () => theme.layers.map((l) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 200" preserveAspectRatio="none"><path d="${layerPath(l)}" fill="${l.color}"/></svg>`;
      return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    }),
    [theme],
  );

  useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty("--accent", theme.accent);
    r.setProperty("--glass", theme.glass);
    // Light accents (mountains) need dark text on filled buttons.
    const n = parseInt(theme.accent.slice(1), 16);
    const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    r.setProperty("--on-accent", lum > 0.62 ? "#0b1018" : "#ffffff");
  }, [theme]);

  const stops = theme.sky.map((c, i) => `${c} ${Math.round((i / (theme.sky.length - 1)) * 100)}%`).join(", ");
  return (
    <div className="scene" aria-hidden="true" style={{ background: `linear-gradient(180deg, ${stops})` }}>
      {theme.milkyway && <div className="band" />}
      {theme.aurora && <div className="aurora-bands"><i /><i /><i /></div>}
      {theme.moon && <div className="moon" />}
      <canvas ref={canvas} />
      <div className="glow" style={{ background: `radial-gradient(ellipse 70% 60% at 50% 100%, ${theme.glow}, transparent 78%)` }} />
      {theme.mist && <div className="mist"><i /><i /></div>}
      {theme.layers.map((l, i) => (
        <div key={`${theme.id}-${i}`} className="layer" style={{ backgroundImage: images[i], bottom: `${l.bottom}%`, height: `${Math.round(l.kind === "waves" ? l.height * 1.5 + 40 : l.height * 0.42 + 40)}px`, opacity: l.opacity ?? 1 }} />
      ))}
      <div className="vignette" />
    </div>
  );
}
