/** Server-render smoke test: every tab, form and catalog block renders without throwing. */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CollectionKey, Effect, ModDef } from '../../engine/schema';
import { CONDITIONS, EFFECTS, EXPRS } from '../../editor/catalog';
import { contextFromDefinition } from '../../editor/describe';
import { COLLECTION_KEYS, fullDefinition, parentDefinition } from '../../editor/merge';
import { TEMPLATES, applyTemplate } from '../../editor/templates';
import { ConditionEditor, EffectsField, ExprEditor } from './blocks';
import { CollectionTab } from './collection';
import { EditorContext, collectSuggestions, type EditorCtx } from './context';
import ModEditor from './ModEditor';
import { RulesTab } from './rules';

const base: ModDef = {
  meta: { id: 'base', name: 'Base', version: '1' },
  resources: [{ id: 'brick', name: 'Brick', color: '#a00', kind: 'resource', bankSupply: 19 }],
  terrains: [{ id: 'hills', name: 'Hills', color: '#a50', produces: { brick: 1 }, numbered: true }],
  pieces: [{ id: 'road', name: 'Road', supply: 15, placement: { on: 'edge', where: true } }],
  cards: [{ id: 'knight', name: 'Knight', description: '', play: { timing: 'ownTurn' }, effect: [] }],
  decks: [{ id: 'dev', name: 'Dev', cards: [{ card: 'knight', count: 14 }] }],
  tokens: [{ id: 'robber', name: 'Robber', on: 'hex', where: true }],
  ports: [{ id: 'any3', resource: 'any', ratio: 3 }],
};

function buildMod(): ModDef {
  let mod: ModDef = { meta: { id: 'm', name: 'M', version: '0.1.0', extends: ['base'] } };
  for (const t of TEMPLATES) mod = applyTemplate(mod, t.make({ def: fullDefinition(mod, [base]), mod }));
  mod.maps = [{ id: 'map', name: 'Map', minPlayers: 3, maxPlayers: 4, hexes: [{ q: 0, r: 0, terrain: '@land', number: '@', port: { port: 'any3', side: 1 } }], terrainBags: { land: ['hills'] }, numberBag: [6] }];
  mod.setup = [{ place: [{ piece: 'road', free: true }], order: 'forward' }];
  mod.dice = { numeric: [{ sides: 6 }], eventDice: [{ id: 'ev', faces: ['a'] }] };
  mod.remove = { cards: ['knight'] };
  return mod;
}

function ctxFor(mod: ModDef): EditorCtx {
  const def = fullDefinition(mod, [base]);
  return { def, parent: parentDefinition(mod, [base]), dctx: contextFromDefinition(def), focusPath: null, suggestions: collectSuggestions(def), library: [] };
}

const render = (ctx: EditorCtx, el: React.ReactElement) =>
  renderToStaticMarkup(<EditorContext.Provider value={ctx}>{el}</EditorContext.Provider>);

describe('editor UI smoke', () => {
  const mod = buildMod();
  const ctx = ctxFor(mod);

  it('renders the shell (empty library → welcome)', () => {
    expect(renderToStaticMarkup(<ModEditor />)).toContain('Create your first mod');
  });

  it('renders the full shell for a mod in the library', () => {
    const store = new Map<string, string>([['catanweb:mods', JSON.stringify([mod])]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
    try {
      const html = renderToStaticMarkup(<ModEditor />);
      expect(html).toContain('About this mod');
      expect(html).toContain('Start from a template');
      for (const k of COLLECTION_KEYS) expect(html).toContain(`>${k.charAt(0).toUpperCase()}`);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(COLLECTION_KEYS)('renders the %s tab with its first item', k => {
    const html = render(ctx, <CollectionTab k={k as CollectionKey} mod={mod} onChange={() => {}} selected={0} onSelect={() => {}} />);
    expect(html.length).toBeGreaterThan(100);
  });

  it('renders the rules tab', () => {
    expect(render(ctx, <RulesTab mod={mod} onChange={() => {}} />)).toContain('Setup rounds');
  });

  it('renders every effect block with a plain-language preview', () => {
    const effects = Object.values(EFFECTS).map(s => s.make() as Effect);
    const html = render(ctx, <EffectsField value={effects} onChange={() => {}} path={['cards', 0, 'effect']} scope={[]} />);
    expect(html).toContain('In plain words');
    for (const s of Object.values(EFFECTS)) expect(html).toContain(s.label.replace(/&/g, '&amp;'));
  });

  it('renders every condition and expr block', () => {
    for (const s of Object.values(CONDITIONS)) render(ctx, <ConditionEditor value={s.make()} onChange={() => {}} path={['x']} scope={[]} />);
    for (const s of Object.values(EXPRS)) render(ctx, <ExprEditor value={s.make()} onChange={() => {}} path={['x']} scope={[]} />);
  });
});
