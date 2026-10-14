import { describe, expect, it } from 'vitest';
import {
  applyCommand, computeVP, createGame, getAvailableMoves, redactFor, topology, type GameDefinition, type GameState, type ModDef,
} from '../index';
import { act, answer, baseDef, cur, edit, finishSetup, give, newGame, place, players, settings, tryAct, withMods } from './helpers';

const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;

/** Main-phase game with an empty board, empty hands, and a no-op/test action. */
function blank(extra: Partial<ModDef> = {}, n = 3, over = {}): { def: GameDefinition; s: GameState } {
  const def = withMods({
    meta: { id: 'x', name: 'x', version: '1', extends: ['base'] },
    actions: [
      { id: 'noop', name: 'noop', available: true, effect: [] },
      { id: 'produce', name: 'produce', available: true, effect: [{ op: 'produce', roll: { global: 'roll' } }] },
    ],
    ...extra,
  });
  let s = finishSetup(def, newGame(5, n, def, over));
  s = edit(s, (c) => {
    c.pieces = [];
    c.phase = 'main';
    c.hasRolled = true;
    c.currentPlayerIndex = 0;
    for (const p of c.players) for (const r of Object.keys(p.resources)) { c.bank[r] += p.resources[r]; p.resources[r] = 0; }
    c.awards = { longestRoad: null, largestArmy: null };
  });
  return { def, s };
}

const landHexWith = (s: GameState, pred: (n: number | null, t: string) => boolean) =>
  Object.values(s.hexes).find((h) => pred(h.number, h.terrain))!;

