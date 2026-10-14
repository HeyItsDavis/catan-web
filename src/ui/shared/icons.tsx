/**
 * Icon registry: simple flat inline-SVG glyphs keyed by name.
 *
 * Mods reference icons by key (e.g. "settlement", "wheat") or by emoji.
 * Every glyph is drawn in a 24x24 box. `fill` is the main colour (owner
 * colour for pieces, resource colour for resources), `stroke` the outline.
 *
 * Use <Icon> in HTML and <IconGlyph> inside an existing <svg> (board).
 */
import type { ReactNode } from 'react';

export interface GlyphColors {
  fill: string;
  stroke: string;
  /** Secondary detail colour (defaults to a translucent white). */
  detail: string;
}

type Glyph = (c: GlyphColors) => ReactNode;

const sw = 1.4; // default stroke width in glyph units

const house: Glyph = ({ fill, stroke }) => (
  <path d="M4 11.5 12 4l8 7.5V20H4z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
);

const GLYPHS: Record<string, Glyph> = {
  /* ------------------------------ pieces ------------------------------ */
  settlement: (c) => (
    <>
      {house(c)}
      <rect x="10" y="14" width="4" height="6" fill={c.detail} />
    </>
  ),
  city: ({ fill, stroke, detail }) => (
    <>
      <path d="M3 20V11l4.5-4L12 11h9v9z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M12 11V8l4.5-4L21 8v3" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <rect x="6" y="14" width="3" height="3" fill={detail} />
      <rect x="14" y="14" width="3" height="3" fill={detail} />
    </>
  ),
  road: ({ fill, stroke }) => (
    <rect x="2" y="9" width="20" height="6" rx="2" fill={fill} stroke={stroke} strokeWidth={sw} />
  ),
  ship: ({ fill, stroke, detail }) => (
    <>
      <path d="M3 15h18l-3 5H6z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M12 3v11" stroke={stroke} strokeWidth={sw} />
      <path d="M12 4l7 9h-7z" fill={detail} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
      <path d="M11 6l-5 7h5z" fill={detail} stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
    </>
  ),
  knight: ({ fill, stroke, detail }) => (
    <>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M12 7v10M8 11h8" stroke={detail} strokeWidth={2} strokeLinecap="round" />
    </>
  ),
  wall: ({ fill, stroke, detail }) => (
    <>
      <path d="M2 20V9h3v2h3V9h3v2h2V9h3v2h3V9h3v11z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M2 15h20M8 15v5M16 15v5M12 11v4" stroke={detail} strokeWidth={1} />
    </>
  ),
  robber: ({ stroke }) => (
    <>
      <circle cx="12" cy="7" r="4" fill="#2b2b33" stroke={stroke} strokeWidth={sw} />
      <path d="M6 21c0-6 2-9 6-9s6 3 6 9z" fill="#2b2b33" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
    </>
  ),
  pirate: ({ stroke }) => (
    <>
      <path d="M3 15h18l-3 5H6z" fill="#2b2b33" stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M12 3v11" stroke={stroke} strokeWidth={sw} />
      <path d="M12 4l7 9h-7z" fill="#1a1a1f" stroke={stroke} strokeWidth={1} strokeLinejoin="round" />
      <circle cx="15" cy="9.5" r="1.3" fill="#eee" />
    </>
  ),
  building: ({ fill, stroke, detail }) => (
    <>
      <rect x="5" y="5" width="14" height="15" fill={fill} stroke={stroke} strokeWidth={sw} />
      <path d="M8 8h2v2H8zM14 8h2v2h-2zM8 12h2v2H8zM14 12h2v2h-2z" fill={detail} />
      <rect x="10.5" y="16" width="3" height="4" fill={detail} />
    </>
  ),
  castle: ({ fill, stroke, detail }) => (
    <>
      <path d="M3 20V7h3v2h2V7h3v4h2V7h3v2h2V7h3v13z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M10 20v-4a2 2 0 0 1 4 0v4z" fill={detail} />
    </>
  ),
  tower: ({ fill, stroke, detail }) => (
    <>
      <path d="M7 21l1-12H6V4h2v2h2V4h4v2h2V4h2v5h-2l1 12z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <rect x="11" y="11" width="2" height="3" fill={detail} />
    </>
  ),
  merchant: ({ fill, stroke, detail }) => (
    <>
      <circle cx="12" cy="7" r="3.5" fill={fill} stroke={stroke} strokeWidth={sw} />
      <path d="M5 21l2-8h10l2 8z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M10 16h4" stroke={detail} strokeWidth={1.5} />
    </>
  ),
  bridge: ({ fill, stroke }) => (
    <path d="M2 17V11c4-3 16-3 20 0v6h-3v-3c-3-2-11-2-14 0v3z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
  ),

  /* ----------------------------- resources ---------------------------- */
  wood: ({ fill, stroke, detail }) => (
    <>
      <rect x="3" y="8" width="16" height="8" rx="1" fill={fill} stroke={stroke} strokeWidth={sw} />
      <ellipse cx="19" cy="12" rx="2.5" ry="4" fill={detail} stroke={stroke} strokeWidth={sw} />
      <ellipse cx="19" cy="12" rx="1" ry="1.6" fill="none" stroke={stroke} strokeWidth={0.8} />
    </>
  ),
  brick: ({ fill, stroke }) => (
    <>
      <rect x="2" y="5" width="9" height="6" fill={fill} stroke={stroke} strokeWidth={sw} />
      <rect x="13" y="5" width="9" height="6" fill={fill} stroke={stroke} strokeWidth={sw} />
      <rect x="7" y="13" width="10" height="6" fill={fill} stroke={stroke} strokeWidth={sw} />
    </>
  ),
  sheep: ({ fill, stroke }) => (
    <>
      <path d="M8 18v3M15 18v3" stroke={stroke} strokeWidth={2} strokeLinecap="round" />
      <path
        d="M6 12a3 3 0 0 1 3-3 3 3 0 0 1 5 0 3 3 0 0 1 4 3 3 3 0 0 1-2 5H8a3 3 0 0 1-2-5z"
        fill={fill === 'currentColor' ? '#f4f4f0' : fill}
        stroke={stroke}
        strokeWidth={sw}
      />
      <ellipse cx="4.5" cy="11.5" rx="2.3" ry="1.8" fill="#333" />
    </>
  ),
  wheat: ({ fill, stroke }) => (
    <>
      <path d="M12 21V6" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      {[7, 11, 15].map((y) => (
        <g key={y}>
          <ellipse cx="9.5" cy={y} rx="2.3" ry="1.4" transform={`rotate(-35 9.5 ${y})`} fill={fill} stroke={stroke} strokeWidth={0.9} />
          <ellipse cx="14.5" cy={y} rx="2.3" ry="1.4" transform={`rotate(35 14.5 ${y})`} fill={fill} stroke={stroke} strokeWidth={0.9} />
        </g>
      ))}
      <ellipse cx="12" cy="4" rx="1.4" ry="2.2" fill={fill} stroke={stroke} strokeWidth={0.9} />
    </>
  ),
  ore: ({ fill, stroke, detail }) => (
    <>
      <path d="M3 18l4-8 4 2 3-6 7 12z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M11 12l3 6M7 10l1 8" stroke={detail} strokeWidth={1} />
    </>
  ),
  paper: ({ fill, stroke }) => (
    <>
      <path d="M6 3h9l4 4v14H6z" fill={fill === 'currentColor' ? '#f6f1df' : fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M9 10h7M9 13h7M9 16h5" stroke={stroke} strokeWidth={1} />
    </>
  ),
  cloth: ({ fill, stroke, detail }) => (
    <>
      <path d="M4 5h16v14H4z" fill={fill} stroke={stroke} strokeWidth={sw} />
      <path d="M4 9h16M4 13h16M8 5v14M12 5v14M16 5v14" stroke={detail} strokeWidth={0.9} />
    </>
  ),
  coin: ({ fill, stroke, detail }) => (
    <>
      <circle cx="12" cy="12" r="8" fill={fill === 'currentColor' ? '#e5b93a' : fill} stroke={stroke} strokeWidth={sw} />
      <circle cx="12" cy="12" r="5" fill="none" stroke={detail} strokeWidth={1.2} />
    </>
  ),
  fish: ({ fill, stroke }) => (
    <>
      <path d="M3 12c3-5 10-6 14 0-4 6-11 5-14 0z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M17 12l4-4v8z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <circle cx="7.5" cy="11" r="1" fill={stroke} />
    </>
  ),
  gold: ({ fill, stroke, detail }) => (
    <>
      <path d="M3 18l2-5h6l2 5zM11 18l2-5h6l2 5zM7 13l2-5h6l2 5z" fill={fill === 'currentColor' ? '#f1c232' : fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M9 10h2" stroke={detail} strokeWidth={1} />
    </>
  ),

  /* ------------------------------ terrain ----------------------------- */
  tree: ({ fill, stroke }) => (
    <>
      <path d="M12 3l6 9h-3l4 6H5l4-6H6z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M12 18v3" stroke={stroke} strokeWidth={2} />
    </>
  ),
  hills: ({ fill, stroke }) => (
    <path d="M2 19c2-6 5-9 8-9s4 3 5 5c1-2 2-4 4-4s3 4 3 8z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
  ),
  mountain: ({ fill, stroke, detail }) => (
    <>
      <path d="M2 20l7-13 4 6 3-4 6 11z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M7 10.7L9 7l2 3-1 1z" fill={detail} />
    </>
  ),
  sun: ({ fill, stroke }) => (
    <>
      <circle cx="12" cy="12" r="4.5" fill={fill} stroke={stroke} strokeWidth={sw} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <path key={a} d="M12 2.5v3" transform={`rotate(${a} 12 12)`} stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
      ))}
    </>
  ),
  wave: ({ stroke }) => (
    <path d="M2 10c2.5-2 4.5-2 7 0s4.5 2 7 0 4-2 6 0M2 15c2.5-2 4.5-2 7 0s4.5 2 7 0 4-2 6 0" fill="none" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" />
  ),
  fog: ({ stroke }) => (
    <path d="M4 9h12M7 13h13M3 17h10" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" />
  ),

  /* ------------------------------- misc ------------------------------- */
  card: ({ fill, stroke, detail }) => (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" fill={fill} stroke={stroke} strokeWidth={sw} />
      <path d="M12 8l2 4-2 4-2-4z" fill={detail} />
    </>
  ),
  star: ({ fill, stroke }) => (
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
  ),
  trophy: ({ fill, stroke }) => (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0z" fill={fill} stroke={stroke} strokeWidth={sw} />
      <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 20h8" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
    </>
  ),
  dice: ({ fill, stroke }) => (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" fill={fill} stroke={stroke} strokeWidth={sw} />
      {[[8.5, 8.5], [15.5, 15.5], [12, 12]].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="1.5" fill={stroke} />
      ))}
    </>
  ),
  sword: ({ fill, stroke }) => (
    <>
      <path d="M18 3l3 0 0 3-10 10-3-3z" fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />
      <path d="M6 13l5 5M5 19l3-3" stroke={stroke} strokeWidth={2} strokeLinecap="round" />
    </>
  ),
  anchor: ({ stroke }) => (
    <>
      <circle cx="12" cy="5" r="2" fill="none" stroke={stroke} strokeWidth={sw} />
      <path d="M12 7v14M8 11h8M5 14a7 7 0 0 0 14 0" fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
    </>
  ),
  question: ({ stroke }) => (
    <>
      <path d="M8.5 9a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3V15" fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" />
      <circle cx="12" cy="18.5" r="1.2" fill={stroke} />
    </>
  ),
};

