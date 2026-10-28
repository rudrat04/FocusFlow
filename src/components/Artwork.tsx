import type { Track } from "../lib/types";
import { useArt } from "../lib/viz";
import { artStyle } from "./bits";

/** Cover art when the track has it, otherwise a generated gradient with a note. */
export function Artwork({ track, size, radius = 10, className = "" }: { track?: Track; size?: number; radius?: number; className?: string }) {
  const url = useArt(track);
  const style = { width: size, height: size, borderRadius: radius, ...(url ? {} : artStyle(track ? `${track.album}${track.title}` : "focusflow")) };
  return (
    <div className={`artwork ${className}`} style={style} aria-hidden="true">
      {url ? <img src={url} alt="" draggable={false} /> : <span className="note-glyph">♪</span>}
    </div>
  );
}

/** Tiny animated equalizer used on the row that is playing. */
export function Eq({ playing }: { playing: boolean }) {
  return (
    <span className={`eq ${playing ? "on" : ""}`} aria-label={playing ? "Playing" : "Paused"}>
      <i /><i /><i /><i />
    </span>
  );
}
