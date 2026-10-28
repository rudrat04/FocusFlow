/** Background themes. Every scene is generated from code: no photographs, nothing to license. */

export type ThemeId = "stargazing" | "forest" | "ocean" | "mountains" | "desert" | "aurora";
/** Scenes are static: nothing moves, so the GPU stays idle and the Mac stays cool. */
export type Particles = "stars" | "none";

export interface Layer {
  kind: "ridge" | "pines" | "dunes" | "waves" | "hills" | "field";
  color: string;
  /** Height of the layer's tallest point, in px of the 1200x200 drawing. */
  height: number;
  /** Distance from the bottom of the window, in % of its height. */
  bottom: number;
  seed: number;
  rough?: number;
  opacity?: number;
}

export interface Theme {
  id: ThemeId;
  label: string;
  blurb: string;
  accent: string;
  /** CSS gradient stops, top to bottom. */
  sky: string[];
  glow: string;
  glowAt?: string;
  /** Tint of the glass panels; brighter scenes get a darker one so text stays readable. */
  glass: string;
  particles: Particles;
  milkyway?: boolean;
  moon?: boolean;
  aurora?: boolean;
  mist?: boolean;
  layers: Layer[];
}

export const THEMES: Theme[] = [
  {
    id: "stargazing", label: "Stargazing", blurb: "A clear night over a quiet field.", accent: "#ff4f64",
    sky: ["#01030a", "#050a17", "#0a1020", "#1b1510", "#241a10"], glow: "rgba(224,160,90,0.38)", glass: "rgba(255,255,255,0.055)",
    particles: "stars", milkyway: true,
    layers: [{ kind: "field", color: "#060403", height: 60, bottom: 21, seed: 3 }, { kind: "hills", color: "#070503", height: 70, bottom: 0, seed: 5, opacity: 0.95 }],
  },
  {
    id: "forest", label: "Forest", blurb: "Pines in the mist at dusk.", accent: "#6ee7a8",
    sky: ["#031010", "#07201c", "#0d3128", "#16402f"], glow: "rgba(130,230,160,0.26)", glass: "rgba(8,24,20,0.42)",
    particles: "none",
    layers: [
      { kind: "pines", color: "#0c2c24", height: 120, bottom: 22, seed: 11, opacity: 0.85 },
      { kind: "pines", color: "#071f19", height: 150, bottom: 10, seed: 21, opacity: 0.95 },
      { kind: "pines", color: "#020b09", height: 180, bottom: 0, seed: 31 },
    ],
  },
  {
    id: "ocean", label: "Ocean", blurb: "Moonlight on a calm, dark sea.", accent: "#4cc9f0",
    sky: ["#020816", "#05213b", "#08385a", "#0c4a6a"], glow: "rgba(150,220,255,0.25)", glass: "rgba(6,22,40,0.42)",
    particles: "stars", moon: true,
    layers: [
      { kind: "waves", color: "#0f5a80", height: 26, bottom: 30, seed: 2, opacity: 0.9 },
      { kind: "waves", color: "#0a4468", height: 34, bottom: 18, seed: 4, opacity: 0.95 },
      { kind: "waves", color: "#06304f", height: 40, bottom: 7, seed: 6 },
      { kind: "waves", color: "#031d34", height: 46, bottom: 0, seed: 8 },
    ],
  },
  {
    id: "mountains", label: "Mountains", blurb: "Layered ridges in the first light.", accent: "#ffb870",
    sky: ["#14163a", "#3a3258", "#7a5a70", "#d98a6a"], glow: "rgba(255,190,130,0.4)", glass: "rgba(20,16,36,0.46)",
    particles: "none",
    layers: [
      { kind: "ridge", color: "#8a6a86", height: 150, bottom: 30, seed: 7, rough: 1.1, opacity: 0.8 },
      { kind: "ridge", color: "#5a4770", height: 160, bottom: 20, seed: 13, rough: 1.2, opacity: 0.9 },
      { kind: "ridge", color: "#352a52", height: 150, bottom: 10, seed: 17, rough: 1.3 },
      { kind: "ridge", color: "#1b1630", height: 120, bottom: 0, seed: 19, rough: 1.0 },
    ],
  },
  {
    id: "desert", label: "Desert", blurb: "Dunes under a violet dusk.", accent: "#ff9a5a",
    sky: ["#0d0722", "#35134a", "#8a2f55", "#e0703a"], glow: "rgba(255,150,70,0.45)", glass: "rgba(24,10,28,0.46)",
    particles: "stars",
    layers: [
      { kind: "dunes", color: "#5a2146", height: 90, bottom: 22, seed: 3, opacity: 0.9 },
      { kind: "dunes", color: "#3a1440", height: 110, bottom: 10, seed: 9 },
      { kind: "dunes", color: "#1a0a26", height: 120, bottom: 0, seed: 15 },
    ],
  },
  {
    id: "aurora", label: "Northern lights", blurb: "Green ribbons over a frozen shore.", accent: "#7affc4",
    sky: ["#02060f", "#06122a", "#0a1d3a", "#10283f"], glow: "rgba(110,255,190,0.2)", glass: "rgba(6,16,30,0.42)",
    particles: "stars", aurora: true,
    layers: [
      { kind: "ridge", color: "#0a1c30", height: 100, bottom: 14, seed: 23, rough: 0.9, opacity: 0.9 },
      { kind: "pines", color: "#030a14", height: 150, bottom: 0, seed: 33 },
    ],
  },
];

