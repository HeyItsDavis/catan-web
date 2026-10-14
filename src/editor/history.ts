/** Pure undo/redo history with coalescing of rapid edits to the same field. */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Coalescing key + time of the last push. */
  lastKey?: string;
  lastTime?: number;
}

export const HISTORY_LIMIT = 200;
export const COALESCE_MS = 1000;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/**
 * Record a new present. Consecutive pushes with the same `key` within
 * COALESCE_MS replace the present instead of adding an undo step (so typing a
 * word is one undo step).
 */
export function pushHistory<T>(h: History<T>, next: T, key?: string, now = Date.now()): History<T> {
  if (Object.is(next, h.present)) return h;
  if (key && key === h.lastKey && h.lastTime !== undefined && now - h.lastTime < COALESCE_MS) {
    return { ...h, present: next, future: [], lastTime: now };
  }
  const past = [...h.past, h.present];
  if (past.length > HISTORY_LIMIT) past.shift();
  return { past, present: next, future: [], lastKey: key, lastTime: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const prev = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest };
}
