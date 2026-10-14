import { describe, expect, it } from 'vitest';
import type { Effect, GameDefinition, GameState, ModDef, TriggerDef } from '../index';
import { act, answer, cur, edit, finishSetup, give, newGame, tryAct, withMods } from './helpers';

const testMod = (fx: Effect[], extra: Partial<ModDef> = {}): ModDef => ({
  meta: { id: 'fx', name: 'fx', version: '1', extends: ['base'] },
  actions: [{ id: 't', name: 'Test', available: true, effect: fx }],
  ...extra,
});

/** A game in the main phase (rolled), with the test action defined. */
function setup(fx: Effect[], extra: Partial<ModDef> = {}, n = 3): { def: GameDefinition; s: GameState } {
  const def = withMods(testMod(fx, extra));
  let s = finishSetup(def, newGame(11, n, def));
  s = edit(s, (c) => { c.phase = 'main'; c.hasRolled = true; });
  return { def, s };
}

const run = (def: GameDefinition, s: GameState) => act(def, s, cur(s), { type: 'doAction', action: 't' });
const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;

describe('control flow', () => {
  it('repeat binds the index, setVar and if/else work', () => {
    const { def, s } = setup([
      { op: 'setVar', name: 'sum', value: 0 },
      { op: 'repeat', times: 4, as: 'i', do: [{ op: 'setVar', name: 'sum', value: { add: [{ var: 'sum' }, { var: 'i' }] } }] },
      { op: 'if', cond: { cmp: [{ var: 'sum' }, '==', 6] }, then: [{ op: 'addStat', key: 'ok', amount: 1 }], else: [{ op: 'addStat', key: 'bad', amount: 1 }] },
    ]);
    const s2 = run(def, s);
    expect(P(s2, cur(s)).stats.ok).toBe(1);
    expect(P(s2, cur(s)).stats.bad).toBeUndefined();
  });

  it('forEachPlayer (turn order) with filter and sequence', () => {
    const { def, s } = setup([{ op: 'forEachPlayer', as: 'p', filter: { not: { samePlayer: [{ var: 'p' }, 'self'] } },
      do: [{ op: 'sequence', do: [{ op: 'addStat', player: { var: 'p' }, key: 'hit', amount: 1 }] }] }]);
    const s2 = run(def, s);
    expect(s2.players.map((p) => p.stats.hit ?? 0)).toEqual(s2.players.map((p) => (p.id === cur(s) ? 0 : 1)));
  });

  it('chooseOption offers only options whose cond holds and runs the chosen branch', () => {
    const { def, s } = setup([{ op: 'chooseOption', label: 'Pick', options: [
      { label: 'A', do: [{ op: 'addStat', key: 'a', amount: 1 }] },
      { label: 'never', cond: false, do: [] },
      { label: 'C', do: [{ op: 'addStat', key: 'c', amount: 1 }] },
    ] }]);
    let s2 = run(def, s);
    expect(s2.prompts[0].options).toEqual(['0', '2']);
    expect(s2.prompts[0].optionLabels).toEqual(['A', 'C']);
    s2 = answer(def, s2, () => '2');
    expect(P(s2, cur(s)).stats).toMatchObject({ c: 1 });
  });

  it('nested repeat x forEach with prompts resumes correctly', () => {
    const { def, s } = setup([{ op: 'repeat', times: 2, as: 'i', do: [
      { op: 'repeat', times: 2, as: 'j', do: [
        { op: 'chooseResource', as: 'r', options: ['ore', 'wool'] },
        { op: 'gain', resources: { ore: { if: [{ cmp: [{ var: 'j' }, '==', 1] }, 1, 0] } } },
      ] },
    ] }]);
    let s2 = run(def, s);
    const before = P(s, cur(s)).resources.ore;
    let prompts = 0;
    while (s2.prompts.length) { s2 = answer(def, s2); prompts++; }
    expect(prompts).toBe(4);
    expect(P(s2, cur(s)).resources.ore - before).toBe(2);
    expect(s2.stack).toEqual([]);
  });

  it('abortIf cancels and refunds the action (cost + earlier effects), even after a prompt', () => {
    const def0: Partial<ModDef> = {};
    const { def, s: s0 } = setup([
      { op: 'gain', resources: { wool: 3 } },
      { op: 'chooseResource', as: 'r', options: ['ore', 'grain'] },
      { op: 'abortIf', cond: { cmp: [1, '==', 1] }, message: 'nope' },
    ], def0);
    const withCost = { ...def, actions: def.actions.map((a) => ({ ...a, cost: { brick: 1 } })) };
    const s = give(s0, cur(s0), { brick: 1 });
    let s2 = act(withCost, s, cur(s), { type: 'doAction', action: 't' });
    expect(P(s2, cur(s)).resources.brick).toBe(P(s, cur(s)).resources.brick - 1);
    s2 = answer(withCost, s2);
    expect(P(s2, cur(s)).resources).toEqual(P(s, cur(s)).resources);
    expect(s2.stack).toEqual([]);
    expect(s2.log.at(-1)?.text).toContain('nope');
  });

  it('abortIf in the same command returns an error', () => {
    const { def, s } = setup([{ op: 'abortIf', cond: true, message: 'blocked' }]);
    const r = tryAct(def, s, cur(s), { type: 'doAction', action: 't' });
    expect(r).toEqual({ ok: false, error: 'blocked' });
  });

  it('simultaneous forEachPlayer raises all prompts at once and resumes when all answered', () => {
    const { def, s } = setup([
      { op: 'forEachPlayer', as: 'p', order: 'simultaneous', do: [
        { op: 'chooseResource', player: { var: 'p' }, as: 'r', options: ['ore', 'grain'] },
        { op: 'transfer', from: 'bank', to: { var: 'p' }, resource: { var: 'r' }, amount: 1 },
      ] },
      { op: 'addStat', key: 'after', amount: 1 },
    ]);
    let s2 = run(def, s);
    expect(s2.prompts.map((p) => p.player).sort()).toEqual(s.players.map((p) => p.id).sort());
    // answer out of order
    const last = s2.prompts[s2.prompts.length - 1];
    s2 = act(def, s2, last.player, { type: 'respond', promptId: last.id, answer: 'grain' });
    expect(P(s2, cur(s)).stats.after).toBeUndefined();
    while (s2.prompts.length) s2 = answer(def, s2);
    expect(P(s2, cur(s)).stats.after).toBe(1);
    expect(s2.stack).toEqual([]);
  });

  it('emit fires custom triggers with payload vars', () => {
    const trig: TriggerDef = { id: 'onPing', on: 'ping', as: 'eventPlayer', do: [{ op: 'addStat', key: 'pinged', amount: { var: 'n' } }] };
    const { def, s } = setup([{ op: 'emit', event: 'ping', payload: { n: 5 } }], { triggers: [trig] });
    expect(P(run(def, s), cur(s)).stats.pinged).toBe(5);
  });

  it('rejects illegal answers and answers from the wrong player', () => {
    const { def, s } = setup([{ op: 'chooseResource', as: 'r', options: ['ore'] }]);
    const s2 = run(def, s);
    const pr = s2.prompts[0];
    expect(tryAct(def, s2, pr.player, { type: 'respond', promptId: pr.id, answer: 'wool' }).ok).toBe(false);
    const other = s.players.find((p) => p.id !== pr.player)!.id;
    expect(tryAct(def, s2, other, { type: 'respond', promptId: pr.id, answer: 'ore' }).ok).toBe(false);
    expect(tryAct(def, s2, pr.player, { type: 'endTurn' }).ok).toBe(false);
  });
});

