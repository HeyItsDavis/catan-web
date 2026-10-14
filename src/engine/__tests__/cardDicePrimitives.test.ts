/**
 * Unit tests for `takeCard` (move a card between hands: random or the taker chooses) and
 * `rollDice.values` (fixed numeric dice, e.g. the C&K Alchemist).
 */
import { describe, expect, it } from 'vitest';
import { validateMod, type Effect, type GameDefinition, type GameState, type ModDef } from '../index';
import { baseMod } from '../../content/base';
import { act, edit, newGame, withMods } from './helpers';

const testMod = (actions: Record<string, Effect[]>, extra: Partial<ModDef> = {}): ModDef => ({
  meta: { id: 'cd', name: 'cd', version: '1', extends: ['base'] },
  setup: [],
  actions: Object.entries(actions).map(([id, effect]) => ({ id, name: id, available: true, effect })),
  ...extra,
});

const P = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const respond = (def: GameDefinition, s: GameState, a: string | null) =>
  act(def, s, s.prompts[0].player, { type: 'respond', promptId: s.prompts[0].id, answer: a });
const hand = (s: GameState, pid: string, cards: [string, string][]) => edit(s, (c) => {
  P(c, pid).hand = cards.map(([card, deck], i) => ({ id: `h${pid}${i}`, card, deck, acquiredTurn: 0 }));
});

describe('takeCard', () => {
  const m = testMod({
    spy: [{ op: 'takeCard', from: { var: 'target' }, choose: true }],
    thief: [{ op: 'takeCard', from: { var: 'target' } }],
    devOnly: [{ op: 'takeCard', from: { var: 'target' }, deck: 'other', choose: true }],
  }, { decks: [{ id: 'other', name: 'Other', cards: [{ card: 'monopoly', count: 1 }], handLimit: 1 }] });
  const def = withMods(m);
  // bind `target` = p2 through a wrapper action
  const withTarget = (id: string): ModDef => ({ ...m, actions: [{ id: 'go', name: 'go', available: true, effect: [
    { op: 'choosePlayer', as: 'target', filter: { samePlayer: [{ var: 'target' }, { var: 'target' }] } },
    ...(m.actions!.find((a) => a.id === id)!.effect),
  ] }] });
  const run = (mod: ModDef, s: GameState) => {
    const d = withMods(mod);
    let st = act(d, s, 'p1', { type: 'doAction', action: 'go' });
    st = respond(d, st, 'p2');
    return { d, st };
  };
  const base = () => hand(edit(newGame(4, 2, def), (c) => { c.phase = 'main'; c.hasRolled = true; }), 'p2', [['knight', 'dev'], ['monopoly', 'dev'], ['yearOfPlenty', 'dev']]);

  it('validates', () => {
    expect(validateMod(m, [baseMod]).filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('choose: the taker sees the cards (names) and picks one; it becomes newly acquired', () => {
    const { d, st } = run(withTarget('spy'), base());
    expect(st.prompts[0]).toMatchObject({ player: 'p1', kind: 'card', options: ['hp20', 'hp21', 'hp22'], optionLabels: ['Knight', 'Monopoly', 'Year of Plenty'] });
    const s2 = respond(d, st, 'hp21');
    expect(P(s2, 'p1').hand.map((c) => c.card)).toEqual(['monopoly']);
    expect(P(s2, 'p1').hand[0].acquiredTurn).toBe(s2.turn);
    expect(P(s2, 'p2').hand.map((c) => c.card)).toEqual(['knight', 'yearOfPlenty']);
  });

  it('random take (no prompt) and deck filter; receiving respects the deck hand limit', () => {
    const r1 = run(withTarget('thief'), base());
    expect(r1.st.prompts).toEqual([]);
    expect(P(r1.st, 'p1').hand).toHaveLength(1);
    expect(P(r1.st, 'p2').hand).toHaveLength(2);
    // only 'other' deck cards are eligible; p1 already holds one (limit 1) -> must discard one
    let s = hand(base(), 'p2', [['knight', 'dev'], ['monopoly', 'other']]);
    s = hand(s, 'p1', [['monopoly', 'other']]);
    const r2 = run(withTarget('devOnly'), s);
    expect(P(r2.st, 'p2').hand.map((c) => c.deck)).toEqual(['dev']);
    expect(r2.st.prompts[0]).toMatchObject({ player: 'p1', kind: 'card' });
    const s3 = respond(r2.d, r2.st, r2.st.prompts[0].options[0]);
    expect(P(s3, 'p1').hand).toHaveLength(1);
  });

  it('nothing to take: no prompt, no change', () => {
    const { st } = run(withTarget('spy'), hand(base(), 'p2', []));
    expect(st.prompts).toEqual([]);
    expect(P(st, 'p1').hand).toEqual([]);
  });
});

describe('rollDice values', () => {
  const m = testMod({}, {
    dice: { numeric: [{ sides: 6 }, { sides: 6 }], eventDice: [{ id: 'ev', faces: ['a', 'b'] }] },
    cards: [{ id: 'fix', name: 'Fix', description: 'x', play: { timing: 'ownTurnBeforeRoll', notOnAcquiredTurn: false },
      effect: [{ op: 'rollDice', values: [{ add: [1, 1] }, 9] }] }],
    decks: [{ id: 'fx', name: 'fx', cards: [{ card: 'fix', count: 1 }] }],
    triggers: [{ id: 'seen', on: 'diceRolled', do: [{ op: 'setStat', key: 'sum', value: { var: 'total' } }] }],
  });
  const def = withMods(m);

  it('validates', () => {
    expect(validateMod(m, [baseMod]).filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('fixes the numeric dice (clamped to the die), still rolls the event die, enters the main phase', () => {
    let s = edit(newGame(2, 2, def), (c) => {
      c.phase = 'preRoll'; c.hasRolled = false;
      P(c, 'p1').hand = [{ id: 'cf', card: 'fix', deck: 'fx', acquiredTurn: 0 }];
    });
    s = act(def, s, 'p1', { type: 'playCard', cardInstance: 'cf' });
    expect(s.lastRoll).toMatchObject({ dice: [2, 6], total: 8 });
    expect(['a', 'b']).toContain(s.lastRoll!.event![0]);
    expect(s.phase).toBe('main');
    expect(P(s, 'p1').stats.sum).toBe(8);
  });

  it('missing values roll normally', () => {
    const d2 = withMods({ ...m, cards: [{ ...m.cards![0], effect: [{ op: 'rollDice', values: [4] }] }] });
    let s = edit(newGame(2, 2, d2), (c) => {
      c.phase = 'preRoll'; c.hasRolled = false;
      P(c, 'p1').hand = [{ id: 'cf', card: 'fix', deck: 'fx', acquiredTurn: 0 }];
    });
    s = act(d2, s, 'p1', { type: 'playCard', cardInstance: 'cf' });
    expect(s.lastRoll!.dice[0]).toBe(4);
    expect(s.lastRoll!.dice[1]).toBeGreaterThanOrEqual(1);
  });
});
