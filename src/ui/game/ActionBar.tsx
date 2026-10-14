/** Roll / build / buy / custom actions / trade / end turn. */
import type { AvailableMoves } from '../../engine';
import type { ActionDef, Command, GameDefinition, GameState } from '../../engine/schema';
import { Icon } from '../shared/icons';
import { CostChips } from './chips';
import { byId, humanize } from './util';

interface Props {
  def: GameDefinition;
  state: GameState;
  playerId: string;
  moves: AvailableMoves;
  send: (c: Command) => void;
  onTrade: () => void;
  hasOwnPrompt: boolean;
}

interface Btn {
  key: string;
  label: string;
  icon?: string;
  iconFill?: string;
  cost?: ActionDef['cost'];
  badge?: string;
  disabled: string | null; // reason, or null when enabled
  title?: string;
  onClick: () => void;
}

export function ActionBar({ def, state, playerId, moves, send, onTrade, hasOwnPrompt }: Props) {
  const myTurn = state.turnOrder[state.currentPlayerIndex] === playerId;
  const over = state.phase === 'gameOver' || !!state.winner;
  const me = state.players.find((p) => p.id === playerId);
  const myColor = me?.color ?? '#ccc';

  const baseBlock = (): string | null => {
    if (over) return 'Game over';
    if (hasOwnPrompt) return 'Answer the current prompt first';
    return null;
  };
  const turnBlock = (): string | null => baseBlock() ?? (myTurn ? null : 'Not your turn');

  const groups = new Map<string, Btn[]>();
  const add = (g: string, b: Btn) => groups.set(g, [...(groups.get(g) ?? []), b]);

  /* builds: show every costed piece; availability from moves.builds */
  const buildable = new Map(moves.builds.map((b) => [b.piece.id, b]));
  const pieceIds = new Set([...def.pieces.filter((p) => p.cost).map((p) => p.id), ...buildable.keys()]);
  for (const id of pieceIds) {
    const b = buildable.get(id);
    const pd = b?.piece ?? byId(def.pieces, id)!;
    const used = state.pieces.filter((x) => x.owner === playerId && x.type === id).length;
    const left = pd.supply >= 0 ? pd.supply - used : null;
    let reason = turnBlock();
    if (!reason) {
      if (!b) reason = left === 0 ? 'None left in supply' : 'Not available right now';
      else if (!b.affordable) reason = 'Not enough resources';
      else if (!b.hasSpot) reason = 'No legal spot';
    }
    add('build', {
      key: `piece:${id}`,
      label: pd.name,
      icon: pd.icon ?? id,
      iconFill: myColor,
      cost: pd.cost,
      badge: left !== null ? String(left) : undefined,
      disabled: reason,
      onClick: () => send({ type: 'build', piece: id }),
    });
  }

  /* decks */
  const buyable = new Map(moves.buyableDecks.map((d) => [d.deck, d]));
  for (const deck of def.decks.filter((d) => d.cost || buyable.has(d.id))) {
    const b = buyable.get(deck.id);
    const remaining = state.decks[deck.id]?.draw.length;
    let reason = turnBlock();
    if (!reason) {
      if (remaining === 0) reason = 'Deck is empty';
      else if (!b) reason = 'Not available right now';
      else if (!b.affordable) reason = 'Not enough resources';
    }
    add('cards', {
      key: `deck:${deck.id}`,
      label: `Buy ${deck.name}`,
      icon: 'card',
      iconFill: deck.color ?? '#7b68b5',
      cost: deck.cost,
      badge: remaining !== undefined ? String(remaining) : undefined,
      disabled: reason,
      onClick: () => send({ type: 'buyCard', deck: deck.id }),
    });
  }

  /* custom actions (recipes) */
  for (const a of moves.actions) {
    const piece = a.pieceId ? state.pieces.find((p) => p.id === a.pieceId) : undefined;
    const pieceName = piece ? byId(def.pieces, piece.type)?.name ?? piece.type : '';
    add(a.action.group ?? 'special', {
      key: `action:${a.action.id}:${a.pieceId ?? ''}`,
      label: pieceName ? `${a.action.name} (${pieceName})` : a.action.name,
      icon: a.action.icon,
      iconFill: myColor,
      cost: a.action.cost,
      title: a.action.description,
      disabled: baseBlock() ?? (a.enabled ? null : 'Not available right now'),
      onClick: () => send({ type: 'doAction', action: a.action.id, ...(a.pieceId ? { pieceId: a.pieceId } : {}) }),
    });
  }

  const tradeReason =
    baseBlock() ??
    (def.trade.onlyCurrentPlayer && !myTurn ? 'Not your turn' : null) ??
    (state.phase === 'setup' ? 'Not during setup' : null) ??
    (myTurn && !state.hasRolled && state.phase === 'preRoll' ? 'Roll first' : null);

  const order = ['build', 'cards', 'trade', 'special'];
  const groupKeys = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  const rollReason = turnBlock() ?? (moves.canRoll ? null : state.hasRolled ? 'Already rolled' : 'Cannot roll now');
  const endReason = turnBlock() ?? (moves.canEndTurn ? null : !state.hasRolled && state.phase !== 'setup' ? 'Roll first' : 'Cannot end turn now');

  return (
    <div className="g-actionbar" role="toolbar" aria-label="Actions">
      <div className="g-ab-group g-ab-primary">
        <button
          type="button"
          className={`g-btn g-btn--roll${!rollReason ? ' g-btn--primary g-btn--glow' : ''}`}
          disabled={!!rollReason}
          title={rollReason ?? 'Roll the dice'}
          onClick={() => send({ type: 'rollDice' })}
        >
          <Icon name="dice" size={18} fill="#fff" />
          Roll
        </button>
      </div>

      {groupKeys.map((g) => (
        <div key={g} className="g-ab-group">
          <span className="g-ab-label">{humanize(g)}</span>
          <div className="g-ab-btns">
            {g === 'trade' && <TradeBtn reason={tradeReason} onTrade={onTrade} />}
            {groups.get(g)!.map((b) => (
              <button
                key={b.key}
                type="button"
                className="g-abtn"
                disabled={!!b.disabled}
                title={[b.label, b.title, b.disabled].filter(Boolean).join(' — ')}
                onClick={b.onClick}
              >
                <span className="g-abtn-top">
                  {b.icon && <Icon name={b.icon} label={b.label} size={20} fill={b.iconFill} />}
                  <span className="g-abtn-label">{b.label}</span>
                  {b.badge !== undefined && <span className="g-badge">{b.badge}</span>}
                </span>
                <CostChips def={def} cost={b.cost} />
              </button>
            ))}
          </div>
        </div>
      ))}

      {!groups.has('trade') && (
        <div className="g-ab-group">
          <span className="g-ab-label">Trade</span>
          <div className="g-ab-btns">
            <TradeBtn reason={tradeReason} onTrade={onTrade} />
          </div>
        </div>
      )}

      <div className="g-ab-group g-ab-end">
        <button
          type="button"
          className={`g-btn${!endReason ? ' g-btn--primary' : ''}`}
          disabled={!!endReason}
          title={endReason ?? 'End your turn'}
          onClick={() => send({ type: 'endTurn' })}
        >
          End turn
        </button>
      </div>
    </div>
  );
}

function TradeBtn({ reason, onTrade }: { reason: string | null; onTrade: () => void }) {
  return (
    <button type="button" className="g-abtn" disabled={!!reason} title={reason ?? 'Trade with the bank or players'} onClick={onTrade}>
      <span className="g-abtn-top">
        <Icon name="coin" size={20} />
        <span className="g-abtn-label">Trade</span>
      </span>
      <span className="g-muted g-small">bank · ports · players</span>
    </button>
  );
}
