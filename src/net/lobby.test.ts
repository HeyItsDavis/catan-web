import { describe, expect, it } from 'vitest';
import {
  canStart, createLobby, lobbyReducer, PLAYER_COLORS, sanitizeName, validateModList,
  type LobbyAction, type LobbyContext, type LobbyState,
} from './lobby';
import { fakeEngine, makeDef, makeMap, mod } from './testFixtures';

const ctx: LobbyContext = { def: makeDef(), resolveDef: (mods) => fakeEngine.buildDefinition(mods) };

function run(state: LobbyState, ...actions: LobbyAction[]): LobbyState {
  for (const a of actions) {
    const r = lobbyReducer(state, a, ctx);
    if (!r.ok) throw new Error(r.error);
    state = r.state;
  }
  return state;
}

function expectErr(state: LobbyState, action: LobbyAction, match: RegExp) {
  const r = lobbyReducer(state, action, ctx);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(match);
}

const fresh = () => createLobby({ id: 'h', name: 'Hosty' }, makeDef());

describe('lobby reducer', () => {
  it('creates a lobby with the host and default settings', () => {
    const s = fresh();
    expect(s.players).toHaveLength(1);
    expect(s.players[0]).toMatchObject({ id: 'h', isHost: true, ready: true, color: PLAYER_COLORS[0] });
    expect(s.settings.mapId).toBe('standard');
    expect(s.settings.victoryPoints).toBe(10);
  });

  it('joins players with unique colors, reconnects existing seats', () => {
    let s = run(fresh(), { type: 'join', playerId: 'a', name: 'Ann' }, { type: 'join', playerId: 'b', name: '' });
    const colors = s.players.map((p) => p.color);
    expect(new Set(colors).size).toBe(3);
    expect(s.players[2].name).toBe('Player 3');
    s = run(s, { type: 'connected', playerId: 'a', connected: false });
    expect(s.players[1].connected).toBe(false);
    s = run(s, { type: 'join', playerId: 'a', name: 'Ann2' });
    expect(s.players).toHaveLength(3);
    expect(s.players[1]).toMatchObject({ connected: true, name: 'Ann2' });
  });

  it('enforces max players', () => {
    let s = fresh();
    s = run(s, { type: 'settings', by: 'h', settings: { ...s.settings, maxPlayers: 2 } });
    s = run(s, { type: 'join', playerId: 'a', name: 'A' });
    expectErr(s, { type: 'join', playerId: 'b', name: 'B' }, /full/);
    expect(run(s, { type: 'settings', by: 'h', settings: { ...s.settings, maxPlayers: 1 } }).settings.maxPlayers).toBe(2);
    s = run(s, { type: 'settings', by: 'h', settings: { ...s.settings, maxPlayers: 3 } }, { type: 'join', playerId: 'b', name: 'B' });
    expectErr(s, { type: 'settings', by: 'h', settings: { ...s.settings, maxPlayers: 2 } }, /already/);
  });

  it('rejects taken or unknown colors', () => {
    const s = run(fresh(), { type: 'join', playerId: 'a', name: 'A' });
    expectErr(s, { type: 'setColor', by: 'a', color: PLAYER_COLORS[0] }, /taken/);
    expectErr(s, { type: 'setColor', by: 'a', color: '#123456' }, /Unknown/);
    const s2 = run(s, { type: 'setColor', by: 'a', color: PLAYER_COLORS[5] });
    expect(s2.players[1].color).toBe(PLAYER_COLORS[5]);
  });

  it('restricts host-only actions', () => {
    const s = run(fresh(), { type: 'join', playerId: 'a', name: 'A' });
    expectErr(s, { type: 'settings', by: 'a', settings: s.settings }, /host/);
    expectErr(s, { type: 'mods', by: 'a', mods: [] }, /host/);
    expectErr(s, { type: 'kick', by: 'a', playerId: 'h' }, /host/);
    expectErr(s, { type: 'start', by: 'a' }, /host/);
    expectErr(s, { type: 'setName', by: 'zzz', name: 'x' }, /not in this room/);
  });

  it('sanitizes settings', () => {
    const s = fresh();
    const r = run(s, {
      type: 'settings', by: 'h',
      settings: { ...s.settings, victoryPoints: 999, discardLimit: -3, diceMode: 'weird', maxPlayers: 6, mapId: 'nope', bogus: 1, mods: ['x'] },
    });
    expect(r.settings.victoryPoints).toBe(30);
    expect(r.settings.discardLimit).toBe(2);
    expect(r.settings.diceMode).toBe('random');
    expect(r.settings.maxPlayers).toBe(6);
    expect(r.settings.mapId).toBe('big'); // auto-picked a map that fits 6 players
    expect(r.settings.mods).toEqual([]);
    expect('bogus' in r.settings).toBe(false);
  });

  it('unreadies guests when settings change', () => {
    let s = run(fresh(), { type: 'join', playerId: 'a', name: 'A' }, { type: 'setReady', by: 'a', ready: true });
    expect(s.players[1].ready).toBe(true);
    s = run(s, { type: 'settings', by: 'h', settings: { ...s.settings, victoryPoints: 12 } });
    expect(s.players[1].ready).toBe(false);
  });

  it('applies mods, fills mod settings and rejects broken ones', () => {
    const m = mod('seafarers', {
      maps: [makeMap('islands', 3, 4)],
      settings: [
        { id: 'fog', name: 'Fog', type: 'boolean', default: true },
        { id: 'vpBonus', name: 'Bonus', type: 'number', default: 2, min: 0, max: 5 },
      ],
    });
    let s = run(fresh(), { type: 'mods', by: 'h', mods: [m] });
    expect(s.mods).toHaveLength(1);
    expect(s.settings.mods).toEqual(['seafarers']);
    expect(s.settings.modSettings).toEqual({ fog: true, vpBonus: 2 });
    // Clamped on later settings edits (ctx.def must reflect the new mods).
    const ctx2: LobbyContext = { ...ctx, def: fakeEngine.buildDefinition([m]) };
    const r = lobbyReducer(s, { type: 'settings', by: 'h', settings: { ...s.settings, modSettings: { vpBonus: 99, fog: 'x' } } }, ctx2);
    expect(r.ok && r.state.settings.modSettings).toEqual({ fog: true, vpBonus: 5 });
    expectErr(s, { type: 'mods', by: 'h', mods: [mod('broken')] }, /broken mod/);
    expectErr(s, { type: 'mods', by: 'h', mods: [m, m] }, /twice/);
    s = run(s, { type: 'mods', by: 'h', mods: [] });
    expect(s.settings.modSettings).toEqual({});
  });

  it('kicks and bans', () => {
    let s = run(fresh(), { type: 'join', playerId: 'a', name: 'A' });
    s = run(s, { type: 'kick', by: 'h', playerId: 'a' });
    expect(s.players).toHaveLength(1);
    expectErr(s, { type: 'join', playerId: 'a', name: 'A' }, /removed/);
    expectErr(s, { type: 'kick', by: 'h', playerId: 'h' }, /cannot/);
  });

  it('starts only when everyone is ready and connected', () => {
    let s = fresh();
    expect(canStart(s).ok).toBe(false);
    s = run(s, { type: 'join', playerId: 'a', name: 'A' });
    expectErr(s, { type: 'start', by: 'h' }, /ready/);
    s = run(s, { type: 'setReady', by: 'a', ready: true });
    s = run(s, { type: 'connected', playerId: 'a', connected: false });
    expect(s.players[1].ready).toBe(false); // dropping out of the lobby unreadies
    s = run(s, { type: 'join', playerId: 'a', name: 'A' }, { type: 'setReady', by: 'a', ready: true });
    s = run(s, { type: 'start', by: 'h' });
    expect(s.started).toBe(true);
    expectErr(s, { type: 'join', playerId: 'z', name: 'Z' }, /in progress/);
    expectErr(s, { type: 'settings', by: 'h', settings: s.settings }, /started/);
  });
});

describe('helpers', () => {
  it('sanitizes names', () => {
    expect(sanitizeName('  Ann \n  Bee ')).toBe('Ann Bee');
    expect(sanitizeName('x'.repeat(50))).toHaveLength(20);
    expect(sanitizeName(42)).toBe('');
  });

  it('validates mod list shape', () => {
    expect(validateModList([mod('a')]).ok).toBe(true);
    expect(validateModList({}).ok).toBe(false);
    expect(validateModList([{ meta: { id: 'bad id!', name: 'x', version: '1' } }]).ok).toBe(false);
    expect(validateModList([{ meta: { id: 'base', name: 'x', version: '1' } }]).ok).toBe(false);
  });
});
