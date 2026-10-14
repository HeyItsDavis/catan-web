import { describe, expect, it } from 'vitest';
import { computeVP, topology } from '../../../engine';
import { act, edit, newGame, place } from '../../../engine/__tests__/helpers';
import { mod } from '../tb-fishermen';
import { defOf, expectValid, playGames } from './scenarioBot';

const def = defOf(mod);
const P = (s: ReturnType<typeof newGame>, id: string) => s.players.find((p) => p.id === id)!;

function main(seed = 1) {
  return edit(newGame(seed, 3, def), (c) => { c.phase = 'main'; c.hasRolled = true; c.pieces = []; c.prompts = []; c.stack = []; delete c.setupProgress; c.turn = 1; });
}

describe('T&B Fishermen of Catan', () => {
  it('validates', () => { expectValid(mod); });

  it('has six numbered fishing grounds and a lake instead of the desert', () => {
    const s = newGame(1, 3, def);
    const hexes = Object.values(s.hexes);
    expect(hexes.filter((h) => h.terrain === 'fishingGround').map((h) => h.number).sort()).toEqual([10, 4, 5, 6, 8, 9]);
    expect(hexes.filter((h) => h.terrain === 'lake')).toHaveLength(1);
    expect(hexes.some((h) => h.terrain === 'desert')).toBe(false);
    expect(s.tokens.robber).toBeNull();
  });

  it('a settlement next to a fishing ground draws fish tokens when its number is rolled; fish buy things', () => {
    let s = main();
    const ground = Object.values(s.hexes).find((h) => h.terrain === 'fishingGround')!;
    const corner = topology.hexCorners(ground.coord).find((v) => topology.vertexHexes(v).some((h) => s.hexes[topology.hexId(h)] && !['sea', 'fishingGround'].includes(s.hexes[topology.hexId(h)].terrain)))!;
    s = place(def, s, 'city', 'p1', corner);
    // force the next roll to be the ground's number: put the dice in balanced mode with a known deck
    s = edit(s, (c) => { c.phase = 'preRoll'; c.hasRolled = false; c.settings.diceMode = 'balanced'; const n = ground.number!; const a = Math.min(6, n - 1); c.diceDeck = [(a - 1) + 6 * (n - a - 1)]; });
    s = act(def, s, 'p1', { type: 'rollDice' });
    expect(s.lastRoll!.total).toBe(ground.number);
    const fish = P(s, 'p1').stats.fish ?? 0;
    const boot = P(s, 'p1').stats.oldBoot ?? 0;
    expect(fish + boot).toBeGreaterThanOrEqual(1); // a city draws 2 tokens (1-3 fish each, or the boot)
    s = edit(s, (c) => { P(c, 'p1').stats.fish = 9; c.tokens.robber = 'h:0,0'; c.globals.robberOffBoard = 0; });
    s = act(def, s, 'p1', { type: 'doAction', action: 'fishShooRobber' });
    expect(s.tokens.robber).toBeNull();
    expect(P(s, 'p1').stats.fish).toBe(7);
    s = act(def, s, 'p1', { type: 'doAction', action: 'fishDevCard' });
    expect(P(s, 'p1').hand).toHaveLength(1);
    expect(P(s, 'p1').stats.fish).toBe(0);
  });

  it('the old boot costs a victory point and can be passed to a player with at least as many points', () => {
    let s = main();
    s = place(def, s, 'settlement', 'p1', topology.hexCorners({ q: 0, r: 0 })[0]);
    s = place(def, s, 'city', 'p2', topology.hexCorners({ q: 0, r: 2 })[0]);
    s = edit(s, (c) => { P(c, 'p1').stats.oldBoot = 1; });
    s = act(def, s, 'p1', { type: 'doAction', action: 'passOldBoot' }); // recompute awards
    // the action prompted for a target: only p2 (2 VP) has at least p1's points
    expect(s.prompts[0].options).toEqual(['p2']);
    s = act(def, s, 'p1', { type: 'respond', promptId: s.prompts[0].id, answer: 'p2' });
    expect(s.awards.oldBoot).toBe('p2');
    expect(computeVP(def, s, 'p2', false)).toBe(1);
  });

  it('bots finish games', () => {
    const games = playGames(def, [1, 2, 3]);
    for (const g of games) expect(g.winner, `turn ${g.turn}`).toBeTruthy();
    expect(games.some((g) => g.players.some((p) => (p.stats.fish ?? 0) > 0 || p.played.length > 0))).toBe(true);
  }, 120_000);
});
