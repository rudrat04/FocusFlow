import type { Repeat } from "./types";

/** Pure queue model. `items` is the play order; `original` is the order before shuffling. */
export interface QueueState {
  items: number[];
  original: number[];
  index: number; // -1 when empty
  shuffle: boolean;
  repeat: Repeat;
}

export type Rng = () => number;

export function emptyQueue(shuffle = false, repeat: Repeat = "all"): QueueState {
  return { items: [], original: [], index: -1, shuffle, repeat };
}

export function currentId(q: QueueState): number | null {
  return q.index >= 0 && q.index < q.items.length ? q.items[q.index] : null;
}

export function shuffled(ids: number[], rng: Rng): number[] {
  const a = ids.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Builds a queue from `ids`, starting at `start`. With shuffle on, the chosen track plays first. */
export function createQueue(ids: number[], start: number, shuffle: boolean, repeat: Repeat, rng: Rng = Math.random): QueueState {
  const original = ids.slice();
  if (original.length === 0) return emptyQueue(shuffle, repeat);
  const s = Math.min(Math.max(start, 0), original.length - 1);
  if (!shuffle) return { items: original.slice(), original, index: s, shuffle, repeat };
  const first = original[s];
  const rest = shuffled(original.filter((_, i) => i !== s), rng);
  return { items: [first, ...rest], original, index: 0, shuffle, repeat };
}

export function setShuffle(q: QueueState, on: boolean, rng: Rng = Math.random): QueueState {
  if (q.shuffle === on) return q;
  const cur = currentId(q);
  if (cur === null) return { ...q, shuffle: on };
  if (on) {
    const rest = shuffled(q.items.filter((_, i) => i !== q.index), rng);
    return { ...q, shuffle: true, items: [cur, ...rest], index: 0 };
  }
  const idx = q.original.indexOf(cur);
  return { ...q, shuffle: false, items: q.original.slice(), index: Math.max(idx, 0) };
}

export function setRepeat(q: QueueState, repeat: Repeat): QueueState {
  return { ...q, repeat };
}

export interface Step {
  queue: QueueState;
  /** Track to play, or null when the queue is finished. */
  id: number | null;
  /** True when moving "next" wrapped around the end of the queue. */
  wrapped: boolean;
}

/**
 * Advances the queue. `auto` is a track ending by itself; manual skips ignore repeat-one.
 * Tracks failing `playable` are skipped; if none is playable the queue yields null.
 */
export function advance(q: QueueState, auto: boolean, playable: (id: number) => boolean, rng: Rng = Math.random): Step {
  const n = q.items.length;
  if (n === 0) return { queue: q, id: null, wrapped: false };
  if (auto && q.repeat === "one" && playable(q.items[q.index])) return { queue: q, id: q.items[q.index], wrapped: false };

  let items = q.items;
  let index = q.index;
  let wrapped = false;
  for (let tries = 0; tries < n; tries++) {
    index += 1;
    if (index >= items.length) {
      if (q.repeat === "off") return { queue: { ...q, items, index: items.length - 1 }, id: null, wrapped: false };
      wrapped = true;
      index = 0;
      if (q.shuffle && items.length > 2) {
        // New lap, new order, without repeating the track that just played first.
        const last = items[items.length - 1];
        let next = shuffled(items, rng);
        if (next[0] === last) [next[0], next[1]] = [next[1], next[0]];
        items = next;
      }
    }
    if (playable(items[index])) return { queue: { ...q, items, index }, id: items[index], wrapped };
  }
  return { queue: q, id: null, wrapped };
}

/** Previous track; past 3 seconds in, "previous" restarts the current track instead. */
export function previous(q: QueueState, positionSecs: number, playable: (id: number) => boolean): Step & { restart: boolean } {
  const n = q.items.length;
  if (n === 0) return { queue: q, id: null, wrapped: false, restart: false };
  if (positionSecs > 3 || n === 1) return { queue: q, id: q.items[q.index], wrapped: false, restart: true };
  let index = q.index;
  let wrapped = false;
  for (let tries = 0; tries < n; tries++) {
    index -= 1;
    if (index < 0) {
      if (q.repeat === "off") return { queue: q, id: q.items[q.index], wrapped: false, restart: true };
      index = n - 1;
      wrapped = true;
    }
    if (playable(q.items[index])) return { queue: { ...q, index }, id: q.items[index], wrapped, restart: false };
  }
  return { queue: q, id: null, wrapped, restart: false };
}

export function jumpTo(q: QueueState, index: number): QueueState {
  if (index < 0 || index >= q.items.length) return q;
  return { ...q, index };
}

/** Adds tracks at the end or right after the current track. Duplicates already queued are allowed. */
export function enqueue(q: QueueState, ids: number[], where: "end" | "next"): QueueState {
  if (ids.length === 0) return q;
  if (q.items.length === 0) return { ...q, items: ids.slice(), original: ids.slice(), index: 0 };
  if (where === "end") return { ...q, items: [...q.items, ...ids], original: [...q.original, ...ids] };
  const items = [...q.items.slice(0, q.index + 1), ...ids, ...q.items.slice(q.index + 1)];
  const cur = currentId(q);
  const oi = cur === null ? -1 : q.original.indexOf(cur);
  const original = [...q.original.slice(0, oi + 1), ...ids, ...q.original.slice(oi + 1)];
  return { ...q, items, original };
}

export function removeAt(q: QueueState, i: number): QueueState {
  if (i < 0 || i >= q.items.length) return q;
  const id = q.items[i];
  const items = q.items.filter((_, k) => k !== i);
  const oi = q.original.indexOf(id);
  const original = oi >= 0 ? q.original.filter((_, k) => k !== oi) : q.original;
  let index = q.index;
  if (i < q.index) index -= 1;
  else if (i === q.index) index = Math.min(index, items.length - 1);
  if (items.length === 0) index = -1;
  return { ...q, items, original, index };
}

/** Drops every occurrence of a track (e.g. when it is deleted from the library). */
export function removeId(q: QueueState, id: number): QueueState {
  let out = q;
  for (let i = out.items.length - 1; i >= 0; i--) if (out.items[i] === id) out = removeAt(out, i);
  return out;
}

export function move(q: QueueState, from: number, to: number): QueueState {
  const n = q.items.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return q;
  const items = q.items.slice();
  const [m] = items.splice(from, 1);
  items.splice(to, 0, m);
  let index = q.index;
  if (from === q.index) index = to;
  else if (from < q.index && to >= q.index) index -= 1;
  else if (from > q.index && to <= q.index) index += 1;
  const original = q.shuffle ? q.original : items.slice();
  return { ...q, items, original, index };
}
