/**
 * Player panels (colonist style): avatar + name, resource card back with count, deck card backs
 * with counts, VP, awards, labelled stats and the pieces left in supply. One per opponent, and a
 * larger one for the viewer. Everything comes from the definition (pieces, decks, awards, display
 * hints) and works with full and redacted player state.
 */
import type { AwardDef, GameDefinition, GameState, PieceDef, PlayerState } from '../../engine/schema';
import { GameIcon, hasGameIcon } from '../shared/gameIcons';
import { useEngine } from './engineContext';
import { CardBack, DevCard, deckColor } from './cards';
import { visibleStats } from './display';
import { cardsByDeck } from './Hand';
import { byId, isHiddenCard, resourceTotal } from './util';

export function Avatar({ color, size = 34, title }: { color: string; size?: number; title?: string }) {
  return (
    <span className="g-avatar" style={{ ['--pc' as string]: color, width: size, height: size }} title={title}>
      <GameIcon name="avatar" size={Math.round(size * 0.62)} color="#fff" />
    </span>
  );
}

/** Icon for an award: a hint from its metric (route length / a stat with an icon) or a trophy. */
export function awardIcon(def: GameDefinition, a: AwardDef): string {
  const m = a.metric as unknown as Record<string, unknown>;
  if (m && typeof m === 'object' && 'longestRoad' in m) return 'road';
  const stat = m && typeof m === 'object' && 'stat' in m ? (m.stat as { key?: string })?.key : undefined;
  if (stat) {
    const icon = def.display?.stats?.find((s) => s.key === stat)?.icon;
    if (icon) return icon === 'knight' ? 'army' : icon;
    if (/knight|army|soldier/i.test(stat)) return 'army';
  }
  if (/army|knight/i.test(a.name)) return 'army';
  if (/road|route/i.test(a.name)) return 'road';
  return 'trophy';
}

/** Pieces that come from a limited per-player supply (shown as "left"). */
function supplyPieces(def: GameDefinition): PieceDef[] {
  return def.pieces.filter((p) => p.supply >= 0 && (p.cost || p.vp || p.productionMultiplier || p.network));
}

export function piecesLeft(state: GameState, p: PlayerState, pd: PieceDef): number {
  const used = state.pieces.filter((x) => x.owner === p.id && x.type === pd.id).length;
  return Math.max(0, pd.supply - used - (p.stats[`lost:${pd.id}`] ?? 0));
}

function Stat({ icon, value, title, color, testid, on, children }: {
  icon: string; value: React.ReactNode; title: string; color?: string; testid?: string; on?: boolean; children?: React.ReactNode;
}) {
  return (
    <span className={`g-stat${on ? ' g-stat--on' : ''}`} title={title} data-stat={testid}>
      <GameIcon name={icon} size={16} color={color ?? 'currentColor'} label={title} />
      <b>{value}</b>
      {children}
    </span>
  );
}

