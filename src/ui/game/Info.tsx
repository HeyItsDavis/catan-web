/** Dice, turn timer, bank row, game log, chat, globals/awards panel and the game-over overlay. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GameDefinition, GameState, LogEntry, PlayerState, ResourceFlow } from '../../engine/schema';
import { GameIcon } from '../shared/gameIcons';
import { hasIcon, Icon } from '../shared/icons';
import { useEngine } from './engineContext';
import { CardBack, deckColor, MiniCards, ResCard } from './cards';
import { PlayerName } from './chips';
import { faceInfo, globalRows } from './display';
import { byId, contrastText } from './util';

/* ---------------------------------- dice ---------------------------------- */

const PIPS: Record<number, [number, number][]> = {
  1: [[12, 12]],
  2: [[7, 7], [17, 17]],
  3: [[7, 7], [12, 12], [17, 17]],
  4: [[7, 7], [17, 7], [7, 17], [17, 17]],
  5: [[7, 7], [17, 7], [12, 12], [7, 17], [17, 17]],
  6: [[7, 6.5], [17, 6.5], [7, 12], [17, 12], [7, 17.5], [17, 17.5]],
};

export function Die({ value, size = 34, red }: { value: number; size?: number; red?: boolean }) {
  const pips = PIPS[value];
  return (
    <svg className="g-die" viewBox="0 0 24 24" width={size} height={size} aria-label={`die ${value}`} role="img">
      <rect x="1" y="1" width="22" height="22" rx="4.5" className={red ? 'g-die-face g-die-face--red' : 'g-die-face'} />
      {pips ? (
        pips.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.1" className="g-die-pip" />)
      ) : (
        <text x="12" y="12.5" textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="700" className="g-die-num">
          {value}
        </text>
      )}
    </svg>
  );
}

/** The last roll, drawn as two large dice (bottom-right of the board). */
export function DiceDisplay({ def, state }: { def: GameDefinition; state: GameState }) {
  const roll = state.lastRoll;
  const [anim, setAnim] = useState(false);
  const key = roll ? `${state.version}:${roll.dice.join(',')}:${state.turn}` : '';
  const prev = useRef(key);
  useEffect(() => {
    if (key && prev.current !== key) {
      const changedRoll = prev.current.split(':').slice(1).join(':') !== key.split(':').slice(1).join(':');
      prev.current = key;
      if (!changedRoll) return;
      setAnim(true);
      const t = setTimeout(() => setAnim(false), 600);
      return () => clearTimeout(t);
    }
  }, [key]);
  if (!roll) return null;
  return (
    <div className={`g-dice${anim ? ' g-dice--anim' : ''}`} title={`Rolled ${roll.total}`} aria-label={`Last roll: ${roll.total}`}>
      {roll.dice.map((d, i) => (
        <Die key={i} value={d} size={52} />
      ))}
      {(roll.event ?? []).map((face, i) => {
        const dieDef = def.dice.eventDice?.[i];
        const f = faceInfo(def, face);
        const bg = f.color;
        const fg = bg ? contrastText(bg) : undefined;
        return (
          <span
            key={`e${i}`}
            className="g-eventdie"
            style={bg ? { background: bg, color: fg, borderColor: 'rgba(0,0,0,0.35)' } : undefined}
            title={`${dieDef?.id ?? 'Event die'}: ${f.label}`}
            data-face={face}
          >
            {f.icon && hasIcon(f.icon) ? <Icon name={f.icon} label={f.label} size={22} fill={bg ? (fg === '#fff' ? '#fff' : '#222') : '#ddd'} /> : null}
            <span className="g-eventdie-label">{f.label}</span>
          </span>
        );
      })}
      <span className={`g-dice-total${roll.total === 7 ? ' g-dice-total--seven' : ''}`}>{roll.total}</span>
    </div>
  );
}

/* --------------------------------- timer ---------------------------------- */

