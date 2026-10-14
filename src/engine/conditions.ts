/**
 * Condition evaluation.
 *
 * Location-scoped semantics (`at` names a bound location var):
 *  - terrainIs / hexNumberIn: a hex tests itself; a vertex/edge tests ANY touching on-board hex.
 *  - isWater: a hex tests its terrain; a vertex/edge is water if ALL touching hexes are water
 *    (off-board counts as water). So `{not:{isWater}}` = "touches land".
 *  - isCoastal: touches both land and water/off-board.
 *  - occupied: some piece located exactly at `at` (filtered by piece/owner).
 *  - adjacentTo: some piece at a location adjacent to `at`.
 *  - connectedTo: edge – an endpoint holds an own piece, or an endpoint not blocked by an opposing
 *    network-breaking piece touches another own network edge (`via` piece types, default any piece
 *    with a `network`); vertex – an own network piece on an incident edge (or own piece on it).
 *  - distanceRule: `minDistance` = minimum number of edges between `at` and any "building"
 *    (see context.isBuilding); default 2 = the standard rule (no building on an adjacent vertex).
 */
import type { Condition } from './schema';
import { type Ctx, type Env, currentPlayerId, findPlayer, isBuilding, piecesAt, settingValue } from './context';
import { evalExpr, evalResourceMap } from './exprs';
import { locOf, pieceMatches, pieceOf, resolvePlayer } from './refs';
import { regionsOf } from './regions';
import { adjacentLocations, areAdjacent, boardTopo, hexesOf, kindOf } from './board';
import { edgeVertices, parseHexId, hexNeighbors, hexId, vertexEdges, vertexNeighbors } from './board/topology';

export function evalCond(ctx: Ctx, env: Env, c: Condition | undefined): boolean {
  if (c === undefined || c === true) return true;
  if (c === false || c === null || typeof c !== 'object') return false;
  if ('all' in c) return c.all.every((x) => evalCond(ctx, env, x));
  if ('any' in c) return c.any.some((x) => evalCond(ctx, env, x));
  if ('not' in c) return !evalCond(ctx, env, c.not);
  if ('cmp' in c) {
    const a = evalExpr(ctx, env, c.cmp[0]);
    const b = evalExpr(ctx, env, c.cmp[2]);
    switch (c.cmp[1]) {
      case '==': return a === b;
      case '!=': return a !== b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
    }
    return false;
  }
  if ('canAfford' in c) {
    const p = findPlayer(ctx, resolvePlayer(ctx, env, c.canAfford.player));
    if (!p) return false;
    const cost = evalResourceMap(ctx, env, c.canAfford.cost);
    return Object.entries(cost).every(([r, n]) => (p.resources[r] ?? 0) >= n);
  }
  if ('isTurnOf' in c) return resolvePlayer(ctx, env, c.isTurnOf) === currentPlayerId(ctx.s);
  if ('phase' in c) return (Array.isArray(c.phase) ? c.phase : [c.phase]).includes(ctx.s.phase);
  if ('hasRolled' in c) return ctx.s.hasRolled === c.hasRolled;
  if ('flag' in c) {
    const p = findPlayer(ctx, resolvePlayer(ctx, env, c.player));
    return !!p?.flags[c.flag]?.value;
  }
  if ('setting' in c) return !!settingValue(ctx, c.setting);
  if ('samePlayer' in c) {
    const a = resolvePlayer(ctx, env, c.samePlayer[0]);
    const b = resolvePlayer(ctx, env, c.samePlayer[1]);
    return a !== null && a === b;
  }
  if ('varSet' in c) return env.vars[c.varSet] !== undefined && env.vars[c.varSet] !== null;
  if ('isAdjacent' in c) {
    const a = locOf(ctx, env, c.isAdjacent[0]);
    const b = locOf(ctx, env, c.isAdjacent[1]);
    return !!a && !!b && areAdjacent(a, b);
  }

  // --- location scoped ---
  if ('terrainIs' in c) {
    const loc = locOf(ctx, env, c.terrainIs.at);
    if (!loc) return false;
    const ts = Array.isArray(c.terrainIs.terrain) ? c.terrainIs.terrain : [c.terrainIs.terrain];
    return hexesOf(boardTopo(ctx.s), loc).some((h) => ts.includes(ctx.s.hexes[h].terrain));
  }
  if ('isWater' in c) {
    const loc = locOf(ctx, env, c.isWater.at);
    if (!loc) return false;
    return hexesOf(boardTopo(ctx.s), loc).every((h) => isWaterHex(ctx, h));
  }
  if ('isCoastal' in c) {
    const loc = locOf(ctx, env, c.isCoastal.at);
    if (!loc) return false;
    return isCoastal(ctx, loc);
  }
  if ('occupied' in c) {
    const loc = locOf(ctx, env, c.occupied.at);
    if (!loc) return false;
    return piecesAt(ctx, loc).some((p) => pieceMatches(ctx, env, p, c.occupied));
  }
  if ('adjacentTo' in c) {
    const loc = locOf(ctx, env, c.adjacentTo.at);
    if (!loc) return false;
    return adjacentLocations(loc).some((l) => piecesAt(ctx, l).some((p) => pieceMatches(ctx, env, p, c.adjacentTo)));
  }
  if ('connectedTo' in c) {
    const loc = locOf(ctx, env, c.connectedTo.at);
    const pid = resolvePlayer(ctx, env, c.connectedTo.owner);
    if (!loc || !pid) return false;
    return connectedTo(ctx, loc, pid, c.connectedTo.via);
  }
  if ('distanceRule' in c) {
    const loc = locOf(ctx, env, c.distanceRule.at);
    if (!loc) return false;
    return distanceOk(ctx, loc, (c.distanceRule.minDistance ?? 2) - 1);
  }
  if ('hasToken' in c) {
    const loc = locOf(ctx, env, c.hasToken.at);
    const tok = ctx.s.tokens[c.hasToken.token];
    if (!loc || !tok) return false;
    return tok === loc || (!!c.hasToken.near && areAdjacent(loc, tok));
  }
  if ('isNetworkEnd' in c) {
    const loc = locOf(ctx, env, c.isNetworkEnd.at);
    if (!loc || kindOf(loc) !== 'edge') return false;
    const here = pieceOf(ctx, env, c.isNetworkEnd.at);
    const pid = c.isNetworkEnd.owner !== undefined ? resolvePlayer(ctx, env, c.isNetworkEnd.owner) : here?.owner ?? env.self;
    if (!pid) return false;
    return isNetworkEnd(ctx, loc, pid, c.isNetworkEnd.via, here?.type);
  }
  if ('sameRegion' in c) {
    const a = locOf(ctx, env, c.sameRegion[0]);
    const b = locOf(ctx, env, c.sameRegion[1]);
    if (!a || !b) return false;
    const rb = regionsOf(ctx, b);
    return [...regionsOf(ctx, a)].some((r) => rb.has(r));
  }
  if ('hexNumberIn' in c) {
    const loc = locOf(ctx, env, c.hexNumberIn.at);
    if (!loc) return false;
    return hexesOf(boardTopo(ctx.s), loc).some((h) => {
      const n = ctx.s.hexes[h].number;
      return n !== null && c.hexNumberIn.numbers.includes(n);
    });
  }
  return false;
}

