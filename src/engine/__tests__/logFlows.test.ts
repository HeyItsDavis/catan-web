/** Structured log data (LogEntry.kind / flows / dice / piece) and its redaction. */
import { describe, expect, it } from 'vitest';
import { redactFor, type GameState, type LogEntry, type ModDef } from '../index';
import { act, answer, baseDef, cur, edit, finishSetup, give, newGame, withMods } from './helpers';

const sum = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
const newEntries = (before: GameState, after: GameState): LogEntry[] => after.log.slice(before.log.length);

describe('log flows', () => {
  it('starting resources: one production line per player, flows from the bank tagged with the hex', () => {
    const s = finishSetup(baseDef, newGame(3));
    const lines = s.log.filter((e) => e.kind === 'production');
    expect(lines.length).toBeGreaterThan(0);
    for (const e of lines) {
      const p = s.players.find((x) => x.id === e.player)!;
      for (const f of e.flows!) {
        expect(f.from).toBe('bank');
        expect(f.to).toBe(p.id);
        expect(f.at).toMatch(/^h:/);
        expect(s.hexes[f.at!]).toBeTruthy();
      }
    }
    // Everything a player holds after setup came through these flows.
    for (const p of s.players) {
      const got: Record<string, number> = {};
      for (const e of lines) for (const f of e.flows ?? []) if (f.to === p.id) for (const [r, n] of Object.entries(f.res)) got[r] = (got[r] ?? 0) + n;
      expect(got).toEqual(Object.fromEntries(Object.entries(p.resources).filter(([, n]) => n > 0)));
    }
  });

  it('dice roll: a roll line with the dice, then production attributed to hexes with that number', () => {
    let seen = 0;
    for (let seed = 1; seed < 30 && seen < 3; seed++) {
      let s = finishSetup(baseDef, newGame(seed));
      const before = s;
      s = act(baseDef, s, cur(s), { type: 'rollDice' });
      const added = newEntries(before, s);
      const roll = added.find((e) => e.kind === 'roll')!;
      expect(roll.dice).toEqual(s.lastRoll!.dice);
      expect(roll.player).toBe(cur(s));
      for (const e of added.filter((x) => x.kind === 'production')) {
        seen++;
        for (const f of e.flows!) {
          expect(f.from).toBe('bank');
          expect(s.hexes[f.at!].number).toBe(s.lastRoll!.total);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('build: the cost flows to the bank on the build line', () => {
    let s = finishSetup(baseDef, newGame(2));
    const pid = cur(s);
    s = act(baseDef, s, pid, { type: 'rollDice' });
    while (s.prompts.length) s = answer(baseDef, s); // a 7: discard / robber
    s = give(s, pid, { brick: 1, lumber: 1 });
    s = act(baseDef, s, pid, { type: 'build', piece: 'road' });
    const before = s;
    s = answer(baseDef, s);
    const line = newEntries(before, s).find((e) => e.kind === 'build')!;
    expect(line).toMatchObject({ piece: 'road', player: pid });
    expect(line.at).toMatch(/^e:/);
    expect(line.flows).toEqual([{ from: pid, to: 'bank', res: { brick: 1, lumber: 1 } }]);
  });

  it('bank trade: give to the bank and get from it', () => {
    let s = finishSetup(baseDef, newGame(4));
    const pid = cur(s);
    s = act(baseDef, s, pid, { type: 'rollDice' });
    while (s.prompts.length) s = answer(baseDef, s);
    s = edit(s, (c) => { c.players.find((p) => p.id === pid)!.resources.ore = 4; });
    const before = s;
    s = act(baseDef, s, pid, { type: 'bankTrade', give: { ore: 4 }, get: { wool: 1 } });
    const line = newEntries(before, s).find((e) => e.kind === 'bankTrade')!;
    expect(line.flows).toEqual([
      { from: pid, to: 'bank', res: { ore: 4 } },
      { from: 'bank', to: pid, res: { wool: 1 } },
    ]);
  });

  const thief: ModDef = {
    meta: { id: 'thief', name: 'Thief', version: '1', extends: ['base'] },
    actions: [
      { id: 'rob', name: 'Rob', available: true, effect: [{ op: 'choosePlayer', as: 'v' }, { op: 'steal', from: { var: 'v' }, amount: 2 }] },
      { id: 'tax', name: 'Tax', available: true, effect: [{ op: 'pay', resources: { grain: 1 } }] },
    ],
  };

  it('steal: hidden flow, only the two players involved see the resource types', () => {
    const def = withMods(thief);
    let s = finishSetup(def, newGame(5, 3, def));
    const pid = cur(s);
    s = act(def, s, pid, { type: 'rollDice' });
    while (s.prompts.length) s = answer(def, s);
    const victim = s.turnOrder.find((x) => x !== pid)!;
    const third = s.turnOrder.find((x) => x !== pid && x !== victim)!;
    s = edit(s, (c) => { c.players.find((p) => p.id === victim)!.resources = { brick: 0, lumber: 0, wool: 3, grain: 0, ore: 0 }; });
    s = act(def, s, pid, { type: 'doAction', action: 'rob' });
    const before = s;
    s = act(def, s, pid, { type: 'respond', promptId: s.prompts[0].id, answer: victim });
    const line = newEntries(before, s).find((e) => e.kind === 'steal')!;
    expect(line.flows).toEqual([{ from: victim, to: pid, res: { wool: 2 }, hidden: true }]);
    const flowFor = (viewer: string | null) => redactFor(def, s, viewer).log.find((e) => e.kind === 'steal' && e.text === line.text)!.flows![0];
    expect(flowFor(pid).res).toEqual({ wool: 2 });
    expect(flowFor(victim).res).toEqual({ wool: 2 });
    expect(flowFor(third).res).toEqual({ '?': 2 });
    expect(flowFor(null).res).toEqual({ '?': 2 });
    // Public flows are untouched by redaction.
    const prod = redactFor(def, s, third).log.find((e) => e.kind === 'production' && e.player !== third)!;
    expect(sum(prod.flows![0].res)).toBeGreaterThan(0);
    expect(Object.keys(prod.flows![0].res)).not.toContain('?');
  });

  it('movements no line describes get a "flow" line of their own', () => {
    const def = withMods(thief);
    let s = finishSetup(def, newGame(6, 3, def));
    const pid = cur(s);
    s = act(def, s, pid, { type: 'rollDice' });
    while (s.prompts.length) s = answer(def, s);
    s = edit(s, (c) => { c.players.find((p) => p.id === pid)!.resources.grain = 2; });
    const before = s;
    s = act(def, s, pid, { type: 'doAction', action: 'tax' });
    const line = newEntries(before, s).find((e) => e.kind === 'flow')!;
    expect(line.flows).toEqual([{ from: pid, to: 'bank', res: { grain: 1 } }]);
    expect(line.text).toMatch(/pays 1 Grain/);
  });
});
