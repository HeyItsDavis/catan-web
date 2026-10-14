import { createContext, useContext } from 'react';
import type { GameDefinition, ModDef } from '../../engine/schema';
import { EVENTS } from '../../editor/catalog';
import type { DescribeContext } from '../../editor/describe';
import { emptyDefinition } from '../../editor/merge';
import { walkCondition, walkEffects, walkExpr, type WalkVisitor } from '../../editor/walk';

export interface Suggestions {
  stat: string[];
  global: string[];
  flag: string[];
  pieceState: string[];
  event: string[];
}

export interface EditorCtx {
  /** Merged definition including the mod being edited. */
  def: GameDefinition;
  /** Merged definition of everything the mod extends ("base"). */
  parent: GameDefinition;
  dctx: DescribeContext;
  /** Formatted path the validation panel asked to reveal. */
  focusPath: string | null;
  suggestions: Suggestions;
  library: ModDef[];
}

export const EditorContext = createContext<EditorCtx>({
  def: emptyDefinition(),
  parent: emptyDefinition(),
  dctx: {},
  focusPath: null,
  suggestions: { stat: [], global: [], flag: [], pieceState: [], event: [] },
  library: [],
});

export function useEditor(): EditorCtx {
  return useContext(EditorContext);
}

/** Collect key names (stats, globals, flags, piece state, custom events) used anywhere in the definition. */
export function collectSuggestions(def: GameDefinition): Suggestions {
  const sets = { stat: new Set<string>(), global: new Set<string>(), flag: new Set<string>(), pieceState: new Set<string>(), event: new Set<string>() };
  const v: WalkVisitor = {
    param(p, value) {
      if (typeof value !== 'string' || !value) return;
      if (p.kind === 'key' && p.keySpace) sets[p.keySpace].add(value);
      if (p.kind === 'event') sets.event.add(value);
    },
  };
  for (const c of def.cards) { walkEffects(c.effect, [], [], v); walkCondition(c.play?.cond, [], [], v); if (c.countsAs) sets.stat.add(c.countsAs); }
  for (const a of def.actions) { walkEffects(a.effect, [], [], v); walkCondition(a.available, [], [], v); }
  for (const t of def.triggers) { walkEffects(t.do, [], [], v); walkCondition(t.when, [], [], v); sets.event.add(t.on); }
  for (const t of def.tokens) { walkEffects(t.onMove ?? [], [], [], v); walkCondition(t.where, [], [], v); }
  for (const p of def.pieces) {
    walkCondition(p.placement?.where, [], [], v);
    Object.keys(p.initialState ?? {}).forEach(k => sets.pieceState.add(k));
    for (const t of p.triggers ?? []) { walkEffects(t.do, [], [], v); sets.event.add(t.on); }
  }
  for (const a of def.awards) walkExpr(a.metric, [], [], v);
  for (const e of Object.keys(EVENTS)) sets.event.delete(e);
  const sorted = (s: Set<string>) => [...s].sort();
  return { stat: sorted(sets.stat), global: sorted(sets.global), flag: sorted(sets.flag), pieceState: sorted(sets.pieceState), event: sorted(sets.event) };
}
