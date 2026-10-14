import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModDef } from '../engine/schema';
import { createHistory, pushHistory, redo, undo } from './history';
import { dependencyChain, mergeMods } from './merge';
import { formatPath, getIn, parsePath, setIn, slugify, uniqueId } from './paths';
import { TEMPLATES, applyTemplate } from './templates';
import { checkMod } from './validate';
import { eventScope, innerScope, scopeAt, setupScope } from './vars';
import { EVENT_PAYLOAD_VARS } from '../engine/schema';
import { deleteMod, getMod, listModDefs as listMods, saveMod } from '../ui/shared/modLibrary';

const base: ModDef = {
  meta: { id: 'base', name: 'Base', version: '1' },
  resources: [{ id: 'brick', name: 'Brick', color: '#a00', kind: 'resource', bankSupply: 19 }],
  terrains: [{ id: 'hills', name: 'Hills', color: '#a50', produces: { brick: 1 }, numbered: true }],
  pieces: [
    { id: 'road', name: 'Road', supply: 15, placement: { on: 'edge', where: true } },
    { id: 'settlement', name: 'Settlement', supply: 5, placement: { on: 'vertex', where: true } },
  ],
  cards: [{ id: 'knight', name: 'Knight', description: '', play: { timing: 'ownTurn' }, effect: [] }],
  decks: [{ id: 'dev', name: 'Dev', cards: [{ card: 'knight', count: 14 }] }],
};

const mk = (extra: Partial<ModDef> = {}): ModDef => ({ meta: { id: 'm', name: 'M', version: '0.1.0', extends: ['base'] }, ...extra });

describe('paths', () => {
  it('format / parse roundtrip', () => {
    const p = ['cards', 2, 'effect', 0, 'do', 1, 'piece'];
    expect(formatPath(p)).toBe('cards[2].effect[0].do[1].piece');
    expect(parsePath('cards[2].effect[0].do[1].piece')).toEqual(p);
    expect(parsePath('/cards/2/effect/0/do/1/piece')).toEqual(p);
    expect(parsePath('cards.2.effect.0')).toEqual(['cards', 2, 'effect', 0]);
  });
  it('setIn is immutable and deletes undefined keys', () => {
    const o = { a: { b: [1, 2] }, c: 1 };
    const n = setIn(o, ['a', 'b', 1], 5);
    expect(n.a.b).toEqual([1, 5]);
    expect(o.a.b).toEqual([1, 2]);
    expect(setIn(o, ['c'], undefined)).toEqual({ a: { b: [1, 2] } });
    expect(getIn(n, ['a', 'b', 1])).toBe(5);
  });
  it('slugify / uniqueId', () => {
    expect(slugify('Year of Plenty!')).toBe('year-of-plenty');
    expect(slugify('Café  Noir')).toBe('cafe-noir');
    expect(uniqueId('x', ['x', 'x-2'])).toBe('x-3');
  });
});

describe('history', () => {
  it('undo / redo / coalesce', () => {
    let h = createHistory(1);
    h = pushHistory(h, 2, 'a', 0);
    h = pushHistory(h, 3, 'a', 100);   // coalesced
    h = pushHistory(h, 4, 'b', 200);
    expect(h.past).toEqual([1, 3]);
    h = undo(h);
    expect(h.present).toBe(3);
    h = undo(h);
    expect(h.present).toBe(1);
    h = redo(h);
    expect(h.present).toBe(3);
    h = pushHistory(h, 9, 'c', 5000);
    expect(h.future).toEqual([]);
  });
});

describe('merge', () => {
  it('replaces, adds and removes by id', () => {
    const mod = mk({
      pieces: [{ id: 'road', name: 'Big road', supply: 5, placement: { on: 'edge', where: true } }, { id: 'ship', name: 'Ship', supply: 15, placement: { on: 'edge', where: true } }],
      remove: { cards: ['knight'] },
      victoryPoints: 12,
    });
    const def = mergeMods([base, mod]);
    expect(def.pieces.map(p => p.name)).toEqual(['Big road', 'Settlement', 'Ship']);
    expect(def.cards).toEqual([]);
    expect(def.victoryPoints).toBe(12);
  });
  it('resolves extends chains', () => {
    const a = { meta: { id: 'a', name: 'A', version: '1', extends: ['base'] } };
    const b = { meta: { id: 'b', name: 'B', version: '1', extends: ['a'] } };
    expect(dependencyChain(b, [base, a, b]).map(m => m.meta.id)).toEqual(['base', 'a']);
  });
});

describe('vars', () => {
  it('earlier binds and loop vars', () => {
    const list = [
      { op: 'choosePlayer', as: 'victim' },
      { op: 'repeat', times: 2, as: 'i', do: [] },
      { op: 'steal', from: { var: 'victim' } },
    ] as const;
    const l = list as unknown as import('../engine/schema').Effect[];
    expect(scopeAt(l, 2, []).map(v => v.name)).toEqual(['victim']);
    expect(innerScope(l[1], 'do', []).map(v => v.name)).toEqual(['i']);
    // Choose filters see the candidate under the op's own `as` name (engine/schema.ts binding rules).
    expect(innerScope({ op: 'chooseLocation', as: 'loc', kind: 'hex', filter: true }, 'filter', []).map(v => v.name)).toEqual(['loc']);
    expect(innerScope({ op: 'choosePlayer', as: 'victim' }, 'filter', [])).toEqual([expect.objectContaining({ name: 'victim', type: 'player' })]);
    expect(innerScope({ op: 'choosePiece', as: 'k', query: {} }, 'filter', [])).toEqual([expect.objectContaining({ name: 'k', type: 'location' })]);
    // LocationChoice.where sees `at`.
    expect(innerScope({ op: 'place', piece: 'road' }, 'location', []).map(v => v.name)).toEqual(['at']);
  });

  it('event payload vars follow the engine', () => {
    for (const [ev, names] of Object.entries(EVENT_PAYLOAD_VARS)) {
      expect(eventScope(ev).map(v => v.name)).toEqual([...names, 'event']);
    }
    expect(eventScope('piecePlaced').find(v => v.name === 'at')?.type).toBe('location');
    expect(eventScope('myCustomEvent').map(v => v.name)).toEqual(['player', 'event']);
    expect(setupScope().map(v => v.name)).toEqual(['at', 'lastPlaced']);
  });
});

