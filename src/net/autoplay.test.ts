import { describe, expect, it } from 'vitest';
import { baseMod } from '../content/base';
import { applyCommand, buildDefinition, createGame, type GameState, type LobbySettings } from '../engine';
import { timeoutCommand } from './autoplay';

const def = buildDefinition([baseMod]);
const settings: LobbySettings = {
  mapId: 'base-standard', maxPlayers: 4, victoryPoints: 10, discardLimit: 7, diceMode: 'random',
  friendlyRobber: false, hideBankCards: false, turnTimerSeconds: 60, randomizeTurnOrder: false, mods: [], modSettings: {},
};

/** Who the host's timer is waiting on (same rule as HostRoom.actingPlayer). */
const acting = (g: GameState) => g.prompts[0]?.player ?? g.turnOrder[g.currentPlayerIndex];

describe('turn-timer auto-play', () => {
  it('can drive a whole stretch of game (setup, 7s, robber, turns) using only timeout moves', () => {
    for (const seed of [1, 2, 3, 4]) {
      let g = createGame(def, settings, [
        { id: 'a', name: 'A', color: '#f00' }, { id: 'b', name: 'B', color: '#00f' }, { id: 'c', name: 'C', color: '#0f0' },
      ], seed);
      let turnsEnded = 0;
      for (let step = 0; step < 600 && turnsEnded < 30; step++) {
        const pid = acting(g);
        const cmd = timeoutCommand(def, g, pid);
        expect(cmd, `seed ${seed} step ${step}: a move for ${pid} in ${g.phase}`).toBeTruthy();
        const res = applyCommand(def, g, pid, cmd!);
        if (!res.ok) throw new Error(`seed ${seed} step ${step}: ${JSON.stringify(cmd)} -> ${res.error}`);
        g = res.state;
        if (cmd!.type === 'endTurn') turnsEnded++;
      }
      expect(turnsEnded).toBe(30);
      expect(g.phase).not.toBe('setup');
    }
  });

  it('discards the most plentiful cards and skips optional prompts', () => {
    const g = createGame(def, settings, [{ id: 'a', name: 'A', color: '#f00' }, { id: 'b', name: 'B', color: '#00f' }], 1);
    const s: GameState = {
      ...g,
      players: g.players.map((p) => (p.id === 'a' ? { ...p, resources: { brick: 1, lumber: 5, wool: 2, grain: 0, ore: 0 } } : p)),
      prompts: [{ id: 'x', player: 'a', kind: 'discard', label: 'Discard', options: ['brick', 'lumber', 'wool', 'grain', 'ore'], amount: 4 }],
    };
    expect(timeoutCommand(def, s, 'a')).toEqual({ type: 'respond', promptId: 'x', answer: { lumber: 4 } });
    const opt: GameState = { ...s, prompts: [{ id: 'y', player: 'a', kind: 'player', label: 'Rob', options: ['b'], optional: true }] };
    expect(timeoutCommand(def, opt, 'a')).toEqual({ type: 'respond', promptId: 'y', answer: null });
    expect(timeoutCommand(def, opt, 'b')).toBeNull();
  });
});
