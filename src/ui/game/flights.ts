/**
 * Pure helpers for the card-flight animations: which log entries are new between two states, and
 * which flights (one per card, capped) they produce. Kept free of DOM so it can be unit-tested.
 */
import type { GameState, LogEntry } from '../../engine/schema';

const same = (a: LogEntry | undefined, b: LogEntry | undefined) => !!a && !!b && JSON.stringify(a) === JSON.stringify(b);

/**
 * Entries appended to `next.log` since `prev`. Handles the engine trimming old entries off the
 * front (log cap). Returns [] when the states are unrelated (another game, a resumed save).
 */
export function newLogEntries(prev: GameState | null, next: GameState, max = 40): LogEntry[] {
  if (!prev || prev === next) return [];
  const pl = prev.log, nl = next.log;
  if (!pl.length) return nl.length && next.turn - prev.turn <= 1 ? nl.slice(-max) : [];
  const last = pl[pl.length - 1];
  // Fast path: nothing trimmed.
  if (nl.length >= pl.length && same(nl[pl.length - 1], last)) return nl.slice(pl.length).slice(-max);
  // Trimmed: find the previous last entry, scanning from the end.
  for (let i = nl.length - 1; i >= 0 && i >= nl.length - 1 - max * 4; i--) {
    if (same(nl[i], last)) return nl.slice(i + 1).slice(-max);
  }
  return [];
}

/** Where a card flies from / to. */
export type Spot =
  | { kind: 'bank'; res?: string }
  | { kind: 'player'; id: string; res?: string }
  | { kind: 'hex'; id: string };

export interface Flight {
  res: string;
  from: Spot;
  to: Spot;
  /** Stagger index (ms delay = index * step). */
  index: number;
}

/** Flights for a batch of new entries; at most `perFlow` cards per resource and `max` overall. */
export function flightsFor(entries: LogEntry[], perFlow = 4, max = 36): Flight[] {
  const out: Flight[] = [];
  let index = 0;
  for (const e of entries) {
    for (const f of e.flows ?? []) {
      const from: Spot = f.at ? { kind: 'hex', id: f.at } : f.from === 'bank' ? { kind: 'bank' } : { kind: 'player', id: f.from };
      for (const [res, n] of Object.entries(f.res)) {
        for (let k = 0; k < Math.min(n, perFlow); k++) {
          if (out.length >= max) return out;
          const withRes = <T extends Spot>(s: T): T => (s.kind === 'hex' ? s : { ...s, res });
          const to: Spot = f.to === 'bank' ? { kind: 'bank' } : { kind: 'player', id: f.to };
          out.push({ res, from: withRes(from), to: withRes(to), index: index++ });
        }
      }
    }
  }
  return out;
}
