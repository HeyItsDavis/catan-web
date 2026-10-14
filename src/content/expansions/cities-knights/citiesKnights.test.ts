/**
 * Rules tests for the Cities & Knights mod, played through applyCommand on hand-built positions.
 */
import { describe, expect, it } from 'vitest';
import {
  buildDefinition, getAvailableMoves, topology, validateMod, type GameDefinition, type GameState, type ModDef,
} from '../../../engine';
import { baseMod } from '../../base';
import { act, edit, finishSetup, give, newGame, place, tryAct } from '../../../engine/__tests__/helpers';
import { validateAll } from '../../../editor/validate';
import { contextFromDefinition, describeEffects } from '../../../editor/describe';
import { mod } from './index';

/** Test-only helpers on top of the mod: a roll with chosen numbers. */
const testMod: ModDef = {
  meta: { id: 'ck-test', name: 'test', version: '0', extends: ['cities-knights'] },
  actions: [
    { id: 't-roll', name: 'roll', available: true, effect: [{ op: 'rollDice', values: [{ stat: { key: 'y' } }, { stat: { key: 'r' } }] }] },
    { id: 't-noop', name: 'noop', available: true, effect: [] },
  ],
};
const def: GameDefinition = buildDefinition([baseMod, mod, testMod]);

const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const respond = (s: GameState, a: string | null) => act(def, s, s.prompts[0].player, { type: 'respond', promptId: s.prompts[0].id, answer: a });
const doAction = (s: GameState, action: string, pieceId?: string, pid = 'p1') =>
  act(def, s, pid, { type: 'doAction', action, ...(pieceId ? { pieceId } : {}) });
const enabled = (s: GameState, action: string, pieceId?: string, pid = 'p1') =>
  getAvailableMoves(def, s, pid).actions.find((a) => a.action.id === action && a.pieceId === pieceId)?.enabled ?? false;
const pieceAt = (s: GameState, type: string, at: string) => s.pieces.find((p) => p.type === type && p.at === at);
const setStats = (s: GameState, pid: string, st: Record<string, number>) => edit(s, (c) => { Object.assign(P(c, pid).stats, st); });
const giveCard = (s: GameState, pid: string, card: string, deck: string, id = `c-${card}`) =>
  edit(s, (c) => { P(c, pid).hand.push({ id, card, deck, acquiredTurn: 0 }); });
const play = (s: GameState, cardInstance: string, pid = 'p1') => act(def, s, pid, { type: 'playCard', cardInstance });

/**
 * Roll the chosen numbers with the chosen event-die face (searching rng states for that face).
 */
function roll(s: GameState, yellow: number, red: number, face: string): GameState {
  const base = setStats(s, 'p1', { y: yellow, r: red });
  for (let k = 1; k < 500; k++) {
    const trial = edit(base, (c) => { c.rngState = (k * 2654435761) >>> 0; });
    const out = doAction(trial, 't-roll');
    if (out.lastRoll?.event?.[0] === face) return out;
  }
  throw new Error(`no rng state rolls ${face}`);
}

const C = topology.hexCorners({ q: 0, r: 0 });
const E = topology.hexEdges({ q: 0, r: 0 });
const B = topology.hexCorners({ q: 1, r: 1 });

/** Empty board, main phase, p1 to play; every hex numberless, robber on the desert. */
function start(n = 2): GameState {
  return edit(newGame(3, n, def, { victoryPoints: 13 }), (c) => {
    c.phase = 'main'; c.hasRolled = true; c.pieces = []; c.turn = 5; c.stack = []; c.prompts = []; delete c.setupProgress;
    for (const h of Object.values(c.hexes)) h.number = null;
    c.tokens.robber = Object.values(c.hexes).find((h) => h.terrain === 'desert')!.id;
  });
}
const terrain = (s: GameState, hex: string, t: string, num: number | null = null) =>
  edit(s, (c) => { c.hexes[hex].terrain = t; c.hexes[hex].number = num; if (c.tokens.robber === hex) c.tokens.robber = null; });

