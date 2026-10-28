import { describe, expect, it } from "vitest";
import { advance, createQueue, currentId, emptyQueue, enqueue, jumpTo, move, previous, removeAt, removeId, setShuffle } from "./queue";

const ok = () => true;
const seeded = (seed = 1) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe("queue basics", () => {
  it("handles an empty queue", () => {
    const q = emptyQueue();
    expect(currentId(q)).toBeNull();
    expect(advance(q, true, ok).id).toBeNull();
    expect(previous(q, 0, ok).id).toBeNull();
    expect(removeAt(q, 0)).toBe(q);
  });

  it("walks forward and stops at the end with repeat off", () => {
    let q = createQueue([1, 2, 3], 0, false, "off");
    const seen: number[] = [1];
    for (;;) {
      const s = advance(q, true, ok);
      if (s.id === null) break;
      q = s.queue;
      seen.push(s.id);
    }
    expect(seen).toEqual([1, 2, 3]);
  });

  it("wraps with repeat all and reports the wrap", () => {
    const q = createQueue([1, 2], 1, false, "all");
    const s = advance(q, true, ok);
    expect(s.id).toBe(1);
    expect(s.wrapped).toBe(true);
  });

  it("repeat one replays on auto-advance but manual next moves on", () => {
    const q = createQueue([1, 2, 3], 0, false, "one");
    expect(advance(q, true, ok).id).toBe(1);
    expect(advance(q, false, ok).id).toBe(2);
  });

  it("a one-track queue loops with repeat all/one and ends with repeat off", () => {
    expect(advance(createQueue([7], 0, false, "all"), true, ok).id).toBe(7);
    expect(advance(createQueue([7], 0, false, "one"), true, ok).id).toBe(7);
    expect(advance(createQueue([7], 0, false, "off"), true, ok).id).toBeNull();
    expect(advance(createQueue([7], 0, true, "all"), true, ok).id).toBe(7);
  });

  it("skips unplayable tracks and gives up when none are playable", () => {
    const q = createQueue([1, 2, 3], 0, false, "all");
    expect(advance(q, true, (id) => id === 3).id).toBe(3);
    expect(advance(q, true, () => false).id).toBeNull();
    expect(advance(createQueue([1], 0, false, "all"), true, () => false).id).toBeNull();
  });
});

describe("previous", () => {
  it("restarts when more than 3s in", () => {
    const q = createQueue([1, 2, 3], 1, false, "all");
    const p = previous(q, 10, ok);
    expect(p.restart).toBe(true);
    expect(p.id).toBe(2);
  });
  it("goes back, wraps with repeat all, restarts at start with repeat off", () => {
    const q = createQueue([1, 2, 3], 1, false, "all");
    expect(previous(q, 0, ok).id).toBe(1);
    expect(previous(createQueue([1, 2, 3], 0, false, "all"), 0, ok).id).toBe(3);
    const off = previous(createQueue([1, 2, 3], 0, false, "off"), 0, ok);
    expect(off.restart).toBe(true);
    expect(off.id).toBe(1);
  });
});

describe("shuffle", () => {
  it("keeps the current track first and the same set of tracks", () => {
    const q = createQueue([1, 2, 3, 4, 5, 6], 2, true, "all", seeded());
    expect(q.items[0]).toBe(3);
    expect([...q.items].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("turning shuffle off restores the original order at the current track", () => {
    let q = createQueue([1, 2, 3, 4, 5], 1, true, "all", seeded(3));
    q = advance(q, true, ok, seeded()).queue;
    const cur = currentId(q)!;
    q = setShuffle(q, false);
    expect(q.items).toEqual([1, 2, 3, 4, 5]);
    expect(currentId(q)).toBe(cur);
  });
  it("reshuffles each lap without repeating the last track first", () => {
    let q = createQueue([1, 2, 3, 4, 5], 0, true, "all", seeded(9));
    const rng = seeded(5);
    for (let lap = 0; lap < 20; lap++) {
      const last = q.items[q.items.length - 1];
      q = { ...q, index: q.items.length - 1 };
      const s = advance(q, true, ok, rng);
      expect(s.wrapped).toBe(true);
      expect(s.id).not.toBe(last);
      expect([...s.queue.items].sort()).toEqual([1, 2, 3, 4, 5]);
      q = s.queue;
    }
  });
});

describe("editing", () => {
  it("enqueues at end and as next", () => {
    let q = createQueue([1, 2, 3], 1, false, "all");
    q = enqueue(q, [9], "next");
    expect(q.items).toEqual([1, 2, 9, 3]);
    q = enqueue(q, [8], "end");
    expect(q.items).toEqual([1, 2, 9, 3, 8]);
    expect(enqueue(emptyQueue(), [4, 5], "end").index).toBe(0);
  });
  it("removal keeps the current track consistent", () => {
    let q = createQueue([1, 2, 3, 4], 2, false, "all");
    q = removeAt(q, 0);
    expect(currentId(q)).toBe(3);
    q = removeAt(q, q.index);
    expect(currentId(q)).toBe(4);
    q = removeAt(removeAt(q, 0), 0);
    expect(q.index).toBe(-1);
    expect(removeId(createQueue([1, 2, 1], 0, false, "all"), 1).items).toEqual([2]);
  });
  it("moves tracks and tracks the current index", () => {
    let q = createQueue([1, 2, 3, 4], 1, false, "all");
    q = move(q, 3, 0);
    expect(q.items).toEqual([4, 1, 2, 3]);
    expect(currentId(q)).toBe(2);
    q = move(q, q.index, 3);
    expect(currentId(q)).toBe(2);
    expect(jumpTo(q, 99)).toBe(q);
  });
  it("survives rapid next/previous bursts without leaving the queue", () => {
    let q = createQueue([1, 2, 3, 4, 5], 0, true, "all", seeded(2));
    const rng = seeded(11);
    for (let i = 0; i < 500; i++) {
      if (i % 3 === 0) {
        const p = previous(q, 0, ok);
        q = p.queue;
      } else {
        q = advance(q, false, ok, rng).queue;
      }
      expect(q.index).toBeGreaterThanOrEqual(0);
      expect(q.index).toBeLessThan(5);
      expect([...q.items].sort()).toEqual([1, 2, 3, 4, 5]);
    }
  });
});
