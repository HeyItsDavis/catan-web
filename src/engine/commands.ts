/**
 * createGame and applyCommand: the command boundary. The input state is cloned once
 * (structuredClone) and the clone is mutated and returned.
 */
import type { Command, CommandResult, GameDefinition, GameState, LobbySettings, PlayerState } from './schema';
import { type Ctx, CommandError, currentPlayerId, emit, getPlayer, log, makeCtx, playerName, victoryTarget } from './context';
import { seedToState, shuffle } from './rng';
import { generateMap } from './mapgen';
import { flushEvents, newThread, respond, run } from './interpreter';
import { startSetup } from './turn';
import { recomputeAwards } from './awards';
import { computeVPInternal } from './vp';
import { evalResourceMap } from './exprs';
import { pay } from './resources';
import { actionError, buildStatus, canEndTurn, canRoll, cardPlayError, deckBuyable } from './moves';
import { bankTrade, cancelTrade, confirmTrade, offerTrade, respondTrade } from './trading';
import type { NewPlayer } from './index';

export function createGame(
  def: GameDefinition, settings: LobbySettings, players: NewPlayer[], seed: number, now?: number,
): GameState {
  if (!players.length) throw new Error('A game needs at least one player');
  const map = def.maps.find((m) => m.id === settings.mapId) ?? def.maps[0];
  if (!map) throw new Error(`Unknown map ${settings.mapId}`);
  const holder = { rngState: seedToState(seed) };
  const order = players.map((p) => p.id);
  if (settings.randomizeTurnOrder) shuffle(holder, order);
  const { hexes, ports } = generateMap(holder, def, map);
  const decks: GameState['decks'] = {};
  for (const d of def.decks) {
    const cards = d.cards.flatMap((c) => Array.from({ length: c.count }, () => c.card));
    decks[d.id] = { draw: shuffle(holder, cards), discard: [] };
  }
  const tokens: GameState['tokens'] = {};
  for (const t of def.tokens) {
    tokens[t.id] = null;
    if (t.start === 'firstOfTerrain' && t.startTerrain) {
      const h = Object.values(hexes).find((x) => x.terrain === t.startTerrain);
      if (h) tokens[t.id] = h.id;
    }
  }
  const mkPlayer = (p: NewPlayer): PlayerState => ({
    id: p.id, name: p.name, color: p.color,
    resources: Object.fromEntries(def.resources.map((r) => [r.id, 0])),
    hand: [], played: [], stats: {}, flags: {}, tokenVP: 0, tradeRates: [], actionUses: {}, cardPlaysThisTurn: {},
  });
  const s: GameState = {
    version: 0, seed, rngState: holder.rngState, settings: structuredClone(settings),
    players: order.map((id) => mkPlayer(players.find((p) => p.id === id)!)),
    turnOrder: order, currentPlayerIndex: 0, turn: 0, phase: 'setup', hasRolled: false, lastRoll: null,
    hexes, pieces: [], tokens, ports, decks,
    bank: Object.fromEntries(def.resources.map((r) => [r.id, r.bankSupply])),
    globals: {}, awards: Object.fromEntries(def.awards.map((a) => [a.id, null])),
    prompts: [], stack: [], trades: [], log: [], winner: null, idCounter: 1,
  };
  const ctx = makeCtx(def, s);
  ctx.now = now;
  const th = newThread(ctx, order[0], []);
  startSetup(ctx, th);
  emit(ctx, 'gameStart', {});
  flushEvents(ctx, th);
  settle(ctx);
  return ctx.s;
}

/** Run to quiescence, keep awards up to date, check for a winner. */
function settle(ctx: Ctx): void {
  for (let i = 0; i < 20; i++) {
    run(ctx);
    if (ctx.s.phase === 'gameOver') break;
    if (!recomputeAwards(ctx)) break;
    flushEvents(ctx, null);
  }
  const s = ctx.s;
  if (s.phase !== 'setup' && s.phase !== 'gameOver' && !s.winner) {
    const pid = currentPlayerId(s);
    if (computeVPInternal(ctx, pid, true) >= victoryTarget(ctx)) {
      s.winner = pid;
      s.phase = 'gameOver';
      log(ctx, `${playerName(ctx, pid)} wins with ${computeVPInternal(ctx, pid, true)} VP!`, pid);
    }
  }
  if (s.phase === 'gameOver') { s.stack = []; s.prompts = []; }
}

