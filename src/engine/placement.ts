/**
 * Legal-location computation for pieces and tokens. The candidate is bound to var `at`.
 *
 * Piece placement:
 *  - setup phase: `setupWhere` if given, else `where` with connectedTo stripped;
 *  - pieces with `upgradesFrom` (outside setup-with-setupWhere): candidates are the player's own
 *    pieces of those types, filtered by `where` (evaluated with the old piece still present);
 *  - `ignoreConnection`: `where` with connectedTo stripped.
 */
import type { Condition, Id, LocationId, LocationKind, PieceDef } from './schema';
import { type Ctx, type Env, supplyLeft } from './context';
import { evalCond, stripConnection } from './conditions';
import { boardTopo, locationsOfKind } from './board';

export interface PlaceOpts { setup?: boolean; ignoreConnection?: boolean; where?: Condition; ignoreSupply?: boolean }

export function filterLocations(
  ctx: Ctx, env: Env, candidates: LocationId[], conds: (Condition | undefined)[], bindAs = 'at', self = env.self,
): LocationId[] {
  const vars = { ...env.vars };
  const e: Env = { self, vars };
  const out: LocationId[] = [];
  for (const loc of candidates) {
    vars[bindAs] = loc;
    if (conds.every((c) => evalCond(ctx, e, c))) out.push(loc);
  }
  return out;
}

export function placementCondition(def: PieceDef, setup: boolean, ignoreConnection: boolean): Condition {
  if (setup) return def.placement.setupWhere ?? stripConnection(def.placement.where);
  return ignoreConnection ? stripConnection(def.placement.where) : def.placement.where;
}

export function legalPlacements(ctx: Ctx, env: Env, pieceId: Id, pid: string, opts: PlaceOpts = {}): LocationId[] {
  const def = ctx.L.pieces.get(pieceId);
  if (!def) return [];
  if (!opts.ignoreSupply && supplyLeft(ctx, pid, pieceId) <= 0) return [];
  const setup = opts.setup ?? ctx.s.phase === 'setup';
  const cond = placementCondition(def, setup, !!opts.ignoreConnection);
  let universe: LocationId[];
  if (def.upgradesFrom?.length && !(setup && def.placement.setupWhere)) {
    const from = def.upgradesFrom;
    universe = [...new Set(ctx.s.pieces.filter((p) => p.owner === pid && from.includes(p.type)).map((p) => p.at))];
  } else {
    universe = locationsOfKind(boardTopo(ctx.s), def.placement.on);
  }
  return filterLocations(ctx, env, universe, [cond, opts.where], 'at', pid);
}

/** Locations of the player's pieces of `from` types that can become `to`. */
export function legalUpgrades(ctx: Ctx, env: Env, from: Id[], to: Id, pid: string, where?: Condition): LocationId[] {
  const def = ctx.L.pieces.get(to);
  if (!def || supplyLeft(ctx, pid, to) <= 0) return [];
  const universe = [...new Set(ctx.s.pieces.filter((p) => p.owner === pid && from.includes(p.type)).map((p) => p.at))];
  return filterLocations(ctx, env, universe, [where], 'at', pid);
}

export function legalTokenSpots(ctx: Ctx, env: Env, tokenId: Id, where?: Condition): LocationId[] {
  const t = ctx.L.tokens.get(tokenId);
  if (!t) return [];
  return filterLocations(ctx, env, locationsOfKind(boardTopo(ctx.s), t.on), [t.where, where]);
}

export function allLocations(ctx: Ctx, kind: LocationKind): LocationId[] {
  return locationsOfKind(boardTopo(ctx.s), kind);
}