export const THEME_BY_ID: Record<ThemeId, Theme> = Object.fromEntries(THEMES.map((t) => [t.id, t])) as Record<ThemeId, Theme>;

// ------------------------------------------------------------------ shape generators

function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const W = 1200, H = 200;

/** SVG path (in a 1200x200 box) for a layer, filled down to the bottom edge. */
export function layerPath(l: Layer): string {
  const r = rng(l.seed);
  const base = H - l.height;
  const pts: [number, number][] = [];
  switch (l.kind) {
    case "ridge": {
      const rough = l.rough ?? 1;
      const ph = [r() * 6, r() * 6, r() * 6];
      for (let x = 0; x <= W; x += 12) {
        const y = base + l.height * (0.5 - 0.28 * Math.sin(x / 190 + ph[0]) - 0.16 * Math.sin(x / 83 + ph[1]) * rough - 0.08 * Math.sin(x / 31 + ph[2]) * rough - (r() - 0.5) * 0.05 * rough);
        pts.push([x, y]);
      }
      break;
    }
    case "hills":
    case "field": {
      const ph = [r() * 6, r() * 6];
      for (let x = 0; x <= W; x += 20) pts.push([x, base + l.height * (0.55 - 0.3 * Math.sin(x / 260 + ph[0]) - 0.15 * Math.sin(x / 110 + ph[1]))]);
      break;
    }
    case "dunes": {
      const ph = [r() * 6, r() * 6];
      for (let x = 0; x <= W; x += 10) pts.push([x, base + l.height * (0.6 - 0.34 * Math.sin(x / 210 + ph[0]) - 0.14 * Math.sin(x / 95 + ph[1]) * Math.sin(x / 400))]);
      break;
    }
    case "waves": {
      const ph = [r() * 6, r() * 6];
      for (let x = 0; x <= W; x += 8) pts.push([x, base + l.height * (0.7 - 0.22 * Math.sin(x / 60 + ph[0]) - 0.1 * Math.sin(x / 23 + ph[1]))]);
      break;
    }
    case "pines": {
      // A row of tiered fir trees drawn as one outline.
      const d: string[] = [`M0 ${H}`];
      let x = -10;
      let last = H;
      d.push(`L-10 ${H}`);
      while (x < W + 30) {
        const th = l.height * (0.35 + r() * 0.65);
        const tw = th * (0.28 + r() * 0.1);
        const cx = x + tw;
        const tiers = 4 + ((r() * 3) | 0);
        const top = H - th;
        // left side stepping up
        d.push(`L${x.toFixed(0)} ${H - 8}`);
        for (let t = 0; t < tiers; t++) {
          const f = t / tiers;
          const y = H - 8 - (th - 8) * f * 0.92;
          const w = tw * (1 - f * 0.78);
          d.push(`L${(cx - w).toFixed(1)} ${y.toFixed(1)}`, `L${(cx - w * 0.55).toFixed(1)} ${(y - th / tiers * 0.35).toFixed(1)}`);
        }
        d.push(`L${cx.toFixed(1)} ${top.toFixed(1)}`);
        for (let t = tiers - 1; t >= 0; t--) {
          const f = t / tiers;
          const y = H - 8 - (th - 8) * f * 0.92;
          const w = tw * (1 - f * 0.78);
          d.push(`L${(cx + w * 0.55).toFixed(1)} ${(y - th / tiers * 0.35).toFixed(1)}`, `L${(cx + w).toFixed(1)} ${y.toFixed(1)}`);
        }
        x += tw * 2 * (0.55 + r() * 0.5);
        last = H;
      }
      d.push(`L${W + 30} ${last}`, `L${W + 30} ${H}`, "Z");
      return d.join(" ");
    }
  }
  return `M0 ${H} ` + pts.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(" ") + ` L${W} ${H} Z`;
}
