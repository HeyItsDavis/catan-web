/**
 * Popover for a tapped board piece: what it is (type, owner, state, cargo) and, for the
 * viewer's own pieces, the piece actions the engine offers for it (AvailableMoves.actions
 * entries carrying this pieceId).
 */
import { useEffect } from 'react';
import type { AvailableMoves } from '../../engine';
import type { Command, GameDefinition, GameState } from '../../engine/schema';
import { Icon } from '../shared/icons';
import { CostChips, PlayerName, ResChip } from './chips';
import { cargoChips, pieceStateRows } from './display';
import { byId } from './util';

interface Props {
  def: GameDefinition;
  state: GameState;
  playerId: string;
  pieceId: string;
  /** Tap point and board size (px, relative to the board container). */
  at: { x: number; y: number; w?: number; h?: number };
  moves: AvailableMoves;
  /** Why actions are blocked right now (pending prompt, game over), or null. */
  blocked: string | null;
  send: (c: Command) => void;
  onClose: () => void;
}

export function PieceMenu({ def, state, playerId, pieceId, at, moves, blocked, send, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const inst = state.pieces.find((p) => p.id === pieceId);
  if (!inst) return null;
  const pd = byId(def.pieces, inst.type);
  const owner = state.players.find((p) => p.id === inst.owner);
  const mine = inst.owner === playerId;
  const rows = pieceStateRows(pd, inst);
  const cargo = cargoChips(def, pd, inst);
  const actions = mine ? moves.actions.filter((a) => a.pieceId === pieceId) : [];

  return (
    <>
      <div className="g-pmenu-backdrop" onClick={onClose} aria-hidden />
      <div
        className="g-pmenu"
        role="dialog"
        aria-label={`${pd?.name ?? inst.type} actions`}
        style={{
          left: `clamp(8px, ${at.x}px - 110px, calc(100% - 228px))`,
          // open below the piece in the top half of the board, above it in the bottom half
          ...(at.h && at.y > at.h / 2 ? { bottom: `${Math.max(8, at.h - at.y + 14)}px` } : { top: `${Math.max(8, at.y + 14)}px` }),
        }}
      >
        <div className="g-pmenu-head">
          <Icon name={pd?.icon ?? inst.type} label={pd?.name} size={22} fill={owner?.color ?? '#aaa'} />
          <div className="g-grow">
            <b>{pd?.name ?? inst.type}</b>
            <div className="g-small"><PlayerName p={owner} /></div>
          </div>
          <button type="button" className="g-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {rows.length > 0 && (
          <dl className="g-pmenu-state">
            {rows.map((r) => (
              <div key={r.key}>
                <dt>{r.label}</dt>
                <dd>{r.text}</dd>
              </div>
            ))}
          </dl>
        )}
        {cargo.length > 0 && (
          <div className="g-pmenu-cargo">
            <span className="g-muted g-small">Carrying</span>
            {cargo.map((c) =>
              byId(def.resources, c.key) ? (
                <ResChip key={c.key} def={def} id={c.key} amount={c.n} small />
              ) : (
                <span key={c.key} className="g-tag">{c.label} ×{c.n}</span>
              ),
            )}
          </div>
        )}
        {actions.length > 0 && (
          <div className="g-pmenu-actions">
            {actions.map((a) => {
              const reason = blocked ?? (a.enabled ? null : 'Not available right now');
              return (
                <button
                  key={a.action.id}
                  type="button"
                  className="g-abtn g-pmenu-btn"
                  disabled={!!reason}
                  title={[a.action.description, reason].filter(Boolean).join(' — ')}
                  onClick={() => {
                    send({ type: 'doAction', action: a.action.id, pieceId });
                    onClose();
                  }}
                >
                  <span className="g-abtn-top">
                    {a.action.icon && <Icon name={a.action.icon} label={a.action.name} size={18} fill={owner?.color} />}
                    <span className="g-abtn-label">{a.action.name}</span>
                  </span>
                  <CostChips def={def} cost={a.action.cost} />
                </button>
              );
            })}
          </div>
        )}
        {mine && actions.length === 0 && (pd?.pieceActions?.length ?? 0) > 0 && (
          <div className="g-muted g-small">No actions available for this piece right now.</div>
        )}
      </div>
    </>
  );
}
