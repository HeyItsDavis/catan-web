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

/** Move up to n of resource r. Returns the amount actually moved. */
export function moveResource(ctx: Ctx, from: string, to: string, r: Id, n: number): number {
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
