export type Repeat = "off" | "all" | "one";
export type SpatialMode = "off" | "wide" | "room" | "orbit";

export interface Track {
  id: number;
  path: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  format: string;
  size: number;
  sampleRate: number;
  channels: number;
  addedAt: number;
  missing: boolean;
  favorite: boolean;
  sourceUrl: string | null;
  hasArt: boolean;
}

export interface Playlist {
  id: number;
  name: string;
  trackIds: number[];
}

export interface ImportReport {
  added: number[];
  duplicates: number;
  failed: [string, string][];
}

export interface ErrorLogEntry {
  id: number;
  trackId: number | null;
  path: string;
  message: string;
  at: number;
}

import type { ThemeId } from "../themes";

export interface Settings {
  crossfadeSecs: number;
  shuffle: boolean;
  repeat: Repeat;
  resumeOnLaunch: boolean;
  keepAwake: boolean;
  hideOnClose: boolean;
  sleepMinutes: number;
  sleepFadeSecs: number;
  spatialMode: SpatialMode;
  spatialAmount: number;
  volume: number;
  muted: boolean;
  theme: ThemeId;
}

export const DEFAULT_SETTINGS: Settings = {
  crossfadeSecs: 3,
  shuffle: false,
  repeat: "all",
  resumeOnLaunch: true,
  keepAwake: true,
  hideOnClose: true,
  sleepMinutes: 30,
  sleepFadeSecs: 20,
  spatialMode: "off",
  spatialAmount: 0.7,
  volume: 0.8,
  muted: false,
  theme: "stargazing",
};

export type EngineEvent =
  | { type: "tick"; serial: number; path: string | null; position: number; duration: number; state: "playing" | "paused" | "stopped"; device: string }
  | { type: "trackChanged"; serial: number; path: string; duration: number }
  | { type: "trackError"; path: string; message: string; preload: boolean }
  | { type: "ended"; serial: number }
  | { type: "devicePaused" }
  | { type: "fadeComplete" }
  | { type: "outputChanged"; device: string };
