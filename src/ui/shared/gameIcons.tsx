/**
 * HUD icons from game-icons.net (CC BY 3.0, see gameIconData.ts and README "Credits").
 *
 * Mods name icons by key (ResourceDef.icon, CardDef.icon, PieceDef.icon...). Known keys and common
 * aliases map to a game-icons glyph; anything else falls back to the flat glyphs in icons.tsx
 * (which in turn fall back to the first letter of the label). Nothing here is keyed on content ids
 * beyond that best-effort icon lookup.
 */
import { GAME_ICONS } from './gameIconData';
import { Icon } from './icons';

export { GAME_ICONS };

/** Alternate names mods are likely to use for the same picture. */
const ALIASES: Record<string, string> = {
  wood: 'lumber', log: 'lumber', logs: 'lumber', timber: 'lumber',
  clay: 'brick', bricks: 'brick',
  sheep: 'wool',
  wheat: 'grain',
  stone: 'ore', rock: 'ore', ores: 'ore',
  coins: 'coin', cash: 'coin', money: 'coin',
  fabric: 'cloth', cloths: 'cloth',
  papers: 'paper', scroll: 'paper',
  fishes: 'fish',
  spice: 'spices',
  vp: 'victoryPoint', victorypoint: 'victoryPoint', point: 'victoryPoint', points: 'victoryPoint', laurel: 'victoryPoint',
  roadbuilding: 'roadBuilding', 'road-building': 'roadBuilding',
  yearofplenty: 'plenty', 'year-of-plenty': 'plenty', cornucopia: 'plenty',
  house: 'settlement', village: 'settlement',
  shield: 'knight', helm: 'knight',
  thief: 'robber', bandit: 'robber',
  boat: 'ship',
  award: 'trophy',
  sword: 'army', swords: 'army',
  card: 'cardBack', cards: 'cardBack',
  devcard: 'devBack', 'development-card': 'devBack',
  endturn: 'hourglass', 'end-turn': 'hourglass',
  bankbuilding: 'bank',
  meeple: 'avatar',
};

/** Resolve a mod icon key to a game-icons entry key, or null. */
export function gameIconKey(name: string | undefined): string | null {
  if (!name) return null;
  if (GAME_ICONS[name]) return name;
  const lower = name.toLowerCase();
  const alias = ALIASES[name] ?? ALIASES[lower];
  if (alias) return alias;
  const k = Object.keys(GAME_ICONS).find((x) => x.toLowerCase() === lower);
  return k ?? null;
}

export function hasGameIcon(name: string | undefined): boolean {
  return gameIconKey(name) !== null;
}

export interface GameIconProps {
  /** Icon key (or alias). Unknown keys fall back to icons.tsx glyphs, then a letter. */
  name?: string;
  /** Alternative keys tried in order when `name` has no game-icon (e.g. the resource id). */
  alt?: (string | undefined)[];
  /** Used for the letter fallback and as the accessible title. */
  label?: string;
  size?: number | string;
  color?: string;
  className?: string;
  /** Adds a <title> (and role=img) instead of hiding the icon from assistive tech. */
  title?: string;
}

/** Single-colour icon. */
export function GameIcon({ name, alt, label, size = 20, color = 'currentColor', className, title }: GameIconProps) {
  const key = [name, ...(alt ?? [])].map(gameIconKey).find((k) => k) ?? null;
  if (!key) {
    return <Icon name={name ?? alt?.find(Boolean)} label={label} size={size} fill={color} className={className} title={title} />;
  }
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 512 512"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      style={{ flex: 'none' }}
    >
      {title && <title>{title}</title>}
      <path d={GAME_ICONS[key].d} fill={color} />
    </svg>
  );
}

/** Path data for imperative (non-React) drawing, e.g. the flying cards. */
export function gameIconPath(name: string | undefined, alt?: (string | undefined)[]): string | null {
  const key = [name, ...(alt ?? [])].map(gameIconKey).find((k) => k) ?? null;
  return key ? GAME_ICONS[key].d : null;
}

/** Unique authors/sources, for the in-app credits. */
export function gameIconCredits(): { key: string; author: string; source: string }[] {
  return Object.entries(GAME_ICONS).map(([key, v]) => ({ key, author: v.author, source: v.source }));
}
