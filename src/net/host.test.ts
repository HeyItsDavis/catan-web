import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomClient } from './client';
import { HOST_SAVE_KEY, HostRoom, loadSavedRoom } from './host';
import { MemoryNetwork } from './memoryTransport';
import { fakeEngine, MemoryStorage, mod } from './testFixtures';
import type { EngineApi } from './host';
import type { GameState } from '../engine/schema';

const flush = async (n = 5) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

interface Setup { net: MemoryNetwork; host: HostRoom; storage: MemoryStorage; hostClient: RoomClient }
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((c) => c()); vi.useRealTimers(); });

function setup(opts: { storage?: MemoryStorage; onTurnTimeout?: (r: HostRoom, p: string) => void; engine?: EngineApi } = {}): Setup {
  const net = new MemoryNetwork();
  const storage = opts.storage ?? new MemoryStorage();
  const host = new HostRoom({
    roomCode: 'ABCDEF', hostPlayer: { id: 'host', name: 'Hana' }, engine: opts.engine ?? fakeEngine,
    baseMod: { meta: { id: 'base', name: 'Base', version: '1' } }, storage,
    saved: loadSavedRoom(storage), onTurnTimeout: opts.onTurnTimeout,
  });
  host.attachListener(net.listen('ABCDEF'));
  const hostClient = client(() => Promise.resolve(host.connectLocal()), 'host', 'Hana');
  cleanups.push(() => host.destroy());
  return { net, host, storage, hostClient };
}

function client(connector: () => Promise<import('./transport').Connection>, id: string, name: string, secret = `${id}-secret`) {
  const c = new RoomClient({ connector, playerId: id, secret, name, backoff: () => 1, pingIntervalMs: 60_000 });
  c.start();
  cleanups.push(() => c.stop());
  return c;
}

