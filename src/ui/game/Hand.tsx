/**
 * The viewer's hand as cards (bottom-left strip): resource cards grouped by type in stacks with a
 * count badge, then deck cards (development cards...) face up. Clicking a resource stack offers it
 * in a trade; clicking a playable card plays it.
 */
import type { AvailableMoves } from '../../engine';
import type { CardInstance, GameDefinition, PlayerState } from '../../engine/schema';
import { DevCard, ResCard } from './cards';
import { pluralKind } from './display';
import { byId, isRedacted, resourceTotal } from './util';

/** Hand cards grouped by deck (definition order, unknown decks last). */
export function cardsByDeck(def: GameDefinition, cards: CardInstance[]): { deck: string; cards: CardInstance[] }[] {
  const order = new Map(def.decks.map((d, i) => [d.id, i]));
  const m = new Map<string, CardInstance[]>();
  for (const c of cards) m.set(c.deck, [...(m.get(c.deck) ?? []), c]);
  return [...m.entries()]
    .sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
    .map(([deck, cs]) => ({ deck, cards: cs }));
}

export interface HandProps {
  def: GameDefinition;
  me: PlayerState;
  moves: AvailableMoves;
  discardLimit: number;
  /** Cards currently put on the "give" side of the trade panel (shown as taken out of the hand). */
  offered?: Record<string, number>;
  /** Click on a resource stack (null = clicking does nothing). */
  onResource?: ((id: string) => void) | null;
  /** Why clicking a resource does nothing right now (tooltip). */
  resourceHint?: string;
  onPlayCard: (instanceId: string) => void;
}

export function Hand({ def, me, moves, discardLimit, offered = {}, onResource, resourceHint, onPlayCard }: HandProps) {
  const playable = new Set(moves.playableCards.map((c) => c.cardInstance));
  const redacted = isRedacted(me);
  const total = resourceTotal(me);
  const kinds: { kind: string; list: GameDefinition['resources'] }[] = [];
  for (const r of def.resources) {
    const g = kinds.find((k) => k.kind === r.kind);
    if (g) g.list.push(r); else kinds.push({ kind: r.kind, list: [r] });
  }
  const decks = cardsByDeck(def, me.hand);
  const warnings: { text: string; bad?: boolean }[] = [];
  if (!redacted && discardLimit > 0 && total > discardLimit) warnings.push({ text: `${total} cards — more than ${discardLimit}: you would discard on a 7` });
  for (const { deck, cards } of decks) {
    const limit = byId(def.decks, deck)?.handLimit;
    if (limit === undefined) continue;
    const name = byId(def.decks, deck)?.name ?? deck;
    if (cards.length > limit) warnings.push({ text: `${name}: over the hand limit of ${limit} — you must discard down`, bad: true });
    else if (cards.length === limit) warnings.push({ text: `Hand limit reached (${limit})` });
  }

  const empty = total === 0 && me.hand.length === 0;

  return (
    <div className="g-hand" data-testid="hand" data-anchor="hand" aria-label="Your hand">
      {warnings.length > 0 && (
        <div className="g-hand-warns">
          {warnings.map((w) => (
            <span key={w.text} className={`g-warn${w.bad ? ' g-warn--bad' : ''}`} role={w.bad ? 'alert' : 'note'}>{w.text}</span>
          ))}
        </div>
      )}
      <div className="g-hand-cards">
        {empty && <span className="g-hand-empty">No cards in hand</span>}
        {redacted ? (
          <ResCard def={def} id="?" size="lg" count={total} />
        ) : (
          kinds.map(({ kind, list }) => {
            const held = list.filter((r) => (me.resources[r.id] ?? 0) > 0);
            if (!held.length) return null;
            return (
              <div key={kind} className="g-hand-group" data-kind={kind} aria-label={pluralKind(kind)} title={kinds.length > 1 ? pluralKind(kind) : undefined}>
                {held.map((r) => {
                  const n = me.resources[r.id] ?? 0;
                  const left = n - (offered[r.id] ?? 0);
                  const layers = Math.min(Math.max(left, 1), 4);
                  const clickable = !!onResource && left > 0;
                  const hint = clickable ? `${r.name} ×${left} — click to offer in a trade` : resourceHint ? `${r.name} ×${left} — ${resourceHint}` : `${r.name} ×${left}`;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={`g-hand-res${left <= 0 ? ' g-hand-res--out' : ''}${clickable ? ' g-hand-res--click' : ''}`}
                      data-hand-res={r.id}
                      aria-label={`${r.name} ×${left}`}
                      title={hint}
                      aria-disabled={!clickable}
                      onClick={() => clickable && onResource!(r.id)}
                    >
                      {Array.from({ length: layers - 1 }, (_, i) => (
                        <ResCard key={i} def={def} id={r.id} size="lg" className="g-stack-under" style={{ ['--i' as string]: layers - 1 - i }} title="" />
                      ))}
                      <ResCard def={def} id={r.id} size="lg" count={left} label title="" />
                      <span className="g-sr">{r.name}</span>
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
        {decks.map(({ deck, cards }) => (
          <div key={deck} className="g-hand-group g-hand-deck" data-deck={deck} aria-label={byId(def.decks, deck)?.name ?? deck}>
            {cards.map((c) => (
              <DevCard key={c.id} def={def} inst={c} playable={playable.has(c.id)} onPlay={() => onPlayCard(c.id)} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
