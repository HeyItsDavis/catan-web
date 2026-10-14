/**
 * Seafarers scenario maps, drawn with mapLayout (odd rows are shifted half a hex right).
 *
 * Legend used here:
 *   .  sea            *  sea with a harbor
 *   m  home-island land, drawn from the "main" bag
 *   !  land on a small foreign island (tagged 'foreign': nobody may start there), "islands" bag
 *   G  gold field on a foreign island
 *   x  any island land (no tag), drawn from the "land" bag
 *   ?  fog: face-down hex from the "fog" bag (sea or land), tagged 'foreign'
 */
import type { MapDef } from '../../../engine/schema';
import { layoutHexes, type LegendEntry } from '../../mapLayout';

const FOREIGN = ['foreign'];

const legend: Record<string, LegendEntry> = {
  '.': { terrain: 'sea' },
  '*': { terrain: 'sea', port: true },
  m: { terrain: '@main' },
  L: { terrain: '@main' },
  '!': { terrain: '@islands', tags: FOREIGN },
  G: { terrain: 'gold', tags: FOREIGN },
  x: { terrain: '@land' },
  '?': { terrain: '@fog', hidden: true, tags: FOREIGN, land: false },
};

const STANDARD_MAIN = [
  'forest', 'forest', 'forest', 'forest', 'pasture', 'pasture', 'pasture', 'pasture',
  'fields', 'fields', 'fields', 'fields', 'hills', 'hills', 'hills', 'mountains', 'mountains', 'mountains', 'desert',
];
const STANDARD_NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const STANDARD_PORTS = ['port-any', 'port-any', 'port-any', 'port-any', 'port-brick', 'port-lumber', 'port-wool', 'port-grain', 'port-ore'];

/** Heading for New Shores (3-4 players): the classic island plus four small islands to the east. */
export const headingForNewShores: MapDef = {
  id: 'seafarers-new-shores',
  name: 'Seafarers: Heading for New Shores (3-4 players)',
  minPlayers: 2,
  maxPlayers: 4,
  hexes: layoutHexes([
    '. . * . * . . . . . . .',
    ' . * m m m * . . ! ! ! .',
    '. . m m m m . . . . . .',
    ' * m m m m m * . ! . G .',
    '. . m m m m . . ! ! . .',
    ' . * m m m * . . . . . .',
    '. . . * . . . ! ! ! . .',
    ' . . . . . . . . . . . .',
  ], legend),
  terrainBags: {
    main: STANDARD_MAIN,
    islands: ['gold', 'hills', 'hills', 'mountains', 'mountains', 'pasture', 'fields', 'forest', 'forest'],
  },
  numberBag: [...STANDARD_NUMBERS, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
  portBag: STANDARD_PORTS,
  noAdjacentRedNumbers: true,
};

/** Heading for New Shores (5-6 players): the large 30-hex island plus five small islands. */
export const headingForNewShoresLarge: MapDef = {
  id: 'seafarers-new-shores-56',
  name: 'Seafarers: Heading for New Shores (5-6 players)',
  minPlayers: 5,
  maxPlayers: 6,
  hexes: layoutHexes([
    '. . * . * . . . . . . . . .',
    ' . . L L L * . . . ! ! ! . .',
    '. * L L L L . . . . . . . .',
    ' . L L L L L * . . ! . . G .',
    '. L L L L L L * . ! ! . . .',
    ' * L L L L L . . . . . . . .',
    '. . L L L L * . . ! ! . ! .',
    ' . * L L L * . . . ! . . ! .',
    '. . . * . . . . . . . . . .',
  ], legend),
  terrainBags: {
    main: [
      ...Array(6).fill('forest'), ...Array(6).fill('pasture'), ...Array(6).fill('fields'),
      ...Array(5).fill('hills'), ...Array(5).fill('mountains'), 'desert', 'desert',
    ],
    islands: ['gold', 'gold', 'forest', 'forest', 'hills', 'hills', 'mountains', 'mountains', 'pasture', 'pasture', 'fields'],
  },
  numberBag: [
    2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12,
    2, 3, 4, 4, 5, 6, 8, 9, 10, 10, 11, 12,
  ],
  portBag: [...STANDARD_PORTS, 'port-any', 'port-wool'],
  noAdjacentRedNumbers: true,
};

/** The Four Islands (3-4 players): four equal islands; players may start on any of them. */
export const fourIslands: MapDef = {
  id: 'seafarers-four-islands',
  name: 'Seafarers: The Four Islands (3-4 players)',
  minPlayers: 2,
  maxPlayers: 4,
  hexes: layoutHexes([
    '. . . . . . . . . .',
    ' * x x . . . x x * .',
    '. x x x . . x x x .',
    ' * x x . . . x x * .',
    '. . . . . . . . . .',
    ' . * x x . . x x * .',
    '. . x x x . x x x .',
    ' . * x x . . x x * .',
    '. . . . . . . . . .',
  ], legend),
  terrainBags: {
    land: [
      ...Array(6).fill('forest'), ...Array(6).fill('pasture'), ...Array(6).fill('fields'),
      ...Array(4).fill('hills'), ...Array(4).fill('mountains'), 'gold', 'gold',
    ],
  },
  numberBag: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12],
  portBag: ['port-any', 'port-any', 'port-any', 'port-brick', 'port-lumber', 'port-wool', 'port-grain', 'port-ore'],
  noAdjacentRedNumbers: true,
};

/** The Fog Islands (3-4 players): a home island, and a sea of face-down hexes to the east. */
export const fogIslands: MapDef = {
  id: 'seafarers-fog-islands',
  name: 'Seafarers: The Fog Islands (3-4 players)',
  minPlayers: 2,
  maxPlayers: 4,
  hexes: layoutHexes([
    '. . * . * . . . . . . .',
    ' . * m m m * . ? ? ? ? .',
    '. . m m m m . ? ? ? ? .',
    ' * m m m m m * ? ? ? ? .',
    '. . m m m m . ? ? ? ? .',
    ' . * m m m * . ? ? ? ? .',
    '. . . * . . . ? ? ? ? .',
    ' . . . . . . . . . . . .',
  ], legend),
  terrainBags: {
    main: STANDARD_MAIN,
    fog: [
      ...Array(10).fill('sea'), 'gold', 'gold', 'forest', 'forest', 'forest', 'pasture', 'pasture', 'pasture',
      'fields', 'fields', 'hills', 'hills', 'mountains', 'mountains',
    ],
  },
  numberBag: [...STANDARD_NUMBERS, 3, 4, 5, 6, 8, 9, 10, 11, 3, 4, 5, 9, 10, 11],
  portBag: STANDARD_PORTS,
  noAdjacentRedNumbers: true,
};
