/**
 * Small generic primitives added for the Traders & Barbarians / Explorers & Pirates content:
 *  - Expr `hexNumber`: the number token on a hex.
 *  - Condition `atPort`: a location touches a harbor.
 *  - Effect `removeToken`: take a token off the board.
 */
import { describe, expect, it } from 'vitest';
import { topology, validateMod, type ModDef } from '../index';
import { baseMod } from '../../content/base';
import { act, edit, newGame, withMods } from './helpers';

const probe: ModDef = {
  meta: { id: 'probe', name: 'probe', version: '0', extends: ['base'] },
  actions: [
    { id: 'numberHere', name: 'n', available: true, effect: [
      { op: 'chooseLocation', kind: 'hex', as: 'h', filter: { cmp: [{ hexNumber: 'h' }, '==', 6] } },
      { op: 'setStat', key: 'n', value: { hexNumber: 'h' } },
    ] },
    { id: 'harbors', name: 'h', available: true, effect: [
      { op: 'forEachLocation', kind: 'vertex', as: 'v', filter: { atPort: { at: 'v' } }, do: [{ op: 'addStat', key: 'harborCorners', amount: 1 }] },
      { op: 'forEachLocation', kind: 'edge', as: 'e', filter: { atPort: { at: 'e', port: 'port-any' } }, do: [{ op: 'addStat', key: 'genericEdges', amount: 1 }] },
      { op: 'forEachLocation', kind: 'hex', as: 'x', filter: { atPort: { at: 'x' } }, do: [{ op: 'addStat', key: 'harborHexes', amount: 1 }] },
    ] },
    { id: 'shoo', name: 's', available: true, effect: [{ op: 'removeToken', token: 'robber' }] },
  ],
  triggers: [{ id: 'seen', on: 'tokenMoved', when: { not: { varSet: 'at' } }, do: [{ op: 'addStat', key: 'offBoard', amount: 1 }] }],
};

describe('scenario primitives', () => {
  const def = withMods(probe);
  const main = () => edit(newGame(4, 2, def), (c) => { c.phase = 'main'; c.hasRolled = true; c.prompts = []; c.stack = []; delete c.setupProgress; });
  const P = (s: ReturnType<typeof main>) => s.players.find((p) => p.id === 'p1')!;

  it('validates', () => {
    expect(validateMod(probe, [baseMod]).filter((p) => p.severity === 'error')).toEqual([]);
    const bad: ModDef = { ...probe, meta: { ...probe.meta, id: 'bad' }, actions: [{ id: 'x', name: 'x', available: { atPort: { at: 'at', port: 'nope' } }, effect: [{ op: 'removeToken', token: 'ghost' }] }] };
    const errs = validateMod(bad, [baseMod]).filter((p) => p.severity === 'error').map((p) => p.message);
    expect(errs).toEqual(expect.arrayContaining(['Unknown port "nope"', 'Unknown token "ghost"']));
  });

  it('hexNumber reads a hex number token (0 when none)', () => {
    let s = main();
    s = act(def, s, 'p1', { type: 'doAction', action: 'numberHere' });
    expect(s.prompts[0].options.length).toBe(2); // two 6s on the standard board
    expect(s.prompts[0].options.every((h) => s.hexes[h].number === 6)).toBe(true);
    s = act(def, s, 'p1', { type: 'respond', promptId: s.prompts[0].id, answer: s.prompts[0].options[0] });
    expect(P(s).stats.n).toBe(6);
  });

  it('atPort matches harbor corners, coast edges and harbor hexes', () => {
    let s = main();
    s = act(def, s, 'p1', { type: 'doAction', action: 'harbors' });
    expect(P(s).stats.harborCorners).toBe(18); // 9 harbors x 2 corners
    expect(P(s).stats.genericEdges).toBe(4);
    expect(P(s).stats.harborHexes).toBe(9);
    const port = s.ports[0];
    expect(topology.hexCorners(topology.parseHexId(port.hex))).toEqual(expect.arrayContaining(port.vertices));
  });

  it('removeToken takes the robber off the board and fires tokenMoved with no location', () => {
    let s = main();
    expect(s.tokens.robber).not.toBeNull();
    s = act(def, s, 'p1', { type: 'doAction', action: 'shoo' });
    expect(s.tokens.robber).toBeNull();
    expect(P(s).stats.offBoard).toBe(1);
    s = act(def, s, 'p1', { type: 'doAction', action: 'shoo' }); // already off: nothing happens
    expect(P(s).stats.offBoard).toBe(1);
  });
});
