/**
 * Hex grid topology — shared by engine and renderer.
 *
 * Pointy-top hexes, axial coordinates (q, r).
 * Neighbor directions: E(+1,0) W(-1,0) NE(+1,-1) NW(0,-1) SE(0,+1) SW(-1,+1).
 *
 * Every vertex is owned canonically by exactly one hex as either its
 * top (N) or bottom (S) corner:
 *   corner order of a hex: 0=N, 1=NE, 2=SE, 3=S, 4=SW, 5=NW
 *   N(q,r)  = "v:q,r,N"
 *   NE(q,r) = S of (q+1, r-1)
 *   SE(q,r) = N of (q,   r+1)
 *   S(q,r)  = "v:q,r,S"
 *   SW(q,r) = N of (q-1, r+1)
 *   NW(q,r) = S of (q,   r-1)
 * Side i of a hex lies between corner i and corner (i+1)%6:
 *   0=NE face, 1=E face, 2=SE face, 3=SW face, 4=W face, 5=NW face.
 * Edge ids are "e:" + the two vertex ids sorted and joined with "|".
 */
import type { EdgeId, HexCoord, HexId, VertexId } from '../schema';

export const SQRT3 = Math.sqrt(3);

/** Neighbor offset across side i (same indexing as sides). */
export const SIDE_DIRECTIONS: HexCoord[] = [
  { q: 1, r: -1 }, // 0 NE
  { q: 1, r: 0 },  // 1 E
  { q: 0, r: 1 },  // 2 SE
  { q: -1, r: 1 }, // 3 SW
  { q: -1, r: 0 }, // 4 W
  { q: 0, r: -1 }, // 5 NW
];

export function hexId(c: HexCoord): HexId {
  return `h:${c.q},${c.r}`;
}

export function parseHexId(id: HexId): HexCoord {
  const [q, r] = id.slice(2).split(',').map(Number);
  return { q, r };
}

function vid(q: number, r: number, c: 'N' | 'S'): VertexId {
  return `v:${q},${r},${c}`;
}

export function parseVertexId(id: VertexId): { q: number; r: number; c: 'N' | 'S' } {
  const [q, r, c] = id.slice(2).split(',');
  return { q: Number(q), r: Number(r), c: c as 'N' | 'S' };
}

/** The six corner vertex ids of a hex, in order N, NE, SE, S, SW, NW. */
export function hexCorners(h: HexCoord): VertexId[] {
  const { q, r } = h;
  return [
    vid(q, r, 'N'),
    vid(q + 1, r - 1, 'S'),
    vid(q, r + 1, 'N'),
    vid(q, r, 'S'),
    vid(q - 1, r + 1, 'N'),
    vid(q, r - 1, 'S'),
  ];
}

export function edgeIdOf(a: VertexId, b: VertexId): EdgeId {
  return a < b ? `e:${a}|${b}` : `e:${b}|${a}`;
}

export function edgeVertices(e: EdgeId): [VertexId, VertexId] {
  const [a, b] = e.slice(2).split('|');
  return [a, b];
}

/** The six edges of a hex, side 0..5. */
export function hexEdges(h: HexCoord): EdgeId[] {
  const c = hexCorners(h);
  return c.map((v, i) => edgeIdOf(v, c[(i + 1) % 6]));
}

export function hexNeighbors(h: HexCoord): HexCoord[] {
  return SIDE_DIRECTIONS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

/** The 3 hex coords touching a vertex (may include off-board hexes). */
export function vertexHexes(v: VertexId): HexCoord[] {
  const { q, r, c } = parseVertexId(v);
  return c === 'N'
    ? [{ q, r }, { q, r: r - 1 }, { q: q + 1, r: r - 1 }]
    : [{ q, r }, { q, r: r + 1 }, { q: q - 1, r: r + 1 }];
}

/** The 3 vertices adjacent (one edge away) to a vertex. */
export function vertexNeighbors(v: VertexId): VertexId[] {
  const { q, r, c } = parseVertexId(v);
  return c === 'N'
    ? [vid(q, r - 1, 'S'), vid(q + 1, r - 2, 'S'), vid(q + 1, r - 1, 'S')]
        // N(q,r) neighbors: NW corner of hex = S(q,r-1); NE corner = S(q+1,r-1); straight up = S(q+1,r-2)
    : [vid(q, r + 1, 'N'), vid(q - 1, r + 1, 'N'), vid(q - 1, r + 2, 'N')];
}

/** The 3 edges touching a vertex. */
export function vertexEdges(v: VertexId): EdgeId[] {
  return vertexNeighbors(v).map((n) => edgeIdOf(v, n));
}

/** The 1-2 hexes bordering an edge (may include off-board hexes; always returns 2). */
export function edgeHexes(e: EdgeId): HexCoord[] {
  const [a, b] = edgeVertices(e);
  const ha = vertexHexes(a).map(hexId);
  const hb = new Set(vertexHexes(b).map(hexId));
  return ha.filter((h) => hb.has(h)).map(parseHexId);
}

/** Edges that share a vertex with this edge. */
export function edgeNeighbors(e: EdgeId): EdgeId[] {
  const [a, b] = edgeVertices(e);
  return [...vertexEdges(a), ...vertexEdges(b)].filter((x) => x !== e);
}

/* ---------------------------- pixel geometry ---------------------------- */

export interface Point { x: number; y: number }

/** Center of a hex, for hex circumradius `size`. */
export function hexToPixel(h: HexCoord, size: number): Point {
  return { x: size * SQRT3 * (h.q + h.r / 2), y: size * 1.5 * h.r };
}

/** Corner points of a hex, order N, NE, SE, S, SW, NW. */
export function hexCornerPoints(h: HexCoord, size: number): Point[] {
  const c = hexToPixel(h, size);
  return [0, 1, 2, 3, 4, 5].map((i) => {
    const a = ((-90 + 60 * i) * Math.PI) / 180;
    return { x: c.x + size * Math.cos(a), y: c.y + size * Math.sin(a) };
  });
}

export function vertexToPixel(v: VertexId, size: number): Point {
  const { q, r, c } = parseVertexId(v);
  const center = hexToPixel({ q, r }, size);
  return { x: center.x, y: center.y + (c === 'N' ? -size : size) };
}

export function edgeToPixel(e: EdgeId, size: number): { a: Point; b: Point; mid: Point; angle: number } {
  const [va, vb] = edgeVertices(e);
  const a = vertexToPixel(va, size);
  const b = vertexToPixel(vb, size);
  return {
    a,
    b,
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  };
}
