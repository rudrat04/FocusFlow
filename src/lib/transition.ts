import type { EngineEvent } from "./types";

/**
 * Decides what an engine event means for the UI, using the path the UI expects next.
 * Stale or unexpected events are ignored so late callbacks cannot corrupt the queue.
 */
export interface TransitionContext {
  /** Path the UI asked the engine to play and is waiting to hear about (null once confirmed). */
  pendingPlayPath: string | null;
  /** Path currently believed to be playing. */
  currentPath: string | null;
  /** Path preloaded as the next track, with its queue step already computed. */
  previewPath: string | null;
  /** Highest engine serial already handled. */
  seenSerial: number;
}

export type TransitionDecision =
  | { kind: "confirm-play" }
  | { kind: "adopt-preview" }
  | { kind: "resync"; path: string }
  | { kind: "ignore"; reason: string };

export function decideTrackChanged(ctx: TransitionContext, ev: Extract<EngineEvent, { type: "trackChanged" }>): TransitionDecision {
  if (ev.serial <= ctx.seenSerial) return { kind: "ignore", reason: "stale serial" };
  if (ctx.pendingPlayPath !== null) {
    if (ev.path === ctx.pendingPlayPath) return { kind: "confirm-play" };
    // The engine moved to something the user did not just ask for. Wait for our own request to land.
    return { kind: "ignore", reason: "superseded by a pending play" };
  }
  if (ctx.previewPath !== null && ev.path === ctx.previewPath && ev.path !== ctx.currentPath) return { kind: "adopt-preview" };
  if (ctx.previewPath !== null && ev.path === ctx.previewPath) return { kind: "adopt-preview" }; // repeat-one
  if (ev.path === ctx.currentPath) return { kind: "ignore", reason: "already current" };
  return { kind: "resync", path: ev.path };
}
