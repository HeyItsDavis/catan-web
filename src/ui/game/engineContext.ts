/**
 * Indirection between the game UI and the engine's query functions, so the
 * dev harness (and tests) can inject fakes. Defaults to the real engine.
 *
 * We import the engine as a namespace and look functions up lazily: while the
 * engine is still `export declare` stubs, a named import would fail at module
 * link time in the browser; a namespace lookup just yields undefined.
 */
import { createContext, useContext } from 'react';
import * as engine from '../../engine';
import type { AvailableMoves } from '../../engine';
import type { GameDefinition, GameState } from '../../engine/schema';

export interface EngineAdapter {
  getAvailableMoves(def: GameDefinition, state: GameState, playerId: string): AvailableMoves;
  computeVP(def: GameDefinition, state: GameState, playerId: string, includeHidden: boolean): number;
}

export function emptyMoves(state: GameState, playerId: string): AvailableMoves {
  return {
    canRoll: false,
    canEndTurn: false,
    builds: [],
    buyableDecks: [],
    playableCards: [],
    actions: [],
    bankRates: {},
    prompt: state.prompts.find((p) => p.player === playerId) ?? null,
  };
}

/** VP estimate from visible info: piece VP + token VP + awards. Used if the engine is unavailable. */
export function estimateVP(def: GameDefinition, state: GameState, playerId: string): number {
  const p = state.players.find((x) => x.id === playerId);
  let vp = p?.tokenVP ?? 0;
  for (const piece of state.pieces) {
    if (piece.owner !== playerId) continue;
    vp += def.pieces.find((d) => d.id === piece.type)?.vp ?? 0;
  }
  for (const [awardId, holder] of Object.entries(state.awards)) {
    if (holder === playerId) vp += def.awards.find((a) => a.id === awardId)?.vp ?? 0;
  }
  return vp;
}

type EngineNs = Partial<EngineAdapter>;

export const realEngine: EngineAdapter = {
  getAvailableMoves(def, state, playerId) {
    const fn = (engine as unknown as EngineNs).getAvailableMoves;
    if (typeof fn !== 'function') return emptyMoves(state, playerId);
    try {
      return fn(def, state, playerId);
    } catch (err) {
      console.error('getAvailableMoves failed', err);
      return emptyMoves(state, playerId);
    }
  },
  computeVP(def, state, playerId, includeHidden) {
    const fn = (engine as unknown as EngineNs).computeVP;
    if (typeof fn !== 'function') return estimateVP(def, state, playerId);
    try {
      return fn(def, state, playerId, includeHidden);
    } catch {
      return estimateVP(def, state, playerId);
    }
  },
};

export const EngineContext = createContext<EngineAdapter>(realEngine);
export const EngineProvider = EngineContext.Provider;

export function useEngine(): EngineAdapter {
  return useContext(EngineContext);
}
