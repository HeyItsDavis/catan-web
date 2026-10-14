/**
 * Turn skeleton: setup rounds (from def.setup), preRoll -> roll -> main -> end turn,
 * per-turn resets, the special building phase, and dice rolling (random / balanced).
 *
 * Setup: each player's placement turn runs `place <piece> (free) as lastPlaced` for every
 * entry of the round, so setupWhere conditions can refer to `lastPlaced`
 * (e.g. the road must touch the settlement just placed: `{isAdjacent:['at','lastPlaced']}`).
 */
import { type Ctx, currentPlayerId, emit, isBuilding, log, playerName, rng } from './context';
import { type IEffect, type Thread, pushScoped } from './interpreter';
import { evalResourceMap } from './exprs';
import { moveResource } from './resources';
import { randInt, shuffle } from './rng';
import { boardTopo, hexesOf } from './board';

function markTurnStart(ctx: Ctx): void {
  if (ctx.now !== undefined) ctx.s.turnStartedAt = ctx.now;
}

function setupOrder(ctx: Ctx, round: number): string[] {
  const r = ctx.def.setup[round];
  return r.order === 'reverse' ? [...ctx.s.turnOrder].reverse() : [...ctx.s.turnOrder];
}

function setupTurnEffects(ctx: Ctx, round: number): IEffect[] {
  const r = ctx.def.setup[round];
  const fx: IEffect[] = [];
  r.place.forEach((pl, i) => {
    fx.push({ op: '$setupStep', step: i });
    fx.push({ op: 'place', piece: pl.piece, free: pl.free !== false, as: 'lastPlaced' });
  });
  if (r.grantStartingResources) fx.push({ op: '$startingResources' });
  fx.push({ op: '$setupNext' });
  return fx;
}

function beginSetupTurn(ctx: Ctx, th: Thread): void {
  const sp = ctx.s.setupProgress!;
  const pid = setupOrder(ctx, sp.round)[sp.playerIndex];
  ctx.s.currentPlayerIndex = ctx.s.turnOrder.indexOf(pid);
  markTurnStart(ctx);
  pushScoped(ctx, th, pid, setupTurnEffects(ctx, sp.round));
}

/** Called once from createGame with a fresh root thread. */
export function startSetup(ctx: Ctx, th: Thread): void {
  if (!ctx.def.setup.length) { finishSetup(ctx, th); return; }
  ctx.s.phase = 'setup';
  ctx.s.setupProgress = { round: 0, playerIndex: 0, step: 0 };
  beginSetupTurn(ctx, th);
}

export function advanceSetup(ctx: Ctx, th: Thread): void {
  const sp = ctx.s.setupProgress;
  if (!sp) return;
  sp.playerIndex++;
  sp.step = 0;
  if (sp.playerIndex >= ctx.s.turnOrder.length) { sp.round++; sp.playerIndex = 0; }
  if (sp.round >= ctx.def.setup.length) finishSetup(ctx, th);
  else beginSetupTurn(ctx, th);
}

function finishSetup(ctx: Ctx, th: Thread): void {
  const s = ctx.s;
  s.setupProgress = undefined;
  delete s.setupProgress;
  s.phase = 'preRoll';
  s.turn = 1;
  s.currentPlayerIndex = 0;
  s.hasRolled = false;
  log(ctx, 'Setup complete');
  pushScoped(ctx, th, currentPlayerId(s), [{ op: '$turnStart' }]);
  emit(ctx, 'setupComplete', {});
}

/** Grant one production of each hex touching the player's most recent vertex building. */
export function startingResources(ctx: Ctx, th: Thread, pid: string): void {
  const last = [...ctx.s.pieces].reverse().find((p) => p.owner === pid && p.at.startsWith('v:') && isBuilding(ctx.L.pieces.get(p.type)));
  if (!last) return;
  const got: string[] = [];
  for (const h of hexesOf(boardTopo(ctx.s), last.at)) {
    const hex = ctx.s.hexes[h];
    const terr = ctx.L.terrains.get(hex.terrain);
    if (!terr || !hex.revealed) continue;
    for (const [r, n] of Object.entries(evalResourceMap(ctx, { self: pid, vars: { at: h } }, terr.produces))) {
      const m = moveResource(ctx, 'bank', pid, r, n);
      if (m) got.push(`${m} ${ctx.L.resources.get(r)?.name ?? r}`);
    }
    if (terr.producesChoice) {
      pushScoped(ctx, th, pid, [{ op: 'chooseAndGain', amount: terr.producesChoice.amount, options: terr.producesChoice.options }]);
    }
  }
  if (got.length) log(ctx, `${playerName(ctx, pid)} receives starting resources: ${got.join(', ')}`, pid);
}

