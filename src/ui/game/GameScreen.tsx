/**
 * The in-game screen. Pure view over (def, state); every change goes through `send`.
 * Engine queries (getAvailableMoves, computeVP) come from EngineContext so the
 * dev harness can inject fakes; by default the real engine is used.
 */
import { useMemo, useState } from 'react';
import type { Command, GameDefinition, GameState } from '../../engine/schema';
import { ActionBar } from './ActionBar';
import { Board, type BoardPick } from './Board';
import { useEngine } from './engineContext';
import { BankDisplay, DiceDisplay, GameOverOverlay, LogChatTabs, TurnIndicator } from './Info';
import { OpponentsPanel, SelfPanel } from './Players';
import { PromptPanel, WaitingFor } from './PromptPanel';
import { TradeDialog, TradeOffers } from './Trade';
import './game.css';

export interface GameScreenProps {
  def: GameDefinition;
  state: GameState;
  playerId: string;
  send: (c: Command) => void;
  chat: { from: string; text: string; at: number }[];
  sendChat: (t: string) => void;
}

export function GameScreen({ def, state, playerId, send, chat, sendChat }: GameScreenProps) {
  const engine = useEngine();
  const moves = useMemo(() => engine.getAvailableMoves(def, state, playerId), [engine, def, state, playerId]);
  const [tradeOpen, setTradeOpen] = useState(false);

  const me = state.players.find((p) => p.id === playerId);
  const myPrompt = moves.prompt ?? state.prompts.find((p) => p.player === playerId) ?? null;
  const over = state.phase === 'gameOver' || !!state.winner;

  const pick = useMemo<BoardPick | null>(() => {
    if (!myPrompt || (myPrompt.kind !== 'location' && myPrompt.kind !== 'piece')) return null;
    const opts = new Set(myPrompt.options);
    return {
      locations: myPrompt.kind === 'location' ? opts : new Set(),
      pieces: myPrompt.kind === 'piece' ? opts : new Set(),
      onPick: (id) => send({ type: 'respond', promptId: myPrompt.id, answer: id }),
    };
  }, [myPrompt, send]);

  return (
    <div className="g-root">
      <header className="g-top">
        <TurnIndicator state={state} playerId={playerId} />
        <DiceDisplay def={def} state={state} />
        <BankDisplay def={def} state={state} />
      </header>

      <aside className="g-left">
        <OpponentsPanel def={def} state={state} playerId={playerId} />
      </aside>

      <main className={`g-center${pick ? ' g-center--picking' : ''}`}>
        <Board def={def} state={state} pick={pick} />
        {myPrompt && (myPrompt.kind === 'location' || myPrompt.kind === 'piece') && (
          <div className="g-overlay-top">
            <PromptPanel def={def} state={state} playerId={playerId} prompt={myPrompt} send={send} />
          </div>
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
            hasOwnPrompt={!!myPrompt}
          />
        </footer>
      )}

      {myPrompt && myPrompt.kind !== 'location' && myPrompt.kind !== 'piece' && !over && (
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