/**
 * Authoritative turn-timer from the room host: epoch ms by which `player` must act (null = no timer
 * running). Newer hosts also send `stage` (counting down to the roll, or the turn) and `total`
 * (seconds the countdown was armed with, for the progress bar); both are optional.
 */
export interface TimerInfo {
  deadline: number | null;
  player: string | null;
  stage?: 'roll' | 'turn';
  total?: number;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/**
 * Countdown box "mm:ss" with a progress bar. With `timer` (from the host) it counts to the host's
 * deadline; without it (dev harness) it is a client-side estimate that restarts when the turn changes.
 */
export function TurnTimer({ state, timer }: { state: GameState; timer?: TimerInfo }) {
  const fallbackTotal = state.settings.turnTimerSeconds;
  const turnKey = `${state.turn}:${state.currentPlayerIndex}:${state.phase}`;
  const [start, setStart] = useState(() => Date.now());
  const lastKey = useRef(turnKey);
  useEffect(() => {
    if (lastKey.current !== turnKey) {
      lastKey.current = turnKey;
      setStart(Date.now());
    }
  }, [turnKey]);
  const running = timer ? !!timer.deadline : fallbackTotal > 0;
  const now = useNow(running);

  // Without `total` from the host, remember what the countdown was armed with: the remaining time
  // when the deadline was first seen (re-armed when the player/stage changes or time is added).
  const armed = useRef<{ key: string; deadline: number; total: number } | null>(null);
  let total = 0;
  let left = 0;
  if (timer) {
    if (timer.deadline) {
      left = Math.max(0, (timer.deadline - now) / 1000);
      const key = `${timer.player}:${timer.stage ?? ''}`;
      const a = armed.current;
      if (!a || a.key !== key || timer.deadline > a.deadline) {
        armed.current = { key, deadline: timer.deadline, total: Math.max(left, a && a.key === key ? a.total : 0) };
      }
      total = timer.total ?? armed.current!.total;
    }
  } else if (fallbackTotal) {
    total = fallbackTotal;
    left = Math.max(0, total - (now - start) / 1000);
  }
  if (!running) return null;
  const secs = Math.ceil(left);
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  const who = timer?.player ? state.players.find((p) => p.id === timer.player) : undefined;
  const pct = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
  const stage = timer?.stage === 'roll' ? 'to roll' : timer?.stage === 'turn' ? 'turn' : '';
  return (
    <div
      className={`g-timerbox${secs <= 10 ? ' g-timerbox--low' : ''}${timer?.stage ? ` g-timerbox--${timer.stage}` : ''}`}
      title={who ? `Time left for ${who.name}${stage ? ` (${stage})` : ''}` : 'Turn timer'}
      style={who ? { ['--pc' as string]: who.color } : undefined}
    >
      <span role="timer" className="g-timer">{mm}:{ss}</span>
      {stage && <span className="g-timer-stage">{stage}</span>}
      <span className="g-timer-bar" aria-hidden><i style={{ width: `${pct * 100}%` }} /></span>
    </div>
  );
}

/* ---------------------------------- bank ---------------------------------- */

export function BankDisplay({ def, state }: { def: GameDefinition; state: GameState }) {
  const decks = def.decks.filter((d) => state.decks[d.id]);
  const showBank = !state.settings.hideBankCards && Object.keys(state.bank).length > 0;
  return (
    <div className="g-bank" aria-label="Bank" data-anchor="bank">
      <span className="g-bank-icon" title={showBank ? 'Bank' : 'Bank (card counts hidden)'}>
        <GameIcon name="bank" size={30} />
      </span>
      {showBank &&
        def.resources.map((r) => {
          const n = state.bank[r.id];
          const label = n === undefined || n < 0 ? '∞' : n;
          return (
            <span key={r.id} className={`g-bank-res${n === 0 ? ' g-bank-res--out' : ''}`} data-bank-res={r.id} title={`${r.name}: ${label} in bank`}>
              <ResCard def={def} id={r.id} size="sm" title="" />
              <b>{label}</b>
            </span>
          );
        })}
      {decks.map((d) => (
        <span key={d.id} className="g-bank-res g-bank-deck" data-bank-deck={d.id} title={`${d.name}: ${state.decks[d.id].draw.length} cards left`}>
          <CardBack size="sm" dev color={d.color ?? deckColor(def, d.id)} />
          <b>{state.decks[d.id].draw.length}</b>
        </span>
      ))}
    </div>
  );
}

/* -------------------------- globals + awards panel -------------------------- */

/**
 * Generic "board state" panel: global counters (GameState.globals, labelled by
 * def.display.globals; `max` draws a track) and every award with its holder.
 */
export function GameInfoPanel({ def, state, playerId, show = 'both' }: { def: GameDefinition; state: GameState; playerId: string; show?: 'globals' | 'awards' | 'both' }) {
  const rows = show === 'awards' ? [] : globalRows(def, state);
  const awards = show === 'globals' ? [] : def.awards;
  if (rows.length === 0 && awards.length === 0) return null;
  return (
    <section className={`g-info g-info--${show}`} aria-label={show === 'globals' ? 'Board counters' : show === 'awards' ? 'Awards' : 'Game info'}>
      {rows.length > 0 && (
        <div className="g-globals">
          {rows.map((r) => {
            const pct = r.max ? Math.max(0, Math.min(1, r.value / r.max)) : 0;
            return (
              <div key={r.key} className="g-global" title={r.max ? `${r.label}: ${r.value} / ${r.max}` : `${r.label}: ${r.value}`} data-global={r.key}>
                <span className="g-global-label">
                  {r.icon && <Icon name={r.icon} label={r.label} size={14} fill={r.color ?? '#ccc'} />}
                  {r.label}
                </span>
                {r.max ? (
                  r.max <= 16 ? (
                    <span className="g-track" style={{ ['--tc' as string]: r.color ?? 'var(--g-accent)' }}>
                      {Array.from({ length: r.max }, (_, i) => (
                        <i key={i} className={i < r.value ? 'on' : ''} />
                      ))}
                    </span>
                  ) : (
                    <span className="g-bar" style={{ ['--tc' as string]: r.color ?? 'var(--g-accent)' }}>
                      <i style={{ width: `${pct * 100}%` }} />
                    </span>
                  )
                ) : <span />}
                <b className="g-global-val">{r.value}{r.max ? <span className="g-muted">/{r.max}</span> : null}</b>
              </div>
            );
          })}
        </div>
      )}
      {awards.length > 0 && (
        <div className="g-awards">
          {awards.map((a) => {
            const holder = state.players.find((p) => p.id === state.awards[a.id]);
            const keep = a.mode === 'keepUntilBeaten';
            return (
              <div key={a.id} className={`g-award${holder ? ' g-award--held' : ''}${holder?.id === playerId ? ' g-award--mine' : ''}`} data-award={a.id}>
                <GameIcon name="trophy" size={14} color={holder ? '#f1c232' : '#777'} />
                <span className="g-grow">
                  {a.name}
                  <span className="g-muted g-small">{' '}{[a.vp ? `+${a.vp} VP` : '', a.min > 0 ? `min ${a.min}` : ''].filter(Boolean).join(' · ')}</span>
                  {keep && <span className="g-tag g-tag--sm" title="Once won, it is kept until another player strictly beats the holder">kept until beaten</span>}
                </span>
                {holder ? <PlayerName p={holder} /> : <span className="g-muted g-small">unclaimed</span>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------------------------------- log ----------------------------------- */

function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}

/** Sum of the cards a flow list moves, filtered. */
function sumFlows(flows: ResourceFlow[], pick: (f: ResourceFlow) => boolean): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of flows) if (pick(f)) for (const [r, n] of Object.entries(f.res)) out[r] = (out[r] ?? 0) + n;
  return out;
}
const nonEmpty = (m: Record<string, number>) => Object.values(m).some((n) => n > 0);

function Who({ p, fallback }: { p: PlayerState | undefined; fallback?: string }) {
  if (!p) return <b className="g-log-name">{fallback ?? 'Someone'}</b>;
  return <b className="g-log-name" style={{ color: `color-mix(in srgb, ${p.color} 70%, var(--g-text))` }}>{p.name}</b>;
}

/** One log line: structured (mini cards, dice, piece icons) when the entry carries data, else text. */
export function LogLine({ def, state, e }: { def: GameDefinition; state: GameState; e: LogEntry }) {
  const byPid = (id: string | undefined) => (id ? state.players.find((p) => p.id === id) : undefined);
  const p = byPid(e.player);
  const flows = e.flows ?? [];
  const other = (f: ResourceFlow) => (f.from === e.player ? f.to : f.from);
  let body: ReactNode = null;
  switch (e.kind) {
    case 'roll': {
      const extra = /\(([^)]*)\)\s*$/.exec(e.text)?.[1];
      body = (
        <>
          <Who p={p} /> rolled{' '}
          <span className="g-log-dice">{(e.dice ?? []).map((d, i) => <Die key={i} value={d} size={18} />)}</span>
          {extra && <span className="g-muted"> ({extra})</span>}
        </>
      );
      break;
    }
    case 'production':
    case 'gain': {
      const got = sumFlows(flows, (f) => f.to === e.player);
      if (nonEmpty(got)) body = <><Who p={p} /> got <MiniCards def={def} res={got} /></>;
      break;
    }
    case 'build': {
      const pd = byId(def.pieces, e.piece);
      body = (
        <>
          <Who p={p} /> {/upgrades/.test(e.text) ? 'upgraded to' : 'built'} a{' '}
          <span className="g-log-piece" title={pd?.name}>
            <GameIcon name={pd?.icon} alt={[e.piece]} label={pd?.name} size={16} color={p?.color} />
          </span>{' '}
          {pd?.name ?? e.piece}
        </>
      );
      break;
    }
    case 'bankTrade':
    case 'trade': {
      const gave = sumFlows(flows, (f) => f.from === e.player);
      const got = sumFlows(flows, (f) => f.to === e.player);
      const partner = flows.map(other).find((x) => x !== 'bank');
      body = (
        <>
          <Who p={p} /> gave <MiniCards def={def} res={gave} /> and got <MiniCards def={def} res={got} />{' '}
          {e.kind === 'bankTrade' ? 'from the bank' : <>from <Who p={byPid(partner)} fallback={partner} /></>}
        </>
      );
      break;
    }
    case 'steal': {
      const got = sumFlows(flows, (f) => f.to === e.player);
      const victim = flows.map(other).find((x) => x !== 'bank');
      if (nonEmpty(got)) body = <><Who p={p} /> stole <MiniCards def={def} res={got} /> from <Who p={byPid(victim)} fallback={victim} /></>;
      break;
    }
    case 'discard': {
      const lost = sumFlows(flows, (f) => f.from === e.player);
      if (nonEmpty(lost)) body = <><Who p={p} /> discarded <MiniCards def={def} res={lost} /></>;
      break;
    }
  }
  if (!body) {
    // Plain text; engine lines usually start with the player's name: colour it instead of repeating it.
    const named = !!p && e.text.startsWith(p.name);
    body = named ? <><Who p={p} />{e.text.slice(p!.name.length)}</> : <span>{e.text}</span>;
    if (flows.length && e.kind !== 'buyCard' && e.kind !== 'action') {
      body = (
        <>
          {body}{' '}
          {flows.map((f, i) => <MiniCards key={i} def={def} res={f.res} />)}
        </>
      );
    } else if (flows.length) {
      const paid = sumFlows(flows, (f) => f.from === e.player && f.to === 'bank');
      if (nonEmpty(paid)) body = <>{body} <span className="g-log-paid"><MiniCards def={def} res={paid} /></span></>;
    }
  }
  return (
    <div className={`g-log-row${e.kind ? ` g-log-row--${e.kind}` : ''}`} data-kind={e.kind}>
      {body}
    </div>
  );
}

export function GameLog({ def, state }: { def: GameDefinition; state: GameState }) {
  const ref = useAutoScroll(state.log.length);
  const shown = state.log.slice(-150);
  return (
    <div className="g-log" ref={ref} aria-live="polite" aria-label="Game log">
      {state.log.length === 0 && <div className="g-muted g-small">Nothing yet.</div>}
      {shown.map((e, i) => <LogLine key={state.log.length - shown.length + i} def={def} state={state} e={e} />)}
    </div>
  );
}

/* ---------------------------------- chat ---------------------------------- */

export function Chat({
  state,
  chat,
  sendChat,
}: {
  state: GameState;
  chat: { from: string; text: string; at: number }[];
  sendChat: (t: string) => void;
}) {
  const [text, setText] = useState('');
  const ref = useAutoScroll(chat.length);
  const byPid = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  return (
    <div className="g-chat">
      <div className="g-chat-msgs" ref={ref} aria-label="Chat messages">
        {chat.length === 0 && <div className="g-muted g-small">No messages yet.</div>}
        {chat.map((m, i) => {
          const p = byPid.get(m.from);
          return (
            <div key={i} className="g-log-row" title={new Date(m.at).toLocaleTimeString()}>
              <b className="g-log-name" style={p ? { color: `color-mix(in srgb, ${p.color} 70%, var(--g-text))` } : undefined}>{p?.name ?? m.from}:</b>
              <span>{m.text}</span>
            </div>
          );
        })}
      </div>
      <form
        className="g-chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          sendChat(t);
          setText('');
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say hello…" maxLength={300} aria-label="Chat message" />
        <button type="submit" className="g-btn g-btn--sm">Send</button>
      </form>
    </div>
  );
}

/* -------------------------------- game over -------------------------------- */

export function GameOverOverlay({ def, state, playerId }: { def: GameDefinition; state: GameState; playerId: string }) {
  const engine = useEngine();
  const [hidden, setHidden] = useState(false);
  if (hidden) {
    return (
      <button type="button" className="g-btn g-gameover-reopen" onClick={() => setHidden(false)}>
        Show results
      </button>
    );
  }
  const rows = state.players
    .map((p) => ({
      p,
      vp: engine.computeVP(def, state, p.id, true),
      awards: Object.entries(state.awards).filter(([, h]) => h === p.id).map(([a]) => byId(def.awards, a)?.name ?? a),
    }))
    .sort((a, b) => (a.p.id === state.winner ? -1 : b.p.id === state.winner ? 1 : b.vp - a.vp));
  const winner = state.players.find((p) => p.id === state.winner);
  return (
    <div className="g-modal-backdrop g-gameover">
      <div className="g-modal" role="dialog" aria-label="Game over">
        <GameIcon name="trophy" size={56} color="#f1c232" />
        <h2>{winner ? (winner.id === playerId ? 'You win!' : `${winner.name} wins!`) : 'Game over'}</h2>
        <table className="g-vptable">
          <thead>
            <tr>
              <th>#</th>
              <th>Player</th>
              <th>VP</th>
              <th>Awards</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.p.id} className={r.p.id === state.winner ? 'g-vptable-win' : ''}>
                <td>{i + 1}</td>
                <td><PlayerName p={r.p} /></td>
                <td><b>{r.vp}</b></td>
                <td className="g-small">{r.awards.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="g-modal-foot">
          <button type="button" className="g-btn" onClick={() => setHidden(true)}>
            View board
          </button>
        </div>
      </div>
    </div>
  );
}
