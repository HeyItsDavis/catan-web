/**
 * Resolution of PlayerRef / ResourceRef / PieceQuery against an Env.
 *
 * Defaults (documented for mod authors):
 *  - PieceQuery.owner omitted = 'any'.
 *  - `near` = pieces located at the bound location OR at any adjacent location
 *    (for a hex: its corners, sides and neighbour hexes).
 *  - {ownerOf: var}: var may hold a piece instance id or a location id.
 */
import type { Id, LocationId, PieceInstance, PieceQuery, PlayerRef, ResourceRef } from './schema';
import { type Ctx, type Env, currentPlayerId, piecesAt } from './context';
import { adjacentLocations, hexesOf, boardTopo } from './board';

/** Returns a player id, 'bank', or null when the ref can't be resolved (e.g. unbound var). */
export function resolvePlayer(ctx: Ctx, env: Env, ref: PlayerRef | undefined, dflt: PlayerRef = 'self'): string | null {
  const r = ref ?? dflt;
  if (r === 'self') return env.self;
  if (r === 'current') return currentPlayerId(ctx.s);
  if (r === 'bank') return 'bank';
  if (typeof r === 'object' && r) {
    if ('var' in r) {
      const v = env.vars[r.var];
      return typeof v === 'string' ? v : null;
    }
    if ('ownerOf' in r) {
      const v = env.vars[r.ownerOf];
      if (typeof v !== 'string') return null;
      const byId = ctx.s.pieces.find((p) => p.id === v);
      if (byId) return byId.owner;
      return piecesAt(ctx, v)[0]?.owner ?? null;
    }
  }
  return null;
}

export function resolveResource(env: Env, ref: ResourceRef | undefined): Id | null {
  if (ref === undefined) return null;
  if (typeof ref === 'string') return ref;
  const v = env.vars[ref.var];
  return typeof v === 'string' ? v : null;
}

export function locVar(env: Env, name: string): LocationId | null {
  const v = env.vars[name];
  return typeof v === 'string' ? v : null;
}

export function ownerMatches(
  ctx: Ctx, env: Env, owner: PlayerRef | 'any' | 'others' | undefined, pid: string,
): boolean {
  if (owner === undefined || owner === 'any') return true;
  if (owner === 'others') return pid !== env.self;
  return resolvePlayer(ctx, env, owner) === pid;
}

export function pieceMatches(ctx: Ctx, env: Env, p: PieceInstance, q: {
  owner?: PlayerRef | 'any' | 'others'; piece?: Id | Id[]; tag?: string;
}): boolean {
  if (q.piece !== undefined) {
    const types = Array.isArray(q.piece) ? q.piece : [q.piece];
    if (!types.includes(p.type)) return false;
  }
  if (q.tag !== undefined && !(ctx.L.pieces.get(p.type)?.tags ?? []).includes(q.tag)) return false;
  return ownerMatches(ctx, env, q.owner, p.owner);
}

export function queryPieces(ctx: Ctx, env: Env, q: PieceQuery): PieceInstance[] {
  let pool: PieceInstance[];
  if (q.near !== undefined) {
    const loc = locVar(env, q.near);
    if (!loc) return [];
    const seen = new Set<PieceInstance>();
    for (const l of [loc, ...adjacentLocations(loc)]) for (const p of piecesAt(ctx, l)) seen.add(p);
    pool = [...seen];
  } else pool = ctx.s.pieces;
  const topo = q.onTerrain ? boardTopo(ctx.s) : null;
  return pool.filter((p) => {
    if (!pieceMatches(ctx, env, p, q)) return false;
    if (q.onTerrain && topo) {
      const hs = hexesOf(topo, p.at);
      if (!hs.some((h) => q.onTerrain!.includes(ctx.s.hexes[h]?.terrain))) return false;
    }
    return true;
  });
}
