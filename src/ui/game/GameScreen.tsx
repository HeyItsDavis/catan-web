/**
 * The in-game screen (colonist-style layout). Pure view over (def, state); every change goes
 * through `send`. Engine queries (getAvailableMoves, computeVP) come from EngineContext so the
 * dev harness can inject fakes; by default the real engine is used.
 *
 *   ┌──────────────── board (ocean) ───────────────┬── log ──────┐
 *   │ prompt banner                         zoom   │── chat ─────│
 *   │ offers                    waiting     dice   │── bank ─────│
 *   ├── hand (cards) ──────┬─ status · timer ──────┤── players ──│
 *   │                      │ [trade][road]…[end]   │── you ──────│
 *   └──────────────────────┴───────────────────────┴─────────────┘
 * On phones the sidebar becomes tabs below the board; hand + actions stay docked at the bottom.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Command, GameDefinition, GameState } from '../../engine/schema';
import { GameIcon, gameIconCredits } from '../shared/gameIcons';
import { ActionBar, tradeBlockReason } from './ActionBar';
import { Board, type BoardPick } from './Board';
import { useEngine } from './engineContext';
import { FlyLayer } from './FlyLayer';
import { Hand } from './Hand';
import { BankDisplay, Chat, DiceDisplay, GameInfoPanel, GameLog, GameOverOverlay, type TimerInfo } from './Info';
import { PieceMenu } from './PieceMenu';
import { OpponentsPanel, OpponentStrip, SelfPanel } from './Players';
import { PieceActionBanner, PromptPanel, WaitingFor } from './PromptPanel';
import { emptyDraft, offerCard, TradeOffers, TradePanel, type TradeDraft } from './Trade';
import { globalRows } from './display';
import { isRedacted } from './util';
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

type MobileTab = 'log' | 'chat' | 'players';

export function GameScreen({ def, state, playerId, send, chat, sendChat, timer }: GameScreenProps) {
  const engine = useEngine();
  const moves = useMemo(() => engine.getAvailableMoves(def, state, playerId), [engine, def, state, playerId]);
  /** Trade panel draft (null = closed). */
  const [draft, setDraft] = useState<TradeDraft | null>(null);
  const [mtab, setMtab] = useState<MobileTab>('log');
  const [chatSeen, setChatSeen] = useState(chat.length);
  /** Piece menu (tapped piece + where). */
  const [menuState, setMenu] = useState<{ pieceId: string; x: number; y: number; w: number; h: number } | null>(null);
  /** Piece action waiting for the player to pick which piece (several eligible). */
  // Remembered with the state version it was started at: any game change cancels it.
  const [actionPickAt, setActionPick] = useState<{ id: string; version: number } | null>(null);

  const me = state.players.find((p) => p.id === playerId);
  const myPrompt = moves.prompt ?? state.prompts.find((p) => p.player === playerId) ?? null;
  const over = state.phase === 'gameOver' || !!state.winner;
  const blocked = over ? 'Game over' : myPrompt ? 'Answer the current prompt first' : null;
  const tradeBlocked = tradeBlockReason(def, state, playerId, !!myPrompt);

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

  /** Click on a hand card: open the trade panel with one more of it on the "give" side. */
  const held = (id: string) => (me && !isRedacted(me) ? me.resources[id] ?? 0 : 0);
  const offerFromHand = tradeBlocked || !me
    ? null
    : (id: string) => setDraft((d) => offerCard(d, id, held(id)));

  const boardPrompt = myPrompt && (myPrompt.kind === 'location' || myPrompt.kind === 'piece');
  const unread = mtab === 'chat' ? 0 : Math.max(0, chat.length - chatSeen);
  const chooseTab = (t: MobileTab) => {
    setChatSeen(chat.length);
    setMtab(t);
  };
  const hasGlobals = globalRows(def, state).length > 0;
  const credits = gameIconCredits();

  return (
    <div className="g-root" data-mtab={mtab}>
      <main className={`g-center${pick ? ' g-center--picking' : ''}`} data-anchor="board">
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
        <div className="g-overlay-offers">
          <TradeOffers def={def} state={state} playerId={playerId} send={send} />
        </div>
        <div className="g-overlay-bottom">
          <WaitingFor state={state} playerId={playerId} />
        </div>
        {hasGlobals && (
          <div className="g-overlay-globals">
            <GameInfoPanel def={def} state={state} playerId={playerId} show="globals" />
          </div>
        )}
        <div className="g-overlay-dice">
          <DiceDisplay def={def} state={state} />
        </div>
        {draft && me && !over && (
          <div className="g-overlay-trade">
            <TradePanel
              def={def}
              state={state}
              playerId={playerId}
              moves={moves}
              send={send}
              draft={draft}
              onChange={setDraft}
              onClose={() => setDraft(null)}
              blocked={tradeBlocked}
            />
          </div>
        )}
      </main>

      <div className="g-phone-top">
        <OpponentStrip def={def} state={state} playerId={playerId} />
      </div>

      {me ? (
        <footer className="g-bottom">
          <Hand
            def={def}
            me={me}
            moves={moves}
            discardLimit={state.settings.discardLimit || def.discardLimit}
            offered={draft?.give}
            onResource={offerFromHand}
            resourceHint={tradeBlocked ?? undefined}
            onPlayCard={(id) => send({ type: 'playCard', cardInstance: id })}
          />
          <ActionBar
            def={def}
            state={state}
            playerId={playerId}
            moves={moves}
            send={send}
            onTrade={() => setDraft((d) => (d ? null : emptyDraft()))}
            tradeOpen={!!draft}
            onPieceAction={startPieceAction}
            hasOwnPrompt={!!myPrompt}
            timer={timer}
          />
        </footer>
      ) : (
        <footer className="g-bottom g-bottom--spectator">
          <span className="g-muted">Spectating</span>
        </footer>
      )}

      <aside className="g-right">
        <nav className="g-mtabs" role="tablist" aria-label="Sidebar">
          {(['log', 'chat', 'players'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={mtab === t} className={mtab === t ? 'g-mtab g-mtab--on' : 'g-mtab'} onClick={() => chooseTab(t)}>
              {t === 'log' ? 'Log' : t === 'chat' ? 'Chat' : 'Players'}
              {t === 'chat' && unread > 0 && <span className="g-badge g-badge--hot">{unread}</span>}
            </button>
          ))}
        </nav>
        <div className="g-logchat">
          <section className="g-sec g-sec--log" data-sec="log" aria-label="Log">
            <GameLog def={def} state={state} />
          </section>
          <section className="g-sec g-sec--chat" data-sec="chat" aria-label="Chat">
            <Chat state={state} chat={chat} sendChat={sendChat} />
          </section>
        </div>
        <section className="g-sec g-sec--bank" data-sec="bank">
          <BankDisplay def={def} state={state} />
        </section>
        {def.awards.length > 0 && (
          <section className="g-sec g-sec--info" data-sec="info">
            <details className="g-info-details">
              <summary>Awards</summary>
              <GameInfoPanel def={def} state={state} playerId={playerId} show="awards" />
            </details>
          </section>
        )}
        <section className="g-sec g-sec--players" data-sec="players">
          <OpponentsPanel def={def} state={state} playerId={playerId} />
          {me ? <SelfPanel def={def} state={state} me={me} /> : <div className="g-muted g-small">Spectating</div>}
        </section>
        <a
          className="g-credits"
          href="https://game-icons.net"
          target="_blank"
          rel="noreferrer"
          title={`Icons by ${[...new Set(credits.map((c) => c.author))].join(', ')} from game-icons.net, CC BY 3.0`}
        >
          <GameIcon name="cardBack" size={12} /> Icons: game-icons.net (CC BY 3.0)
        </a>
      </aside>

      <FlyLayer def={def} state={state} playerId={playerId} />

      {myPrompt && !boardPrompt && !over && (
        <PromptPanel def={def} state={state} playerId={playerId} prompt={myPrompt} send={send} />
      )}
      {over && <GameOverOverlay def={def} state={state} playerId={playerId} />}
    </div>
  );
}

export default GameScreen;
