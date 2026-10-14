/**
 * Presentation helpers driven by the definition's optional display hints
 * (PieceDef.display, GameDefinition.display). Never keyed on content ids.
 */
import type { GameDefinition, GameState, Id, PieceDef, PieceInstance, Prompt } from '../../engine/schema';
import { byId, humanize } from './util';

/* --------------------------------- stats ---------------------------------- */

export function statInfo(def: GameDefinition, key: string): { label: string; icon?: string; hidden: boolean; max?: number } {
  const h = def.display?.stats?.find((s) => s.key === key);
  return { label: h?.label || humanize(key), icon: h?.icon, hidden: !!h?.hidden, max: h?.max };
}

/** Visible, non-zero stats of a player with their labels. */
export interface StatRow { key: string; label: string; icon?: string; value: number; max?: number }

/** Visible, non-zero stats of a player with their labels (hinted stats first, in hint order). */
export function visibleStats(def: GameDefinition, stats: Record<string, number>): StatRow[] {
  const order = new Map((def.display?.stats ?? []).map((h, i) => [h.key, i]));
  const out: StatRow[] = [];
  for (const [key, value] of Object.entries(stats)) {
    if (!value) continue;
    const i = statInfo(def, key);
    if (i.hidden) continue;
    const row: StatRow = { key, label: i.label, value };
    if (i.icon) row.icon = i.icon;
    if (i.max) row.max = i.max;
    out.push(row);
  }
  return out.sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999));
}

/* -------------------------------- globals --------------------------------- */

export interface GlobalRow { key: string; label: string; value: number; max?: number; icon?: string; color?: string }

/** Globals in hint order first, then unlisted ones; hidden ones dropped. */
export function globalRows(def: GameDefinition, state: GameState): GlobalRow[] {
  const hints = def.display?.globals ?? [];
  const globals = state.globals ?? {};
  const rows: GlobalRow[] = [];
  const seen = new Set<string>();
  for (const h of hints) {
    seen.add(h.key);
    if (h.hidden) continue;
    rows.push({ key: h.key, label: h.label || humanize(h.key), value: globals[h.key] ?? 0, max: h.max, icon: h.icon, color: h.color });
  }
  for (const [key, value] of Object.entries(globals)) {
    if (seen.has(key) || key.startsWith('$') || key.startsWith('_')) continue;
    rows.push({ key, label: humanize(key), value });
  }
  return rows;
}

/* ------------------------------ event dice -------------------------------- */

/** Plain CSS colour words an event face may be named after (generic fallback when no hint). */
const COLOR_WORDS: Record<string, string> = {
  red: '#d64541', blue: '#2f7fd8', green: '#3a9a4f', yellow: '#e3b82f', orange: '#e67e22', purple: '#8e5cc4',
  black: '#2b2b33', white: '#f1f1f1', gray: '#8a8f99', grey: '#8a8f99', brown: '#8b5a2b', gold: '#d4a017', pink: '#e86a9b',
};

export function faceInfo(def: GameDefinition, face: string): { label: string; color?: string; icon?: string } {
  const h = def.display?.eventFaces?.find((f) => f.face === face);
  return {
    label: h?.label || humanize(face),
    color: h?.color ?? COLOR_WORDS[face.toLowerCase()],
    icon: h?.icon ?? (COLOR_WORDS[face.toLowerCase()] ? undefined : face),
  };
}

/* -------------------------------- pieces ---------------------------------- */

export interface Badge { key: string; label: string; value: number; style: 'pips' | 'number' | 'toggle'; max: number; icon?: string }

/** State badges to draw on a piece instance. */
export function pieceBadges(pd: PieceDef | undefined, inst: PieceInstance): Badge[] {
  const st = inst.state ?? {};
  const hints = pd?.display?.stateBadges;
  if (hints) {
    return hints.map((h) => ({
      key: h.key, label: h.label || humanize(h.key), value: st[h.key] ?? 0, style: h.style ?? 'number',
      max: h.max ?? 3, icon: h.icon,
    }));
  }
  // No hints: up to two non-zero values as numbered badges.
  return Object.entries(st)
    .filter(([, v]) => v)
    .slice(0, 2)
    .map(([key, value]) => ({ key, label: humanize(key), value, style: 'number' as const, max: 3 }));
}

/** A 'toggle' badge is off (value 0): draw the piece dimmed. */
export function pieceInactive(pd: PieceDef | undefined, inst: PieceInstance): boolean {
  return (pd?.display?.stateBadges ?? []).some((h) => h.style === 'toggle' && !(inst.state?.[h.key] ?? 0));
}

export interface CargoChip { key: Id; n: number; color: string; icon?: string; label: string }

export function cargoChips(def: GameDefinition, pd: PieceDef | undefined, inst: PieceInstance): CargoChip[] {
  if (pd?.display?.showCargo === false || !inst.cargo) return [];
  return Object.entries(inst.cargo)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => {
      const res = byId(def.resources, key);
      return { key, n, color: res?.color ?? '#e9e2cf', icon: res?.icon ?? key, label: res?.name ?? humanize(key) };
    });
}

/** Edge pieces drawn as a boat rather than a bar: icon 'ship'/'boat' or tag 'ship'. */
export function isShipLike(pd: PieceDef | undefined): boolean {
  if (!pd) return false;
  const icon = pd.icon?.toLowerCase();
  return icon === 'ship' || icon === 'boat' || !!pd.tags?.some((t) => t.toLowerCase() === 'ship');
}

/** One-line description: "Knight — Alice · Strength 2, Active: yes · carrying 2 Wool". */
export function pieceSummary(def: GameDefinition, state: GameState, inst: PieceInstance): string {
  const pd = byId(def.pieces, inst.type);
  const owner = state.players.find((p) => p.id === inst.owner)?.name ?? inst.owner;
  const parts = [`${pd?.name ?? inst.type} — ${owner}`];
  const st = pieceStateRows(pd, inst).map((r) => `${r.label} ${r.text}`);
  if (st.length) parts.push(st.join(', '));
  const cargo = cargoChips(def, pd, inst).map((c) => `${c.n} ${c.label}`);
  if (cargo.length) parts.push(`carrying ${cargo.join(', ')}`);
  return parts.join(' · ');
}

/** Every state key of a piece with a readable value (hinted keys first). */
export function pieceStateRows(pd: PieceDef | undefined, inst: PieceInstance): { key: string; label: string; text: string }[] {
  const st = inst.state ?? {};
  const hints = pd?.display?.stateBadges ?? [];
  const keys = [...hints.map((h) => h.key), ...Object.keys(st).filter((k) => !hints.some((h) => h.key === k))];
  return [...new Set(keys)].map((key) => {
    const h = hints.find((x) => x.key === key);
    const v = st[key] ?? 0;
    const text = h?.style === 'toggle' ? (v ? 'yes' : 'no') : h?.style === 'pips' ? `${v}/${h.max ?? 3}` : String(v);
    return { key, label: h?.label || humanize(key), text };
  });
}

/* --------------------------------- misc ----------------------------------- */

/** "commodity" -> "Commodities", "resource" -> "Resources". */
export function pluralKind(kind: string): string {
  const h = humanize(kind);
  if (/[^aeiou]y$/i.test(h)) return `${h.slice(0, -1)}ies`;
  return h.endsWith('s') ? h : `${h}s`;
}

/** Label without the engine's "(k/n)" counter when the prompt carries structured progress. */
export function promptLabel(prompt: Prompt): string {
  const l = prompt.label || '';
  return prompt.progress ? l.replace(/\s*\(\d+\/\d+\)\s*$/, '') : l;
}
