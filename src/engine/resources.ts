/**
 * Resource movement between players and the bank. Bank supply < 0 means unlimited.
 * Emits resourceGained / resourceLost (payload: player, resource, amount).
 */
import type { Id } from './schema';
import { type Ctx, emit, findPlayer } from './context';
import { randInt } from './rng';
import { rng } from './context';

export function bankHas(ctx: Ctx, r: Id): number {
  const b = ctx.s.bank[r];
  return b === undefined ? 0 : b < 0 ? Infinity : b;
}

export interface FlowOpts {
  /** Board location the cards came from (production hex). */
  at?: string;
  /** Random steal: which resource moved is secret (redacted for uninvolved players). */
  hidden?: boolean;
}

/**
 * Remember a resource movement for the next log line (LogEntry.flows). Consecutive movements
 * between the same parties (and source location) are merged.
 */
export function recordFlow(ctx: Ctx, from: string, to: string, r: Id, n: number, opts: FlowOpts = {}): void {
  if (ctx.readonly || n <= 0) return;
  const flows = (ctx.flows ??= []);
  let f = flows.find((x) => x.from === from && x.to === to && x.at === opts.at && !!x.hidden === !!opts.hidden);
  if (!f) {
    f = { from, to, res: {} };
    if (opts.at !== undefined) f.at = opts.at;
    if (opts.hidden) f.hidden = true;
    flows.push(f);
  }
  f.res[r] = (f.res[r] ?? 0) + n;
}

/**
 * Move up to n of resource r. Returns the amount actually moved. The movement is recorded for
 * the next log line unless `opts.record` is false (the caller records it itself).
 */
export function moveResource(ctx: Ctx, from: string, to: string, r: Id, n: number, opts: FlowOpts & { record?: boolean } = {}): number {
  if (n <= 0 || from === to || !ctx.L.resources.has(r)) return 0;
  const src = from === 'bank' ? null : findPlayer(ctx, from);
  const dst = to === 'bank' ? null : findPlayer(ctx, to);
  if ((from !== 'bank' && !src) || (to !== 'bank' && !dst)) return 0;
  const avail = src ? src.resources[r] ?? 0 : bankHas(ctx, r);
  const amt = Math.min(n, avail);
  if (amt <= 0) return 0;
  if (src) src.resources[r] = (src.resources[r] ?? 0) - amt;
  else if (ctx.s.bank[r] >= 0) ctx.s.bank[r] -= amt;
  if (dst) dst.resources[r] = (dst.resources[r] ?? 0) + amt;
  else if (ctx.s.bank[r] >= 0) ctx.s.bank[r] += amt;
  if (opts.record !== false) recordFlow(ctx, from, to, r, amt, opts);
  if (src) emit(ctx, 'resourceLost', { player: src.id, resource: r, amount: amt }, src.id);
  if (dst) emit(ctx, 'resourceGained', { player: dst.id, resource: r, amount: amt }, dst.id);
  return amt;
}

export function canPay(ctx: Ctx, pid: string, cost: Record<Id, number>): boolean {
  const p = findPlayer(ctx, pid);
  if (!p) return false;
  return Object.entries(cost).every(([r, n]) => (p.resources[r] ?? 0) >= n);
}

/** Pay a cost to the bank. Returns false (and pays nothing) if unaffordable. */
export function pay(ctx: Ctx, pid: string, cost: Record<Id, number>): boolean {
  if (!canPay(ctx, pid, cost)) return false;
  for (const [r, n] of Object.entries(cost)) moveResource(ctx, pid, 'bank', r, n);
  return true;
}

/** Pick a uniformly random resource card from a player's hand (optionally of one kind). */
export function randomResource(ctx: Ctx, pid: string, kind?: string): Id | null {
  const p = findPlayer(ctx, pid);
  if (!p) return null;
  const cards: Id[] = [];
  for (const r of ctx.def.resources) {
    if (kind && r.kind !== kind) continue;
    for (let i = 0; i < (p.resources[r.id] ?? 0); i++) cards.push(r.id);
  }
  if (!cards.length) return null;
  return cards[randInt(rng(ctx), 0, cards.length - 1)];
}
