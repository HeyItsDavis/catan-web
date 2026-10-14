/** Own hand panel + opponents panel. Handles both full and redacted player state. */
import type { AvailableMoves } from '../../engine';
import type { CardInstance, Command, GameDefinition, GameState, PlayerState } from '../../engine/schema';
import { Icon } from '../shared/icons';
import { useEngine } from './engineContext';
import { PlayerDot, ResChip } from './chips';
import { pluralKind, visibleStats } from './display';
import { byId, HIDDEN_KEY, isHiddenCard, isRedacted, resourceTotal } from './util';

/** Hand cards grouped by deck (definition order, unknown decks last). */
function cardsByDeck(def: GameDefinition, cards: CardInstance[]): { deck: string; cards: CardInstance[] }[] {
  const order = new Map(def.decks.map((d, i) => [d.id, i]));
  const m = new Map<string, CardInstance[]>();
  for (const c of cards) m.set(c.deck, [...(m.get(c.deck) ?? []), c]);
  return [...m.entries()]
    .sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
    .map(([deck, cs]) => ({ deck, cards: cs }));
}

function StatTags({ def, stats }: { def: GameDefinition; stats: Record<string, number> }) {
  return (
    <>
      {visibleStats(def, stats).map((st) => (
        <span key={st.key} className="g-tag" data-stat={st.key}>
          {st.icon && <Icon name={st.icon} label={st.label} size={12} fill="#ccc" />} {st.label}: {st.value}
        </span>
      ))}
    </>
  );
}

function awardsOf(def: GameDefinition, state: GameState, pid: string) {
  return Object.entries(state.awards)
    .filter(([, holder]) => holder === pid)
    .map(([id]) => byId(def.awards, id))
    .filter((a): a is NonNullable<typeof a> => !!a);
}

function deckColor(def: GameDefinition, deckId: string): string {
  return byId(def.decks, deckId)?.color ?? '#7b68b5';
}

function CardTile({
  def,
  inst,
  playable,
  onPlay,
}: {
  def: GameDefinition;
  inst: CardInstance;
  playable?: boolean;
  onPlay?: () => void;
}) {
  if (isHiddenCard(inst)) {
    return (
      <span className="g-card g-card--hidden" style={{ ['--deck' as string]: deckColor(def, inst.deck) }} title="Hidden card">
        <Icon name="card" size={18} fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.6)" />
      </span>
    );
  }
  const card = byId(def.cards, inst.card);
  const name = card?.name ?? inst.card;
  const tip = [card?.description, card?.vp ? `+${card.vp} VP` : '', playable ? 'Click to play' : ''].filter(Boolean).join('\n');
  const content = (
    <>
      <Icon name={card?.icon ?? 'card'} label={name} size={18} fill="rgba(255,255,255,0.9)" stroke="#222" />
      <span className="g-card-name">{name}</span>
    </>
  );
  const style = { ['--deck' as string]: deckColor(def, inst.deck) };
  return playable ? (
    <button type="button" className="g-card g-card--playable" style={style} title={tip} onClick={onPlay}>
      {content}
    </button>
  ) : (
    <span className="g-card" style={style} title={tip}>
      {content}
    </span>
  );
}

/* ------------------------------- own panel -------------------------------- */

