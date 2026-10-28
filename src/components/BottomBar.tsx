import { player, usePlayer, usePosition } from "../lib/player";
import { api } from "../lib/api";
import { fmtTime } from "../lib/format";
import { Icon } from "./Icons";
import { Artwork } from "./Artwork";
import { Slider } from "./bits";
import { SleepMenu } from "./SleepMenu";
import type { SpatialMode } from "../lib/types";

const SPATIAL_LABEL: Record<SpatialMode, string> = { off: "Stereo", wide: "Wide stage", room: "Surround room", orbit: "Orbit" };
const SPATIAL_ORDER: SpatialMode[] = ["off", "wide", "room", "orbit"];

function LcdProgress({ loaded, fallbackDuration }: { loaded: boolean; fallbackDuration: number }) {
  const { duration } = usePlayer();
  const position = usePosition();
  const max = Math.max(duration || fallbackDuration, 1);
  const shown = loaded ? position : 0;
  return (
    <div className="lcd-progress">
      <span>{fmtTime(shown)}</span>
      <Slider label="Seek" value={Math.min(shown, max)} max={max} step={0.1} disabled={!loaded} onChange={(v) => void player.seek(v)} />
      <span>-{fmtTime(Math.max(0, max - shown))}</span>
    </div>
  );
}

/** Apple Music-style player bar: transport on the left, a "now playing" display in the middle, extras on the right. */
export function BottomBar() {
  const { queue, tracks, settings, status, awakeActive, engineLoaded } = usePlayer();
  const cur = queue.index >= 0 ? tracks.find((t) => t.id === queue.items[queue.index]) : undefined;
  const loaded = !!cur && engineLoaded;

  return (
    <footer className="glass bottom" aria-label="Player">
      <div className="transport-mini">
        <button className={`icon-btn sm ${settings.shuffle ? "on" : ""}`} aria-label="Shuffle" aria-pressed={settings.shuffle} onClick={() => player.toggleShuffle()}><Icon name="shuffle" /></button>
        <button className="icon-btn" aria-label="Previous" onClick={() => void player.prev()}><Icon name="prev" /></button>
        <button className="icon-btn big" aria-label={status === "playing" ? "Pause" : "Play"} onClick={() => void player.togglePlay()}><Icon name={status === "playing" ? "pause" : "play"} /></button>
        <button className="icon-btn" aria-label="Next" onClick={() => void player.next()}><Icon name="next" /></button>
        <button className={`icon-btn sm ${settings.repeat !== "off" ? "on" : ""}`} aria-label={`Repeat ${settings.repeat}`} onClick={() => player.cycleRepeat()}>
          <Icon name="repeat" />{settings.repeat === "one" && <span className="badge">1</span>}
        </button>
      </div>

      <div className="lcd">
        <button className="thumb-btn" disabled={!cur} aria-label="Open Now Playing" title="Open Now Playing" onClick={() => player.setView("now")}>
          <Artwork track={cur} size={44} radius={7} />
        </button>
        <div className="lcd-body">
          <div className="lcd-top">
            <button className="lcd-title" disabled={!cur} title="Open Now Playing" onClick={() => player.setView("now")}>{cur?.title ?? "Not playing"}</button>
            <div className="lcd-sub">{cur ? [cur.artist, cur.album].filter(Boolean).join(" — ") || "Local file" : "Choose something from your library"}</div>
          </div>
          <LcdProgress loaded={loaded} fallbackDuration={cur?.duration ?? 0} />
        </div>
        {cur && <button className={`icon-btn sm ${cur.favorite ? "on" : ""}`} aria-label={cur.favorite ? "Remove favorite" : "Add favorite"} onClick={() => void player.toggleFavorite(cur.id)}><Icon name={cur.favorite ? "heartFill" : "heart"} /></button>}
      </div>

      <div className="right-controls">
        <button className="icon-btn" aria-label="Open mini player" title="Mini player" onClick={() => void api.miniOpen()}><Icon name="mini" /></button>
        <SleepMenu />
        <button className="icon-btn" aria-label={`Spatial audio: ${SPATIAL_LABEL[settings.spatialMode]}. Click to change`} title={`Spatial: ${SPATIAL_LABEL[settings.spatialMode]}`}
          style={{ color: settings.spatialMode === "off" ? undefined : "var(--accent)" }}
          onClick={() => void player.setSettings({ spatialMode: SPATIAL_ORDER[(SPATIAL_ORDER.indexOf(settings.spatialMode) + 1) % 4] })}>
          <Icon name="headphones" />
        </button>
        <button className="icon-btn" aria-label={settings.muted ? "Unmute" : "Mute"} onClick={() => player.toggleMute()}><Icon name={settings.muted || settings.volume === 0 ? "mute" : "volume"} /></button>
        <div style={{ width: 110 }}><Slider label="Volume" value={settings.muted ? 0 : settings.volume} onChange={(v) => player.setVolume(v)} /></div>
        {awakeActive && <span className="awake-dot" title="Keeping this Mac awake while playing" />}
      </div>
    </footer>
  );
}
