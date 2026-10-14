import { describe, expect, it } from 'vitest';
import {
  edgeHexes, hexCorners, hexEdges, vertexEdges, vertexHexes, vertexNeighbors, vertexToPixel, hexCornerPoints, hexId,
} from './topology';

describe('topology', () => {
  const h = { q: 2, r: -1 };

  it('corner ids match pixel corners', () => {
    const ids = hexCorners(h);
    const pts = hexCornerPoints(h, 10);
    ids.forEach((v, i) => {
      const p = vertexToPixel(v, 10);
      expect(p.x).toBeCloseTo(pts[i].x);
      expect(p.y).toBeCloseTo(pts[i].y);
    });
  });

  it('each corner of a hex lists that hex among its 3 hexes', () => {
    for (const v of hexCorners(h)) {
      expect(vertexHexes(v).map(hexId)).toContain(hexId(h));
    }
  });

  it('adjacent corners are vertex neighbors (symmetric)', () => {
    const c = hexCorners(h);
    c.forEach((v, i) => {
      const n = c[(i + 1) % 6];
      expect(vertexNeighbors(v)).toContain(n);
      expect(vertexNeighbors(n)).toContain(v);
    });
  });

  it('neighbors are at distance = size', () => {
    for (const v of hexCorners(h)) {
      const p = vertexToPixel(v, 10);
      for (const n of vertexNeighbors(v)) {
        const o = vertexToPixel(n, 10);
        expect(Math.hypot(p.x - o.x, p.y - o.y)).toBeCloseTo(10);
      }
    }
  });

  it('hex edges border the hex and each vertex has 3 edges', () => {
    for (const e of hexEdges(h)) {
      expect(edgeHexes(e).map(hexId)).toContain(hexId(h));
      expect(edgeHexes(e)).toHaveLength(2);
    }
    for (const v of hexCorners(h)) expect(new Set(vertexEdges(v)).size).toBe(3);
  });
});
