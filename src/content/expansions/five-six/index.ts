/**
 * 5–6 Player Extension, as a mod on top of the base game:
 *  - a 30-hex island with the standard 5–6 terrain, number and port mix (5–6 players; also
 *    playable with 3–4 for a roomier game);
 *  - the Special Building Phase: after each turn, every other player in turn order may build
 *    and buy development cards (no trading, no card play);
 *  - 9 more development cards (34 in all) and 24 of each resource in the bank.
 */
import type { MapDef, ModDef, ResourceDef } from '../../../engine/schema';
import { baseMod } from '../../base';
import { layoutHexes } from '../../mapLayout';

/* The board: rows of 3-4-5-6-5-4-3 land hexes ("L") in a ring of sea; "*" = harbor. */
const ROWS = [
  '. . * . * . . .',
  ' . . L L L * . .',
  '. * L L L L . .',
  ' . L L L L L * .',
  '. L L L L L L *',
  ' * L L L L L . .',
  '. . L L L L * .',
  ' . * L L L * . .',
  '. . . * . . . .',
];

export const fiveSixMap: MapDef = {
  id: 'five-six-standard',
  name: 'Large island (5-6 players)',
  minPlayers: 3,
  maxPlayers: 6,
  hexes: layoutHexes(ROWS, {
    '.': { terrain: 'sea' },
    '*': { terrain: 'sea', port: true },
    L: { terrain: '@land' },
  }),
  terrainBags: {
    land: [
      ...Array(6).fill('forest'), ...Array(6).fill('pasture'), ...Array(6).fill('fields'),
      ...Array(5).fill('hills'), ...Array(5).fill('mountains'), 'desert', 'desert',
    ],
  },
  numberBag: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12],
  portBag: [
    'port-any', 'port-any', 'port-any', 'port-any', 'port-any',
    'port-brick', 'port-lumber', 'port-wool', 'port-wool', 'port-grain', 'port-ore',
  ],
  noAdjacentRedNumbers: true,
};

const biggerBank: ResourceDef[] = baseMod.resources!.map((r) => ({ ...r, bankSupply: 24 }));

export const mod: ModDef = {
  meta: {
    id: 'five-six',
    name: '5–6 Player Extension',
    version: '1.0.0',
    author: 'catan-web',
    extends: ['base'],
    description:
      'Room for 5 or 6 players: a 30-hex island, a Special Building Phase between turns, 34 development cards and 24 of each resource in the bank.',
  },
  resources: biggerBank,
  maps: [fiveSixMap],
  decks: [{
    id: 'dev', name: 'Development', color: '#6a4c93',
    cards: [
      { card: 'knight', count: 20 },
      { card: 'roadBuilding', count: 3 },
      { card: 'yearOfPlenty', count: 3 },
      { card: 'monopoly', count: 3 },
      { card: 'victoryPoint', count: 5 },
    ],
    cost: { wool: 1, grain: 1, ore: 1 },
  }],
  settings: [
    { id: 'specialBuildPhase', name: 'Special Building Phase (others may build between turns)', type: 'boolean', default: true },
  ],
  triggers: [
    {
      // After a player ends their turn, everyone else gets a short building-only turn, in turn order.
      id: 'special-build-phase', on: 'turnEnd',
      when: { setting: 'specialBuildPhase' },
      do: [{ op: 'extraBuildPhase' }],
    },
  ],
};

export default mod;
