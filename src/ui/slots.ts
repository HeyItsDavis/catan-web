/**
 * Screens owned by other workstreams. Resolved from either a named or a default
 * export so the shell keeps compiling whichever style those files use.
 */
import type { ComponentType } from 'react';
import type { Command, GameDefinition, GameState } from '../engine/schema';
import * as GameScreenModule from './game/GameScreen';

export interface GameScreenProps {
  def: GameDefinition;
  state: GameState;
  playerId: string;
  send: (c: Command) => void;
  /** `from` is the sender's display name. */
  chat: { from: string; text: string; at: number }[];
  sendChat: (t: string) => void;
}

function pick<P>(mod: Record<string, unknown>, name: string): ComponentType<P> {
  return (mod[name] ?? mod.default) as ComponentType<P>;
}

export const GameScreen = pick<GameScreenProps>(GameScreenModule as Record<string, unknown>, 'GameScreen');
