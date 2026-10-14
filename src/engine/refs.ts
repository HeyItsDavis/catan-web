/**
 * Resolution of PlayerRef / ResourceRef / PieceQuery against an Env.
 *
 * Defaults (documented for mod authors):
 *  - PieceQuery.owner omitted = 'any'.
 *  - `near` = pieces located at the bound location OR at any adjacent location
 *    (for a hex: its corners, sides and neighbour hexes).
 *  - {ownerOf: var}: var may hold a piece instance id or a location id.
 *  - Any var used as a location may hold a piece instance id instead (= where that piece is).
 *  - PieceQuery.where sees the candidate piece as `candidate` (location) and `candidateId` (id).
 */
import type { Id, LocationId, PieceInstance, PieceQuery, PlayerRef, ResourceRef } from './schema';
import { type Ctx, type Env, currentPlayerId, piecesAt } from './context';
import { adjacentLocations, hexesOf, boardTopo } from './board';
import { evalCond } from './conditions';
import { regionsOf } from './regions';

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
      const byId = pieceById(ctx, v);
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

/** Raw string value of a var (no piece-id resolution). Prefer `locOf`. */
export function locVar(env: Env, name: string): LocationId | null {
  const v = env.vars[name];
  return typeof v === 'string' ? v : null;
}

export function isLocationId(v: string): boolean {
  return v.startsWith('h:') || v.startsWith('v:') || v.startsWith('e:');
}

export function pieceById(ctx: Ctx, id: string): PieceInstance | undefined {
  if (isLocationId(id)) return undefined;
  return ctx.s.pieces.find((p) => p.id === id);
}

/** Location held by a var; a piece instance id resolves to the piece's current location. */
export function locOf(ctx: Ctx, env: Env, name: string): LocationId | null {
  const v = env.vars[name];
  if (typeof v !== 'string') return null;
  if (isLocationId(v)) return v;
  return pieceById(ctx, v)?.at ?? v;
}

/** The piece a var refers to: a piece instance id, or the first piece at a location (matching `q`). */
export function pieceOf(ctx: Ctx, env: Env, name: string, q?: PieceQuery): PieceInstance | undefined {
  const v = env.vars[name];
  if (typeof v !== 'string') return undefined;
  if (q?.near !== undefined) return queryPieces(ctx, env, q).find((p) => p.id === v || p.at === v);
  const byId = pieceById(ctx, v);
  if (byId) return !q || queryMatches(ctx, env, byId, q) ? byId : undefined;
  return piecesAt(ctx, v).find((p) => !q || queryMatches(ctx, env, p, q));
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

/** Every PieceQuery filter except `near` (which selects the pool). `regions` = precomputed q.region. */
export function queryMatches(ctx: Ctx, env: Env, p: PieceInstance, q: PieceQuery, regions?: Set<number> | null): boolean {
  if (!pieceMatches(ctx, env, p, q)) return false;
  if (q.onTerrain) {
    const hs = hexesOf(boardTopo(ctx.s), p.at);
    if (!hs.some((h) => q.onTerrain!.includes(ctx.s.hexes[h]?.terrain))) return false;
  }
  if (q.state) {
    for (const [k, v] of Object.entries(q.state)) if ((p.state[k] ?? 0) !== v) return false;
  }
  if (q.region !== undefined) {
    let rs = regions;
    if (rs === undefined) {
      const loc = locOf(ctx, env, q.region);
      rs = loc ? regionsOf(ctx, loc) : null;
    }
    if (!rs || !rs.size) return false;
    const mine = regionsOf(ctx, p.at);
    if (![...mine].some((r) => rs!.has(r))) return false;
  }
  if (q.where !== undefined) {
    const e: Env = { self: env.self, vars: { ...env.vars, candidate: p.at, candidateId: p.id } };
    if (!evalCond(ctx, e, q.where)) return false;
  }
  return true;
}

export function queryPieces(ctx: Ctx, env: Env, q: PieceQuery): PieceInstance[] {
  let pool: PieceInstance[];
  if (q.near !== undefined) {
    const loc = locOf(ctx, env, q.near);
    if (!loc) return [];
    const seen = new Set<PieceInstance>();
    for (const l of [loc, ...adjacentLocations(loc)]) for (const p of piecesAt(ctx, l)) seen.add(p);
    pool = [...seen];
  } else pool = ctx.s.pieces;
  let regions: Set<number> | null | undefined;
  if (q.region !== undefined) {
    const loc = locOf(ctx, env, q.region);
    regions = loc ? regionsOf(ctx, loc) : null;
    if (!regions) return [];
  }
  return pool.filter((p) => queryMatches(ctx, env, p, q, regions));
}
