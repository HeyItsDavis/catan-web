/**
 * A small custom mod built only from the schema vocabulary: a new resource (fish), a
 * fishery terrain, a coastal "lighthouse" building, a recipe action that needs one,
 * and a "Double Road" card in a new deck. Proves new content works end-to-end
 * without engine changes.
 */
import { describe, expect, it } from 'vitest';
import { getAvailableMoves, topology, validateMod, type MapDef, type ModDef } from '../index';
import { baseMod } from '../../content/base';
import { act, answer, cur, edit, finishSetup, give, newGame, place, simulate, withMods } from './helpers';

const isle: MapDef = {
  id: 'fish-isle', name: 'Fish Isle', minPlayers: 2, maxPlayers: 3,
  hexes: [
    { q: 0, r: 0, terrain: 'fishery', number: 6 },
    { q: 1, r: -1, terrain: 'hills', number: 5 }, { q: 1, r: 0, terrain: 'forest', number: 8 },
    { q: 0, r: 1, terrain: 'fields', number: 4 }, { q: -1, r: 1, terrain: 'pasture', number: 9 },
    { q: -1, r: 0, terrain: 'mountains', number: 10 }, { q: 0, r: -1, terrain: '@extra' },
    ...[[2, -2], [2, -1], [2, 0], [1, 1], [0, 2], [-1, 2], [-2, 2], [-2, 1], [-2, 0], [-1, -1], [0, -2], [1, -2]]
      .map(([q, r], i) => ({ q, r, terrain: 'sea', ...(i === 0 ? { port: { port: 'port-fish', side: 3 } } : {}) })),
  ],
  terrainBags: { extra: ['desert'] },
};

export const fishMod: ModDef = {
  meta: { id: 'fish', name: 'Fishermen', version: '0.1', extends: ['base'] },
  resources: [{ id: 'fish', name: 'Fish', color: '#4fc3f7', kind: 'resource', bankSupply: 12 }],
  terrains: [{ id: 'fishery', name: 'Fishery', color: '#81d4fa', produces: { fish: 1 }, numbered: true }],
  ports: [{ id: 'port-fish', resource: 'fish', ratio: 2 }],
  pieces: [{
    id: 'lighthouse', name: 'Lighthouse', supply: 2,
    placement: {
      on: 'vertex',
      where: { all: [{ not: { occupied: { at: 'at' } } }, { isCoastal: { at: 'at' } }, { distanceRule: { at: 'at' } }, { connectedTo: { at: 'at', owner: 'self' } }] },
    },
    cost: { fish: 2, brick: 1 },
    vp: 1,
    tags: ['lighthouse'],
  }],
  actions: [{
    id: 'smokehouse', name: 'Smoke fish', description: '2 fish + 1 lumber -> 2 grain (needs a lighthouse)', group: 'special',
    cost: { fish: 2, lumber: 1 },
    available: { all: [{ phase: 'main' }, { isTurnOf: 'self' }, { cmp: [{ pieceCount: { owner: 'self', piece: 'lighthouse' } }, '>', 0] }] },
    effect: [{ op: 'gain', resources: { grain: 2 } }],
    limitPerTurn: 1,
  }],
  cards: [{
    id: 'doubleRoad', name: 'Double Road', description: 'Place 2 roads for free.',
    play: { timing: 'ownTurnAfterRoll' },
    effect: [{ op: 'repeat', times: 2, do: [{ op: 'place', piece: 'road', free: true }] }],
    afterPlay: 'discard',
  }],
  decks: [{ id: 'harbour', name: 'Harbour', cards: [{ card: 'doubleRoad', count: 3 }], cost: { fish: 1 }, reshuffleDiscards: true }],
  maps: [isle],
};

describe('custom mod: fish, lighthouse, recipe, double road', () => {
  const def = withMods(fishMod);

  it('validates cleanly', () => {
    expect(validateMod(fishMod, [baseMod]).filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('works end to end', () => {
    let s = newGame(4, 2, def, { mapId: 'fish-isle' });
    expect(Object.values(s.hexes).filter((h) => h.terrain === 'fishery')).toHaveLength(1);
    expect(s.players[0].resources.fish).toBe(0);
    expect(s.ports).toEqual([expect.objectContaining({ port: 'port-fish' })]);
    s = finishSetup(def, s);
    s = edit(s, (c) => { c.phase = 'main'; c.hasRolled = true; });
    const me = cur(s);
    s = give(s, me, { fish: 5, brick: 1, lumber: 1 });
    // a known layout: own settlement on the hills' north corner, roads along its NE and E faces;
    // the hills' SE corner is coastal, 2 edges away and connected.
    const hills = { q: 1, r: -1 };
    const c = topology.hexCorners(hills);
    const e = topology.hexEdges(hills);
    s = edit(s, (x) => { x.pieces = []; });
    s = place(def, s, 'settlement', me, c[0]);
    s = place(def, s, 'road', me, e[0]);
    s = place(def, s, 'road', me, e[1]);

    // recipe disabled without a lighthouse
    expect(getAvailableMoves(def, s, me).actions.find((a) => a.action.id === 'smokehouse')?.enabled).toBe(false);

    // build a lighthouse on a coastal spot connected to our roads (give a road first if needed)
    const mv = getAvailableMoves(def, s, me).builds.find((b) => b.piece.id === 'lighthouse')!;
    expect(mv.affordable).toBe(true);
    expect(mv.hasSpot).toBe(true);
    s = act(def, s, me, { type: 'build', piece: 'lighthouse' });
    expect(s.prompts[0].options).toEqual([c[2]]);
    s = answer(def, s);
    expect(s.pieces.filter((p) => p.type === 'lighthouse' && p.owner === me)).toHaveLength(1);
    const p = s.players.find((x) => x.id === me)!;
    expect(p.resources.fish).toBe(3);

    // recipe now enabled; once per turn
    s = act(def, s, me, { type: 'doAction', action: 'smokehouse' });
    const p2 = s.players.find((x) => x.id === me)!;
    expect(p2.resources.fish).toBe(1);
    expect(p2.resources.grain).toBeGreaterThanOrEqual(2);
    expect(getAvailableMoves(def, s, me).actions.find((a) => a.action.id === 'smokehouse')?.enabled).toBe(false);

    // buy from the new deck, play next turn
    s = act(def, s, me, { type: 'buyCard', deck: 'harbour' });
    const inst = s.players.find((x) => x.id === me)!.hand.find((c) => c.card === 'doubleRoad')!;
    expect(inst).toBeTruthy();
    expect(getAvailableMoves(def, s, me).playableCards).toEqual([]);
    s = edit(s, (c) => { c.turn += 2; });
    const roads = s.pieces.filter((x) => x.type === 'road' && x.owner === me).length;
    s = act(def, s, me, { type: 'playCard', cardInstance: inst.id });
    s = answer(def, s);
    s = answer(def, s);
    expect(s.pieces.filter((x) => x.type === 'road' && x.owner === me).length).toBe(roads + 2);
    expect(s.decks.harbour.discard).toEqual(['doubleRoad']);
  });

  it('bots can play the modded game without errors', () => {
    const { state } = simulate(def, newGame(8, 3, def), 99, 120);
    expect(state.turn).toBeGreaterThan(1);
  });
});
