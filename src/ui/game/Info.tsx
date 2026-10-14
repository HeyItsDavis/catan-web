/** Turn bar, dice, timer, bank, log, chat and game-over overlay. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameDefinition, GameState } from '../../engine/schema';
import { hasIcon, Icon } from '../shared/icons';
import { useEngine } from './engineContext';
import { PlayerDot, PlayerName, ResChip } from './chips';
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

function Die({ value, red }: { value: number; red?: boolean }) {
  const pips = PIPS[value];
  return (
    <svg className="g-die" viewBox="0 0 24 24" width={34} height={34} aria-label={`die ${value}`}>
      <rect x="1" y="1" width="22" height="22" rx="5" className={red ? 'g-die-face g-die-face--red' : 'g-die-face'} />
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

export function DiceDisplay({ def, state }: { def: GameDefinition; state: GameState }) {
  const roll = state.lastRoll;
  const [anim, setAnim] = useState(false);
  const key = roll ? `${state.version}:${roll.dice.join(',')}` : '';
  const prev = useRef(key);
  useEffect(() => {
    if (key && prev.current !== key) {
      prev.current = key;
      setAnim(true);
      const t = setTimeout(() => setAnim(false), 500);
      return () => clearTimeout(t);
    }
  }, [key]);
  if (!roll) return <div className="g-dice g-muted g-small">No roll yet</div>;
  return (
    <div className={`g-dice${anim ? ' g-dice--anim' : ''}`} title={`Rolled ${roll.total}`}>
      {roll.dice.map((d, i) => (
        <Die key={i} value={d} red={i === 1 && roll.dice.length === 2} />
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
            {f.icon && hasIcon(f.icon) ? <Icon name={f.icon} label={f.label} size={18} fill={bg ? (fg === '#fff' ? '#fff' : '#222') : '#ddd'} /> : null}
            <span className="g-eventdie-label">{f.label}</span>
          </span>
        );
      })}
      <span className={`g-dice-total${roll.total === 7 ? ' g-dice-total--seven' : ''}`}>{roll.total}</span>
    </div>
  );
}

/* --------------------------------- timer ---------------------------------- */

/** Authoritative turn-timer deadline from the room host (epoch ms; null = no timer running). */
export interface TimerInfo { deadline: number | null; player: string | null }

/**
 * Countdown. With `timer` (from the host) it counts to the host's deadline for whoever must act;
 * without it (dev harness) it is a client-side estimate that restarts when the turn changes.
 */
export function TurnTimer({ state, timer }: { state: GameState; timer?: TimerInfo }) {
  const total = timer ? (timer.deadline ? 1 : 0) : state.settings.turnTimerSeconds;
  const key = `${state.turn}:${state.currentPlayerIndex}:${state.phase}`;
  const [start, setStart] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key;
      setStart(Date.now());
    }
  }, [key]);
  useEffect(() => {
    if (!total) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [total]);
  if (!total) return null;
  const left = timer?.deadline
    ? Math.max(0, Math.ceil((timer.deadline - now) / 1000))
    : Math.max(0, Math.ceil(total - (now - start) / 1000));
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  const who = timer?.player ? state.players.find((p) => p.id === timer.player)?.name : undefined;
  return (
    <span className={`g-timer${left <= 10 ? ' g-timer--low' : ''}`} title={who ? `Time left for ${who}` : 'Turn timer'} role="timer">
      ⏱ {mm}:{ss}
    </span>
  );
}

/* -------------------------------- turn bar -------------------------------- */

const PHASE_LABEL: Record<string, string> = {
  setup: 'Setup',
  preRoll: 'Roll',
  main: 'Main',
  specialBuild: 'Special build',
  gameOver: 'Game over',
};