/** Alternate names mods are likely to use. */
const ALIASES: Record<string, string> = {
  log: 'wood', lumber: 'wood', timber: 'wood',
  clay: 'brick',
  wool: 'sheep',
  grain: 'wheat',
  stone: 'ore', rock: 'ore',
  coins: 'coin',
  house: 'settlement', village: 'settlement',
  shield: 'knight',
  ruler: 'robber', bandit: 'robber', thief: 'robber',
  'pirate-ship': 'pirate', pirateShip: 'pirate',
  forest: 'tree', hill: 'hills', pasture: 'sheep', field: 'wheat', fields: 'wheat',
  mountains: 'mountain', desert: 'sun', sea: 'wave', water: 'wave', ocean: 'wave',
  vp: 'star', point: 'star', award: 'trophy',
  'development-card': 'card', devcard: 'card',
  boat: 'ship', fort: 'castle', keep: 'castle', metropolis: 'tower',
};

export const ICON_NAMES = Object.keys(GLYPHS);

const EMOJI_RE = /\p{Extended_Pictographic}/u;

export function isEmoji(s: string | undefined): boolean {
  return !!s && EMOJI_RE.test(s);
}

function resolve(name: string | undefined): Glyph | null {
  if (!name) return null;
  if (GLYPHS[name]) return GLYPHS[name];
  const alias = ALIASES[name] ?? ALIASES[name.toLowerCase()];
  if (alias) return GLYPHS[alias];
  const lower = name.toLowerCase();
  return GLYPHS[lower] ?? null;
}

