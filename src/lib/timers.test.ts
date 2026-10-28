import { describe, expect, it } from "vitest";
import { sleepRemainingMs, startSleep, tickSleep } from "./timers";

const T0 = 1_700_000_000_000;

describe("sleep timer", () => {
  it("starts a fade then stops", () => {
    let t = startSleep(T0, 30, 20);
    let r = tickSleep(t, T0 + 10 * 60_000);
    expect(r.action).toBe("none");
    r = tickSleep(t, T0 + 30 * 60_000 - 19_000);
    expect(r.action).toBe("fade");
    t = r.timer;
    expect(tickSleep(t, T0 + 30 * 60_000 - 10_000).action).toBe("none");
    expect(tickSleep(t, T0 + 30 * 60_000).action).toBe("stop");
    expect(sleepRemainingMs(t, T0 + 40 * 60_000)).toBe(0);
  });

  it("clamps the fade to the timer length and enforces at least one minute", () => {
    const t = startSleep(T0, 0, 600);
    expect(t.endsAt - T0).toBe(60_000);
    expect(t.fadeMs).toBe(60_000);
  });

  it("zero fade stops without a fade phase", () => {
    const t = startSleep(T0, 5, 0);
    expect(tickSleep(t, T0 + 5 * 60_000 - 1).action).toBe("none");
    expect(tickSleep(t, T0 + 5 * 60_000).action).toBe("stop");
  });
});