export function TurnIndicator({ state, playerId, timer }: { state: GameState; playerId: string; timer?: TimerInfo }) {
  const cur = state.players.find((p) => p.id === state.turnOrder[state.currentPlayerIndex]);
  const mine = cur?.id === playerId;
  return (
    <div className={`g-turn${mine ? ' g-turn--mine' : ''}`} style={{ ['--pc' as string]: cur?.color ?? '#888' }}>
      <span className="g-turn-who">
        {mine ? <b>Your turn</b> : <><PlayerName p={cur} /><span className="g-muted">'s turn</span></>}
      </span>
      <span className="g-turn-meta g-muted g-small">
        Turn {state.turn} · {PHASE_LABEL[state.phase] ?? state.phase}
      </span>
      <TurnTimer state={state} timer={timer} />
    </div>
  );
}

/* ---------------------------------- bank ---------------------------------- */

export function BankDisplay({ def, state }: { def: GameDefinition; state: GameState }) {
  const decks = def.decks.filter((d) => state.decks[d.id]);
  const showBank = !state.settings.hideBankCards && Object.keys(state.bank).length > 0;
  if (!showBank && decks.length === 0) return null;
  return (
    <div className="g-bank" aria-label="Bank">
      <span className="g-muted g-small">Bank</span>
      {showBank &&
        def.resources.map((r) => {
          const n = state.bank[r.id];
          return <ResChip key={r.id} def={def} id={r.id} amount={n === undefined || n < 0 ? '∞' : n} small title={`${r.name} in bank`} />;
        })}
      {decks.map((d) => (
        <span key={d.id} className="g-reschip g-reschip--sm g-deckchip" style={{ background: d.color ?? '#7b68b5' }} title={`${d.name}: cards left`}>
          <Icon name="card" size={12} fill="rgba(255,255,255,0.3)" stroke="#fff" />
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
export function GameInfoPanel({ def, state, playerId }: { def: GameDefinition; state: GameState; playerId: string }) {
  const rows = globalRows(def, state);
  const awards = def.awards;
  if (rows.length === 0 && awards.length === 0) return null;
  return (
    <section className="g-panel g-info" aria-label="Game info">
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
                ) : null}
                <b className="g-global-val">{r.value}{r.max ? <span className="g-muted">/{r.max}</span> : null}</b>
              </div>
            );
          })}
        </div>
      )}
      {awards.length > 0 && (
        <div className="g-awards">
          <h4>Awards</h4>
          {awards.map((a) => {
            const holder = state.players.find((p) => p.id === state.awards[a.id]);
            const keep = a.mode === 'keepUntilBeaten';
            return (
              <div key={a.id} className={`g-award${holder ? ' g-award--held' : ''}${holder?.id === playerId ? ' g-award--mine' : ''}`} data-award={a.id}>
                <Icon name="trophy" size={14} fill={holder ? '#f1c232' : '#777'} />
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

/* ------------------------------- log + chat -------------------------------- */

function useAutoScroll(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [dep]);
  return ref;
}

export function GameLog({ state }: { state: GameState }) {
  const ref = useAutoScroll(state.log.length);
  const colors = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  return (
    <div className="g-log" ref={ref} aria-live="polite">
      {state.log.length === 0 && <div className="g-muted g-small">Nothing yet.</div>}
      {state.log.slice(-200).map((e, i) => {
        const p = e.player ? colors.get(e.player) : undefined;
        // Engine log lines usually already start with the player's name: bold it instead of repeating it.
        const named = !!p && e.text.startsWith(p.name);
        return (
          <div key={i} className="g-log-row">
            {p && <PlayerDot color={p.color} size={8} />}
            {named ? (
              <span><b className="g-log-name">{p!.name}</b>{e.text.slice(p!.name.length)}</span>
            ) : (
              <span>{e.text}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

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
      <div className="g-chat-msgs" ref={ref}>
        {chat.length === 0 && <div className="g-muted g-small">Say hi!</div>}
        {chat.map((m, i) => {
          const p = byPid.get(m.from);
          return (
            <div key={i} className="g-log-row" title={new Date(m.at).toLocaleTimeString()}>
              <b className="g-log-name" style={{ color: p?.color }}>{p?.name ?? m.from}:</b>
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
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message…" maxLength={300} aria-label="Chat message" />
        <button type="submit" className="g-btn g-btn--sm">Send</button>
      </form>
    </div>
  );
}

export function LogChatTabs(props: Parameters<typeof Chat>[0]) {
  const [tab, setTab] = useState<'log' | 'chat'>('log');
  const [seen, setSeen] = useState(props.chat.length);
  const unread = tab === 'chat' ? 0 : props.chat.length - seen;
  const choose = (t: 'log' | 'chat') => {
    setSeen(props.chat.length);
    setTab(t);
  };
  return (
    <section className="g-panel g-logchat">
      <div className="g-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'g-tab g-tab--on' : 'g-tab'} onClick={() => choose('log')}>
          Log
        </button>
        <button type="button" role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'g-tab g-tab--on' : 'g-tab'} onClick={() => choose('chat')}>
          Chat {unread > 0 && <span className="g-badge g-badge--hot">{unread}</span>}
        </button>
      </div>
      {tab === 'log' ? <GameLog state={props.state} /> : <Chat {...props} />}
    </section>
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
        <Icon name="trophy" size={48} fill="#f1c232" />
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
