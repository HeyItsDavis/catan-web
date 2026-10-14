import { describe, expect, it } from 'vitest';
import { getAvailableMoves, topology } from '../../../engine';
import { act, edit, give, newGame, place, tryAct } from '../../../engine/__tests__/helpers';
import { mod } from '../tb-traders-barbarians';
import { defOf, expectValid, playGames } from './scenarioBot';

const def = defOf(mod);
/** Bots: drive a lot, always load and deliver goods, rarely load resource cards. */
const TB_WEIGHTS = { driveWagon: 6, loadMarble: 20, loadGlass: 20, deliverGoods: 20, loadWares: 0.1, hireMercenaries: 0.3, goldForResource: 3 };
type S = ReturnType<typeof newGame>;
const P = (s: S, id: string) => s.players.find((p) => p.id === id)!;
const respond = (s: S, a: string) => act(def, s, s.prompts[0].player, { type: 'respond', promptId: s.prompts[0].id, answer: a });
const doAction = (s: S, action: string, pieceId?: string) => act(def, s, 'p1', { type: 'doAction', action, ...(pieceId ? { pieceId } : {}) });
const enabled = (s: S, action: string, pieceId: string) => getAvailableMoves(def, s, 'p1').actions.find((a) => a.action.id === action && a.pieceId === pieceId)?.enabled;

function sideBetween(a: { q: number; r: number }, b: { q: number; r: number }): string {
  const ea = new Set(topology.hexEdges(a));
  return topology.hexEdges(b).find((e) => ea.has(e))!;
}

const QUARRY = { q: -2, r: 2 };
const MIDDLE = { q: -1, r: 1 };
const CASTLE = { q: 0, r: 0 };

/** p2 owns a ring of roads around the hex between the quarry and the castle; p1 has a wagon at the quarry. */
function board(): { s: S; wagon: string } {
  let s = edit(newGame(1, 3, def), (c) => { c.phase = 'main'; c.hasRolled = true; c.pieces = []; c.prompts = []; c.stack = []; delete c.setupProgress; c.turn = 1; });
  for (const e of topology.hexEdges(MIDDLE)) s = place(def, s, 'road', 'p2', e);
  s = place(def, s, 'wagon', 'p1', sideBetween(QUARRY, MIDDLE));
  return { s, wagon: s.pieces.find((p) => p.type === 'wagon')!.id };
}

describe('T&B Traders & Barbarians', () => {
  it('validates', () => { expectValid(mod); });

  it('the map has the castle in the middle, a quarry and a glassworks', () => {
    const s = newGame(2, 3, def);
    expect(s.hexes['h:0,0'].terrain).toBe('castle');
    expect(s.hexes['h:-2,2'].terrain).toBe('quarry');
    expect(s.hexes['h:2,-2'].terrain).toBe('glassworks');
  });

  it('after setup every player puts a wagon on one of their roads', () => {
    let s = newGame(3, 3, def);
    let guard = 0;
    while (s.phase === 'setup' || s.prompts.length) {
      s = respond(s, s.prompts[0].options[0]);
      if (++guard > 100) throw new Error('stuck');
    }
    const wagons = s.pieces.filter((p) => p.type === 'wagon');
    expect(wagons).toHaveLength(3);
    for (const w of wagons) expect(s.pieces.some((p) => p.type === 'road' && p.owner === w.owner && p.at === w.at)).toBe(true);
  });

  it('a wagon loads marble at the quarry, drives along roads and delivers to the castle for VP and gold', () => {
    let { s, wagon } = board();
    expect(enabled(s, 'loadGlass', wagon)).toBe(false);
    s = doAction(s, 'loadMarble', wagon);
    s = give(s, 'p1', { ore: 1 });
    s = doAction(s, 'loadWares', wagon);
    s = respond(s, 'ore');
    expect(s.pieces.find((p) => p.id === wagon)!.cargo).toEqual({ marble: 1, ore: 1 });
    expect(enabled(s, 'loadMarble', wagon)).toBe(false); // full (2 things)

    const castleSide = sideBetween(CASTLE, MIDDLE);
    s = doAction(s, 'driveWagon', wagon);
    expect(s.prompts[0].options).toContain(castleSide);
    s = respond(s, castleSide);
    const w = s.pieces.find((p) => p.id === wagon)!;
    expect(w.at).toBe(castleSide);
    expect(w.cargo).toBeUndefined();
    expect(w.state.moved).toBe(3); // half way round the hex
    expect(P(s, 'p1').tokenVP).toBe(1);
    expect(P(s, 'p1').stats.gold).toBe(3); // 2 for the marble, 1 for the ore sold
    expect(s.bank.ore).toBe(19);
    // one movement point left; feeding the horses adds 2
    s = give(s, 'p1', { grain: 1 });
    s = doAction(s, 'feedHorses', wagon);
    s = doAction(s, 'driveWagon', wagon);
    expect(s.prompts[0].options.length).toBeGreaterThan(2);
  });

  it('barbarian bands block wagons and raid the ones next to them', () => {
    let { s, wagon } = board();
    s = doAction(s, 'loadMarble', wagon);
    const ring = topology.hexEdges(MIDDLE);
    const start = sideBetween(QUARRY, MIDDLE);
    const i = ring.indexOf(start);
    const blockA = ring[(i + 1) % 6];
    const blockB = ring[(i + 5) % 6];
    s = edit(s, (c) => { c.tokens.barbarianA = blockA; c.tokens.barbarianB = blockB; });
    expect(enabled(s, 'driveWagon', wagon)).toBe(true);
    const blocked = tryAct(def, s, 'p1', { type: 'doAction', action: 'driveWagon', pieceId: wagon });
    expect(blocked).toEqual({ ok: false, error: 'The wagon cannot move' });
    // a band moved next to the wagon raids it
    s = give(s, 'p1', { ore: 1, wool: 1 });
    s = doAction(s, 'hireMercenaries');
    s = respond(s, '2'); // band C
    const next = s.prompts[0].options.find((e) => topology.edgeNeighbors(start).includes(e))!;
    s = respond(s, next);
    expect(s.pieces.find((p) => p.id === wagon)!.cargo).toBeUndefined();
  });

  it('bots finish games', () => {
    const games = playGames(def, [1, 2, 3], { maxTurns: 500, weights: TB_WEIGHTS });
    for (const g of games) expect(g.winner, `turn ${g.turn}`).toBeTruthy();
    expect(games.every((g) => g.pieces.filter((p) => p.type === 'wagon').length >= 3)).toBe(true);
    // goods were delivered to the castle (the only source of token VP in this scenario)
    expect(games.every((g) => g.players.some((p) => p.tokenVP > 0))).toBe(true);
  }, 120_000);
});
