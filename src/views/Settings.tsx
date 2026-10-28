import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { player, usePlayer } from "../lib/player";
import { Setting, Slider, Toggle } from "../components/bits";
import type { Repeat } from "../lib/types";
import { fileName } from "../lib/format";
import { Seg, SPATIAL_MODES } from "../components/StageControls";
import { THEMES, THEME_BY_ID, layerPath } from "../themes";

export function SettingsView() {
  const st = usePlayer();
  const { settings: s, libraryDir, tools, errors, device, engineError } = st;
  const set = (p: Parameters<typeof player.setSettings>[0]) => void player.setSettings(p);
  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="lead">Everything is saved automatically.</p>

      <div className="glass card">
        <h3>Theme</h3>
        <div className="theme-grid" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button key={t.id} role="radio" aria-checked={s.theme === t.id} className={`theme-card ${s.theme === t.id ? "on" : ""}`} onClick={() => set({ theme: t.id })}>
              <span className="theme-swatch" style={{ background: `linear-gradient(180deg, ${t.sky.join(", ")})` }}>
                {t.layers.map((l, i) => <svg key={i} viewBox="0 0 1200 200" preserveAspectRatio="none" style={{ opacity: l.opacity ?? 1, bottom: `${l.bottom * 0.5}%` }}><path d={layerPath(l)} fill={l.color} /></svg>)}
                <i style={{ background: t.accent }} />
              </span>
              <b>{t.label}</b>
              <small>{THEME_BY_ID[t.id].blurb}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="glass card">
        <h3>Playback</h3>
        <Setting title="Crossfade" hint="Overlap between tracks. 0 plays them back to back.">
          <Slider label="Crossfade seconds" value={s.crossfadeSecs} min={0} max={12} step={1} onChange={(v) => set({ crossfadeSecs: v })} />
          <span className="val">{s.crossfadeSecs}s</span>
        </Setting>
        <Setting title="Shuffle by default"><Toggle label="Shuffle" on={s.shuffle} onChange={(v) => set({ shuffle: v })} /></Setting>
        <Setting title="Repeat by default">
          <div className="seg" role="group" aria-label="Repeat mode">
            {(["off", "all", "one"] as Repeat[]).map((r) => <button key={r} className={s.repeat === r ? "on" : ""} onClick={() => set({ repeat: r })}>{r === "off" ? "Off" : r === "all" ? "All" : "One"}</button>)}
          </div>
        </Setting>
        <Setting title="Restore queue on launch" hint="Brings back your queue and position, paused. It never starts playing by itself.">
          <Toggle label="Restore on launch" on={s.resumeOnLaunch} onChange={(v) => set({ resumeOnLaunch: v })} />
        </Setting>
      </div>

      <div className="glass card">
        <h3>Spatial audio for headphones</h3>
        <Setting title="Mode" hint={SPATIAL_MODES.find((x) => x.id === s.spatialMode)?.hint}>
          <Seg label="Spatial mode" value={s.spatialMode} options={SPATIAL_MODES} onChange={(v) => set({ spatialMode: v })} />
        </Setting>
        <Setting title="Intensity">
          <Slider label="Spatial intensity" value={s.spatialAmount} disabled={s.spatialMode === "off"} onChange={(v) => set({ spatialAmount: v })} />
          <span className="val">{Math.round(s.spatialAmount * 100)}%</span>
        </Setting>
        <p className="note">
          This is FocusFlow’s own processing and works with any headphones. For AirPods, macOS also offers system Spatial Audio
          (Control Center → Sound → Spatial Audio); apps cannot switch that on, so leave this Off if you use it.
        </p>
      </div>

      <div className="glass card">
        <h3>Power and window</h3>
        <Setting title="Keep Mac awake while playing" hint="Holds a macOS power assertion against idle system sleep during playback; released when you pause or quit. The display may still sleep.">
          <Toggle label="Keep awake" on={s.keepAwake} onChange={(v) => set({ keepAwake: v })} />
        </Setting>
        <Setting title="Keep playing when the window is closed" hint="Closing the window hides it to the menu bar and music continues. Quit from the menu-bar icon.">
          <Toggle label="Hide on close" on={s.hideOnClose} onChange={(v) => set({ hideOnClose: v })} />
        </Setting>
      </div>

      <div className="glass card">
        <h3>Sleep timer defaults</h3>
        <Setting title="Duration">
          <Slider label="Sleep timer minutes" value={s.sleepMinutes} min={5} max={180} step={5} onChange={(v) => set({ sleepMinutes: v })} />
          <span className="val">{s.sleepMinutes} min</span>
        </Setting>
        <Setting title="Fade-out length" hint="Volume ramps down gradually before playback stops.">
          <Slider label="Sleep fade seconds" value={s.sleepFadeSecs} min={0} max={120} step={5} onChange={(v) => set({ sleepFadeSecs: v })} />
          <span className="val">{s.sleepFadeSecs}s</span>
        </Setting>
      </div>

      <div className="glass card">
        <h3>Music library</h3>
        <Setting title="Library folder" hint={<span className="code">{libraryDir}</span>}>
          <button className="btn" onClick={() => void revealItemInDir(libraryDir).catch(() => player.toast("error", "Folder does not exist yet. Import something first."))}>Show in Finder</button>
          <button className="btn" onClick={() => void player.chooseLibraryDir()}>Change…</button>
        </Setting>
        <Setting title="Rescan" hint="Picks up files you dropped into the folder and flags files that went missing.">
          <button className="btn" onClick={() => void player.rescan()}>Rescan now</button>
        </Setting>
        <Setting title="Link import tools" hint={<>Needed only for “Add from link”. Install with <span className="code">brew install yt-dlp ffmpeg</span>.</>}>
          <span className="tag">{tools?.ytdlp ? `yt-dlp ${tools.ytdlp}` : "yt-dlp missing"}</span>
          <span className="tag">{tools?.ffmpeg ? "ffmpeg ✓" : "ffmpeg missing"}</span>
        </Setting>
      </div>

      <div className="glass card">
        <h3>Status</h3>
        <Setting title="Audio engine" hint={engineError ?? `Output device: ${device || "—"}`}><span className="tag">{engineError ? "Unavailable" : "Running"}</span></Setting>
        <Setting title="Playback errors" hint={errors.length ? "Tracks that failed are skipped automatically." : "No errors recorded."}>
          {errors.length > 0 && <button className="btn" onClick={() => void player.clearErrors()}>Clear</button>}
        </Setting>
        {errors.slice(0, 8).map((e) => (
          <div key={e.id} className="note" style={{ padding: "6px 0" }}><b>{fileName(e.path)}</b> — {e.message} <span>({new Date(e.at * 1000).toLocaleString()})</span></div>
        ))}
      </div>
    </div>
  );
}