describe('HostRoom + RoomClient over memory transport', () => {
  it('runs a lobby through to a game with per-player redaction', async () => {
    const { net, hostClient } = setup();
    const ann = client(() => net.connect('ABCDEF'), 'ann', 'Ann');
    await flush();

    expect(hostClient.getSnapshot().status).toBe('connected');
    expect(ann.getSnapshot().status).toBe('connected');
    expect(ann.getSnapshot().hostId).toBe('host');
    expect(ann.getSnapshot().players.map((p) => p.name)).toEqual(['Hana', 'Ann']);

    // Guests cannot do host things.
    ann.send({ t: 'lobby:start' });
    await flush();
    expect(ann.getSnapshot().error?.message).toMatch(/host/);

    hostClient.send({ t: 'lobby:start' });
    await flush();
    expect(hostClient.getSnapshot().error?.message).toMatch(/ready/);

    ann.send({ t: 'lobby:ready', ready: true });
    ann.sendChat('hi all');
    await flush();
    expect(hostClient.getSnapshot().chat.at(-1)).toMatchObject({ from: 'ann', name: 'Ann', text: 'hi all' });

    hostClient.send({ t: 'lobby:start' });
    await flush();
    const hg = hostClient.getSnapshot().game!;
    const ag = ann.getSnapshot().game!;
    expect(hg).toBeTruthy();
    expect(ann.getSnapshot().started).toBe(true);
    // Host sees own resources, not Ann's.
    expect(hg.players.find((p) => p.id === 'host')!.resources).toEqual({ secret: 1 });
    expect(hg.players.find((p) => p.id === 'ann')!.resources).toEqual({});
    expect(ag.players.find((p) => p.id === 'ann')!.resources).toEqual({ secret: 1 });

    // Out-of-turn command rejected; in-turn accepted.
    ann.sendCommand({ type: 'rollDice' });
    await flush();
    expect(ann.getSnapshot().error?.message).toBe('Not your turn');
    hostClient.sendCommand({ type: 'endTurn' });
    await flush();
    expect(ann.getSnapshot().game!.currentPlayerIndex).toBe(1);
  });

  it('a second tab takes the seat; the first stops instead of fighting back', async () => {
    const { net, host } = setup();
    const tab1 = client(() => net.connect('ABCDEF'), 'ann', 'Ann');
    await flush();
    expect(tab1.getSnapshot().status).toBe('connected');
    const tab2 = client(() => net.connect('ABCDEF'), 'ann', 'Ann');
    await flush();
    await new Promise((r) => setTimeout(r, 80));
    await flush();
    expect(tab2.getSnapshot().status).toBe('connected');
    expect(tab1.getSnapshot().status).toBe('failed');
    expect(tab1.getSnapshot().error?.message).toMatch(/another tab/);
    // No reconnect storm: tab2 keeps the seat.
    await new Promise((r) => setTimeout(r, 50));
    await flush();
    expect(tab2.getSnapshot().status).toBe('connected');
    expect(host.getLobby().players.filter((p) => p.id === 'ann')).toHaveLength(1);
    // The user can take the seat back explicitly.
    tab1.retryNow();
    await flush();
    await new Promise((r) => setTimeout(r, 80));
    await flush();
    expect(tab1.getSnapshot().status).toBe('connected');
    expect(tab2.getSnapshot().status).toBe('failed');
  });

  it('protects the host seat and other seats from impersonation', async () => {
    const { net } = setup();
    const fake = client(() => net.connect('ABCDEF'), 'host', 'Evil');
    await flush();
    expect(fake.getSnapshot().status).toBe('failed');

    const ann = client(() => net.connect('ABCDEF'), 'ann', 'Ann', 's1');
    await flush();
    expect(ann.getSnapshot().status).toBe('connected');
    const thief = client(() => net.connect('ABCDEF'), 'ann', 'Thief', 's2');
    await flush();
    expect(thief.getSnapshot().status).toBe('failed');
    expect(thief.getSnapshot().error?.message).toMatch(/another browser/);
  });

  it('kicks a player and blocks rejoin', async () => {
    const { net, hostClient } = setup();
    const ann = client(() => net.connect('ABCDEF'), 'ann', 'Ann');
    await flush();
    hostClient.send({ t: 'lobby:kick', playerId: 'ann' });
    await flush();
    expect(ann.getSnapshot().status).toBe('kicked');
    expect(hostClient.getSnapshot().players.map((p) => p.id)).toEqual(['host']);
    const again = client(() => net.connect('ABCDEF'), 'ann', 'Ann');
    await flush();
    expect(again.getSnapshot().status).toBe('kicked');
  });

  it('closing the room tells guests to stop reconnecting and forgets the save', async () => {
    const { net, host, storage } = setup();
    const ann = client(() => net.connect('ABCDEF'), 'ann', 'Ann');
    await flush();
    host.closeRoom();
    await flush();
    expect(ann.getSnapshot().status).toBe('kicked');
    expect(ann.getSnapshot().error?.message).toMatch(/closed/);
    expect(storage.getItem(HOST_SAVE_KEY)).toBeNull();
  });

  it('syncs mods to guests with stable references', async () => {
    const { net, hostClient } = setup();
    const ann = client(() => net.connect('ABCDEF'), 'ann', 'Ann');
    await flush();
    hostClient.send({ t: 'lobby:mods', mods: [mod('extra')] });
    await flush();
    const mods1 = ann.getSnapshot().mods;
    expect(mods1.map((m) => m.meta.id)).toEqual(['extra']);
    ann.send({ t: 'lobby:ready', ready: true });
    await flush();
    expect(ann.getSnapshot().mods).toBe(mods1);
  });

  it('guest reconnects automatically after a drop', async () => {
    const { net, host } = setup();
    let conns = 0;
    const ann = client(async () => { conns++; return net.connect('ABCDEF'); }, 'ann', 'Ann');
    await flush();
    expect(conns).toBe(1);
    // Simulate a network drop by closing all host-side sessions of ann.
    const sessions = (host as unknown as { sessions: Set<{ playerId: string | null; conn: { close(): void } }> }).sessions;
    for (const s of sessions) if (s.playerId === 'ann') s.conn.close();
    await flush(10);
    expect(conns).toBe(2);
    expect(ann.getSnapshot().status).toBe('connected');
    expect(host.getLobby().players.find((p) => p.id === 'ann')!.connected).toBe(true);
  });

  it('autosaves and resumes the room and game after a host refresh', async () => {
    const storage = new MemoryStorage();
    {
      const { net, hostClient, host } = setup({ storage });
      const ann = client(() => net.connect('ABCDEF'), 'ann', 'Ann');
      await flush();
      ann.send({ t: 'lobby:ready', ready: true });
      await flush();
      hostClient.send({ t: 'lobby:start' });
      await flush();
      hostClient.sendCommand({ type: 'rollDice' });
      await flush();
      expect(storage.getItem(HOST_SAVE_KEY)).toContain('"started":true');
      host.destroy();
      ann.stop();
    }
    const { hostClient, host } = setup({ storage });
    await flush();
    expect(host.getGame()?.version).toBe(1);
    expect(hostClient.getSnapshot().game?.hasRolled).toBe(true);
    expect(host.getLobby().players.find((p) => p.id === 'ann')!.connected).toBe(false);
  });

  it('broadcasts turn deadlines and calls the timeout hook', async () => {
    const onTurnTimeout = vi.fn();
    const { net, hostClient } = setup({ onTurnTimeout });
    const ann = client(() => net.connect('ABCDEF'), 'ann', 'Ann');
    await flush();
    hostClient.send({ t: 'lobby:settings', settings: { ...hostClient.getSnapshot().settings!, turnTimerSeconds: 60 } });
    ann.send({ t: 'lobby:ready', ready: true });
    await flush();
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    hostClient.send({ t: 'lobby:start' });
    await vi.advanceTimersByTimeAsync(10);
    const t = ann.getSnapshot().timer;
    expect(t.player).toBe('host');
    expect(t.deadline).toBeGreaterThan(Date.now());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onTurnTimeout).toHaveBeenCalledWith(expect.anything(), 'host');
  });

  describe('turn timer stages', () => {
    /** fakeEngine with phases: turns start in preRoll; any other command is a no-op "action". */
    const phasedEngine: EngineApi = {
      ...fakeEngine,
      createGame: (...a) => ({ ...fakeEngine.createGame(...a), phase: 'preRoll' }),
      applyCommand(def, state, playerId, cmd) {
        if (state.turnOrder[state.currentPlayerIndex] !== playerId) return { ok: false, error: 'Not your turn' };
        if (cmd.type === 'rollDice') return { ok: true, state: { ...state, version: state.version + 1, hasRolled: true, phase: 'main' } };
        if (cmd.type === 'endTurn') {
          const res = fakeEngine.applyCommand(def, state, playerId, cmd);
          return res.ok ? { ok: true, state: { ...res.state, phase: 'preRoll' } } : res;
        }
        return { ok: true, state: { ...state, version: state.version + 1 } };
      },
    };
    const action = { type: 'cancelTrade', tradeId: 'x' } as const;

    async function started(onTurnTimeout?: (r: HostRoom, p: string) => void) {
      const s = setup({ engine: phasedEngine, onTurnTimeout });
      const ann = client(() => s.net.connect('ABCDEF'), 'ann', 'Ann');
      await flush();
      s.hostClient.send({ t: 'lobby:settings', settings: { ...s.hostClient.getSnapshot().settings!, turnTimerSeconds: 60 } });
      ann.send({ t: 'lobby:ready', ready: true });
      await flush();
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
      s.hostClient.send({ t: 'lobby:start' });
      await vi.advanceTimersByTimeAsync(10);
      const timer = () => ann.getSnapshot().timer;
      const left = () => Math.round(((timer().deadline ?? 0) - Date.now()) / 1000);
      return { ...s, ann, timer, left };
    }

    it('gives 10s to roll, then the full turn, and +10s per action capped at the turn length', async () => {
      const { hostClient, timer, left } = await started();
      expect(timer()).toMatchObject({ player: 'host', stage: 'roll', total: 10 });
      expect(left()).toBe(10);

      hostClient.sendCommand({ type: 'rollDice' });
      await vi.advanceTimersByTimeAsync(10);
      expect(timer()).toMatchObject({ player: 'host', stage: 'turn', total: 60 });
      expect(left()).toBe(60);

      await vi.advanceTimersByTimeAsync(30_000);
      hostClient.sendCommand(action);
      await vi.advanceTimersByTimeAsync(10);
      expect(left()).toBe(40);
      hostClient.sendCommand(action);
      await vi.advanceTimersByTimeAsync(10);
      hostClient.sendCommand(action);
      await vi.advanceTimersByTimeAsync(10);
      expect(left()).toBe(60); // never past the turn length

      hostClient.sendCommand({ type: 'endTurn' });
      await vi.advanceTimersByTimeAsync(10);
      expect(timer()).toMatchObject({ player: 'ann', stage: 'roll', total: 10 });
    });

    it('times out the roll after 10s', async () => {
      const onTurnTimeout = vi.fn();
      await started(onTurnTimeout);
      await vi.advanceTimersByTimeAsync(9_000);
      expect(onTurnTimeout).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_100);
      expect(onTurnTimeout).toHaveBeenCalledWith(expect.anything(), 'host');
    });

    it("pauses the turn clock while another player answers a prompt", async () => {
      const { host, hostClient, timer, left } = await started();
      hostClient.sendCommand({ type: 'rollDice' });
      await vi.advanceTimersByTimeAsync(20_000); // 40s left
      const g = host.getGame()!;
      const prompt = { id: 'p1', player: 'ann', kind: 'discard', options: [], optional: false } as unknown as GameState['prompts'][number];
      host.debugSetGame({ ...g, prompts: [prompt] });
      await vi.advanceTimersByTimeAsync(10);
      expect(timer()).toMatchObject({ player: 'ann', total: 60 });
      expect(left()).toBe(60);

      await vi.advanceTimersByTimeAsync(15_000);
      host.debugSetGame({ ...host.getGame()!, prompts: [] });
      await vi.advanceTimersByTimeAsync(10);
      expect(timer()).toMatchObject({ player: 'host', stage: 'turn' });
      expect(left()).toBe(40);
    });
  });
});