export function isWaterHex(ctx: Ctx, h: string): boolean {
  const hs = ctx.s.hexes[h];
  if (!hs) return true;
  return !!ctx.L.terrains.get(hs.terrain)?.water;
}

function isCoastal(ctx: Ctx, loc: string): boolean {
  const topo = boardTopo(ctx.s);
  const k = kindOf(loc);
  if (k === 'hex') {
    if (isWaterHex(ctx, loc)) return false;
    const ns = hexNeighbors(parseHexId(loc)).map(hexId);
    return ns.some((n) => isWaterHex(ctx, n));
  }
  const hs = hexesOf(topo, loc);
  const offBoard = hs.length < (k === 'vertex' ? 3 : 2);
  const water = offBoard || hs.some((h) => isWaterHex(ctx, h));
  const land = hs.some((h) => !isWaterHex(ctx, h));
  return water && land;
}

function isNetworkPiece(ctx: Ctx, type: string, via: string[] | undefined): boolean {
  return via ? via.includes(type) : !!ctx.L.pieces.get(type)?.network;
}

/** Whether an opposing piece on vertex v breaks `pid`'s network there. */
export function vertexBlocks(ctx: Ctx, v: string, pid: string): boolean {
  return piecesAt(ctx, v).some((p) => p.owner !== pid && ctx.L.pieces.get(p.type)?.breaksNetworks !== false);
}

export function connectedTo(ctx: Ctx, loc: string, pid: string, via?: string[]): boolean {
  const k = kindOf(loc);
  const ownNet = (l: string) => piecesAt(ctx, l).some((p) => p.owner === pid && isNetworkPiece(ctx, p.type, via));
  if (k === 'vertex') {
    if (piecesAt(ctx, loc).some((p) => p.owner === pid)) return true;
    return vertexEdges(loc).some(ownNet);
  }
  if (k === 'edge') {
    for (const v of edgeVertices(loc)) {
      if (piecesAt(ctx, v).some((p) => p.owner === pid)) return true;
      if (vertexBlocks(ctx, v, pid)) continue;
      if (vertexEdges(v).some((e) => e !== loc && ownNet(e))) return true;
    }
    return false;
  }
  return adjacentLocations(loc).some((l) => piecesAt(ctx, l).some((p) => p.owner === pid));
}

/**
 * An edge is an open end of `pid`'s route if some endpoint holds no piece of `pid` and touches no
 * other edge of `pid`'s route. Route pieces = `via` types, else pieces sharing the network of
 * `type` (the piece on the edge), else any network piece.
 */
export function isNetworkEnd(ctx: Ctx, edge: string, pid: string, via?: string[], type?: string): boolean {
  const net = type ? ctx.L.pieces.get(type)?.network : undefined;
  const isRoute = (t: string) => via ? via.includes(t) : net ? ctx.L.pieces.get(t)?.network === net : !!ctx.L.pieces.get(t)?.network;
  return edgeVertices(edge).some((v) => {
    if (piecesAt(ctx, v).some((p) => p.owner === pid)) return false;
    return !vertexEdges(v).some((e) => e !== edge && piecesAt(ctx, e).some((p) => p.owner === pid && isRoute(p.type)));
  });
}

function distanceOk(ctx: Ctx, loc: string, n: number): boolean {
  if (kindOf(loc) !== 'vertex') return true;
  let frontier = [loc];
  const seen = new Set(frontier);
  for (let d = 1; d <= n; d++) {
    const next: string[] = [];
    for (const v of frontier) for (const nb of vertexNeighbors(v)) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      if (piecesAt(ctx, nb).some((p) => isBuilding(ctx.L.pieces.get(p.type)))) return false;
      next.push(nb);
    }
    frontier = next;
  }
  return true;
}

/** Replace every `connectedTo` node with `true` (used for setup / ignoreConnection placement). */
export function stripConnection(c: Condition): Condition {
  if (c === true || c === false || typeof c !== 'object' || c === null) return c;
  if ('connectedTo' in c) return true;
  if ('all' in c) return { all: c.all.map(stripConnection) };
  if ('any' in c) return { any: c.any.map(stripConnection) };
  if ('not' in c) return { not: stripConnection(c.not) };
  return c;
}
