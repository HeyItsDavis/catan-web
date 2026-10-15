/**
 * Card-shaped primitives: resource cards (definition colour + icon), card backs, development /
 * deck cards and the mini cards used in the log and in flights. Everything is driven by the
 * GameDefinition (ResourceDef.color/icon, DeckDef.color, CardDef.icon); unknown icons fall back to
 * a generic glyph or the first letter.
 */
import type { CSSProperties, ReactNode } from 'react';
import type { CardInstance, GameDefinition, Id, ResourceDef } from '../../engine/schema';
import { GameIcon } from '../shared/gameIcons';
import { byId, contrastText, HIDDEN_KEY, isHiddenCard } from './util';

export type CardSize = 'lg' | 'md' | 'sm' | 'xs';

const DEFAULT_DECK = '#6a4c93';

export function resColor(res: ResourceDef | undefined): string {
  return res?.color ?? '#8a8f99';
}

export function deckColor(def: GameDefinition, deckId: string | undefined): string {
  return byId(def.decks, deckId)?.color ?? DEFAULT_DECK;
}

/** Icon drawn on a resource card face. */
export function ResGlyph({ res, id, size, color }: { res?: ResourceDef; id: Id; size: number; color: string }) {
  return <GameIcon name={res?.icon} alt={[id]} label={res?.name ?? id} size={size} color={color} />;
}

const ICON_PX: Record<CardSize, number> = { lg: 34, md: 26, sm: 17, xs: 12 };

/** A resource card: rounded rectangle in the resource colour with its icon. */
export function ResCard({
  def,
  id,
  size = 'md',
  count,
  label,
  className,
  style,
  title,
}: {
  def: GameDefinition;
  id: Id;
  size?: CardSize;
  /** Count badge (top-right corner). */
  count?: number | string;
  /** Show the resource name under the icon (large cards). */
  label?: boolean;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  if (id === HIDDEN_KEY) return <CardBack size={size} count={count} className={className} title={title ?? 'Hidden card'} />;
  const res = byId(def.resources, id);
  const bg = resColor(res);
  const fg = contrastText(bg);
  return (
    <span
      className={`g-rcard g-rcard--${size}${className ? ` ${className}` : ''}`}
      style={{ ['--rc' as string]: bg, ['--rcfg' as string]: fg, ...style }}
      title={title ?? res?.name ?? id}
      data-res={id}
    >
      <ResGlyph res={res} id={id} size={ICON_PX[size]} color={fg === '#fff' ? 'rgba(255,255,255,0.92)' : 'rgba(20,20,26,0.78)'} />
      {label && <span className="g-rcard-name">{res?.name ?? id}</span>}
      {count !== undefined && <span className="g-count">{count}</span>}
    </span>
  );
}

/** Face-down card. `dev` = development/deck card back (uses the deck colour). */
export function CardBack({
  size = 'md',
  count,
  color,
  dev,
  className,
  title,
}: {
  size?: CardSize;
  count?: number | string;
  color?: string;
  dev?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`g-rcard g-rcard--back g-rcard--${size}${dev ? ' g-rcard--devback' : ''}${className ? ` ${className}` : ''}`}
      style={color ? { ['--rc' as string]: color } : undefined}
      title={title}
    >
      <GameIcon name={dev ? 'devBack' : 'cardBack'} size={ICON_PX[size]} color="rgba(255,255,255,0.85)" />
      {count !== undefined && <span className="g-count">{count}</span>}
    </span>
  );
}

/** A development (or any deck) card face: deck colour, icon and name. */
export function DevCard({
  def,
  inst,
  size = 'lg',
  playable,
  onPlay,
  dim,
  extra,
}: {
  def: GameDefinition;
  inst: CardInstance;
  size?: 'lg' | 'sm';
  playable?: boolean;
  onPlay?: () => void;
  dim?: boolean;
  extra?: ReactNode;
}) {
  const color = deckColor(def, inst.deck);
  if (isHiddenCard(inst)) {
    return <CardBack dev size={size === 'lg' ? 'md' : 'sm'} color={color} className="g-card g-card--hidden" title="Hidden card" />;
  }
  const card = byId(def.cards, inst.card);
  const name = card?.name ?? inst.card;
  const tip = [name, card?.description, card?.vp ? `+${card.vp} VP` : '', playable ? 'Click to play' : ''].filter(Boolean).join('\n');
  const cls = `g-card g-dcard g-dcard--${size}${playable ? ' g-card--playable' : ''}${dim ? ' g-dcard--dim' : ''}`;
  const body = (
    <>
      <span className="g-dcard-icon">
        <GameIcon name={card?.icon} alt={[inst.card]} label={name} size={size === 'lg' ? 28 : 14} color="rgba(255,255,255,0.95)" />
      </span>
      <span className="g-card-name">{name}</span>
      {extra}
      {size === 'lg' && card?.description && (
        <span className="g-dcard-tip" role="tooltip">
          <b>{name}</b>
          {card.description}
          {playable && <em>Click to play</em>}
        </span>
      )}
    </>
  );
  const style = { ['--deck' as string]: color };
  return playable ? (
    <button type="button" className={cls} style={style} title={tip} onClick={onPlay} data-card={inst.card}>
      {body}
    </button>
  ) : (
    <span className={cls} style={style} title={tip} data-card={inst.card} tabIndex={size === 'lg' ? 0 : undefined}>
      {body}
    </span>
  );
}

/** Mini cards for a resource map (log lines, offers). Repeats a card per unit up to `maxEach`. */
export function MiniCards({ def, res, maxEach = 4, size = 'xs' }: { def: GameDefinition; res: Record<Id, number>; maxEach?: number; size?: 'xs' | 'sm' }) {
  const order = new Map(def.resources.map((r, i) => [r.id, i]));
  const entries = Object.entries(res)
    .filter(([, n]) => n > 0)
    .sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  return (
    <span className="g-minicards">
      {entries.map(([id, n]) => {
        const shown = Math.min(n, maxEach);
        const name = id === HIDDEN_KEY ? 'card' : byId(def.resources, id)?.name ?? id;
        return (
          <span key={id} className="g-minigroup" title={`${n} ${name}`}>
            {Array.from({ length: shown }, (_, i) => <ResCard key={i} def={def} id={id} size={size} title="" />)}
            {n > shown && <span className="g-minimore">×{n}</span>}
          </span>
        );
      })}
    </span>
  );
}