describe('setup', () => {
  it('snake order, road must touch the settlement just placed, second settlement gives resources', () => {
    let s = newGame(3, 3);
    const placers: string[] = [];
    while (s.phase === 'setup') {
      const pr = s.prompts[0];
      expect(s.prompts).toHaveLength(1);
      if (pr.piece === 'settlement') placers.push(pr.player);
      if (pr.piece === 'road') {
        const last = [...s.pieces].reverse().find((p) => p.owner === pr.player && p.type === 'settlement')!;
        for (const e of pr.options) expect(topology.edgeVertices(e)).toContain(last.at);
      }
      s = answer(baseDef, s, (o) => o[o.length - 1]);
    }
    expect(placers).toEqual(['p1', 'p2', 'p3', 'p3', 'p2', 'p1']);
    expect(s.phase).toBe('preRoll');
    expect(cur(s)).toBe('p1');
    expect(s.turn).toBe(1);
    // starting resources == productive hexes around 2nd settlement
    for (const pl of s.players) {
      const second = s.pieces.filter((p) => p.owner === pl.id && p.type === 'settlement')[1];
      const expected = topology.vertexHexes(second.at).map(topology.hexId)
        .filter((h) => s.hexes[h] && baseDef.terrains.find((t) => t.id === s.hexes[h].terrain)?.produces).length;
      expect(Object.values(pl.resources).reduce((a, b) => a + b, 0)).toBe(expected);
    }
  });

  it('randomizeTurnOrder shuffles deterministically', () => {
    const a = newGame(77, 4, baseDef, { randomizeTurnOrder: true });
    const b = newGame(77, 4, baseDef, { randomizeTurnOrder: true });
    expect(a.turnOrder).toEqual(b.turnOrder);
    expect([...a.turnOrder].sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
  });
});

describe('map generation', () => {
  it('builds the standard board', () => {
    const s = newGame(12, 4);
    const hexes = Object.values(s.hexes);
    expect(hexes.filter((h) => h.terrain === 'sea')).toHaveLength(18);
    const land = hexes.filter((h) => h.terrain !== 'sea');
    expect(land).toHaveLength(19);
    expect(land.filter((h) => h.number !== null)).toHaveLength(18);
    const desert = land.find((h) => h.terrain === 'desert')!;
    expect(desert.number).toBeNull();
    expect(s.tokens.robber).toBe(desert.id);
    // no adjacent 6/8
    for (const h of land) {
      if (h.number !== 6 && h.number !== 8) continue;
      for (const n of topology.hexNeighbors(h.coord)) expect([6, 8]).not.toContain(s.hexes[topology.hexId(n)]?.number);
    }
    expect(s.ports).toHaveLength(9);
    const pv = s.ports.flatMap((p) => p.vertices);
    expect(new Set(pv).size).toBe(18);
    for (const v of pv) expect(topology.vertexHexes(v).some((h) => s.hexes[topology.hexId(h)] && s.hexes[topology.hexId(h)].terrain !== 'sea')).toBe(true);
    expect(s.ports.filter((p) => p.port === 'port-any')).toHaveLength(4);
    expect(newGame(12, 4).hexes).toEqual(s.hexes);
    expect(newGame(13, 4).hexes).not.toEqual(s.hexes);
  });
});

describe('production', () => {
  it('settlements get 1, cities 2; robber blocks; bank shortage rule', () => {
    const { def, s: s0 } = blank();
    // a 6/8 hex: never adjacent to another hex with the same number
    const h = landHexWith(s0, (n) => n === 6 || n === 8);
    const res = baseDef.terrains.find((t) => t.id === h.terrain)!.produces!;
    const r = Object.keys(res)[0];
    const corners = topology.hexCorners(h.coord);
    let s = place(def, s0, 'settlement', 'p1', corners[0]);
    s = place(def, s, 'city', 'p2', corners[3]);
    s = edit(s, (c) => { c.globals.roll = h.number!; c.tokens.robber = null; });
    let s2 = act(def, s, 'p1', { type: 'doAction', action: 'produce' });
    expect(P(s2, 'p1').resources[r]).toBe(1);
    expect(P(s2, 'p2').resources[r]).toBe(2);
    // robber blocks
    s2 = act(def, edit(s, (c) => { c.tokens.robber = h.id; }), 'p1', { type: 'doAction', action: 'produce' });
    expect(P(s2, 'p1').resources[r]).toBe(0);
    // shortage with 2 claimants: nobody gets it
    s2 = act(def, edit(s, (c) => { c.bank[r] = 2; }), 'p1', { type: 'doAction', action: 'produce' });
    expect(P(s2, 'p1').resources[r] + P(s2, 'p2').resources[r]).toBe(0);
    // shortage with 1 claimant: gets what is left
    const solo = edit(s, (c) => { c.bank[r] = 1; c.pieces = c.pieces.filter((p) => p.owner === 'p2'); });
    s2 = act(def, solo, 'p1', { type: 'doAction', action: 'produce' });
    expect(P(s2, 'p2').resources[r]).toBe(1);
  });
});

describe('the 7: discard, robber, steal', () => {
  function sevenGame(over = {}) {
    const { def, s: s0 } = blank({}, 3, { diceMode: 'balanced', ...over });
    const h = landHexWith(s0, (n, t) => n !== null && t !== 'desert' && n !== 7);
    const c = topology.hexCorners(h.coord);
    let s = place(def, s0, 'settlement', 'p2', c[0]);
    s = place(def, s, 'settlement', 'p3', c[3]);
    s = give(s, 'p1', { ore: 9 });
    s = give(s, 'p2', { wool: 8 });
    s = give(s, 'p3', { grain: 3 });
    // balanced dice index 20 decodes to dice (3, 4)
    s = edit(s, (x) => { x.phase = 'preRoll'; x.hasRolled = false; x.diceDeck = [20]; });
    return { def, s, h };
  }

  it('players over the limit discard half simultaneously, then robber + steal', () => {
    const { def, s, h } = sevenGame();
    let s2 = act(def, s, 'p1', { type: 'rollDice' });
    expect(s2.lastRoll?.total).toBe(7);
    expect(s2.prompts.map((p) => [p.player, p.kind, p.amount])).toEqual(
      expect.arrayContaining([['p1', 'discard', 4], ['p2', 'discard', 4]]),
    );
    expect(s2.prompts).toHaveLength(2);
    // cannot move on while discards are pending
    expect(tryAct(def, s2, 'p1', { type: 'endTurn' }).ok).toBe(false);
    s2 = act(def, s2, 'p2', { type: 'respond', promptId: s2.prompts.find((p) => p.player === 'p2')!.id, answer: { wool: 4 } });
    expect(s2.prompts).toHaveLength(1);
    s2 = act(def, s2, 'p1', { type: 'respond', promptId: s2.prompts[0].id, answer: { ore: 4 } });
    expect(P(s2, 'p1').resources.ore).toBe(5);
    expect(s2.prompts[0]).toMatchObject({ player: 'p1', kind: 'location' });
    s2 = act(def, s2, 'p1', { type: 'respond', promptId: s2.prompts[0].id, answer: h.id });
    expect(s2.prompts[0]).toMatchObject({ kind: 'player' });
    expect(s2.prompts[0].options.sort()).toEqual(['p2', 'p3']);
    s2 = act(def, s2, 'p1', { type: 'respond', promptId: s2.prompts[0].id, answer: 'p3' });
    expect(P(s2, 'p3').resources.grain).toBe(2);
    expect(P(s2, 'p1').resources.grain).toBe(1);
    expect(s2.stack).toEqual([]);
    expect(s2.phase).toBe('main');
  });

  it('honours the lobby discard limit and friendly robber', () => {
    const { def, s, h } = sevenGame({ discardLimit: 9, friendlyRobber: true });
    let s2 = act(def, s, 'p1', { type: 'rollDice' });
    expect(s2.prompts).toHaveLength(1); // nobody above 9 cards
    s2 = act(def, s2, 'p1', { type: 'respond', promptId: s2.prompts[0].id, answer: h.id });
    // p2/p3 have 1 VP each -> protected, no steal prompt
    expect(s2.prompts).toHaveLength(0);
    expect(P(s2, 'p3').resources.grain).toBe(3);
  });
});

describe('awards', () => {
  it('longest road: awarded at 5, broken by an opponent settlement', () => {
    const { def, s: s0 } = blank();
    const centre = { q: 0, r: 0 };
    const edges = topology.hexEdges(centre).slice(0, 5);
    let s = s0;
    for (const e of edges) s = place(def, s, 'road', 'p1', e);
    s = act(def, s, 'p1', { type: 'doAction', action: 'noop' });
    expect(s.awards.longestRoad).toBe('p1');
    expect(computeVP(def, s, 'p1', false)).toBe(2);
    // p2 builds a settlement in the middle of the road (corner 2 joins edges 1 and 2)
    s = place(def, s, 'settlement', 'p2', topology.hexCorners(centre)[2]);
    s = act(def, s, 'p1', { type: 'doAction', action: 'noop' });
    expect(s.awards.longestRoad).toBeNull();
  });

  it('longest road: holder keeps it on a tie', () => {
    const { def, s: s0 } = blank();
    let s = s0;
    for (const e of topology.hexEdges({ q: 0, r: 0 }).slice(0, 5)) s = place(def, s, 'road', 'p1', e);
    s = act(def, s, 'p1', { type: 'doAction', action: 'noop' });
    for (const e of topology.hexEdges({ q: 0, r: 2 }).slice(0, 5)) s = place(def, s, 'road', 'p2', e);
    s = act(def, s, 'p1', { type: 'doAction', action: 'noop' });
    expect(s.awards.longestRoad).toBe('p1');
  });

  it('largest army via knights (countsAs), min 3', () => {
    const { def, s: s0 } = blank();
    let s = edit(s0, (c) => { c.players[0].stats.knightsPlayed = 2; c.players[0].hand.push({ id: 'k1', card: 'knight', deck: 'dev', acquiredTurn: 0 }); });
    s = act(def, s, 'p1', { type: 'playCard', cardInstance: 'k1' });
    expect(s.awards.largestArmy).toBeNull(); // still resolving the robber
    s = answer(def, s);
    while (s.prompts.length) s = answer(def, s);
    expect(P(s, 'p1').stats.knightsPlayed).toBe(3);
    expect(s.awards.largestArmy).toBe('p1');
    expect(P(s, 'p1').played.map((c) => c.card)).toEqual(['knight']);
  });
});

describe('trading', () => {
  it('ports lower bank rates; bank trades are validated', () => {
    const { def, s: s0 } = blank();
    const p2port = s0.ports.find((p) => p.port !== 'port-any')!;
    const anyPort = s0.ports.find((p) => p.port === 'port-any')!;
    let s = place(def, s0, 'settlement', 'p1', p2port.vertices[0]);
    s = place(def, s, 'settlement', 'p1', anyPort.vertices[1]);
    const res = def.ports.find((p) => p.id === p2port.port)!.resource as string;
    const rates = getAvailableMoves(def, s, 'p1').bankRates;
    expect(rates[res]).toBe(2);
    expect(Object.entries(rates).filter(([r]) => r !== res).every(([, v]) => v === 3)).toBe(true);
    expect(getAvailableMoves(def, s, 'p2').bankRates.ore).toBe(4);
    s = give(s, 'p1', { [res]: 4 });
    const other = res === 'ore' ? 'wool' : 'ore';
    expect(tryAct(def, s, 'p1', { type: 'bankTrade', give: { [res]: 3 }, get: { [other]: 1 } }).ok).toBe(false);
    expect(tryAct(def, s, 'p1', { type: 'bankTrade', give: { [res]: 4 }, get: { [other]: 1 } }).ok).toBe(false);
    const s2 = act(def, s, 'p1', { type: 'bankTrade', give: { [res]: 4 }, get: { [other]: 1, grain: res === 'grain' ? 0 : 1 } });
    expect(P(s2, 'p1').resources[res]).toBe(0);
    expect(P(s2, 'p1').resources[other]).toBe(1);
  });

  it('player offers: everyone eligible pending, accept, confirm', () => {
    const { def, s: s0 } = blank();
    let s = give(give(s0, 'p1', { ore: 1 }), 'p3', { wool: 1 });
    s = act(def, s, 'p1', { type: 'offerTrade', to: null, give: { ore: 1 }, get: { wool: 1 } });
    const t = s.trades[0];
    expect(t.responses).toEqual({ p2: 'pending', p3: 'pending' });
    expect(tryAct(def, s, 'p2', { type: 'respondTrade', tradeId: t.id, accept: true }).ok).toBe(false); // has no wool
    s = act(def, s, 'p2', { type: 'respondTrade', tradeId: t.id, accept: false });
    s = act(def, s, 'p3', { type: 'respondTrade', tradeId: t.id, accept: true });
    expect(tryAct(def, s, 'p1', { type: 'confirmTrade', tradeId: t.id, withPlayer: 'p2' }).ok).toBe(false);
    s = act(def, s, 'p1', { type: 'confirmTrade', tradeId: t.id, withPlayer: 'p3' });
    expect(P(s, 'p1').resources).toMatchObject({ ore: 0, wool: 1 });
    expect(P(s, 'p3').resources).toMatchObject({ ore: 1, wool: 0 });
    expect(s.trades).toEqual([]);
    // non-current players cannot propose (onlyCurrentPlayer)
    expect(tryAct(def, give(s, 'p2', { ore: 1 }), 'p2', { type: 'offerTrade', to: null, give: { ore: 1 }, get: { wool: 1 } }).ok).toBe(false);
  });
});

describe('development cards', () => {
  it('cannot play on the acquired turn; one per turn; VP cards hidden and never playable', () => {
    const { def, s: s0 } = blank();
    let s = edit(s0, (c) => {
      // put two known cards on top of the deck
      c.decks.dev.draw.unshift('monopoly', 'victoryPoint');
    });
    s = give(s, 'p1', { ore: 2, wool: 2, grain: 2 });
    s = act(def, s, 'p1', { type: 'buyCard', deck: 'dev' });
    s = act(def, s, 'p1', { type: 'buyCard', deck: 'dev' });
    expect(P(s, 'p1').hand.map((c) => c.card)).toEqual(['monopoly', 'victoryPoint']);
    expect(getAvailableMoves(def, s, 'p1').playableCards).toEqual([]);
    expect(computeVP(def, s, 'p1', false)).toBe(0);
    expect(computeVP(def, s, 'p1', true)).toBe(1);
    // advance a full round back to p1
    for (let i = 0; i < 3; i++) {
      const pid = cur(s);
      if (s.phase === 'preRoll') s = edit(s, (c) => { c.phase = 'main'; c.hasRolled = true; });
      s = act(def, s, pid, { type: 'endTurn' });
    }
    expect(cur(s)).toBe('p1');
    const playable = getAvailableMoves(def, s, 'p1').playableCards;
    expect(playable.map((c) => c.card.id)).toEqual(['monopoly']); // before roll is fine for ownTurn
    s = give(s, 'p2', { brick: 2 });
    s = give(s, 'p3', { brick: 1 });
    s = act(def, s, 'p1', { type: 'playCard', cardInstance: playable[0].cardInstance });
    s = answer(def, s, () => 'brick');
    expect(P(s, 'p1').resources.brick).toBe(3);
    expect(P(s, 'p2').resources.brick).toBe(0);
  });

  it('road building places two free roads', () => {
    const { def, s: s0 } = blank();
    const v = topology.hexCorners({ q: 0, r: 0 })[0];
    let s = place(def, s0, 'settlement', 'p1', v);
    s = edit(s, (c) => { c.players[0].hand.push({ id: 'rb', card: 'roadBuilding', deck: 'dev', acquiredTurn: 0 }); });
    s = act(def, s, 'p1', { type: 'playCard', cardInstance: 'rb' });
    s = answer(def, s);
    s = answer(def, s);
    expect(s.pieces.filter((p) => p.type === 'road' && p.owner === 'p1')).toHaveLength(2);
    expect(Object.values(P(s, 'p1').resources).every((n) => n === 0)).toBe(true);
    expect(tryAct(def, s, 'p1', { type: 'playCard', cardInstance: 'x' }).ok).toBe(false);
  });

  it('year of plenty takes two resources from the bank', () => {
    const { def, s: s0 } = blank();
    let s = edit(s0, (c) => { c.players[0].hand.push({ id: 'y', card: 'yearOfPlenty', deck: 'dev', acquiredTurn: 0 }); c.bank.ore = 0; });
    s = act(def, s, 'p1', { type: 'playCard', cardInstance: 'y' });
    expect(s.prompts[0].options).not.toContain('ore');
    s = answer(def, s, () => 'wool');
    s = answer(def, s, () => 'wool');
    expect(P(s, 'p1').resources.wool).toBe(2);
  });
});

describe('building', () => {
  it('build command: cost paid on placement, cancel is free, upgrade to city', () => {
    const { def, s: s0 } = blank();
    const v = topology.hexCorners({ q: 0, r: 0 })[0];
    let s = place(def, s0, 'settlement', 'p1', v);
    s = give(s, 'p1', { brick: 1, lumber: 1, grain: 2, ore: 3 });
    s = act(def, s, 'p1', { type: 'build', piece: 'road' });
    expect(s.prompts[0].optional).toBe(true);
    expect(s.prompts[0].options.every((e) => topology.edgeVertices(e).includes(v))).toBe(true);
    const cancelled = act(def, s, 'p1', { type: 'respond', promptId: s.prompts[0].id, answer: null });
    expect(P(cancelled, 'p1').resources.brick).toBe(1);
    s = answer(def, s);
    expect(P(s, 'p1').resources.brick).toBe(0);
    s = act(def, s, 'p1', { type: 'build', piece: 'city' });
    s = answer(def, s);
    expect(s.pieces.find((p) => p.at === v)?.type).toBe('city');
    expect(computeVP(def, s, 'p1', false)).toBe(2);
    expect(tryAct(def, s, 'p1', { type: 'build', piece: 'settlement' }).ok).toBe(false);
  });

  it('wins at the target VP after a command', () => {
    const { def, s: s0 } = blank({}, 3, { victoryPoints: 3 });
    let s = place(def, s0, 'city', 'p1', topology.hexCorners({ q: 0, r: 0 })[0]);
    s = edit(s, (c) => { c.players[0].tokenVP = 1; });
    s = act(def, s, 'p1', { type: 'doAction', action: 'noop' });
    expect(s.winner).toBe('p1');
    expect(s.phase).toBe('gameOver');
  });
});

describe('redaction', () => {
  it('hides other hands, deck order, rng, other resource breakdowns', () => {
    const { def, s: s0 } = blank({}, 3, { hideBankCards: true });
    let s = give(give(s0, 'p1', { ore: 2 }), 'p2', { wool: 3, brick: 1 });
    s = edit(s, (c) => { c.players[1].hand.push({ id: 'h', card: 'monopoly', deck: 'dev', acquiredTurn: 0 }); });
    const r = redactFor(def, s, 'p1');
    expect(P(r, 'p1').resources.ore).toBe(2);
    expect(P(r, 'p2').resources).toEqual({ '?': 4 });
    expect(P(r, 'p2').hand).toEqual([{ id: 'h', card: 'hidden', deck: 'dev', acquiredTurn: 0 }]);
    expect(r.decks.dev.draw.length).toBe(s.decks.dev.draw.length);
    expect(new Set(r.decks.dev.draw)).toEqual(new Set(['hidden']));
    expect(r.rngState).toBe(0);
    expect(r.seed).toBe(0);
    expect(r.bank).toEqual({});
    const spectator = redactFor(def, s, null);
    expect(P(spectator, 'p1').resources).toEqual({ '?': 2 });
    expect(s.players[1].hand[0].card).toBe('monopoly'); // input untouched
  });
});

describe('turn timing and dice', () => {
  it('records turnStartedAt from the host-supplied clock', () => {
    const { def, s } = blank();
    const s2 = applyCommand(def, s, 'p1', { type: 'endTurn' }, 123456);
    expect(s2.ok && s2.state.turnStartedAt).toBe(123456);
    expect(createGame(def, settings(), players(2), 1, 42).turnStartedAt).toBe(42);
  });

  it('event dice expose event0 on diceRolled and fire a custom event named by the face', () => {
    const { def, s: s0 } = blank({
      dice: { numeric: [{ sides: 6 }, { sides: 6 }], eventDice: [{ id: 'ev', faces: ['boom'] }] },
      triggers: [
        { id: 'face', on: 'boom', do: [{ op: 'addStat', key: 'booms', amount: 1 }] },
        { id: 'var', on: 'diceRolled', when: { cmp: [{ dice: 'total' }, '>', 0] }, do: [{ op: 'log', text: 'face {event0}' }] },
      ],
    });
    const s = edit(s0, (c) => { c.phase = 'preRoll'; c.hasRolled = false; });
    const r = act(def, s, 'p1', { type: 'rollDice' });
    expect(r.lastRoll?.event).toEqual(['boom']);
    expect(P(r, 'p1').stats.booms).toBe(1);
    expect(r.log.some((l) => l.text === 'face boom')).toBe(true);
  });

  it('balanced dice deal every combination once per 36 rolls', () => {
    const { def, s: s0 } = blank({}, 2, { diceMode: 'balanced' });
    let s = edit(s0, (c) => { c.diceDeck = []; });
    const totals: number[] = [];
    for (let i = 0; i < 36; i++) {
      s = edit(s, (c) => { c.phase = 'preRoll'; c.hasRolled = false; c.stack = []; c.prompts = []; });
      const r = applyCommand(def, s, cur(s), { type: 'rollDice' });
      if (!r.ok) throw new Error(r.error);
      s = r.state;
      totals.push(s.lastRoll!.total);
    }
    const count = (n: number) => totals.filter((t) => t === n).length;
    expect([count(2), count(7), count(12)]).toEqual([1, 6, 1]);
  });
});
