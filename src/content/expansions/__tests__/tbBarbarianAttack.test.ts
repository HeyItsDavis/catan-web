import { describe, expect, it } from 'vitest';
import { topology } from '../../../engine';
import { act, edit, newGame, place } from '../../../engine/__tests__/helpers';
import { mod } from '../tb-barbarian-attack';
import { defOf, expectValid, playGames } from './scenarioBot';

const def = defOf(mod);
type S = ReturnType<typeof newGame>;
const P = (s: S, id: string) => s.players.find((p) => p.id === id)!;
const respond = (s: S, a: string) => act(def, s, s.prompts[0].player, { type: 'respond', promptId: s.prompts[0].id, answer: a });

function main() {
  return edit(newGame(1, 3, def), (c) => { c.phase = 'main'; c.hasRolled = true; c.pieces = []; c.prompts = []; c.stack = []; delete c.setupProgress; c.turn = 1; });
}

describe('T&B Barbarian Attack', () => {
  it('validates', () => { expectValid(mod); });

  it('a 7 lands barbarians on the coast; 3 conquer a hex; knights drive them off for prisoners', () => {
    let s = main();
    expect(s.tokens.robber).toBeUndefined();
    // roll 7s until a hex is conquered (deterministic for this seed)
    let guard = 0;
    while (!s.pieces.some((p) => p.type === 'barbarian' && p.state.count >= 3)) {
      s = edit(s, (c) => { c.phase = 'preRoll'; c.hasRolled = false; c.settings.diceMode = 'balanced'; c.diceDeck = [3 + 6 * 2]; }); // 4 + 3
      s = act(def, s, 'p1', { type: 'rollDice' });
      expect(s.lastRoll!.total).toBe(7);
      if (++guard > 300) throw new Error('no conquest');
    }
    const camp = s.pieces.find((p) => p.type === 'barbarian' && p.state.count >= 3)!;
    expect(s.hexes[camp.at].number).toBeNull();
    const lost = camp.state.number;
    expect(lost).toBeGreaterThan(0);

    // surround the hex with knights: as many knights as barbarians
    const corners = topology.hexCorners(topology.parseHexId(camp.at));
    s = edit(s, (c) => { c.pieces = c.pieces.filter((p) => p.type === 'barbarian' && p.id === camp.id); c.pieces[0].state.count = 3; });
    for (let i = 0; i < 3; i++) s = place(def, s, 'knight', i % 2 ? 'p2' : 'p1', corners[i]);
    const myKnight = s.pieces.find((p) => p.type === 'knight' && p.owner === 'p1')!;
    s = act(def, s, 'p1', { type: 'doAction', action: 'attackBarbarians', pieceId: myKnight.id });
    s = respond(s, camp.at);
    expect(s.pieces.some((p) => p.type === 'barbarian')).toBe(false);
    expect(s.hexes[camp.at].number).toBe(lost);
    expect(P(s, 'p1').stats.prisoners).toBe(3);
    expect(P(s, 'p1').tokenVP).toBe(1);
  });

  it('bots finish games', () => {
    const games = playGames(def, [1, 2, 3]);
    for (const g of games) expect(g.winner, `turn ${g.turn}`).toBeTruthy();
  }, 120_000);
});
