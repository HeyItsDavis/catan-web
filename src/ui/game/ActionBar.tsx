/**
 * Bottom-centre controls (colonist style): a wide status / "Roll dice" button with the current
 * player's avatar and the turn timer next to it, and below a row of square icon buttons: trade,
 * every buildable piece, every buyable deck, the mod's actions, end turn. Buttons come from the
 * definition + AvailableMoves; nothing is keyed on base-game ids.
 */
import type { AvailableMoves } from '../../engine';
import type { ActionDef, Command, GameDefinition, GameState, ResourceMap } from '../../engine/schema';
import { GameIcon, hasGameIcon } from '../shared/gameIcons';
import { MiniCards } from './cards';
import { TurnTimer, type TimerInfo } from './Info';
import { Avatar } from './Players';
import { promptLabel } from './display';
import { byId, humanize } from './util';

interface Props {
  def: GameDefinition;
  state: GameState;
  playerId: string;
  moves: AvailableMoves;
  send: (c: Command) => void;
  onTrade: () => void;
  tradeOpen?: boolean;
  /** Start a piece action that several pieces could perform (player then picks one on the board). */
  onPieceAction?: (actionId: string) => void;
  hasOwnPrompt: boolean;
  timer?: TimerInfo;
}

interface Btn {
  key: string;
  label: string;
  icon?: string;
  iconAlt?: string[];
  iconColor?: string;
  cost?: ResourceMap;
  badge?: string;
  disabled: string | null; // reason, or null when enabled
  title?: string;
  onClick: () => void;
}

/** Why trading is not possible right now (null = it is). */
export function tradeBlockReason(def: GameDefinition, state: GameState, playerId: string, hasOwnPrompt: boolean): string | null {
  const over = state.phase === 'gameOver' || !!state.winner;
  const myTurn = state.turnOrder[state.currentPlayerIndex] === playerId;
  if (over) return 'Game over';
  if (hasOwnPrompt) return 'Answer the current prompt first';
  if (def.trade.onlyCurrentPlayer && !myTurn) return 'Not your turn';
  if (state.phase === 'setup') return 'Not during setup';
  if (myTurn && !state.hasRolled && state.phase === 'preRoll') return 'Roll first';
  return null;
}

/** Numeric cost as colour dots (formulas show as "?"). */
function CostDots({ def, cost }: { def: GameDefinition; cost: ResourceMap | undefined }) {
  if (!cost) return null;
  const dots: { id: string; color: string }[] = [];
  let formula = false;
  for (const [id, e] of Object.entries(cost)) {
    if (typeof e !== 'number') { formula = true; continue; }
    const color = byId(def.resources, id)?.color ?? '#999';
    for (let i = 0; i < Math.min(e, 6); i++) dots.push({ id, color });
  }
  if (!dots.length && !formula) return null;
  return (
    <span className="g-costdots" aria-hidden>
      {dots.map((d, i) => <i key={i} style={{ background: d.color }} />)}
      {formula && <b>?</b>}
    </span>
  );
}

function costMap(cost: ResourceMap | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, e] of Object.entries(cost ?? {})) if (typeof e === 'number' && e > 0) out[id] = e;
  return out;
}

function SquareBtn({ def, b, active }: { def: GameDefinition; b: Btn; active?: boolean }) {
  const known = hasGameIcon(b.icon) || b.iconAlt?.some(hasGameIcon);
  const cost = costMap(b.cost);
  return (
    <button
      type="button"
      className={`g-abtn${active ? ' g-abtn--active' : ''}${known ? '' : ' g-abtn--text'}`}
      disabled={!!b.disabled}
      aria-label={b.label}
      data-key={b.key}
      onClick={b.onClick}
    >
      <GameIcon name={b.icon} alt={b.iconAlt} label={b.label} size={known ? 30 : 22} color={b.iconColor ?? 'currentColor'} />
      {!known && <span className="g-abtn-label">{b.label}</span>}
      <CostDots def={def} cost={b.cost} />
      {b.badge !== undefined && <span className="g-badge g-abtn-badge">{b.badge}</span>}
      <span className="g-tip" role="tooltip">
        <b>{b.label}</b>
        {Object.keys(cost).length > 0 && <MiniCards def={def} res={cost} maxEach={5} />}
        {b.title && <span className="g-tip-desc">{b.title}</span>}
        {b.disabled && <span className="g-tip-why">{b.disabled}</span>}
      </span>
    </button>
  );
}