describe('resource ops', () => {
  it('gain is limited by bank supply; pay failure aborts', () => {
    const { def, s: s0 } = setup([{ op: 'gain', resources: { ore: 50 } }]);
    const s = edit(s0, (c) => { c.bank.ore = 2; });
    const s2 = run(def, s);
    expect(P(s2, cur(s)).resources.ore - P(s, cur(s)).resources.ore).toBe(2);
    expect(s2.bank.ore).toBe(0);
    const { def: d2, s: t } = setup([{ op: 'gain', resources: { wool: 1 } }, { op: 'pay', resources: { ore: 99 } }]);
    expect(tryAct(d2, t, cur(t), { type: 'doAction', action: 't' }).ok).toBe(false);
  });

  it('transfer random/choice and steal move cards between players', () => {
    const { def, s: s0 } = setup([
      { op: 'choosePlayer', as: 'v' },
      { op: 'transfer', from: { var: 'v' }, to: 'self', resource: 'random', amount: 1 },
      { op: 'transfer', from: { var: 'v' }, to: 'self', resource: 'choice', amount: 1 },
      { op: 'steal', from: { var: 'v' } },
    ]);
    const me = cur(s0);
    const victim = s0.turnOrder.find((p) => p !== me)!;
    let s = edit(s0, (c) => { for (const p of c.players) for (const r of Object.keys(p.resources)) { c.bank[r] += p.resources[r]; p.resources[r] = 0; } });
    s = give(s, victim, { ore: 5 });
    let s2 = run(def, s);
    expect(s2.prompts[0].kind).toBe('player');
    s2 = act(def, s2, me, { type: 'respond', promptId: s2.prompts[0].id, answer: victim });
    expect(s2.prompts[0].player).toBe(victim); // giver chooses for 'choice'
    s2 = answer(def, s2);
    expect(P(s2, me).resources.ore).toBe(3);
    expect(P(s2, victim).resources.ore).toBe(2);
  });

  it('discard prompts for a resource map and validates it', () => {
    const { def, s: s0 } = setup([{ op: 'discard', player: 'self', amount: 2 }]);
    const me = cur(s0);
    const s = give(edit(s0, (c) => { const p = c.players.find((x) => x.id === me)!; for (const r of Object.keys(p.resources)) { c.bank[r] += p.resources[r]; p.resources[r] = 0; } }), me, { ore: 3 });
    let s2 = run(def, s);
    const pr = s2.prompts[0];
    expect(pr).toMatchObject({ kind: 'discard', amount: 2 });
    expect(tryAct(def, s2, me, { type: 'respond', promptId: pr.id, answer: { ore: 1 } }).ok).toBe(false);
    s2 = act(def, s2, me, { type: 'respond', promptId: pr.id, answer: { ore: 2 } });
    expect(P(s2, me).resources.ore).toBe(1);
  });

  it('chooseAndGain lets the player pick N resources', () => {
    const { def, s } = setup([{ op: 'chooseAndGain', amount: 2, options: ['brick', 'ore'] }]);
    let s2 = run(def, s);
    s2 = answer(def, s2, () => 'brick');
    s2 = answer(def, s2, () => 'ore');
    const a = P(s, cur(s)).resources; const b = P(s2, cur(s)).resources;
    expect([b.brick - a.brick, b.ore - a.ore]).toEqual([1, 1]);
  });
});