export function hasIcon(name: string | undefined): boolean {
  return resolve(name) !== null;
}

interface GlyphProps {
  /** Icon key or emoji. */
  name?: string;
  /** Fallback label: its first letter is drawn when the icon is unknown. */
  label?: string;
  fill?: string;
  stroke?: string;
  detail?: string;
}

/** The glyph content in a 24x24 coordinate space (no wrapping <svg>). */
function GlyphBody({ name, label, fill = 'currentColor', stroke = '#1d1d22', detail = 'rgba(255,255,255,0.55)' }: GlyphProps) {
  const g = resolve(name);
  if (g) return <>{g({ fill, stroke, detail })}</>;
  if (name && isEmoji(name)) {
    return (
      <text x="12" y="13" textAnchor="middle" dominantBaseline="central" fontSize="18">
        {name}
      </text>
    );
  }
  const letter = (label || name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <>
      <circle cx="12" cy="12" r="9.5" fill={fill} stroke={stroke} strokeWidth={sw} />
      <text
        x="12"
        y="12.5"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="12"
        fontWeight="700"
        fill={stroke}
        fontFamily="system-ui, sans-serif"
      >
        {letter}
      </text>
    </>
  );
}

export interface IconProps extends GlyphProps {
  size?: number | string;
  className?: string;
  title?: string;
}

/** Standalone icon for HTML contexts. */
export function Icon({ size = 20, className, title, ...rest }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      style={{ flex: 'none', overflow: 'visible' }}
    >
      {title && <title>{title}</title>}
      <GlyphBody {...rest} />
    </svg>
  );
}

/** Icon embedded inside another SVG, centred on (x, y) with the given size. */
export function IconGlyph({ x, y, size, ...rest }: GlyphProps & { x: number; y: number; size: number }) {
  const s = size / 24;
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${s})`}>
      <GlyphBody {...rest} />
    </g>
  );
}
