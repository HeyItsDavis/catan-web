/**
 * Deterministic, serializable RNG (mulberry32). The whole generator state is a
 * single 32-bit integer stored in `GameState.rngState`.
 */

export interface RngHolder { rngState: number }

/** Hash an arbitrary seed into a non-zero 32-bit state. */
export function seedToState(seed: number): number {
  let h = (Math.floor(seed) ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h || 0x1234567;
}

/** Float in [0, 1). Advances the holder's state. */
export function nextFloat(h: RngHolder): number {
  h.rngState = (h.rngState + 0x6d2b79f5) >>> 0;
  let t = h.rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [lo, hi] inclusive. */
export function randInt(h: RngHolder, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return lo + Math.floor(nextFloat(h) * (hi - lo + 1));
}

/** Fisher-Yates in place; returns the same array. */
export function shuffle<T>(h: RngHolder, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(h, 0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
