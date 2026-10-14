/**
 * Resource production. A hex produces when its number is rolled (or when targeted directly),
 * it is revealed, and no token with `blocksProduction` sits on it. Every vertex piece with
 * productionMultiplier > 0 on its corners receives terrain.produces x multiplier plus any
 * matching productionBonus. Bank shortage rule: if the bank can't cover all claims for a
 * resource and more than one player claims it, nobody receives that resource.
 * Gold-style terrains (producesChoice) are returned as owed choices for the interpreter.
 */
import type { Id } from './schema';
import { type Ctx, emit, log, piecesAt, playerName } from './context';
import { evalResourceMap } from './exprs';
import { bankHas, moveResource } from './resources';
import { hexCorners, parseHexId } from './board/topology';

export interface GoldOwed { player: string; amount: number; options?: Id[] }

export function hexBlocked(ctx: Ctx, hex: string): boolean {
  for (const [tid, loc] of Object.entries(ctx.s.tokens)) {
    if (loc === hex && ctx.L.tokens.get(tid)?.blocksProduction) return true;
  }
  return false;
}

export function runProduction(ctx: Ctx, opts: { roll?: number; hex?: string; player?: string }): GoldOwed[] {
  const hexes = opts.hex !== undefined
    ? [opts.hex].filter((h) => ctx.s.hexes[h])
    : Object.values(ctx.s.hexes).filter((h) => h.number !== null && h.number === opts.roll).map((h) => h.id);
  const claims = new Map<string, Map<Id, number>>();
  const gold = new Map<string, GoldOwed>();
  const addClaim = (pid: string, r: Id, n: number) => {
    if (n <= 0) return;
    let m = claims.get(pid);
    if (!m) claims.set(pid, (m = new Map()));
    m.set(r, (m.get(r) ?? 0) + n);
  };
  for (const hid of hexes) {
    const hex = ctx.s.hexes[hid];
    if (!hex.revealed || hexBlocked(ctx, hid)) continue;
    const terr = ctx.L.terrains.get(hex.terrain);
    if (!terr) continue;
    for (const v of hexCorners(parseHexId(hid))) {
      for (const pc of piecesAt(ctx, v)) {
        if (opts.player && pc.owner !== opts.player) continue;
        const pdef = ctx.L.pieces.get(pc.type);
        const mult = pdef?.productionMultiplier ?? 0;
        if (mult <= 0) continue;
        const env = { self: pc.owner, vars: { at: hid } };
        for (const [r, n] of Object.entries(evalResourceMap(ctx, env, terr.produces))) addClaim(pc.owner, r, n * mult);
        for (const b of pdef?.productionBonus ?? []) {
          if (b.terrain !== hex.terrain) continue;
          for (const [r, n] of Object.entries(evalResourceMap(ctx, env, b.gives))) addClaim(pc.owner, r, n);
        }
        if (terr.producesChoice) {
          const g = gold.get(pc.owner) ?? { player: pc.owner, amount: 0, options: terr.producesChoice.options };
          g.amount += terr.producesChoice.amount * mult;
          gold.set(pc.owner, g);
        }
      }
    }
  }
  // bank shortage
  const totals = new Map<Id, { total: number; claimants: number }>();
  for (const m of claims.values()) for (const [r, n] of m) {
    const t = totals.get(r) ?? { total: 0, claimants: 0 };
    t.total += n; t.claimants += 1;
    totals.set(r, t);
  }
  for (const [pid, m] of claims) {
    const got: string[] = [];
    for (const [r, n] of m) {
      const t = totals.get(r)!;
      if (bankHas(ctx, r) < t.total && t.claimants > 1) continue;
      const moved = moveResource(ctx, 'bank', pid, r, n);
      if (moved > 0) got.push(`${moved} ${ctx.L.resources.get(r)?.name ?? r}`);
    }
    if (got.length) log(ctx, `${playerName(ctx, pid)} receives ${got.join(', ')}`, pid);
  }
  for (const [r, t] of totals) {
    if (bankHas(ctx, r) < t.total && t.claimants > 1) log(ctx, `The bank is short of ${ctx.L.resources.get(r)?.name ?? r}; nobody receives it`);
  }
  emit(ctx, 'production', { roll: opts.roll ?? null, hex: opts.hex ?? null });
  return [...gold.values()].filter((g) => g.amount > 0);
}
