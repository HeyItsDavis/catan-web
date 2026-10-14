/**
 * Board-level topology derived from the set of hexes in a game:
 * the universe of vertices / edges, location kinds and adjacency.
 * Cached per distinct hex set (the hex set never changes during a game).
 */
import type { EdgeId, GameState, HexId, LocationId, LocationKind, VertexId } from './schema';
import {
  edgeHexes, edgeNeighbors, edgeVertices, hexCorners, hexEdges, hexId, hexNeighbors, parseHexId, vertexEdges,
  vertexHexes, vertexNeighbors,
} from './board/topology';

export interface BoardTopo {
  hexes: HexId[];
  hexSet: Set<HexId>;
  vertices: VertexId[];
  edges: EdgeId[];
  /** On-board hexes touching each vertex / edge. */
  vertexHexes: Map<VertexId, HexId[]>;
  edgeHexes: Map<EdgeId, HexId[]>;
}

const cache = new Map<string, BoardTopo>();

export function boardTopo(s: Pick<GameState, 'hexes'>): BoardTopo {
  const hexes = Object.keys(s.hexes);
  const key = hexes.join(';');
  const hit = cache.get(key);
  if (hit) return hit;
  const hexSet = new Set(hexes);
  const vs = new Set<VertexId>();
  const es = new Set<EdgeId>();
  for (const h of hexes) {
    const c = parseHexId(h);
    hexCorners(c).forEach((v) => vs.add(v));
    hexEdges(c).forEach((e) => es.add(e));
  }
  const vertices = [...vs];
  const edges = [...es];
  const vh = new Map<VertexId, HexId[]>();
  for (const v of vertices) vh.set(v, vertexHexes(v).map(hexId).filter((h) => hexSet.has(h)));
  const eh = new Map<EdgeId, HexId[]>();
  for (const e of edges) eh.set(e, edgeHexes(e).map(hexId).filter((h) => hexSet.has(h)));
  const topo: BoardTopo = { hexes, hexSet, vertices, edges, vertexHexes: vh, edgeHexes: eh };
  if (cache.size > 64) cache.clear();
  cache.set(key, topo);
  return topo;
}

export function kindOf(loc: LocationId): LocationKind {
  if (loc.startsWith('h:')) return 'hex';
  if (loc.startsWith('v:')) return 'vertex';
  return 'edge';
}

export function locationsOfKind(topo: BoardTopo, kind: LocationKind): LocationId[] {
  return kind === 'hex' ? topo.hexes : kind === 'vertex' ? topo.vertices : topo.edges;
}

/** On-board hexes touching a location (a hex returns itself). */
export function hexesOf(topo: BoardTopo, loc: LocationId): HexId[] {
  const k = kindOf(loc);
  if (k === 'hex') return topo.hexSet.has(loc) ? [loc] : [];
  if (k === 'vertex') return topo.vertexHexes.get(loc) ?? vertexHexes(loc).map(hexId).filter((h) => topo.hexSet.has(h));
  return topo.edgeHexes.get(loc) ?? edgeHexes(loc).map(hexId).filter((h) => topo.hexSet.has(h));
}

/** All locations adjacent to `loc` (not including itself), across all kinds. */
export function adjacentLocations(loc: LocationId): LocationId[] {
  const k = kindOf(loc);
  if (k === 'hex') {
    const c = parseHexId(loc);
    return [...hexNeighbors(c).map(hexId), ...hexCorners(c), ...hexEdges(c)];
  }
  if (k === 'vertex') return [...vertexNeighbors(loc), ...vertexEdges(loc), ...vertexHexes(loc).map(hexId)];
  return [...edgeNeighbors(loc), ...edgeVertices(loc), ...edgeHexes(loc).map(hexId)];
}

export function areAdjacent(a: LocationId, b: LocationId): boolean {
  return adjacentLocations(a).includes(b);
}
