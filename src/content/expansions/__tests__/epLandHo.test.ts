import { describe, expect, it } from 'vitest';
import { computeVP, redactFor, topology } from '../../../engine';
import { act, edit, give, newGame, tryAct } from '../../../engine/__tests__/helpers';
import { mod } from '../ep-land-ho';
import { defOf, expectValid, playGames } from './scenarioBot';

const def = defOf(mod);
type S = ReturnType<typeof newGame>;
const respond = (s: S, a: string) => act(def, s, s.prompts[0].player, { type: 'respond', promptId: s.prompts[0].id, answer: a });
const dist = (h: string) => { const { q, r } = topology.parseHexId(h); return Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)); };

function afterSetup(seed = 1): S {
  let s = newGame(seed, 3, def, { victoryPoints: 8 });
  while (s.phase === 'setup') s = respond(s, s.prompts[0].options[0]);
  return s;
}

/** Roll a fixed 2 (nobody needs to discard, few hexes produce). */
function roll(s: S): S {
  s = edit(s, (c) => { c.settings.diceMode = 'balanced'; c.diceDeck = [0]; });
  return act(def, s, s.turnOrder[s.currentPlayerIndex], { type: 'rollDice' });
}

describe('E&P Land Ho!', () => {
  it('validates', () => { expectValid(mod); });

  it('a home island in open sea, surrounded by fog; setup = settlement, harbor settlement and a ship', () => {
    const s = afterSetup();
    const hexes = Object.values(s.hexes);
    expect(hexes).toHaveLength(61);
    expect(hexes.filter((h) => !h.revealed).length).toBe(42);
    expect(hexes.filter((h) => !h.revealed).every((h) => dist(h.id) >= 3)).toBe(true);
    for (const p of ['p1', 'p2', 'p3']) {
      expect(s.pieces.filter((x) => x.owner === p).map((x) => x.type).sort()).toEqual(['harborSettlement', 'settlement', 'ship']);
      expect(computeVP(def, s, p, false)).toBe(3);
    }
    // fog is hidden from players
    const red = redactFor(def, s, 'p1');
    expect(Object.values(red.hexes).filter((h) => h.terrain === 'hidden')).toHaveLength(42);
  });

  it('ships sail with 4 movement points and reveal the fog where they stop', () => {
    let s = roll(afterSetup());
    const ship = s.pieces.find((p) => p.type === 'ship' && p.owner === 'p1')!;
    s = act(def, s, 'p1', { type: 'doAction', action: 'sail', pieceId: ship.id });
    // pick a destination that touches the fog ring
    const touchesFog = (e: string) => topology.edgeVertices(e).some((v) => topology.vertexHexes(v).some((h) => s.hexes[topology.hexId(h)] && !s.hexes[topology.hexId(h)].revealed));
    const dest = s.prompts[0].options.find(touchesFog)!;
    expect(dest).toBeTruthy();
    const hidden = Object.values(s.hexes).filter((h) => !h.revealed).length;
    s = respond(s, dest);
    expect(Object.values(s.hexes).filter((h) => !h.revealed).length).toBeLessThan(hidden);
    expect(Object.values(s.hexes).some((h) => h.terrain.startsWith('fog') && h.revealed)).toBe(false); // revealed hexes show their real terrain
    const moved = s.pieces.find((p) => p.id === ship.id)!.state.moved;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThanOrEqual(4);
  });

  it('a settler boards at the harbor, sails and founds a settlement', () => {
    let s = roll(afterSetup());
    const ship = s.pieces.find((p) => p.type === 'ship' && p.owner === 'p1')!;
    s = give(s, 'p1', { brick: 1, lumber: 1, wool: 1, grain: 1 });
    s = act(def, s, 'p1', { type: 'doAction', action: 'takeSettler', pieceId: ship.id });
    expect(s.pieces.find((p) => p.id === ship.id)!.cargo).toEqual({ settler: 1 });
    // at the dock there is no room (distance rule): sail to a shore where the settler can land
    s = act(def, s, 'p1', { type: 'doAction', action: 'sail', pieceId: ship.id });
    let landed: S | null = null;
    for (const dest of s.prompts[0].options) {
      const sailed = respond(s, dest);
      const r = tryAct(def, sailed, 'p1', { type: 'doAction', action: 'foundSettlement', pieceId: ship.id });
      if (r.ok && r.state.prompts.length) { landed = r.state; break; }
    }
    expect(landed).toBeTruthy();
    s = respond(landed!, landed!.prompts[0].options[0]);
    expect(computeVP(def, s, 'p1', false)).toBe(4);
    expect(s.pieces.find((p) => p.id === ship.id)!.cargo).toBeUndefined();
  });

  it('bots finish games', () => {
    const games = playGames(def, [1, 2, 3], { weights: { foundSettlement: 20, takeSettler: 10, sail: 6 } });
    for (const g of games) expect(g.winner, `turn ${g.turn}`).toBeTruthy();
    expect(games.every((g) => Object.values(g.hexes).some((h) => h.revealed && dist(h.id) >= 3))).toBe(true);
  }, 120_000);
});