export function PlayerPanel({ def, state, p, self, vp, vpHidden }: {
  def: GameDefinition;
  state: GameState;
  p: PlayerState;
  self?: boolean;
  vp: number;
  /** Own panel: VP including hidden cards (when different). */
  vpHidden?: number;
}) {
  const current = state.turnOrder[state.currentPlayerIndex];
  const isTurn = p.id === current;
  const prompted = state.prompts.some((x) => x.player === p.id);
  const awardsHeld = def.awards.filter((a) => state.awards[a.id] === p.id);
  const stats = visibleStats(def, p.stats);
  const decks = cardsByDeck(def, p.hand);
  const faceUp = self ? [] : p.hand.filter((c) => !isHiddenCard(c));
  const target = state.settings.victoryPoints || def.victoryPoints;
  const pieces = supplyPieces(def);

  return (
    <div
      className={`g-ppanel ${self ? 'g-self' : 'g-opp'}${isTurn ? ' g-opp--turn' : ''}`}
      style={{ ['--pc' as string]: p.color }}
      data-player-panel={p.id}
      aria-label={self ? 'You' : p.name}
    >
      <div className="g-pp-head">
        <Avatar color={p.color} size={self ? 40 : 34} />
        <div className="g-pp-name">
          <b>{p.name}</b>
          {self && <span className="g-muted g-small">(you)</span>}
          {prompted && <span className="g-thinking" title="Deciding…">…</span>}
        </div>
        <span className="g-pp-vp" title={vpHidden !== undefined && vpHidden !== vp ? `${vp} visible + ${vpHidden - vp} hidden (of ${target})` : `Victory points (of ${target})`}>
          <GameIcon name="trophy" size={18} color="#f1c232" />
          <b>{vpHidden ?? vp}</b>
          {vpHidden !== undefined && vpHidden !== vp && <span className="g-muted g-small">({vp})</span>}
        </span>
      </div>

      <div className="g-opp-counts">
        <span className="g-pp-cards" title="Resource cards">
          <CardBack size="sm" />
          <b>{resourceTotal(p)}</b>
        </span>
        {decks.length === 0 && def.decks.length > 0 && (
          <span className="g-pp-cards" title="Cards in hand">
            <CardBack size="sm" dev color={deckColor(def, def.decks[0].id)} />
            <b>0</b>
          </span>
        )}
        {decks.map(({ deck, cards }, i) => (
          <span key={deck} className="g-pp-cards" title={i === 0 ? 'Cards in hand' : `${byId(def.decks, deck)?.name ?? deck} cards in hand`} data-deck={deck}>
            <CardBack size="sm" dev color={deckColor(def, deck)} />
            <b>{cards.length}</b>
          </span>
        ))}
        {def.awards.map((a) => (
          <Stat
            key={a.id}
            icon={awardIcon(def, a)}
            on={awardsHeld.includes(a)}
            value=''
            title={`${a.name}${awardsHeld.includes(a) ? ` — held${a.vp ? ` (+${a.vp} VP)` : ''}` : ' — not held'}`}
            color={awardsHeld.includes(a) ? '#f1c232' : undefined}
            testid={`award:${a.id}`}
          />
        ))}
        {stats.map((st) => (
          <Stat
            key={st.key}
            icon={st.icon && hasGameIcon(st.icon) ? st.icon : st.icon ?? 'trophy'}
            title={`${st.label}: ${st.value}${st.max ? ` / ${st.max}` : ''}`}
            testid={st.key}
            value={st.max ? '' : st.value}
          >
            {st.max ? (
              <span className="g-statpips" aria-hidden>
                {Array.from({ length: st.max }, (_, i) => <i key={i} className={i < st.value ? 'on' : ''} />)}
              </span>
            ) : null}
          </Stat>
        ))}
        {p.played.length > 0 && !self && (
          <span className="g-stat" title={`Played: ${p.played.map((c) => byId(def.cards, c.card)?.name ?? c.card).join(', ')}`}>
            <GameIcon name="cardBack" size={16} />
            <span className="g-small g-muted">played</span> <b>{p.played.length}</b>
          </span>
        )}
      </div>

      {pieces.length > 0 && (
        <div className="g-pp-pieces" aria-label="Pieces left">
          {pieces.map((pd) => (
            <span key={pd.id} className="g-pp-piece" title={`${pd.name}: ${piecesLeft(state, p, pd)} left`}>
              <GameIcon name={pd.icon} alt={[pd.id]} label={pd.name} size={15} color={p.color} />
              <b>{piecesLeft(state, p, pd)}</b>
            </span>
          ))}
        </div>
      )}

      {faceUp.length > 0 && (
        <div className="g-pp-faceup" aria-label="Face-up cards">
          {faceUp.map((c) => (
            <DevCard key={c.id} def={def} inst={c} size="sm" />
          ))}
        </div>
      )}

      {self && p.played.length > 0 && (
        <div className="g-pp-played">
          <span className="g-muted g-small">Played</span>
          {p.played.map((c) => (
            <DevCard key={c.id} def={def} inst={c} size="sm" dim />
          ))}
        </div>
      )}
    </div>
  );
}

/** Opponents in turn order (starting after the viewer), then the viewer. */
export function orderedPlayers(state: GameState, playerId: string): PlayerState[] {
  const order = state.turnOrder.length ? state.turnOrder : state.players.map((p) => p.id);
  const i = order.indexOf(playerId);
  const rotated = i < 0 ? order : [...order.slice(i + 1), ...order.slice(0, i)];
  return rotated.map((id) => state.players.find((p) => p.id === id)).filter((p): p is PlayerState => !!p);
}

export function OpponentsPanel({ def, state, playerId }: { def: GameDefinition; state: GameState; playerId: string }) {
  const engine = useEngine();
  const others = orderedPlayers(state, playerId);
  return (
    <section className="g-opps" aria-label="Opponents">
      {others.map((p) => (
        <PlayerPanel key={p.id} def={def} state={state} p={p} vp={engine.computeVP(def, state, p.id, false)} />
      ))}
    </section>
  );
}

export function SelfPanel({ def, state, me }: { def: GameDefinition; state: GameState; me: PlayerState }) {
  const engine = useEngine();
  return (
    <PlayerPanel
      def={def}
      state={state}
      p={me}
      self
      vp={engine.computeVP(def, state, me.id, false)}
      vpHidden={engine.computeVP(def, state, me.id, true)}
    />
  );
}

/** Compact strip of opponents for phones: avatar, VP, card count. Also an animation target. */
export function OpponentStrip({ def, state, playerId }: { def: GameDefinition; state: GameState; playerId: string }) {
  const engine = useEngine();
  const current = state.turnOrder[state.currentPlayerIndex];
  return (
    <div className="g-oppstrip" aria-label="Players">
      {orderedPlayers(state, playerId).map((p) => (
        <span key={p.id} className={`g-oppchip${p.id === current ? ' g-opp--turn' : ''}`} data-player-panel={p.id} style={{ ['--pc' as string]: p.color }} title={p.name}>
          <Avatar color={p.color} size={24} />
          <span className="g-oppchip-name">{p.name}</span>
          <span className="g-oppchip-stat"><GameIcon name="trophy" size={12} color="#f1c232" />{engine.computeVP(def, state, p.id, false)}</span>
          <span className="g-oppchip-stat"><GameIcon name="cardBack" size={12} />{resourceTotal(p)}</span>
          {p.hand.length > 0 && <span className="g-oppchip-stat"><GameIcon name="devBack" size={12} />{p.hand.length}</span>}
        </span>
      ))}
    </div>
  );
}
