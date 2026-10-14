/**
 * The in-game screen. Pure view over (def, state); every change goes through `send`.
 * Engine queries (getAvailableMoves, computeVP) come from EngineContext so the
 * dev harness can inject fakes; by default the real engine is used.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Command, GameDefinition, GameState } from '../../engine/schema';
import { ActionBar } from './ActionBar';
import { Board, type BoardPick } from './Board';
import { useEngine } from './engineContext';
import { BankDisplay, DiceDisplay, GameInfoPanel, GameOverOverlay, LogChatTabs, TurnIndicator, type TimerInfo } from './Info';
import { PieceMenu } from './PieceMenu';
import { OpponentsPanel, SelfPanel } from './Players';
import { PieceActionBanner, PromptPanel, WaitingFor } from './PromptPanel';
import { TradeDialog, TradeOffers } from './Trade';
import './game.css';

export interface GameScreenProps {
  def: GameDefinition;
  state: GameState;
  playerId: string;
  send: (c: Command) => void;
  chat: { from: string; text: string; at: number }[];
  sendChat: (t: string) => void;
  /** Turn-timer deadline from the room host (omit for a client-side estimate). */
  timer?: TimerInfo;
}

export function GameScreen({ def, state, playerId, send, chat, sendChat, timer }: GameScreenProps) {
  const engine = useEngine();
  const moves = useMemo(() => engine.getAvailableMoves(def, state, playerId), [engine, def, state, playerId]);
  const [tradeOpen, setTradeOpen] = useState(false);
  /** Piece menu (tapped piece + where). */
  const [menuState, setMenu] = useState<{ pieceId: string; x: number; y: number; w: number; h: number } | null>(null);
  /** Piece action waiting for the player to pick which piece (several eligible). */
  // Remembered with the state version it was started at: any game change cancels it.
  const [actionPickAt, setActionPick] = useState<{ id: string; version: number } | null>(null);

  const me = state.players.find((p) => p.id === playerId);
  const myPrompt = moves.prompt ?? state.prompts.find((p) => p.player === playerId) ?? null;
  const over = state.phase === 'gameOver' || !!state.winner;
  const blocked = over ? 'Game over' : myPrompt ? 'Answer the current prompt first' : null;

  // Local modes are derived as stale-safe: a menu for a piece that left the board, or a piece-action
  // pick from an older state version, simply isn't shown.
  const menu = menuState && state.pieces.some((p) => p.id === menuState.pieceId) ? menuState : null;
  const pending = actionPickAt && actionPickAt.version === state.version && !myPrompt && !over ? actionPickAt.id : null;
  const actionPieces = useMemo(
    () => (pending ? moves.actions.filter((a) => a.action.id === pending && a.pieceId && a.enabled).map((a) => a.pieceId!) : []),
    [pending, moves.actions],
  );
  const actionPick = actionPieces.length ? pending : null;

  const pick = useMemo<BoardPick | null>(() => {
    if (!myPrompt) {
      if (!actionPick || actionPieces.length === 0) return null;
      return {
        locations: new Set(),
        pieces: new Set(actionPieces),
        mode: 'select',
        onPick: (pieceId) => {
          setActionPick(null);
          send({ type: 'doAction', action: actionPick, pieceId });
        },
      };
    }
    if (myPrompt.kind !== 'location' && myPrompt.kind !== 'piece') return null;
    const opts = new Set(myPrompt.options);
    const chosen = myPrompt.progress?.chosen?.length ? new Set(myPrompt.progress.chosen) : undefined;
    if (myPrompt.kind === 'location') {
      const moving = myPrompt.pieceId && state.pieces.some((p) => p.id === myPrompt.pieceId) ? myPrompt.pieceId : undefined;
      return {
        locations: opts,
        pieces: new Set(),
        mode: moving ? 'move' : 'place',
        movingPieceId: moving,
        ghostPiece: moving ? undefined : myPrompt.piece,
        chosen,
        onPick: (id) => send({ type: 'respond', promptId: myPrompt.id, answer: id }),
      };
    }
    // Piece prompts: the engine offers the LOCATIONS of the candidate pieces (piece instance ids are
    // accepted too). Highlight the pieces standing there and answer with whatever the option was.
    const answerFor = new Map<string, string>();
    for (const pc of state.pieces) {
      if (opts.has(pc.id)) answerFor.set(pc.id, pc.id);
      else if (opts.has(pc.at) && !answerFor.has(pc.id)) answerFor.set(pc.id, pc.at);
    }
    return {
      locations: new Set(),
      pieces: new Set(answerFor.keys()),
      mode: 'select',
      chosen,
      onPick: (pieceId) => send({ type: 'respond', promptId: myPrompt.id, answer: answerFor.get(pieceId) ?? pieceId }),
    };
  }, [myPrompt, send, state.pieces, actionPick, actionPieces]);

  const onPieceTap = useCallback((pieceId: string, at: { x: number; y: number; w: number; h: number }) => setMenu({ pieceId, ...at }), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const startPieceAction = useCallback(
    (actionId: string) => {
      setMenu(null);
      setActionPick({ id: actionId, version: state.version });
    },
    [state.version],
  );

  const boardPrompt = myPrompt && (myPrompt.kind === 'location' || myPrompt.kind === 'piece');

  return (
    <div className="g-root">
      <header className="g-top">
        <TurnIndicator state={state} playerId={playerId} timer={timer} />
        <DiceDisplay def={def} state={state} />
        <BankDisplay def={def} state={state} />
      </header>

      <aside className="g-left">
        <OpponentsPanel def={def} state={state} playerId={playerId} />
      </aside>

      <main className={`g-center${pick ? ' g-center--picking' : ''}`}>
        <Board def={def} state={state} pick={pick} onPieceTap={onPieceTap} selectedPiece={menu?.pieceId ?? null} />
        {boardPrompt && (
          <div className="g-overlay-top">
            <PromptPanel def={def} state={state} playerId={playerId} prompt={myPrompt} send={send} />
          </div>
        )}
        {!boardPrompt && actionPick && actionPieces.length > 0 && (
          <div className="g-overlay-top">
            <PieceActionBanner def={def} actionId={actionPick} count={actionPieces.length} onCancel={() => setActionPick(null)} />
          </div>
        )}
        {menu && (
          <PieceMenu
            def={def}
            state={state}
            playerId={playerId}
            pieceId={menu.pieceId}
            at={menu}
            moves={moves}
            blocked={blocked}
            send={send}
            onClose={closeMenu}
          />
        )}
        <div className="g-overlay-bottom">
          <WaitingFor state={state} playerId={playerId} />
        </div>
      </main>

      <aside className="g-right">
        {me ? (
          <SelfPanel def={def} state={state} me={me} moves={moves} send={send} />
        ) : (
          <section className="g-panel g-muted">Spectating</section>
        )}
        <GameInfoPanel def={def} state={state} playerId={playerId} />
        <TradeOffers def={def} state={state} playerId={playerId} send={send} />
        <LogChatTabs state={state} chat={chat} sendChat={sendChat} />
      </aside>

      {me && (
        <footer className="g-bottom">
          <ActionBar
            def={def}
            state={state}
            playerId={playerId}
            moves={moves}
            send={send}
            onTrade={() => setTradeOpen(true)}
            onPieceAction={startPieceAction}
            hasOwnPrompt={!!myPrompt}
          />
        </footer>
      )}

      {myPrompt && !boardPrompt && !over && (
        <PromptPanel def={def} state={state} playerId={playerId} prompt={myPrompt} send={send} />
      )}
      {tradeOpen && me && !over && (
        <TradeDialog def={def} state={state} playerId={playerId} moves={moves} send={send} onClose={() => setTradeOpen(false)} />
      )}
      {over && <GameOverOverlay def={def} state={state} playerId={playerId} />}
    </div>
  );
}

export default GameScreen;