describe('piece ops', () => {
  it('place (prompted), upgrade, setPieceState, movePiece and remove', () => {
    const { def, s } = setup([
      { op: 'place', piece: 'road', free: true, as: 'r1' },
      { op: 'setPieceState', at: 'r1', key: 'hp', value: 3 },
      { op: 'upgrade', from: 'settlement', to: 'city', free: true },
      { op: 'movePiece', query: { piece: 'road', owner: 'self' }, from: { at: 'r1' } },
      { op: 'remove', query: { piece: 'road', owner: 'self' }, returnToSupply: false },
    ]);
    const me = cur(s);
    const roads0 = s.pieces.filter((p) => p.owner === me && p.type === 'road').length;
    let s2 = run(def, s);
    expect(s2.prompts[0]).toMatchObject({ kind: 'location', piece: 'road' });
    s2 = answer(def, s2);
    const placed = s2.pieces.filter((p) => p.owner === me && p.type === 'road');
    expect(placed.length).toBe(roads0 + 1);
    expect(placed.some((p) => p.state.hp === 3)).toBe(true);
    s2 = answer(def, s2); // upgrade location
    expect(s2.pieces.filter((p) => p.owner === me && p.type === 'city').length).toBe(1);
    s2 = answer(def, s2); // move-to location
    s2 = answer(def, s2); // remove which road
    expect(s2.pieces.filter((p) => p.owner === me && p.type === 'road').length).toBe(roads0);
    expect(P(s2, me).stats['lost:road']).toBe(1);
    expect(s2.stack).toEqual([]);
  });

  it('the remove op deletes a matching piece at a bound location and fires pieceRemoved', () => {
    const trig: TriggerDef = { id: 'rm', on: 'pieceRemoved', as: 'eventPlayer', do: [{ op: 'addStat', key: 'removed', amount: 1 }] };
    const { def, s } = setup([
      { op: 'choosePiece', as: 'x', query: { piece: 'settlement', owner: 'self' } },
      { op: 'remove', query: { piece: 'settlement' }, location: { at: 'x' } },
    ], { triggers: [trig] });
    const me = cur(s);
    let s2 = run(def, s);
    s2 = answer(def, s2);
    expect(s2.pieces.filter((p) => p.owner === me && p.type === 'settlement').length).toBe(1);
    expect(P(s2, me).stats.removed).toBe(1);
  });

  it('moveToken runs onMove with `at` bound', () => {
    const { def, s } = setup([{ op: 'moveToken', token: 'robber', as: 'where' }]);
    let s2 = run(def, s);
    const target = s2.prompts[0].options[0];
    expect(s2.prompts[0].options).not.toContain(s.tokens.robber);
    s2 = answer(def, s2);
    expect(s2.tokens.robber).toBe(target);
  });
});