export function ActionBar({ def, state, playerId, moves, send, onTrade, tradeOpen, onPieceAction, hasOwnPrompt, timer }: Props) {
  const myTurn = state.turnOrder[state.currentPlayerIndex] === playerId;
  const over = state.phase === 'gameOver' || !!state.winner;
  const me = state.players.find((p) => p.id === playerId);
  const myColor = me?.color ?? '#ccc';
  const cur = state.players.find((p) => p.id === state.turnOrder[state.currentPlayerIndex]);

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
    const left = pd.supply >= 0 ? Math.max(0, pd.supply - used - (me?.stats[`lost:${id}`] ?? 0)) : null;
    let reason = turnBlock();
    if (!reason) {
      if (!b) reason = left === 0 ? 'None left in supply' : 'Not available right now';
      else if (!b.affordable) reason = 'Not enough resources';
      else if (!b.hasSpot) reason = 'No legal spot';
    }
    add('build', {
      key: `piece:${id}`,
      label: pd.name,
      icon: pd.icon,
      iconAlt: [id],
      iconColor: myColor,
      cost: pd.cost,
      badge: left !== null ? String(left) : undefined,
      disabled: reason,
      title: left !== null ? `${left} left` : undefined,
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
      icon: 'buyCard',
      iconColor: deck.color ?? '#9b7fd1',
      cost: deck.cost,
      badge: remaining !== undefined ? String(remaining) : undefined,
      title: remaining !== undefined ? `${remaining} cards left` : undefined,
      disabled: reason,
      onClick: () => send({ type: 'buyCard', deck: deck.id }),
    });
  }

  /* custom actions (recipes). Piece actions: one button per action; with several eligible
     pieces the player then picks one on the board (onPieceAction). */
  const pieceActs = new Map<string, { action: ActionDef; pieces: string[]; enabled: string[] }>();
  for (const a of moves.actions) {
    if (a.pieceId) {
      const e = pieceActs.get(a.action.id) ?? { action: a.action, pieces: [], enabled: [] };
      e.pieces.push(a.pieceId);
      if (a.enabled) e.enabled.push(a.pieceId);
      if (!pieceActs.has(a.action.id)) {
        pieceActs.set(a.action.id, e);
        // reserve the slot in its group now so order follows the definition
        add(a.action.group ?? 'special', { key: `paction:${a.action.id}`, label: '', disabled: null, onClick: () => {} });
      }
      continue;
    }
    add(a.action.group ?? 'special', {
      key: `action:${a.action.id}`,
      label: a.action.name,
      icon: a.action.icon,
      iconAlt: [a.action.id],
      iconColor: myColor,
      cost: a.action.cost,
      title: a.action.description,
      disabled: baseBlock() ?? (a.enabled ? null : 'Not available right now'),
      onClick: () => send({ type: 'doAction', action: a.action.id }),
    });
  }
  for (const [id, e] of pieceActs) {
    const g = e.action.group ?? 'special';
    const names = [...new Set(e.pieces.map((pid) => {
      const t = state.pieces.find((p) => p.id === pid)?.type;
      return byId(def.pieces, t)?.name ?? t ?? '';
    }))].filter(Boolean);
    const btn: Btn = {
      key: `paction:${id}`,
      label: e.action.name,
      icon: e.action.icon,
      iconAlt: [id],
      iconColor: myColor,
      cost: e.action.cost,
      badge: e.pieces.length > 1 ? `${e.enabled.length}/${e.pieces.length}` : undefined,
      title: [e.action.description, names.length ? `On: ${names.join(', ')}` : '', e.enabled.length > 1 ? 'Then pick a piece on the board' : '']
        .filter(Boolean).join(' · '),
      disabled: baseBlock() ?? (e.enabled.length ? null : 'Not available right now'),
      onClick: () => {
        if (e.enabled.length === 1) send({ type: 'doAction', action: id, pieceId: e.enabled[0] });
        else if (onPieceAction) onPieceAction(id);
        else send({ type: 'doAction', action: id, pieceId: e.enabled[0] });
      },
    };
    groups.set(g, groups.get(g)!.map((b) => (b.key === btn.key ? btn : b)));
  }

  const tradeReason = tradeBlockReason(def, state, playerId, hasOwnPrompt);
  const tradeBtn: Btn = {
    key: 'trade',
    label: 'Trade',
    icon: 'trade',
    disabled: tradeReason,
    title: 'Trade with the bank, your harbors or other players. Tip: click cards in your hand.',
    onClick: onTrade,
  };

  const order = ['build', 'cards', 'trade', 'special'];
  const groupKeys = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  const rollReason = turnBlock() ?? (moves.canRoll ? null : state.hasRolled ? 'Already rolled' : 'Cannot roll now');
  const endReason = turnBlock() ?? (moves.canEndTurn ? null : !state.hasRolled && state.phase !== 'setup' ? 'Roll first' : 'Cannot end turn now');

  // Status text for the big button.
  const myPrompt = moves.prompt ?? state.prompts.find((p) => p.player === playerId);
  let status: string;
  if (over) status = 'Game over';
  else if (!rollReason) status = 'Roll dice';
  else if (myPrompt) status = promptLabel(myPrompt) || 'Your choice';
  else if (myTurn) status = state.phase === 'setup' ? 'Place your pieces' : state.phase === 'specialBuild' ? 'Special building phase' : 'Your turn';
  else {
    const waiting = state.prompts.find((p) => p.player !== playerId);
    const wp = waiting ? state.players.find((p) => p.id === waiting.player) : cur;
    status = state.phase === 'preRoll' && !waiting ? `${cur?.name ?? '?'}'s turn — rolling` : `Waiting for ${wp?.name ?? '?'}`;
  }
  const statusColor = myPrompt || myTurn ? myColor : cur?.color ?? '#888';

  return (
    <div className="g-actionbar" role="toolbar" aria-label="Actions">
      <div className="g-statusrow">
        <button
          type="button"
          className={`g-status${!rollReason ? ' g-status--roll' : ''}${myTurn ? ' g-turn--mine' : ''}`}
          disabled={!!rollReason}
          title={rollReason ? status : 'Roll the dice'}
          onClick={() => send({ type: 'rollDice' })}
          data-testid="status"
          style={{ ['--pc' as string]: statusColor }}
        >
          <Avatar color={statusColor} size={28} />
          <span className="g-status-text">{status}</span>
          {!rollReason && <GameIcon name="dice" size={24} color="#1d1d22" />}
        </button>
        <TurnTimer state={state} timer={timer} />
      </div>

      <div className="g-ab-row">
        <SquareBtn def={def} b={tradeBtn} active={tradeOpen} />
        {groupKeys.map((g) => (
          <div key={g} className="g-ab-group" role="group" aria-label={humanize(g)} data-group={g}>
            {groups.get(g)!.map((b) => <SquareBtn key={b.key} def={def} b={b} />)}
          </div>
        ))}
        <SquareBtn
          def={def}
          b={{ key: 'end', label: 'End turn', icon: 'hourglass', disabled: endReason, onClick: () => send({ type: 'endTurn' }) }}
          active={!endReason}
        />
      </div>
    </div>
  );
}
