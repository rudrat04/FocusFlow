import { player, usePlayer } from "../lib/player";
import type { SpatialMode } from "../lib/types";
import { Icon } from "./Icons";
import { PopMenu } from "./PopMenu";
import { Slider } from "./bits";

export const SPATIAL_MODES: { id: SpatialMode; label: string; hint: string }[] = [
  { id: "off", label: "Off", hint: "Plain stereo." },
  { id: "wide", label: "Wide", hint: "A much wider stage, with a little crossfeed to stay comfortable." },
  { id: "room", label: "Room", hint: "Two virtual speakers in a room, with reflections and reverb." },
  { id: "orbit", label: "Orbit", hint: "The sound circles your head about every 10 seconds." },
];

export function Seg<T extends string>({ value, options, onChange, label, small }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string; small?: boolean }) {
  return (
    <div className={`seg ${small ? "small" : ""}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? "on" : ""} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

function Item({ on, title, hint, onClick }: { on: boolean; title: string; hint?: string; onClick: () => void }) {
  return (
    <button role="menuitemradio" aria-checked={on} className={`mi ${on ? "on" : ""}`} onClick={onClick}>
      <span className="mi-check">{on && <Icon name="check" />}</span>
      <span className="mi-text"><b>{title}</b>{hint && <small>{hint}</small>}</span>
    </button>
  );
}

/** Headphone icon beside Shuffle: spatial sound mode and intensity. */
export function SoundMenu() {
  const { settings, outputChannels } = usePlayer();
  const mono = outputChannels < 2;
  return (
    <PopMenu icon="headphones" label={`Sound: ${SPATIAL_MODES.find((m) => m.id === settings.spatialMode)!.label}`} active={settings.spatialMode !== "off"} align="left">
      {() => (
        <>
          <div className="lbl">Spatial sound</div>
          {SPATIAL_MODES.map((m) => <Item key={m.id} on={settings.spatialMode === m.id} title={m.label} hint={m.hint} onClick={() => void player.setSettings({ spatialMode: m.id })} />)}
          <div className="sep" />
          <div className={`mi-slider ${settings.spatialMode === "off" ? "off" : ""}`}>
            <span>Intensity</span>
            <Slider label="Spatial intensity" value={settings.spatialAmount} disabled={settings.spatialMode === "off"} onChange={(v) => void player.setSettings({ spatialAmount: v })} />
            <span className="val">{Math.round(settings.spatialAmount * 100)}%</span>
          </div>
          {mono && settings.spatialMode !== "off" && <div className="mi-warn">This output is mono right now (a Bluetooth headset in call mode does this), so spatial effects can’t be heard. Choose the stereo output in System Settings → Sound.</div>}
        </>
      )}
    </PopMenu>
  );
}
