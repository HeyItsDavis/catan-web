/**
 * Land regions ("islands"): groups of non-water on-board hexes joined by shared sides.
 * Region ids are 1-based and stable for a given board (numbered in hex order).
 * A vertex / edge belongs to the regions of the land hexes it touches (usually one).
 * Cached on the Ctx; setTerrain invalidates the cache.
 */
import type { HexId, LocationId } from './schema';
import type { Ctx } from './context';
import { boardTopo, hexesOf } from './board';
import { hexId, hexNeighbors, parseHexId } from './board/topology';
import { isWaterHex } from './conditions';

export function regionMap(ctx: Ctx): Map<HexId, number> {
  if (ctx.regions) return ctx.regions;
  const topo = boardTopo(ctx.s);
  const out = new Map<HexId, number>();
  let next = 1;
  for (const h of topo.hexes) {
    if (out.has(h) || isWaterHex(ctx, h)) continue;
    const id = next++;
    const stack = [h];
    out.set(h, id);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const n of hexNeighbors(parseHexId(cur)).map(hexId)) {
        if (!topo.hexSet.has(n) || out.has(n) || isWaterHex(ctx, n)) continue;
        out.set(n, id);
        stack.push(n);
      }
    }
  }
  ctx.regions = out;
  return out;
}

/** Region ids touched by a location (empty for pure water). */
export function regionsOf(ctx: Ctx, loc: LocationId): Set<number> {
  const m = regionMap(ctx);
  const out = new Set<number>();
  for (const h of hexesOf(boardTopo(ctx.s), loc)) {
    const r = m.get(h);
    if (r !== undefined) out.add(r);
  }
  return out;
}
