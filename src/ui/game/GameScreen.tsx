/**
 * PLACEHOLDER created by the network workstream so the app shell compiles.
 * The game-UI workstream owns this file and replaces it; keep the props contract.
 */
import type { Command, GameDefinition, GameState } from '../../engine/schema';

export interface GameScreenProps {
  def: GameDefinition;
  state: GameState;
  playerId: string;
  send: (c: Command) => void;
  chat: { from: string; text: string; at: number }[];
  sendChat: (t: string) => void;
}

export function GameScreen({ state, playerId, send }: GameScreenProps) {
  const current = state.turnOrder[state.currentPlayerIndex];
  return (
    <div style={{ padding: 24 }}>
      <h2>Game in progress (placeholder)</h2>
      <p>Turn {state.turn} · phase {state.phase} · current player {state.players.find((p) => p.id === current)?.name}</p>
      {current === playerId && (
        <p>
          <button onClick={() => send({ type: 'rollDice' })}>Roll</button>{' '}
          <button onClick={() => send({ type: 'endTurn' })}>End turn</button>
        </p>
      )}
    </div>
  );
}

export default GameScreen;