export function applyCommand(
  def: GameDefinition, state: GameState, playerId: string, cmd: Command, now?: number,
): CommandResult {
  if (state.phase === 'gameOver') return { ok: false, error: 'The game is over' };
  if (!state.players.some((p) => p.id === playerId)) return { ok: false, error: 'You are not in this game' };
  const ctx = makeCtx(def, structuredClone(state));
  ctx.now = now;
  try {
    dispatch(ctx, playerId, cmd);
    run(ctx);
    if (ctx.aborted && cmd.type !== 'respond') return { ok: false, error: ctx.aborted };
    settle(ctx);
    ctx.s.version = state.version + 1;
    return { ok: true, state: ctx.s };
  } catch (e) {
    if (e instanceof CommandError) return { ok: false, error: e.message };
    return { ok: false, error: `Internal engine error: ${(e as Error)?.message ?? String(e)}` };
  }
}

function dispatch(ctx: Ctx, pid: string, cmd: Command): void {
  const s = ctx.s;
  switch (cmd.type) {
    case 'respond': respond(ctx, pid, cmd.promptId, cmd.answer); return;
    case 'rollDice':
      if (!canRoll(ctx, pid)) throw new CommandError('You cannot roll now');
      newThread(ctx, pid, [{ op: 'rollDice' }]);
      return;
    case 'endTurn':
      if (!canEndTurn(ctx, pid)) throw new CommandError('You cannot end your turn now');
      newThread(ctx, pid, [{ op: 'endTurn' }]);
      return;
    case 'build': {
      const pdef = ctx.L.pieces.get(cmd.piece);
      if (!pdef?.cost) throw new CommandError('That piece cannot be built');
      const st = buildStatus(ctx, pid, cmd.piece);
      if (!st.affordable) throw new CommandError(`You cannot afford a ${pdef.name}`);
      if (!st.hasSpot) throw new CommandError(`You cannot build a ${pdef.name} now`);
      newThread(ctx, pid, [{ op: 'place', piece: pdef.id, free: false, $cancelable: true }], { txn: true });
      return;
    }
    case 'buyCard': {
      const err = deckBuyable(ctx, pid, cmd.deck);
      if (err) throw new CommandError(err);
      const d = ctx.L.decks.get(cmd.deck)!;
      const th = newThread(ctx, pid, [{ op: 'drawCard', deck: d.id, player: 'self' }], { txn: true });
      pay(ctx, pid, evalResourceMap(ctx, { self: pid, vars: {} }, d.cost));
      log(ctx, `${playerName(ctx, pid)} buys a ${d.name} card`, pid);
      flushEvents(ctx, th);
      return;
    }
    case 'playCard': {
      const p = getPlayer(ctx, pid);
      const inst = p.hand.find((c) => c.id === cmd.cardInstance);
      if (!inst) throw new CommandError('You do not hold that card');
      const err = cardPlayError(ctx, pid, inst);
      if (err) throw new CommandError(err);
      const cdef = ctx.L.cards.get(inst.card)!;
      newThread(ctx, pid, [...cdef.effect, { op: '$afterCardPlay', instance: inst }], { txn: true, vars: { card: inst.card } });
      p.hand = p.hand.filter((c) => c.id !== inst.id);
      if (cdef.play.limitGroup) p.cardPlaysThisTurn[cdef.play.limitGroup] = (p.cardPlaysThisTurn[cdef.play.limitGroup] ?? 0) + 1;
      log(ctx, `${p.name} plays ${cdef.name}`, pid);
      return;
    }
    case 'doAction': {
      const a = ctx.L.actions.get(cmd.action);
      if (!a) throw new CommandError('Unknown action');
      const err = actionError(ctx, pid, a, cmd.pieceId);
      if (err) throw new CommandError(err);
      const vars: Record<string, string> = {};
      if (cmd.pieceId) {
        const pc = s.pieces.find((x) => x.id === cmd.pieceId)!;
        vars.piece = pc.at;
        vars.pieceId = pc.id;
      }
      const th = newThread(ctx, pid, a.effect, { txn: true, vars });
      const p = getPlayer(ctx, pid);
      if (a.cost) pay(ctx, pid, evalResourceMap(ctx, { self: pid, vars }, a.cost));
      p.actionUses[a.id] = (p.actionUses[a.id] ?? 0) + 1;
      log(ctx, `${p.name}: ${a.name}`, pid);
      flushEvents(ctx, th);
      return;
    }
    case 'bankTrade': bankTrade(ctx, pid, cmd.give, cmd.get); flushEvents(ctx, null); return;
    case 'offerTrade': offerTrade(ctx, pid, cmd.to, cmd.give, cmd.get); return;
    case 'respondTrade': respondTrade(ctx, pid, cmd.tradeId, cmd.accept); return;
    case 'confirmTrade': confirmTrade(ctx, pid, cmd.tradeId, cmd.withPlayer); flushEvents(ctx, null); return;
    case 'cancelTrade': cancelTrade(ctx, pid, cmd.tradeId); return;
    default: throw new CommandError(`Unknown command ${(cmd as { type: string }).type}`);
  }
}