describe('Cities & Knights mod', () => {
  it('validates with zero errors (engine and editor checks); every block can be described', () => {
    expect(validateMod(mod, [baseMod]).filter((p) => p.severity === 'error')).toEqual([]);
    expect(validateAll(mod, [baseMod]).issues.filter((p) => p.severity === 'error')).toEqual([]);
    const ctx = contextFromDefinition(def);
    for (const c of mod.cards!) expect(describeEffects(c.effect, ctx).length).toBe(c.effect.length);
    for (const a of mod.actions!) expect(describeEffects(a.effect, ctx).length).toBe(a.effect.length);
  });

  it('removes the development deck and largest army; 13 VP; commodities trade 4:1', () => {
    expect(def.decks.map((d) => d.id).sort()).toEqual(['politics', 'science', 'trade']);
    for (const d of def.decks) expect(d.cards.reduce((a, c) => a + c.count, 0)).toBe(18);
    expect(def.awards.some((a) => a.id === 'largestArmy')).toBe(false);
    expect(def.victoryPoints).toBe(13);
    const m = getAvailableMoves(def, start(), 'p1');
    expect(m.buyableDecks).toEqual([]);
    expect(m.bankRates.paper).toBe(4);
    for (const c of def.cards) expect(c.description.length).toBeGreaterThan(10);
    for (const a of mod.actions!) expect(a.description!.length).toBeGreaterThan(10);
  });

  it('setup: a settlement then a city; the city grants starting resources', () => {
    const s = finishSetup(def, newGame(7, 3, def));
    for (const p of s.players) {
      expect(s.pieces.filter((x) => x.owner === p.id && x.type === 'settlement')).toHaveLength(1);
      expect(s.pieces.filter((x) => x.owner === p.id && x.type === 'city')).toHaveLength(1);
    }
  });

  it('cities: 1 resource + 1 commodity on forest/pasture/mountains, 2 resources on hills/fields', () => {
    let s = terrain(start(), 'h:0,0', 'forest', 6);
    s = place(def, s, 'city', 'p1', C[0]);
    s = roll(s, 3, 3, 'trade');
    expect(P(s, 'p1').resources).toMatchObject({ lumber: 1, paper: 1 });
    s = terrain(s, 'h:0,0', 'hills', 6);
    s = roll(s, 3, 3, 'trade');
    expect(P(s, 'p1').resources).toMatchObject({ brick: 2 });
  });

  it('aqueduct (science 3): nothing produced on a roll -> pick a resource', () => {
    let s = setStats(start(), 'p2', { scienceLevel: 3 });
    s = roll(s, 3, 3, 'trade');
    expect(s.prompts[0]).toMatchObject({ player: 'p2', kind: 'resource' });
    expect(s.prompts[0].options).not.toContain('paper');
    s = respond(s, 'ore');
    expect(P(s, 'p2').resources.ore).toBe(1);
  });

  it('robber only moves after the first barbarian attack; walls add 2 to the hand limit', () => {
    let s = place(def, start(), 'city', 'p1', C[0]);
    s = place(def, s, 'wall', 'p1', C[0]);
    s = give(s, 'p1', { brick: 9 });
    s = give(s, 'p2', { ore: 8 });
    s = roll(s, 3, 4, 'trade');
    expect(s.prompts).toHaveLength(1);
    expect(s.prompts[0]).toMatchObject({ player: 'p2', kind: 'discard', amount: 4 });
    s = act(def, s, 'p2', { type: 'respond', promptId: s.prompts[0].id, answer: { ore: 4 } });
    expect(s.prompts).toEqual([]); // robber stays
    s = edit(s, (c) => { c.globals.barbarianAttacks = 1; });
    s = roll(s, 3, 4, 'trade');
    expect(s.prompts[0]).toMatchObject({ player: 'p1', kind: 'location' });
  });

  describe('barbarians', () => {
    function board(): GameState {
      let s = place(def, start(3), 'city', 'p1', C[0]);
      s = place(def, s, 'wall', 'p1', C[0]);
      s = place(def, s, 'city', 'p2', B[0]);
      s = place(def, s, 'knight1', 'p2', B[2]);
      return edit(s, (c) => { c.globals.barbarians = 6; });
    }
    const knight = (s: GameState, owner: string) => s.pieces.find((p) => p.owner === owner && p.type.startsWith('knight'))!;

    it('advance on the ship face; a lost attack pillages the weakest city owner (wall falls too) and knights go home', () => {
      let s = edit(board(), (c) => { knight(c, 'p2').state.active = 1; });
      s = roll(s, 1, 1, 'barbarianShip');
      expect(s.prompts[0]).toMatchObject({ player: 'p1', kind: 'piece', options: [C[0]] });
      s = respond(s, C[0]);
      expect(pieceAt(s, 'settlement', C[0])?.owner).toBe('p1');
      expect(pieceAt(s, 'wall', C[0])).toBeUndefined();
      expect(pieceAt(s, 'city', B[0])?.owner).toBe('p2');
      expect(knight(s, 'p2').state.active).toBe(0);
      expect(s.globals).toMatchObject({ barbarians: 0, barbarianAttacks: 1 });
    });

    it('a won attack: the strongest defender gets Defender of Catan (1 VP)', () => {
      let s = edit(board(), (c) => { Object.assign(knight(c, 'p2').state, { active: 1, strength: 2 }); });
      s = roll(s, 1, 1, 'barbarianShip');
      expect(s.prompts).toEqual([]);
      expect(P(s, 'p2').played.map((c) => c.card)).toEqual(['defenderOfCatan']);
    });

    it('a won attack with tied defenders: each draws a progress card of their choice', () => {
      let s = place(def, board(), 'knight1', 'p1', C[2]);
      s = edit(s, (c) => { for (const p of c.pieces) if (p.type === 'knight1') p.state.active = 1; });
      s = roll(s, 1, 1, 'barbarianShip');
      expect(s.prompts[0]).toMatchObject({ player: 'p1', kind: 'option', optionLabels: ['Trade', 'Politics', 'Science'] });
      s = respond(s, '1');
      s = respond(s, '2');
      expect(P(s, 'p1').hand.map((c) => c.deck)).toEqual(['politics']);
      expect(P(s, 'p2').hand.map((c) => c.deck)).toEqual(['science']);
    });

    it('metropolises are never pillaged and their owner is not the weakest', () => {
      let s = edit(board(), (c) => { c.pieces.find((p) => p.type === 'city' && p.owner === 'p2')!.type = 'metropolis-trade'; });
      s = roll(s, 1, 1, 'barbarianShip');
      expect(s.prompts[0]).toMatchObject({ player: 'p1', options: [C[0]] });
    });
  });

  it('progress cards: drawn on a city gate if the red die <= level + 1', () => {
    let s = place(def, start(), 'city', 'p1', C[0]);
    s = setStats(s, 'p1', { politicsLevel: 2 });
    s = roll(s, 1, 4, 'politics');
    expect(P(s, 'p1').hand).toHaveLength(0);
    s = roll(s, 1, 3, 'trade');
    expect(P(s, 'p1').hand).toHaveLength(0);
    s = roll(s, 1, 3, 'politics');
    expect(P(s, 'p1').hand.map((c) => c.deck)).toEqual(['politics']);
    expect(P(s, 'p2').hand).toHaveLength(0);
  });

  it('progress hand limit: at most 4 cards in total', () => {
    let s = setStats(start(), 'p1', { scienceLevel: 5 });
    s = edit(s, (c) => { c.decks.science.draw = ['crane', ...c.decks.science.draw.filter((x) => x !== 'crane')]; });
    for (const [card, deck] of [['spy', 'politics'], ['merchant', 'trade'], ['bishop', 'politics'], ['warlord', 'politics']]) s = giveCard(s, 'p1', card, deck);
    s = roll(s, 1, 6, 'science');
    expect(s.prompts[0]).toMatchObject({ player: 'p1', kind: 'card' });
    expect(s.prompts[0].options).toHaveLength(5);
    s = respond(s, 'c-spy');
    expect(P(s, 'p1').hand.map((c) => c.card).sort()).toEqual(['bishop', 'crane', 'merchant', 'warlord']);
  });

  describe('city improvements', () => {
    it('cost = level in the matching commodity, need a city; Trading House gives 2:1 commodities', () => {
      let s = give(start(), 'p1', { cloth: 10 });
      expect(enabled(s, 'improve-trade')).toBe(false); // no city
      s = place(def, s, 'city', 'p1', C[0]);
      s = doAction(s, 'improve-trade');
      s = doAction(s, 'improve-trade');
      expect(P(s, 'p1').resources.cloth).toBe(7);
      expect(getAvailableMoves(def, s, 'p1').bankRates.coin).toBe(4);
      s = doAction(s, 'improve-trade');
      expect(P(s, 'p1').resources.cloth).toBe(4);
      expect(P(s, 'p1').stats.tradeLevel).toBe(3);
      const rates = getAvailableMoves(def, s, 'p1').bankRates;
      expect([rates.paper, rates.cloth, rates.coin, rates.ore]).toEqual([2, 2, 2, 4]);
    });

    it('Crane: one commodity less for the next improvement this turn', () => {
      let s = place(def, give(start(), 'p1', { coin: 2 }), 'city', 'p1', C[0]);
      s = setStats(s, 'p1', { politicsLevel: 2 });
      s = giveCard(s, 'p1', 'crane', 'science');
      s = play(s, 'c-crane');
      s = doAction(s, 'improve-politics');
      expect(P(s, 'p1').resources.coin).toBe(0);
      expect(P(s, 'p1').stats.politicsLevel).toBe(3);
      expect(P(s, 'p1').flags.crane?.value).toBe(false);
    });

    it('metropolis: first to level 4 upgrades a city (+2 VP); a later level 5 takes it', () => {
      let s = place(def, start(), 'city', 'p1', C[0]);
      s = place(def, s, 'city', 'p2', B[0]);
      s = give(setStats(s, 'p1', { scienceLevel: 3 }), 'p1', { paper: 4 });
      s = doAction(s, 'improve-science');
      expect(s.awards['metropolis-science']).toBe('p1');
      expect(s.prompts[0]).toMatchObject({ player: 'p1', options: [C[0]] });
      s = respond(s, C[0]);
      expect(pieceAt(s, 'metropolis-science', C[0])?.owner).toBe('p1');
      s = setStats(s, 'p2', { scienceLevel: 4 });
      s = doAction(s, 't-noop');
      expect(s.awards['metropolis-science']).toBe('p1');
      s = setStats(s, 'p2', { scienceLevel: 5 });
      s = doAction(s, 't-noop');
      s = respond(s, C[0]); // p1 loses it
      s = respond(s, B[0]); // p2 places it
      expect(pieceAt(s, 'city', C[0])?.owner).toBe('p1');
      expect(pieceAt(s, 'metropolis-science', B[0])?.owner).toBe('p2');
      // p1, without a plain city... has one again, so may still go to level 5 (and cannot exceed p2's 5)
      expect(enabled(s, 'improve-science')).toBe(false); // no paper
    });
  });

  describe('knights', () => {
    function board(): GameState {
      let s = place(def, start(), 'city', 'p1', C[0]);
      for (const e of [E[0], E[1], E[2]]) s = place(def, s, 'road', 'p1', e); // C0-C1-C2-C3
      return s;
    }

    it('build (wool + ore, on your road network), activate (grain), not able to act on the turn activated', () => {
      let s = give(board(), 'p1', { wool: 1, ore: 1, grain: 1 });
      s = act(def, s, 'p1', { type: 'build', piece: 'knight1' });
      expect(s.prompts[0].options.sort()).toEqual([C[1], C[2], C[3]].sort());
      s = respond(s, C[2]);
      const k = pieceAt(s, 'knight1', C[2])!;
      expect(k.state).toMatchObject({ active: 0, strength: 1 });
      expect(enabled(s, 'moveKnight', k.id)).toBe(false);
      s = doAction(s, 'activateKnight', k.id);
      expect(enabled(s, 'moveKnight', k.id)).toBe(false); // fresh
      s = edit(s, (c) => { c.pieces.find((p) => p.id === k.id)!.state.fresh = 0; });
      expect(enabled(s, 'moveKnight', k.id)).toBe(true);
      s = doAction(s, 'moveKnight', k.id);
      expect(s.prompts[0].options.sort()).toEqual([C[1], C[3]].sort());
      s = respond(s, C[3]);
      expect(s.pieces.find((p) => p.id === k.id)).toMatchObject({ at: C[3], state: { active: 0 } });
    });

    it('roads cannot start from a knight alone', () => {
      let s = place(def, start(), 'knight1', 'p1', C[2]);
      s = give(s, 'p1', { brick: 1, lumber: 1 });
      expect(getAvailableMoves(def, s, 'p1').builds.find((b) => b.piece.id === 'road')?.hasSpot).toBe(false);
    });

    it('promotion keeps the active status; mighty knights need the Fortress', () => {
      let s = place(def, board(), 'knight1', 'p1', C[2]);
      const k = pieceAt(s, 'knight1', C[2])!;
      s = edit(s, (c) => { c.pieces.find((p) => p.id === k.id)!.state.active = 1; });
      s = give(s, 'p1', { wool: 2, ore: 2 });
      s = doAction(s, 'promoteBasic', k.id);
      const k2 = pieceAt(s, 'knight2', C[2])!;
      expect(k2.state).toMatchObject({ active: 1, strength: 2, promoted: 1 });
      expect(enabled(s, 'promoteStrong', k2.id)).toBe(false);
      s = setStats(edit(s, (c) => { c.pieces.find((p) => p.id === k2.id)!.state.promoted = 0; }), 'p1', { politicsLevel: 3 });
      expect(enabled(s, 'promoteStrong', k2.id)).toBe(true);
      s = doAction(s, 'promoteStrong', k2.id);
      expect(pieceAt(s, 'knight3', C[2])!.state).toMatchObject({ active: 1, strength: 3 });
    });

    it('displace a weaker knight along your roads; its owner relocates it', () => {
      let s = place(def, board(), 'knight2', 'p1', C[1]);
      s = place(def, s, 'knight1', 'p2', C[3]);
      s = place(def, s, 'road', 'p2', E[3]); // C3-C4
      s = place(def, s, 'road', 'p2', E[4]); // C4-C5
      const mine = pieceAt(s, 'knight2', C[1])!;
      s = edit(s, (c) => { c.pieces.find((p) => p.id === mine.id)!.state.active = 1; });
      s = doAction(s, 'displaceKnight', mine.id);
      expect(s.prompts[0]).toMatchObject({ player: 'p1', options: [C[3]] });
      s = respond(s, C[3]);
      expect(s.prompts[0].player).toBe('p2');
      expect(s.prompts[0].options).toContain(C[5]);
      s = respond(s, C[5]);
      expect(s.pieces.find((p) => p.id === mine.id)).toMatchObject({ at: C[3], state: { active: 0 } });
      expect(pieceAt(s, 'knight1', C[5])?.owner).toBe('p2');
    });

    it('chase away the robber: only next to it and after the first barbarian attack', () => {
      let s = place(def, board(), 'knight1', 'p1', C[2]);
      const k = pieceAt(s, 'knight1', C[2])!;
      s = edit(s, (c) => { c.pieces.find((p) => p.id === k.id)!.state.active = 1; c.tokens.robber = 'h:0,0'; });
      expect(enabled(s, 'chaseRobber', k.id)).toBe(false);
      s = edit(s, (c) => { c.globals.barbarianAttacks = 1; });
      expect(enabled(s, 'chaseRobber', k.id)).toBe(true);
      s = doAction(s, 'chaseRobber', k.id);
      expect(s.prompts[0].options).not.toContain('h:0,0');
      s = respond(s, s.prompts[0].options[0]);
      expect(s.tokens.robber).not.toBe('h:0,0');
      expect(s.pieces.find((p) => p.id === k.id)!.state.active).toBe(0);
    });
  });

  describe('progress cards', () => {
    it('Alchemist: chosen dice before rolling', () => {
      let s = giveCard(edit(start(), (c) => { c.phase = 'preRoll'; c.hasRolled = false; }), 'p1', 'alchemist', 'science');
      s = play(s, 'c-alchemist');
      s = respond(s, '4'); // yellow = 5
      s = respond(s, '1'); // red = 2
      expect(s.lastRoll?.dice).toEqual([5, 2]);
      expect(s.phase).toBe('main');
    });

    it('Spy: look at a hand and take a card', () => {
      let s = giveCard(giveCard(start(), 'p1', 'spy', 'politics'), 'p2', 'merchantFleet', 'trade', 'mf');
      s = giveCard(s, 'p2', 'smith', 'science', 'sm');
      s = play(s, 'c-spy');
      s = respond(s, 'p2');
      expect(s.prompts[0]).toMatchObject({ player: 'p1', kind: 'card' });
      s = respond(s, 'mf');
      expect(P(s, 'p1').hand.map((c) => c.card)).toEqual(['merchantFleet']);
    });

    it('Inventor: swap two numbers (never 2, 12, 6 or 8)', () => {
      let s = edit(start(), (c) => { c.hexes['h:0,0'].number = 4; c.hexes['h:1,0'].number = 10; c.hexes['h:0,1'].number = 6; });
      s = giveCard(s, 'p1', 'inventor', 'science');
      s = play(s, 'c-inventor');
      expect(s.prompts[0].options.sort()).toEqual(['h:0,0', 'h:1,0']);
      s = respond(s, 'h:0,0');
      expect(s.prompts[0].options).toEqual(['h:1,0']);
      s = respond(s, 'h:1,0');
      expect([s.hexes['h:0,0'].number, s.hexes['h:1,0'].number]).toEqual([10, 4]);
    });

    it('Merchant: placed next to your building; 2:1 for that resource and 1 VP while you hold it', () => {
      let s = terrain(start(), 'h:0,0', 'pasture');
      s = place(def, s, 'settlement', 'p1', C[0]);
      s = giveCard(s, 'p1', 'merchant', 'trade');
      s = play(s, 'c-merchant');
      s = respond(s, 'h:0,0');
      expect(s.awards.merchant).toBe('p1');
      expect(getAvailableMoves(def, s, 'p1').bankRates.wool).toBe(2);
    });

    it('Wedding: richer players give 2 cards of their choice', () => {
      let s = place(def, start(), 'city', 'p2', B[0]);
      s = give(s, 'p2', { ore: 1, coin: 2 });
      s = giveCard(s, 'p1', 'wedding', 'politics');
      s = play(s, 'c-wedding');
      expect(s.prompts[0]).toMatchObject({ player: 'p2', kind: 'resource' });
      s = respond(s, 'coin');
      s = respond(s, 'ore');
      expect(P(s, 'p1').resources).toMatchObject({ coin: 1, ore: 1 });
    });

    it('Deserter: the victim removes a knight; you place one of the same strength', () => {
      let s = place(def, start(), 'city', 'p1', C[0]);
      s = place(def, s, 'road', 'p1', E[0]);
      s = place(def, s, 'knight2', 'p2', B[0]);
      s = giveCard(s, 'p1', 'deserter', 'politics');
      s = play(s, 'c-deserter');
      s = respond(s, 'p2');
      expect(s.prompts[0]).toMatchObject({ player: 'p2', options: [B[0]] });
      s = respond(s, B[0]);
      expect(s.prompts[0]).toMatchObject({ player: 'p1', piece: 'knight2', options: [C[1]] });
      s = respond(s, C[1]);
      expect(pieceAt(s, 'knight2', C[1])?.owner).toBe('p1');
      expect(s.pieces.some((p) => p.owner === 'p2' && p.type.startsWith('knight'))).toBe(false);
    });

    it('Medicine: a city for 2 ore + 1 grain; Irrigation: 2 grain per fields hex', () => {
      let s = terrain(start(), 'h:0,0', 'fields');
      s = place(def, s, 'settlement', 'p1', C[0]);
      s = give(s, 'p1', { ore: 2, grain: 1 });
      s = giveCard(giveCard(s, 'p1', 'medicine', 'science'), 'p1', 'irrigation', 'science');
      s = play(s, 'c-medicine');
      s = respond(s, C[0]);
      expect(pieceAt(s, 'city', C[0])).toBeTruthy();
      expect(P(s, 'p1').resources).toMatchObject({ ore: 0, grain: 0 });
      const fieldsAround = topology.vertexHexes(C[0]).map(topology.hexId).filter((h) => s.hexes[h]?.terrain === 'fields').length;
      s = play(s, 'c-irrigation');
      expect(P(s, 'p1').resources.grain).toBe(2 * fieldsAround);
    });

    it('Bishop is not playable before the first barbarian attack; then robs everyone next to the hex', () => {
      let s = terrain(start(3), 'h:0,0', 'hills');
      s = place(def, place(def, s, 'settlement', 'p2', C[0]), 'settlement', 'p3', C[3]);
      s = give(give(s, 'p2', { ore: 1 }), 'p3', { wool: 1 });
      s = giveCard(s, 'p1', 'bishop', 'politics');
      expect(tryAct(def, s, 'p1', { type: 'playCard', cardInstance: 'c-bishop' }).ok).toBe(false);
      s = edit(s, (c) => { c.globals.barbarianAttacks = 1; });
      s = play(s, 'c-bishop');
      s = respond(s, 'h:0,0');
      expect(s.prompts).toEqual([]);
      expect(P(s, 'p1').resources).toMatchObject({ ore: 1, wool: 1 });
    });
  });
});
