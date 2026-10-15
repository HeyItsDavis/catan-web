/**
 * Dev-only page that renders GameScreen against a fixture with a tiny fake
 * reducer, so the UI can be exercised without the engine. Route at #/dev/game.
 */
import { useCallback, useMemo, useState } from 'react';
import type { Command, GameState, Prompt } from '../../../engine/schema';
import { EngineProvider, estimateVP, type EngineAdapter } from '../engineContext';
import { GameScreen } from '../GameScreen';
import {
  fakeAvailableMoves, fakeRedact, legalEdges, legalVertices, makeFixtureDef, makeFixtureState, ME, sampleMovePrompt, sampleMultiPrompt, samplePrompt,
} from './fixture';

const adapter: EngineAdapter = {
  getAvailableMoves: fakeAvailableMoves,
  computeVP: (def, state, pid, includeHidden) => {
    const p = state.players.find((x) => x.id === pid);
    const hidden = includeHidden && p ? p.hand.filter((c) => def.cards.find((d) => d.id === c.card)?.vp).length : 0;
    return estimateVP(def, state, pid) + hidden;
  },
};

type Chat = { from: string; text: string; at: number };

export function DevGameHarness() {
  const def = useMemo(() => makeFixtureDef(), []);
  // `?prompt=<kind>` starts with a sample prompt of that kind (handy for screenshots).
  const [state, setState] = useState<GameState>(() => {
    const s = makeFixtureState();
    const kind = new URLSearchParams(window.location.search).get('prompt') as Prompt['kind'] | null;
    return kind ? { ...s, prompts: [samplePrompt(kind, s, def)] } : s;
  });
  const [viewer, setViewer] = useState(ME);
  const [chat, setChat] = useState<Chat[]>(() => [{ from: 'p2', text: 'gl hf', at: Date.now() }]);
  const [showTools, setShowTools] = useState(() => new URLSearchParams(window.location.search).get('tools') !== '0');

  const log = (s: GameState, text: string, player?: string): GameState => ({ ...s, log: [...s.log, { turn: s.turn, player, text }] });
  const bump = (s: GameState): GameState => ({ ...s, version: s.version + 1 });
  const updatePlayer = (s: GameState, pid: string, fn: (r: Record<string, number>) => Record<string, number>): GameState => ({
    ...s,
    players: s.players.map((p) => (p.id === pid ? { ...p, resources: fn({ ...p.resources }) } : p)),
  });

  const send = useCallback(
    (cmd: Command) => {
      console.info('[dev] send', viewer, cmd);
      setState((s0) => {
        let s = bump(s0);
        const pname = (id: string) => s.players.find((p) => p.id === id)?.name ?? id;
        switch (cmd.type) {
          case 'rollDice': {
            const dice = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)];
            const faces = def.dice.eventDice?.[0]?.faces ?? [];
            s = { ...s, hasRolled: true, phase: 'main', lastRoll: { dice, total: dice[0] + dice[1], event: faces.length ? [faces[Math.floor(Math.random() * faces.length)]] : undefined } };
            return log(s, `rolled ${dice[0] + dice[1]}`, viewer);
          }
          case 'endTurn': {
            const idx = (s.currentPlayerIndex + 1) % s.turnOrder.length;
            s = { ...s, currentPlayerIndex: idx, turn: idx === 0 ? s.turn + 1 : s.turn, hasRolled: false, phase: 'preRoll' };
            return log(s, 'ended their turn', viewer);
          }
          case 'build': {
            const pd = def.pieces.find((p) => p.id === cmd.piece)!;
            const options = pd.placement.on === 'vertex'
              ? pd.upgradesFrom
                ? s.pieces.filter((p) => p.owner === viewer && pd.upgradesFrom!.includes(p.type)).map((p) => p.at)
                : legalVertices(s)
              : legalEdges(s, viewer);
            s = updatePlayer(s, viewer, (r) => {
              for (const [k, v] of Object.entries(pd.cost ?? {})) r[k] = (r[k] ?? 0) - (typeof v === 'number' ? v : 0);
              return r;
            });
            const prompt: Prompt = { id: `build:${pd.id}:${s.version}`, player: viewer, kind: 'location', label: `Place your ${pd.name}`, options, optional: true };
            return { ...s, prompts: [...s.prompts, prompt] };
          }
          case 'respond': {
            const pr = s.prompts.find((p) => p.id === cmd.promptId);
            s = { ...s, prompts: s.prompts.filter((p) => p.id !== cmd.promptId) };
            if (!pr) return s;
            if (pr.pieceId && typeof cmd.answer === 'string') {
              const to = cmd.answer;
              return log({ ...s, pieces: s.pieces.map((p) => (p.id === pr.pieceId ? { ...p, at: to } : p)) }, 'moved a piece', viewer);
            }
            if (pr.progress && typeof cmd.answer === 'string') {
              const pg = pr.progress;
              const chosen = [...(pg.chosen ?? []), cmd.answer];
              if (chosen.length >= pg.max) return log(s, `picked ${chosen.length}`, viewer);
              const next: Prompt = {
                ...pr, id: `${pr.id}+`, options: pr.options.filter((o) => o !== cmd.answer),
                optionLabels: pr.optionLabels?.filter((_, i) => pr.options[i] !== cmd.answer),
                optional: chosen.length >= pg.min ? true : undefined, progress: { ...pg, picked: chosen.length, chosen },
              };
              return { ...s, prompts: [next, ...s.prompts] };
            }
            if (pr.kind === 'location' && typeof cmd.answer === 'string') {
              const a = cmd.answer;
              if (a.startsWith('h:')) return log({ ...s, tokens: { ...s.tokens, robber: a } }, 'moved the robber', viewer);
              const m = /^build:(\w+):/.exec(pr.id);
              const type = m ? m[1] : 'settlement';
              const pieces = s.pieces.filter((p) => p.at !== a);
              pieces.push({ id: `pc${s.version}`, type, owner: viewer, at: a, state: {} });
              return log({ ...s, pieces }, `built a ${def.pieces.find((p) => p.id === type)?.name ?? type}`, viewer);
            }
            if (pr.kind === 'discard' && cmd.answer && typeof cmd.answer === 'object' && !Array.isArray(cmd.answer)) {
              const ans = cmd.answer;
              s = updatePlayer(s, viewer, (r) => {
                for (const [k, v] of Object.entries(ans)) r[k] -= v;
                return r;
              });
              return log(s, `discarded ${Object.values(ans).reduce((x, y) => x + y, 0)} cards`, viewer);
            }
            return log(s, `answered "${pr.label}" with ${JSON.stringify(cmd.answer)}`, viewer);
          }
          case 'playCard': {
            const me = s.players.find((p) => p.id === viewer)!;
            const c = me.hand.find((x) => x.id === cmd.cardInstance);
            if (!c) return s;
            s = { ...s, players: s.players.map((p) => (p.id === viewer ? { ...p, hand: p.hand.filter((x) => x !== c), played: [...p.played, c] } : p)) };
            return log(s, `played ${def.cards.find((x) => x.id === c.card)?.name}`, viewer);
          }
          case 'buyCard': {
            const deck = def.decks.find((d) => d.id === cmd.deck)!;
            const pool = deck.cards.map((c) => c.card);
            const newCard = { id: `c${s.version}`, card: pool[Math.floor(Math.random() * pool.length)], deck: deck.id, acquiredTurn: s.turn };
            s = updatePlayer(s, viewer, (r) => {
              for (const [k, v] of Object.entries(deck.cost ?? {})) r[k] -= typeof v === 'number' ? v : 0;
              return r;
            });
            s = { ...s, decks: { ...s.decks, [deck.id]: { ...s.decks[deck.id], draw: s.decks[deck.id].draw.slice(1) } } };
            s = { ...s, players: s.players.map((p) => (p.id === viewer ? { ...p, hand: [...p.hand, newCard] } : p)) };
            return log(s, `bought a ${deck.name} card`, viewer);
          }
          case 'bankTrade': {
            s = updatePlayer(s, viewer, (r) => {
              for (const [k, v] of Object.entries(cmd.give)) r[k] -= v;
              for (const [k, v] of Object.entries(cmd.get)) r[k] = (r[k] ?? 0) + v;
              return r;
            });
            return log(s, `traded with the bank`, viewer);
          }
          case 'offerTrade': {
            const responses: Record<string, 'accept' | 'reject' | 'pending'> = {};
            for (const p of s.players) if (p.id !== viewer && (!cmd.to || cmd.to.includes(p.id))) responses[p.id] = Math.random() < 0.5 ? 'accept' : 'pending';
            return { ...s, trades: [...s.trades, { id: `t${s.version}`, from: viewer, to: cmd.to, give: cmd.give, get: cmd.get, responses }] };
          }
          case 'respondTrade':
            return { ...s, trades: s.trades.map((t) => (t.id === cmd.tradeId ? { ...t, responses: { ...t.responses, [viewer]: cmd.accept ? 'accept' : 'reject' } } : t)) };
          case 'confirmTrade': {
            const t = s.trades.find((x) => x.id === cmd.tradeId);
            if (!t) return s;
            s = updatePlayer(s, t.from, (r) => {
              for (const [k, v] of Object.entries(t.give)) r[k] -= v;
              for (const [k, v] of Object.entries(t.get)) r[k] = (r[k] ?? 0) + v;
              return r;
            });
            s = updatePlayer(s, cmd.withPlayer, (r) => {
              for (const [k, v] of Object.entries(t.get)) r[k] -= v;
              for (const [k, v] of Object.entries(t.give)) r[k] = (r[k] ?? 0) + v;
              return r;
            });
            return log({ ...s, trades: s.trades.filter((x) => x.id !== t.id) }, `traded with ${pname(cmd.withPlayer)}`, t.from);
          }
          case 'cancelTrade':
            return { ...s, trades: s.trades.filter((t) => t.id !== cmd.tradeId) };
          case 'doAction': {
            const name = def.actions.find((a) => a.id === cmd.action)?.name;
            const pc = cmd.pieceId ? s.pieces.find((p) => p.id === cmd.pieceId) : undefined;
            if (pc && cmd.action.startsWith('move')) return { ...s, prompts: [...s.prompts, sampleMovePrompt(s, viewer, pc.id)] };
            if (pc && (cmd.action === 'activate' || cmd.action === 'promote')) {
              const st = cmd.action === 'activate' ? { ...pc.state, active: 1 } : { ...pc.state, strength: Math.min(3, (pc.state.strength ?? 0) + 1) };
              s = { ...s, pieces: s.pieces.map((p) => (p.id === pc.id ? { ...p, state: st } : p)) };
            }
            return log(s, `did ${name}${pc ? ` on ${def.pieces.find((d) => d.id === pc.type)?.name}` : ''}`, viewer);
          }
        }
        return s;
      });
    },
    [def, viewer],
  );

  const shown = useMemo(() => fakeRedact(state, viewer), [state, viewer]);
  const addPrompt = (kind: Prompt['kind'], pid = viewer) => setState((s) => ({ ...s, version: s.version + 1, prompts: [...s.prompts, samplePrompt(kind, s, def, pid)] }));

  return (
    <EngineProvider value={adapter}>
      <GameScreen
        def={def}
        state={shown}
        playerId={viewer}
        send={send}
        chat={chat}
        sendChat={(text) => setChat((c) => [...c, { from: viewer, text, at: Date.now() }])}
      />
      <div style={{ position: 'fixed', right: 360, top: 8, zIndex: 100, font: '12px system-ui', background: 'rgba(0,0,0,0.8)', color: '#fff', padding: 8, borderRadius: 8, maxWidth: 260 }}>
        <button type="button" onClick={() => setShowTools((x) => !x)} style={{ font: 'inherit' }}>
          dev {showTools ? '▾' : '▸'}
        </button>
        {showTools && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
            <label>
              view as{' '}
              <select value={viewer} onChange={(e) => setViewer(e.target.value)}>
                {state.players.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            {(['location', 'discard', 'resource', 'player', 'card', 'piece', 'option'] as const).map((k) => (
              <button key={k} type="button" onClick={() => addPrompt(k)}>{k}</button>
            ))}
            <button type="button" onClick={() => setState((s) => ({ ...s, version: s.version + 1, prompts: [...s.prompts, sampleMovePrompt(s, viewer)] }))}>move</button>
            {(['location', 'player', 'resource'] as const).map((k) => (
              <button key={`many-${k}`} type="button" onClick={() => setState((s) => ({ ...s, version: s.version + 1, prompts: [...s.prompts, sampleMultiPrompt(s, def, k, viewer)] }))}>many {k}</button>
            ))}
            <button type="button" onClick={() => setState((s) => ({ ...s, globals: { ...s.globals, barbarians: ((s.globals.barbarians ?? 0) + 1) % 8 } }))}>barbarians+1</button>
            <button type="button" onClick={() => addPrompt('player', 'p3')}>other prompt</button>
            <button type="button" onClick={() => setState((s) => ({ ...s, prompts: [] }))}>clear prompts</button>
            <button type="button" onClick={() => setState((s) => ({ ...s, settings: { ...s.settings, hideBankCards: !s.settings.hideBankCards } }))}>toggle bank</button>
            <button type="button" onClick={() => setState((s) => ({ ...s, winner: s.winner ? null : 'p2', phase: s.winner ? 'main' : 'gameOver' }))}>game over</button>
            <button type="button" onClick={() => setState(makeFixtureState())}>reset</button>
          </div>
        )}
      </div>
    </EngineProvider>
  );
}

export default DevGameHarness;
