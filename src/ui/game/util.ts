/** Small data helpers shared across game UI components. */
import type { CardInstance, Expr, GameDefinition, Id, PlayerState, ResourceDef, ResourceMap } from '../../engine/schema';

/** Key used by redactFor for a hidden resource total. */
export const HIDDEN_KEY = '?';
/** Card id used by redactFor for hidden hand cards. */
export const HIDDEN_CARD = 'hidden';

export function byId<T extends { id: string }>(list: T[], id: string | undefined): T | undefined {
  return id === undefined ? undefined : list.find((x) => x.id === id);
}

/** Total resource cards held; works for full and redacted maps. */
export function resourceTotal(p: PlayerState): number {
  return Object.values(p.resources).reduce((a, b) => a + (b || 0), 0);
}

/** True if the resources map is the redacted {'?': n} form. */
export function isRedacted(p: PlayerState): boolean {
  return HIDDEN_KEY in p.resources;
}

export function isHiddenCard(c: CardInstance): boolean {
  return c.card === HIDDEN_CARD || c.id === HIDDEN_CARD;
}

/** Display a cost Expr: number as-is, formulas as '?'. */
export function exprLabel(e: Expr): string {
  return typeof e === 'number' ? String(e) : '?';
}

export function costEntries(def: GameDefinition, cost: ResourceMap | undefined): { res: ResourceDef | undefined; id: Id; label: string }[] {
  if (!cost) return [];
  return Object.entries(cost).map(([id, e]) => ({ id, res: byId(def.resources, id), label: exprLabel(e) }));
}

export function sumMap(m: Record<string, number>): number {
  return Object.values(m).reduce((a, b) => a + (b || 0), 0);
}

export function cleanMap(m: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) if (v > 0) out[k] = v;
  return out;
}

/** "knightsPlayed" -> "Knights played" */
export function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Readable text colour on top of a background colour. */
export function contrastText(bg: string): string {
  const hex = bg.trim().replace('#', '');
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) return '#111';
  const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111' : '#fff';
}