export function SelfPanel({
  def,
  state,
  me,
  moves,
  send,
}: {
  def: GameDefinition;
  state: GameState;
  me: PlayerState;
  moves: AvailableMoves;
  send: (c: Command) => void;
}) {
  const engine = useEngine();
  const playable = new Set(moves.playableCards.map((c) => c.cardInstance));
  const vpVisible = engine.computeVP(def, state, me.id, false);
  const vpTotal = engine.computeVP(def, state, me.id, true);
  const awards = awardsOf(def, state, me.id);
  const redacted = isRedacted(me);
  const kinds: { kind: string; list: GameDefinition['resources'] }[] = [];
  for (const r of def.resources) {
    const g = kinds.find((k) => k.kind === r.kind);
    if (g) g.list.push(r); else kinds.push({ kind: r.kind, list: [r] });
  }
  const handTotal = resourceTotal(me);
  const discardLimit = state.settings.discardLimit || def.discardLimit;
  const deckGroups = cardsByDeck(def, me.hand);

  return (
    <section className="g-panel g-self" aria-label="Your hand">
      <header className="g-panel-head">
        <span className="g-pname">
          <PlayerDot color={me.color} size={14} />
          <b>{me.name}</b>
        </span>
        <span className="g-vp" title={vpTotal !== vpVisible ? `${vpVisible} visible + ${vpTotal - vpVisible} hidden` : 'Victory points'}>
          <Icon name="star" size={14} fill="#f1c232" />
          {vpTotal}
          {vpTotal !== vpVisible && <span className="g-muted g-small"> ({vpVisible})</span>}
          <span className="g-muted g-small">/{state.settings.victoryPoints || def.victoryPoints}</span>
        </span>
      </header>

      {redacted ? (
        <div className="g-hand" aria-label="Resources">
          <span className="g-muted">{me.resources[HIDDEN_KEY]} cards</span>
        </div>
      ) : (
        kinds.map(({ kind, list }) => (
          <div key={kind} className="g-hand-group" data-kind={kind}>
            {kinds.length > 1 && <h4>{pluralKind(kind)}</h4>}
            <div className="g-hand" aria-label={pluralKind(kind)}>
              {list.map((r) => {
                const n = me.resources[r.id] ?? 0;
                return (
                  <div key={r.id} className={`g-hand-res${n === 0 ? ' g-hand-res--empty' : ''}`} title={r.name}>
                    <ResChip def={def} id={r.id} amount={n} />
                    <span className="g-hand-res-name">{r.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
      {!redacted && discardLimit > 0 && handTotal > discardLimit && (
        <div className="g-warn" role="note">
          {handTotal} cards — more than {discardLimit}: you would discard on a 7
        </div>
      )}

      {deckGroups.map(({ deck, cards }) => {
        const dd = byId(def.decks, deck);
        const limit = dd?.handLimit;
        const over = limit !== undefined && cards.length > limit;
        const full = limit !== undefined && cards.length === limit;
        return (
          <div key={deck} className="g-subsec g-deckgroup" style={{ ['--deck' as string]: deckColor(def, deck) }} data-deck={deck}>
            <h4>
              <span className="g-deckdot" />
              {dd?.name ?? (deckGroups.length > 1 ? deck : 'Cards')}
              <span className={`g-deckcount${over ? ' g-deckcount--over' : full ? ' g-deckcount--full' : ''}`}>
                {cards.length}{limit !== undefined ? `/${limit}` : ''}
              </span>
              {dd?.public && <span className="g-tag g-tag--sm" title="Everyone can see these cards">public</span>}
            </h4>
            {over && <div className="g-warn g-warn--bad" role="alert">Over the hand limit of {limit} — you must discard down</div>}
            {full && <div className="g-warn" role="note">Hand limit reached ({limit})</div>}
            <div className="g-cards">
              {cards.map((c) => (
                <CardTile
                  key={c.id}
                  def={def}
                  inst={c}
                  playable={playable.has(c.id)}
                  onPlay={() => send({ type: 'playCard', cardInstance: c.id })}
                />
              ))}
            </div>
          </div>
        );
      })}

      {me.played.length > 0 && (
        <div className="g-subsec">
          <h4>Played</h4>
          <div className="g-cards g-cards--played">
            {me.played.map((c) => (
              <CardTile key={c.id} def={def} inst={c} />
            ))}
          </div>
        </div>
      )}

      {(awards.length > 0 || visibleStats(def, me.stats).length > 0) && (
        <div className="g-tags">
          {awards.map((a) => (
            <span key={a.id} className="g-tag g-tag--award" title={`${a.name} (+${a.vp} VP)`}>
              <Icon name="trophy" size={12} fill="#f1c232" /> {a.name}
            </span>
          ))}
          <StatTags def={def} stats={me.stats} />
        </div>
      )}
    </section>
  );
}

/* ------------------------------ opponents --------------------------------- */

export function OpponentsPanel({ def, state, playerId }: { def: GameDefinition; state: GameState; playerId: string }) {
  const engine = useEngine();
  const current = state.turnOrder[state.currentPlayerIndex];
  const order = state.turnOrder.length ? state.turnOrder : state.players.map((p) => p.id);
  const others = order
    .map((id) => state.players.find((p) => p.id === id))
    .filter((p): p is PlayerState => !!p && p.id !== playerId);

  return (
    <section className="g-panel g-opps" aria-label="Opponents">
      {others.map((p) => {
        const awards = awardsOf(def, state, p.id);
        const stats = visibleStats(def, p.stats);
        const faceUp = p.hand.filter((c) => !isHiddenCard(c));
        const hiddenCards = p.hand.length - faceUp.length;
        const isTurn = p.id === current;
        const prompted = state.prompts.some((x) => x.player === p.id);
        return (
          <div key={p.id} className={`g-opp${isTurn ? ' g-opp--turn' : ''}`} style={{ ['--pc' as string]: p.color }}>
            <div className="g-opp-head">
              <span className="g-pname">
                <PlayerDot color={p.color} size={14} />
                <b>{p.name}</b>
                {prompted && <span className="g-thinking" title="Deciding…">…</span>}
              </span>
              <span className="g-vp" title="Visible victory points">
                <Icon name="star" size={14} fill="#f1c232" />
                {engine.computeVP(def, state, p.id, false)}
              </span>
            </div>
            <div className="g-opp-counts">
              <span title="Resource cards">
                <Icon name="card" size={14} fill="#c9a86a" /> {resourceTotal(p)}
              </span>
              <span title="Cards in hand">
                <Icon name="card" size={14} fill="#7b68b5" /> {hiddenCards}
              </span>
              {p.played.length > 0 && (
                <span title={p.played.map((c) => byId(def.cards, c.card)?.name ?? c.card).join(', ')}>
                  played {p.played.length}
                </span>
              )}
            </div>
            {!isRedacted(p) && resourceTotal(p) > 0 && (
              <div className="g-opp-res">
                {Object.entries(p.resources)
                  .filter(([, n]) => n > 0)
                  .map(([id, n]) => (
                    <ResChip key={id} def={def} id={id} amount={n} small />
                  ))}
              </div>
            )}
            {faceUp.length > 0 && (
              <div className="g-cards g-opp-cards" aria-label="Face-up cards">
                {faceUp.map((c) => (
                  <CardTile key={c.id} def={def} inst={c} />
                ))}
              </div>
            )}
            {(awards.length > 0 || stats.length > 0) && (
              <div className="g-tags">
                {awards.map((a) => (
                  <span key={a.id} className="g-tag g-tag--award" title={`+${a.vp} VP`}>
                    <Icon name="trophy" size={12} fill="#f1c232" /> {a.name}
                  </span>
                ))}
                <StatTags def={def} stats={p.stats} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
