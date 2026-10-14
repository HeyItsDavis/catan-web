import { describe, expect, it } from 'vitest';
import { topology } from '../../../engine';
import { act, edit, give, newGame, place } from '../../../engine/__tests__/helpers';
import { mod } from '../tb-caravans';
import { defOf, expectValid, playGames } from './scenarioBot';

const def = defOf(mod);
type S = ReturnType<typeof newGame>;
const P = (s: S, id: string) => s.players.find((p) => p.id === id)!;
const respond = (s: S, a: string) => act(def, s, s.prompts[0].player, { type: 'respond', promptId: s.prompts[0].id, answer: a });
const optionIndex = (s: S, label: string) => String(s.prompts[0].optionLabels!.indexOf(label));

function main() {
  return edit(newGame(1, 3, def), (c) => { c.phase = 'main'; c.hasRolled = true; c.pieces = []; c.prompts = []; c.stack = []; delete c.setupProgress; c.turn = 1; });
}

describe('T&B The Caravans', () => {
  it('validates', () => { expectValid(mod); });

  it('building a settlement starts a vote; the highest offer places a camel; buildings beside camels score', () => {
    let s = main();
    const oasis = topology.hexCorners({ q: 0, r: 0 });
    const oasisEdges = topology.hexEdges({ q: 0, r: 0 });
    // p1 has a road to an empty corner of the oasis
    s = place(def, s, 'road', 'p1', oasisEdges[0]);
    s = give(s, 'p1', { brick: 1, lumber: 1, wool: 1, grain: 1 });
    s = give(s, 'p2', { grain: 1, wool: 1 });
    s = act(def, s, 'p1', { type: 'build', piece: 'settlement' });
    s = respond(s, oasis[0]);
    // vote: p1 (nothing left), p2 offers grain+wool, p3 nothing
    expect(s.prompts[0].player).toBe('p1');
    s = respond(s, optionIndex(s, 'Offer nothing'));
    expect(s.prompts[0].player).toBe('p2');
    s = respond(s, optionIndex(s, 'Offer 1 grain and 1 wool'));
    s = respond(s, optionIndex(s, 'Offer nothing'));
    expect(s.prompts[0]).toMatchObject({ player: 'p2', kind: 'location' });
    // p2 places the camel beside p1's new settlement, on the oasis
    s = respond(s, oasisEdges[5]);
    expect(s.pieces.find((p) => p.type === 'camel')).toMatchObject({ owner: 'p2', at: oasisEdges[5] });
    expect(P(s, 'p2').resources.grain).toBe(0);
    expect(P(s, 'p1').tokenVP).toBe(1); // settlement next to a camel
    expect(P(s, 'p1').stats.camelBid).toBe(0);
    // roads can share a side with a camel, and it counts for Longest Road
    s = give(s, 'p1', { brick: 1, lumber: 1 });
    s = act(def, s, 'p1', { type: 'build', piece: 'road' });
    expect(s.prompts[0].options).toContain(oasisEdges[5]);
  });

  it('bots finish games', () => {
    const games = playGames(def, [1, 2, 3]);
    for (const g of games) expect(g.winner, `turn ${g.turn}`).toBeTruthy();
    expect(games.every((g) => g.pieces.some((p) => p.type === 'camel'))).toBe(true);
  }, 120_000);
});