describe('checkMod', () => {
  it('a clean mod has no errors', () => {
    const mod = mk({ cards: [{ id: 'c', name: 'C', description: '', play: { timing: 'never' }, effect: [{ op: 'gain', resources: { brick: 1 } }] }] });
    expect(checkMod(mod, [base]).filter(i => i.severity === 'error')).toEqual([]);
  });

  it('finds dangling refs, duplicates, unknown ops and unbound vars with paths', () => {
    const mod = mk({
      cards: [
        { id: 'c', name: 'C', description: '', play: { timing: 'ownTurn' }, effect: [
          { op: 'place', piece: 'castle' },
          { op: 'steal', from: { var: 'victim' } },
          { op: 'bogus' } as never,
          { op: 'gain', resources: { gold: 1 } },
        ] },
        { id: 'c', name: 'Dup', description: '', play: { timing: 'never' }, effect: [] },
      ],
      remove: { pieces: ['nothing'] },
    });
    const issues = checkMod(mod, [base]);
    const at = (p: string) => issues.filter(i => i.path === p).map(i => i.message).join(' | ');
    expect(at('cards[0].effect[0].piece')).toMatch(/Unknown piece “castle”/);
    expect(at('cards[0].effect[1].from.var')).toMatch(/isn’t set/);
    expect(at('cards[0].effect[2]')).toMatch(/Unknown step/);
    expect(at('cards[0].effect[3].resources.gold')).toMatch(/Unknown resource/);
    expect(at('cards[1].id')).toMatch(/Duplicate/);
    expect(at('remove.pieces[0]')).toMatch(/Nothing called/);
    expect(at('cards[0]')).toMatch(/isn’t in any deck/);
  });

  it('vars bound earlier and trigger payload vars are fine', () => {
    const mod = mk({
      triggers: [{ id: 't', on: 'diceRolled', when: { cmp: [{ var: 'total' }, '==', 7] }, do: [
        { op: 'choosePlayer', as: 'victim' },
        { op: 'steal', from: { var: 'victim' } },
      ] }],
    });
    expect(checkMod(mod, [base])).toEqual([]);
  });
});

describe('templates', () => {
  it('every template produces a mod without errors', () => {
    const def = mergeMods([base]);
    for (const t of TEMPLATES) {
      let mod = mk();
      const res = t.make({ def, mod });
      mod = applyTemplate(mod, res);
      const list = (mod[res.focus.collection] ?? []) as { id: string }[];
      expect(list.some(x => x.id === res.focus.id), t.id).toBe(true);
      const errors = checkMod(mod, [base]).filter(i => i.severity === 'error');
      expect(errors, t.id).toEqual([]);
    }
  });
});

describe('modLibrary', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('save / list / get / delete', () => {
    expect(listMods()).toEqual([]);
    saveMod(mk());
    saveMod({ ...mk(), meta: { ...mk().meta, name: 'Renamed' } });
    saveMod({ meta: { id: 'other', name: 'O', version: '1' } });
    expect(listMods().map(m => m.meta.id)).toEqual(['m', 'other']);
    expect(getMod('m')?.meta.name).toBe('Renamed');
    deleteMod('m');
    expect(listMods().map(m => m.meta.id)).toEqual(['other']);
    expect(localStorage.getItem('catanweb:mods')).toContain('other');
  });
});

describe('editor ↔ engine sync', () => {
  it('the real base mod passes the editor checks and the engine validator', async () => {
    const { baseMod } = await import('../content/base');
    const { validateAll } = await import('./validate');
    const errors = checkMod(baseMod, []).filter(i => i.severity === 'error' && i.path !== 'meta.id'); // 'base' id is reserved for mods
    expect(errors).toEqual([]);
    const mod: ModDef = { meta: { id: 'm', name: 'M', version: '1', extends: ['base'] } };
    const res = validateAll(mod, [baseMod]);
    expect(res.engineStatus).toBe('ok');
    expect(res.issues.filter(i => i.severity === 'error')).toEqual([]);
  });

  it('reference ids resolve from the real base mod', async () => {
    const { baseMod } = await import('../content/base');
    const { fullDefinition } = await import('./merge');
    const def = fullDefinition({ meta: { id: 'm', name: 'M', version: '1', extends: ['base'] } }, [baseMod]);
    expect(def.resources.map(r => r.id)).toEqual(['brick', 'lumber', 'wool', 'grain', 'ore']);
    expect(def.pieces.map(p => p.id)).toEqual(expect.arrayContaining(['road', 'settlement', 'city']));
    expect(def.decks.map(d => d.id)).toContain('dev');
  });
});
