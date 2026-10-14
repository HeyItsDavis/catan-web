/**
 * Draw a map as rows of characters instead of listing coordinates.
 *
 * Each row is a line of hexes, one character per hex (spaces are ignored). Odd rows are
 * shifted half a hex to the right, so a picture like
 *
 *     ". * m m m . ."
 *     " . m m m m . ."      <- odd row, drawn shifted
 *
 * reads the way the board looks. The legend says what each character means. A legend entry
 * with `port: true` is a sea hex carrying a port drawn from the map's port bag; the port faces
 * one of its land neighbours automatically (an error is thrown if it has none).
 */
import type { MapDef } from '../engine/schema';
import { SIDE_DIRECTIONS } from '../engine/board/topology';

export interface LegendEntry {
  terrain: string;
  number?: number | '@';
  /** Sea hex with a random port (from the map's port bag). */
  port?: boolean;
  /** Starts face-down (fog). */
  hidden?: boolean;
  tags?: string[];
  /** Counts as land when deciding which way a port faces. Default: terrain is not 'sea'. */
  land?: boolean;
}

type Hex = MapDef['hexes'][number];

/** Axial coordinate of column `c` in row `r` (odd rows shifted right). */
export function offsetToAxial(c: number, r: number): { q: number; r: number } {
  return { q: c - Math.floor(r / 2), r };
}

export function layoutHexes(rows: string[], legend: Record<string, LegendEntry>): Hex[] {
  const grid = rows.map((row) => row.replace(/\s+/g, '').split(''));
  const out: Hex[] = [];
  const isLand = new Map<string, boolean>();
  const entries: { hex: Hex; e: LegendEntry }[] = [];
  grid.forEach((cells, r) => cells.forEach((ch, c) => {
    const e = legend[ch];
    if (!e) throw new Error(`Map layout: no legend entry for "${ch}" (row ${r}, column ${c})`);
    const { q } = offsetToAxial(c, r);
    const hex: Hex = { q, r, terrain: e.terrain };
    if (e.number !== undefined) hex.number = e.number;
    if (e.hidden) hex.hidden = true;
    if (e.tags?.length) hex.tags = [...e.tags];
    isLand.set(`${q},${r}`, !e.port && (e.land ?? e.terrain !== 'sea'));
    entries.push({ hex, e });
    out.push(hex);
  }));
  for (const { hex, e } of entries) {
    if (!e.port) continue;
    const sides = SIDE_DIRECTIONS.map((d, s) => ({ s, land: isLand.get(`${hex.q + d.q},${hex.r + d.r}`) === true }))
      .filter((x) => x.land).map((x) => x.s);
    if (!sides.length) throw new Error(`Map layout: port at (${hex.q}, ${hex.r}) has no land next to it`);
    hex.port = { port: '@', side: sides[Math.floor((sides.length - 1) / 2)] };
  }
  return out;
}

/** How many hexes of a layout use each legend character. */
export function countCells(rows: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ch of rows.join('').replace(/\s+/g, '')) out[ch] = (out[ch] ?? 0) + 1;
  return out;
}