export function turnStart(ctx: Ctx): void {
  const s = ctx.s;
  markTurnStart(ctx);
  if (!ctx.def.dice.numeric.length) { s.phase = 'main'; s.hasRolled = true; }
  log(ctx, `Turn ${s.turn}: ${playerName(ctx, currentPlayerId(s))}`, currentPlayerId(s));
  emit(ctx, 'turnStart', { player: currentPlayerId(s) }, currentPlayerId(s));
}

function endOfTurnCleanup(ctx: Ctx): void {
  for (const p of ctx.s.players) {
    for (const [k, f] of Object.entries(p.flags)) if (f.until === 'endOfTurn') delete p.flags[k];
    p.tradeRates = p.tradeRates.filter((r) => r.until !== 'endOfTurn');
    p.actionUses = {};
    p.cardPlaysThisTurn = {};
  }
  ctx.s.trades = [];
}

export function advanceTurn(ctx: Ctx, th: Thread): void {
  const s = ctx.s;
  if (s.phase === 'gameOver') return;
  if (s.phase === 'specialBuild' && s.specialBuild) {
    s.specialBuild.queue.shift();
    for (const p of s.players) p.actionUses = {};
    if (s.specialBuild.queue.length) {
      s.currentPlayerIndex = s.turnOrder.indexOf(s.specialBuild.queue[0]);
      markTurnStart(ctx);
      log(ctx, `Special building phase: ${playerName(ctx, s.specialBuild.queue[0])}`);
      return;
    }
    s.currentPlayerIndex = s.specialBuild.turnPlayerIndex;
    delete s.specialBuild;
  } else {
    endOfTurnCleanup(ctx);
    if (s.specialBuild?.queue.length) {
      s.phase = 'specialBuild';
      s.currentPlayerIndex = s.turnOrder.indexOf(s.specialBuild.queue[0]);
      markTurnStart(ctx);
      log(ctx, `Special building phase: ${playerName(ctx, s.specialBuild.queue[0])}`);
      return;
    }
    delete s.specialBuild;
  }
  const next = (s.currentPlayerIndex + 1) % s.turnOrder.length;
  s.currentPlayerIndex = next;
  s.turn++;
  s.phase = 'preRoll';
  s.hasRolled = false;
  pushScoped(ctx, th, currentPlayerId(s), [{ op: '$turnStart' }]);
  if (next === 0) {
    for (const p of s.players) for (const [k, f] of Object.entries(p.flags)) if (f.until === 'endOfRound') delete p.flags[k];
    emit(ctx, 'roundEnd', {});
  }
}

/** Roll the numeric (+event) dice, enter the main phase, emit diceRolled. */
export function doRoll(ctx: Ctx): void {
  const s = ctx.s;
  const dice = ctx.def.dice.numeric;
  const r = rng(ctx);
  let values: number[];
  if (s.settings.diceMode === 'balanced' && dice.length) {
    const combos = dice.reduce((a, d) => a * d.sides, 1);
    if (!s.diceDeck?.length) s.diceDeck = shuffle(r, Array.from({ length: combos }, (_, i) => i));
    let idx = s.diceDeck.shift()!;
    values = dice.map((d) => { const v = (idx % d.sides) + 1; idx = Math.floor(idx / d.sides); return v; });
  } else {
    values = dice.map((d) => randInt(r, 1, d.sides));
  }
  const events = (ctx.def.dice.eventDice ?? []).map((ed) => ed.faces[randInt(r, 0, ed.faces.length - 1)]);
  const total = values.reduce((a, b) => a + b, 0);
  s.lastRoll = events.length ? { dice: values, event: events, total } : { dice: values, total };
  s.hasRolled = true;
  if (s.phase === 'preRoll') s.phase = 'main';
  const pid = currentPlayerId(s);
  log(ctx, `${playerName(ctx, pid)} rolls ${total}${events.length ? ` (${events.join(', ')})` : ''}`, pid);
  const payload: Record<string, number | string> = { total, player: pid };
  values.forEach((v, i) => { payload[`die${i}`] = v; });
  (ctx.def.dice.eventDice ?? []).forEach((ed, i) => { payload[`eventDie_${ed.id}`] = events[i]; });
  emit(ctx, 'diceRolled', payload, pid);
}
