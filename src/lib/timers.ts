/** Sleep timer. Derived from timestamps (`now` is passed in), never from counting UI ticks. */

export interface SleepTimer {
  endsAt: number;
  fadeMs: number;
  startedAt: number;
  fadeStarted: boolean;
}

export function startSleep(now: number, minutes: number, fadeSecs: number): SleepTimer {
  const total = Math.max(1, minutes) * 60_000;
  // The fade must fit inside the timer.
  const fadeMs = Math.min(Math.max(0, fadeSecs) * 1000, total);
  return { endsAt: now + total, fadeMs, startedAt: now, fadeStarted: false };
}

export function sleepRemainingMs(t: SleepTimer, now: number): number {
  return Math.max(0, t.endsAt - now);
}

export type SleepAction = "none" | "fade" | "stop";

/** `fade` is returned once, when the fade window opens; `stop` once the timer has run out. */
export function tickSleep(t: SleepTimer, now: number): { timer: SleepTimer; action: SleepAction } {
  if (now >= t.endsAt) return { timer: t, action: "stop" };
  if (!t.fadeStarted && t.endsAt - now <= t.fadeMs) return { timer: { ...t, fadeStarted: true }, action: "fade" };
  return { timer: t, action: "none" };
}
