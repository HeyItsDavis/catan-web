/**
 * Map generation from a MapDef (deterministic with the game rng).
 *  - terrain '@bag' draws from terrainBags[bag] (shuffled);
 *  - number: explicit value; '@' draws from numberBag; omitted -> drawn from numberBag if the
 *    terrain is `numbered` and a bag exists, else none;
 *  - noAdjacentRedNumbers: reshuffle numbers until no two 6/8 tokens are neighbours;
 *  - port '@' draws from portBag. A port on hex side i is granted by that side's two corners.
 */
import type { GameDefinition, HexState, MapDef, PortInstance } from './schema';
import { type RngHolder, shuffle } from './rng';
import { hexCorners, hexId, hexNeighbors } from './board/topology';

export function generateMap(r: RngHolder, def: GameDefinition, map: MapDef): { hexes: Record<string, HexState>; ports: PortInstance[] } {
  const terrains = new Map(def.terrains.map((t) => [t.id, t]));
  const bags: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(map.terrainBags ?? {})) bags[k] = shuffle(r, [...v]);
  const hexes: Record<string, HexState> = {};
  const needNumber: string[] = [];
  for (const h of map.hexes) {
    let terrain = h.terrain;
    if (terrain.startsWith('@')) {
      const bag = bags[terrain.slice(1)];
      if (!bag?.length) throw new Error(`Map ${map.id}: terrain bag ${terrain} is empty or missing`);
      terrain = bag.pop()!;
    }
    const id = hexId(h);
    const tdef = terrains.get(terrain);
    let number: number | null = null;
    if (typeof h.number === 'number') number = h.number;
    else if (h.number === '@' || (h.number === undefined && tdef?.numbered && map.numberBag)) needNumber.push(id);
    hexes[id] = { id, coord: { q: h.q, r: h.r }, terrain, number, revealed: !tdef?.hidden };
  }
  if (needNumber.length) {
    const bag = map.numberBag ?? [];
    if (bag.length < needNumber.length) throw new Error(`Map ${map.id}: number bag has ${bag.length} tokens, needs ${needNumber.length}`);
    const isRed = (n: number | null) => n === 6 || n === 8;
    for (let attempt = 0; attempt < 500; attempt++) {
      const nums = shuffle(r, [...bag]);
      needNumber.forEach((id, i) => { hexes[id].number = nums[i]; });
      if (!map.noAdjacentRedNumbers) break;
      const bad = Object.values(hexes).some((h) => isRed(h.number)
        && hexNeighbors(h.coord).some((n) => isRed(hexes[hexId(n)]?.number ?? null)));
      if (!bad) break;
    }
  }
  const portBag = shuffle(r, [...(map.portBag ?? [])]);
  const ports: PortInstance[] = [];
  for (const h of map.hexes) {
    if (!h.port) continue;
    let port = h.port.port;
    if (port === '@') {
      const p = portBag.pop();
      if (!p) throw new Error(`Map ${map.id}: port bag exhausted`);
      port = p;
    }
    const c = hexCorners(h);
    const side = ((h.port.side % 6) + 6) % 6;
    ports.push({ port, vertices: [c[side], c[(side + 1) % 6]], hex: hexId(h), side });
  }
  return { hexes, ports };
}
