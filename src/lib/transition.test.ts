import { describe, expect, it } from "vitest";
import { decideTrackChanged, type TransitionContext } from "./transition";

const ev = (path: string, serial: number) => ({ type: "trackChanged" as const, serial, path, duration: 100 });
const base: TransitionContext = { pendingPlayPath: null, currentPath: "/a", previewPath: "/b", seenSerial: 5 };

describe("track transition decisions", () => {
  it("adopts the preloaded next track when the engine promotes it", () => {
    expect(decideTrackChanged(base, ev("/b", 6))).toEqual({ kind: "adopt-preview" });
  });
  it("ignores stale or duplicate events", () => {
    expect(decideTrackChanged(base, ev("/b", 5)).kind).toBe("ignore");
    expect(decideTrackChanged(base, ev("/b", 2)).kind).toBe("ignore");
  });
  it("confirms a user-requested play and ignores events from superseded plays", () => {
    const ctx = { ...base, pendingPlayPath: "/c" };
    expect(decideTrackChanged(ctx, ev("/c", 6))).toEqual({ kind: "confirm-play" });
    expect(decideTrackChanged(ctx, ev("/b", 6)).kind).toBe("ignore");
    expect(decideTrackChanged(ctx, ev("/zzz", 7)).kind).toBe("ignore");
  });
  it("handles repeat-one, where the preview is the current track", () => {
    const ctx = { ...base, currentPath: "/a", previewPath: "/a" };
    expect(decideTrackChanged(ctx, ev("/a", 6))).toEqual({ kind: "adopt-preview" });
  });
  it("resyncs on an unexpected track and ignores an echo of the current one", () => {
    expect(decideTrackChanged(base, ev("/other", 6))).toEqual({ kind: "resync", path: "/other" });
    expect(decideTrackChanged({ ...base, previewPath: null }, ev("/a", 6)).kind).toBe("ignore");
  });
  it("with no queued next, any other track is a resync", () => {
    expect(decideTrackChanged({ ...base, previewPath: null }, ev("/b", 6)).kind).toBe("resync");
  });
});