describe('cards, scoring and state ops', () => {
  it('drawCard / giveCard / discardCard(choose) / shuffleDeck', () => {
    const { def, s } = setup([
      { op: 'drawCard', deck: 'dev', count: 2 },
      { op: 'giveCard', card: 'monopoly' },
      { op: 'discardCard', choose: true },
      { op: 'shuffleDeck', deck: 'dev' },
    ]);
    let s2 = run(def, s);
    expect(s2.prompts[0].kind).toBe('card');
    s2 = answer(def, s2);
    const me = P(s2, cur(s));
    expect(me.hand.length).toBe(2);
    expect(s2.decks.dev.discard.length).toBe(0);
    expect(s2.decks.dev.draw.length).toBe(24); // 25 - 2 drawn + 1 discarded (giveCard came from supply)
  });

  it('addVP, stats, globals, flags (until endOfTurn) and trade rates', () => {
    const { def, s } = setup([
      { op: 'addVP', amount: 2, reason: 'test' },
      { op: 'setStat', key: 'k', value: 4 }, { op: 'addStat', key: 'k', amount: 1 },
      { op: 'setGlobal', key: 'g', value: 2 }, { op: 'addGlobal', key: 'g', amount: 3 },
      { op: 'setFlag', flag: 'tmp', value: true, until: 'endOfTurn' },
      { op: 'setFlag', flag: 'perm', value: true },
      { op: 'grantTradeRate', resource: 'ore', ratio: 2, until: 'endOfTurn' },
    ]);
    const me = cur(s);
    let s2 = run(def, s);
    const p = P(s2, me);
    expect(p.tokenVP).toBe(2);
    expect(p.stats.k).toBe(5);
    expect(s2.globals.g).toBe(5);
    expect(p.flags.tmp.value && p.flags.perm.value).toBe(true);
    s2 = act(def, s2, me, { type: 'endTurn' });
    expect(P(s2, me).flags.tmp).toBeUndefined();
    expect(P(s2, me).flags.perm.value).toBe(true);
    expect(P(s2, me).tradeRates).toEqual([]);
  });

  it('win ends the game', () => {
    const { def, s } = setup([{ op: 'win' }]);
    const s2 = run(def, s);
    expect(s2.phase).toBe('gameOver');
    expect(s2.winner).toBe(cur(s));
    expect(tryAct(def, s2, cur(s), { type: 'endTurn' }).ok).toBe(false);
  });

  it('extraBuildPhase gives every other player a special build phase after the turn', () => {
    const trig: TriggerDef = { id: 'sbp', on: 'turnEnd', do: [{ op: 'extraBuildPhase' }] };
    const { def, s } = setup([], { triggers: [trig] });
    const order = s.turnOrder;
    const i0 = s.currentPlayerIndex;
    let s2 = act(def, s, order[i0], { type: 'endTurn' });
    expect(s2.phase).toBe('specialBuild');
    const builders: string[] = [];
    while (s2.phase === 'specialBuild') {
      builders.push(cur(s2));
      expect(tryAct(def, s2, cur(s2), { type: 'rollDice' }).ok).toBe(false);
      s2 = act(def, s2, cur(s2), { type: 'endTurn' });
    }
    expect(builders).toEqual([1, 2].map((k) => order[(i0 + k) % 3]));
    expect(s2.phase).toBe('preRoll');
    expect(cur(s2)).toBe(order[(i0 + 1) % 3]);
  });
});
