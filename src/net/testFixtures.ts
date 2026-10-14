/** Fake engine + definitions for net tests (the real engine is developed separately). */
import type { Command, GameDefinition, GameState, LobbySettings, MapDef, ModDef } from '../engine/schema';
import type { EngineApi } from './host';

export function makeMap(id: string, minPlayers: number, maxPlayers: number): MapDef {
  return { id, name: id, minPlayers, maxPlayers, hexes: [] };
}

export function makeDef(mods: ModDef[] = []): GameDefinition {
  const maps: MapDef[] = [makeMap('standard', 2, 4), makeMap('big', 5, 6)];
  const settings = mods.flatMap((m) => m.settings ?? []);
  for (const m of mods) maps.push(...(m.maps ?? []));
  return {
    mods: mods.map((m) => m.meta), resources: [], terrains: [], pieces: [], cards: [], decks: [], actions: [],
    tokens: [], awards: [], ports: [], maps, triggers: [], settings, dice: { numeric: [{ sides: 6 }, { sides: 6 }] },
    setup: [], trade: { bankRates: { resource: 4 }, playerTrading: true, onlyCurrentPlayer: true },
    victoryPoints: mods.reduce((v, m) => m.victoryPoints ?? v, 10),
    discardLimit: mods.reduce((v, m) => m.discardLimit ?? v, 7),
  };
}

export function mod(id: string, extra: Partial<ModDef> = {}): ModDef {
  return { meta: { id, name: id, version: '1.0.0', extends: ['base'] }, ...extra };
}

/** Toy engine: commands 'rollDice' bump version, 'endTurn' advances the turn, anything else is rejected. */
export const fakeEngine: EngineApi = {
  buildDefinition(mods: ModDef[]) {
    const extra = mods.filter((m) => m.meta.id !== 'base');
    if (extra.some((m) => m.meta.id === 'broken')) throw new Error('broken mod');
    return makeDef(extra);
  },
  createGame(_def: GameDefinition, settings: LobbySettings, players, seed): GameState {
    return {
      version: 0, seed, rngState: seed, settings,
      players: players.map((p) => ({
        id: p.id, name: p.name, color: p.color, resources: { secret: 1 }, hand: [], played: [], stats: {}, flags: {},
        tokenVP: 0, tradeRates: [], actionUses: {}, cardPlaysThisTurn: {},
      })),
      turnOrder: players.map((p) => p.id), currentPlayerIndex: 0, turn: 1, phase: 'main', hasRolled: false,
      lastRoll: null, hexes: {}, pieces: [], tokens: {}, ports: [], decks: {}, bank: {}, globals: {}, awards: {},
      prompts: [], stack: [], trades: [], log: [], winner: null,
    };
  },
  applyCommand(_def, state, playerId, cmd: Command) {
    if (state.turnOrder[state.currentPlayerIndex] !== playerId) return { ok: false, error: 'Not your turn' };
    if (cmd.type === 'rollDice') return { ok: true, state: { ...state, version: state.version + 1, hasRolled: true } };
    if (cmd.type === 'endTurn') {
      return {
        ok: true,
        state: {
          ...state, version: state.version + 1, hasRolled: false, turn: state.turn + 1,
          currentPlayerIndex: (state.currentPlayerIndex + 1) % state.turnOrder.length,
        },
      };
    }
    return { ok: false, error: 'unsupported' };
  },
  redactFor(_def, state, playerId) {
    return {
      ...state,
      players: state.players.map((p) => (p.id === playerId ? p : { ...p, resources: {} })),
    };
  },
};

export class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.data.set(k, v); }
  removeItem(k: string): void { this.data.delete(k); }
}
