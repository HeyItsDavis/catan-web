/**
 * Expr evaluation. Every Expr evaluates to a finite number (unknown/unbound -> 0).
 * Defaults: resourceCount/cardCount/stat `player` = 'self'; resourceCount without
 * `resource` counts all resources (optionally filtered by `kind`).
 */
import type { Expr, ResourceMap, Id } from './schema';
import { type Ctx, type Env, findPlayer, settingValue } from './context';
import { evalCond } from './conditions';
import { resolvePlayer, resolveResource, queryPieces } from './refs';
import { randInt } from './rng';
import { rng } from './context';
import { computeVPInternal } from './vp';
import { longestRoadFor } from './awards';

export function evalExpr(ctx: Ctx, env: Env, e: Expr): number {
  const n = evalRaw(ctx, env, e);
  return Number.isFinite(n) ? n : 0;
}

function evalRaw(ctx: Ctx, env: Env, e: Expr): number {
  if (typeof e === 'number') return e;
  if (e === null || typeof e !== 'object') return 0;
  if ('var' in e) {
    const v = env.vars[e.var];
    return typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : typeof v === 'string' ? Number(v) || 0 : 0;
  }
  if ('param' in e) {
    const v = settingValue(ctx, e.param);
    return typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : Number(v) || 0;
  }
  if ('add' in e) return e.add.reduce((a: number, x) => a + evalExpr(ctx, env, x), 0);
  if ('sub' in e) return evalExpr(ctx, env, e.sub[0]) - evalExpr(ctx, env, e.sub[1]);
  if ('mul' in e) return e.mul.reduce((a: number, x) => a * evalExpr(ctx, env, x), 1);
  if ('div' in e) {
    const d = evalExpr(ctx, env, e.div[1]);
    return d === 0 ? 0 : Math.floor(evalExpr(ctx, env, e.div[0]) / d);
  }
  if ('min' in e) return e.min.length ? Math.min(...e.min.map((x) => evalExpr(ctx, env, x))) : 0;
  if ('max' in e) return e.max.length ? Math.max(...e.max.map((x) => evalExpr(ctx, env, x))) : 0;
  if ('if' in e) return evalCond(ctx, env, e.if[0]) ? evalExpr(ctx, env, e.if[1]) : evalExpr(ctx, env, e.if[2]);
  if ('random' in e) return randInt(rng(ctx), evalExpr(ctx, env, e.random[0]), evalExpr(ctx, env, e.random[1]));
  if ('resourceCount' in e) {
    const q = e.resourceCount;
    const p = findPlayer(ctx, resolvePlayer(ctx, env, q.player));
    if (!p) return 0;
    if (q.resource !== undefined && q.resource !== 'any') {
      const r = resolveResource(env, q.resource);
      return r ? p.resources[r] ?? 0 : 0;
    }
    let n = 0;
    for (const [r, c] of Object.entries(p.resources)) {
      if (q.kind !== undefined && ctx.L.resources.get(r)?.kind !== q.kind) continue;
      n += c;
    }
    return n;
  }
  if ('pieceCount' in e) return queryPieces(ctx, env, e.pieceCount).length;
  if ('cardCount' in e) {
    const q = e.cardCount;
    const p = findPlayer(ctx, resolvePlayer(ctx, env, q.player));
    if (!p) return 0;
    const pool = q.played ? p.played : p.hand;
    return pool.filter((c) => (q.card === undefined || c.card === q.card) && (q.deck === undefined || c.deck === q.deck)).length;
  }
  if ('stat' in e) {
    const p = findPlayer(ctx, resolvePlayer(ctx, env, e.stat.player));
    return p?.stats[e.stat.key] ?? 0;
  }
  if ('global' in e) return ctx.s.globals[e.global] ?? 0;
  if ('vp' in e) {
    const pid = resolvePlayer(ctx, env, e.vp);
    return pid && findPlayer(ctx, pid) ? computeVPInternal(ctx, pid, false) : 0;
  }
  if ('dice' in e) {
    const lr = ctx.s.lastRoll;
    if (!lr) return 0;
    return e.dice === 'total' ? lr.total : lr.dice[e.dice] ?? 0;
  }
  if ('playerCount' in e) return ctx.s.players.length;
  if ('longestRoad' in e) {
    const pid = resolvePlayer(ctx, env, e.longestRoad);
    return pid && findPlayer(ctx, pid) ? longestRoadFor(ctx, pid) : 0;
  }
  return 0;
}

/** Evaluate a ResourceMap into concrete non-negative integer amounts (zero entries dropped). */
export function evalResourceMap(ctx: Ctx, env: Env, m: ResourceMap | undefined): Record<Id, number> {
  const out: Record<Id, number> = {};
  if (!m) return out;
  for (const [r, x] of Object.entries(m)) {
    const n = Math.max(0, Math.floor(evalExpr(ctx, env, x)));
    if (n > 0) out[r] = n;
  }
  return out;
}
