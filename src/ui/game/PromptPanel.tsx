/**
 * UI for answering this player's pending prompt. Location / piece prompts are
 * answered on the board (this shows a banner); everything else is a panel.
 */
import { useState } from 'react';
import type { Command, GameDefinition, GameState, Prompt } from '../../engine/schema';
import { Icon } from '../shared/icons';
import { PlayerName, ResChip } from './chips';
import { promptLabel } from './display';
import { byId, HIDDEN_KEY, sumMap } from './util';

/** "Pick up to 3 · 1 chosen" for multi-select prompts. */
export function ProgressPill({ prompt }: { prompt: Prompt }) {
  const pr = prompt.progress;
  if (!pr) return null;
  const range = pr.min >= pr.max ? `Pick ${pr.max}` : pr.min > 0 ? `Pick ${pr.min}–${pr.max}` : `Pick up to ${pr.max}`;
  const need = pr.picked < pr.min ? ` · ${pr.min - pr.picked} more needed` : '';
  return (
    <span className="g-progress" aria-label="Selection progress">
      {range} · <b>{pr.picked}</b> chosen{need}
      <span className="g-progress-dots" aria-hidden>
        {Array.from({ length: Math.min(pr.max, 12) }, (_, i) => (
          <i key={i} className={i < pr.picked ? 'on' : i < pr.min ? 'need' : ''} />
        ))}
      </span>
    </span>
  );
}

/** Banner while the player picks which piece performs a piece action. */
export function PieceActionBanner({ def, actionId, count, onCancel }: { def: GameDefinition; actionId: string; count: number; onCancel: () => void }) {
  const a = byId(def.actions, actionId);
  return (
    <div className="g-prompt-banner" role="status">
      <span className="g-prompt-pulse" />
      {a?.icon && <Icon name={a.icon} label={a.name} size={18} fill="#fff" />}
      <span>{a?.name ?? actionId}: choose one of your {count} pieces</span>
      <button type="button" className="g-btn g-btn--sm" onClick={onCancel}>Cancel</button>
    </div>
  );
}

/** Prompt may carry human labels for 'option' prompts (proposed additive schema field). */
type PromptWithLabels = Prompt & { optionLabels?: string[] };

interface Props {
  def: GameDefinition;
  state: GameState;
  playerId: string;
  prompt: Prompt;
  send: (c: Command) => void;
}

export function PromptPanel({ def, state, playerId, prompt, send }: Props) {
  const respond = (answer: Extract<Command, { type: 'respond' }>['answer']) =>
    send({ type: 'respond', promptId: prompt.id, answer });

  // Multi-select prompts become optional once enough is picked: answering null = "done".
  const done = !!prompt.progress && prompt.progress.picked > 0;
  const skip = prompt.optional ? (
    <button type="button" className={done ? 'g-btn g-btn--primary g-btn--sm' : 'g-btn g-btn--ghost'} onClick={() => respond(null)}>
      {done ? `Done (${prompt.progress!.picked})` : 'Skip'}
    </button>
  ) : null;

  const me = state.players.find((p) => p.id === playerId);
  const label = promptLabel(prompt);
  const chosen = new Set(prompt.progress?.chosen ?? []);

  if (prompt.kind === 'location' || prompt.kind === 'piece') {
    const moving = prompt.pieceId ? state.pieces.find((p) => p.id === prompt.pieceId) : undefined;
    const movingDef = byId(def.pieces, moving?.type);
    const movingOwner = state.players.find((p) => p.id === moving?.owner);
    return (
      <div className={`g-prompt-banner${moving ? ' g-prompt-banner--move' : ''}`} role="status">
        <span className="g-prompt-pulse" />
        {moving && (
          <span className="g-moving-chip" title="Piece being moved">
            <Icon name={movingDef?.icon ?? moving.type} label={movingDef?.name} size={18} fill={movingOwner?.color ?? '#aaa'} />
            {movingDef?.name ?? moving.type}
          </span>
        )}
        <span>{label || (prompt.kind === 'piece' ? 'Choose a piece on the board' : moving ? 'Choose where to move' : 'Choose a location on the board')}</span>
        {moving && prompt.options.length > 0 && (
          <span className="g-muted g-small">{prompt.options.length} reachable spot{prompt.options.length === 1 ? '' : 's'}</span>
        )}
        <ProgressPill prompt={prompt} />
        {prompt.options.length === 0 && <span className="g-muted">(no legal options)</span>}
        {prompt.kind === 'piece' &&
          prompt.options.map((pid) => {
            // Options are piece locations (engine) or piece instance ids.
            const inst = state.pieces.find((p) => p.id === pid) ?? state.pieces.find((p) => p.at === pid);
            const owner = state.players.find((p) => p.id === inst?.owner);
            return (
              <button key={pid} type="button" className="g-btn g-btn--sm" onClick={() => respond(pid)} title={owner?.name}>
                {owner && <span className="g-pdot" style={{ background: owner.color, width: 8, height: 8 }} />}
                {byId(def.pieces, inst?.type)?.name ?? inst?.type ?? pid}
              </button>
            );
          })}
        {skip}
      </div>
    );
  }

  let body: React.ReactNode;
  switch (prompt.kind) {
    case 'player':
      body = (
        <div className="g-choice-grid">
          {prompt.options.map((pid) => {
            const p = state.players.find((x) => x.id === pid);
            const cards = p ? Object.values(p.resources).reduce((a, b) => a + b, 0) : 0;
            return (
              <button key={pid} type="button" className="g-choice" onClick={() => respond(pid)}>
                <PlayerName p={p ?? { name: pid, color: '#888' }} />
                <span className="g-muted">{cards} cards</span>
              </button>
            );
          })}
        </div>
      );
      break;
    case 'resource':
      body = (
        <div className="g-choice-grid">
          {prompt.options.map((rid) => (
            <button key={rid} type="button" className="g-choice" onClick={() => respond(rid)}>
              <ResChip def={def} id={rid} />
              <span>{byId(def.resources, rid)?.name ?? rid}</span>
            </button>
          ))}
        </div>
      );
      break;
    case 'card':
      body = (
        <div className="g-choice-grid">
          {prompt.options.map((cid, i) => {
            // Options are card instance ids, possibly from ANOTHER player's hand (take a card).
            const owner = state.players.find((p) => p.hand.some((c) => c.id === cid) || p.played.some((c) => c.id === cid));
            const inst = owner?.hand.find((c) => c.id === cid) ?? owner?.played.find((c) => c.id === cid);
            const card = byId(def.cards, inst?.card) ?? (inst ? undefined : byId(def.cards, cid));
            const deck = byId(def.decks, inst?.deck);
            const name = card?.name ?? prompt.optionLabels?.[i] ?? 'Hidden card';
            return (
              <button
                key={cid}
                type="button"
                className="g-choice g-choice--card"
                style={deck?.color ? { borderTopColor: deck.color } : undefined}
                onClick={() => respond(cid)}
                title={[card?.description, deck?.name].filter(Boolean).join(' — ')}
              >
                <b>{name}</b>
                {owner && owner.id !== playerId && <span className="g-muted g-small">from {owner.name}</span>}
                {card?.description && <span className="g-muted g-small">{card.description}</span>}
              </button>
            );
          })}
        </div>
      );
      break;
    case 'discard':
      body = <DiscardPicker key={prompt.id} def={def} resources={me?.resources ?? {}} prompt={prompt} onSubmit={respond} />;
      break;
    default: {
      // 'option', 'tradeResponse', and unknown kinds: generic buttons.
      const labels = (prompt as PromptWithLabels).optionLabels;
      body = (
        <div className="g-choice-col">
          {prompt.options.map((o, i) => (
            <button key={o} type="button" className="g-btn" onClick={() => respond(o)}>
              {labels?.[i] ?? (/^\d+$/.test(o) ? `Option ${Number(o) + 1}` : o)}
            </button>
          ))}
        </div>
      );
    }
  }

  return (
    <div className="g-modal-backdrop">
      <div className="g-modal" role="dialog" aria-label={label}>
        <h3>{label || 'Make a choice'}</h3>
        {prompt.progress && (
          <div className="g-modal-progress">
            <ProgressPill prompt={prompt} />
            {chosen.size > 0 && (
              <div className="g-chosen-list">
                <span className="g-muted g-small">Chosen:</span>
                {[...chosen].map((c) => {
                  const pl = state.players.find((p) => p.id === c);
                  if (pl) return <PlayerName key={c} p={pl} />;
                  if (byId(def.resources, c)) return <ResChip key={c} def={def} id={c} small />;
                  return <span key={c} className="g-tag">{c}</span>;
                })}
              </div>
            )}
          </div>
        )}
        {body}
        {skip && <div className="g-modal-foot">{skip}</div>}
      </div>
    </div>
  );
}

function DiscardPicker({
  def,
  resources,
  prompt,
  onSubmit,
}: {
  def: GameDefinition;
  resources: Record<string, number>;
  prompt: Prompt;
  onSubmit: (m: Record<string, number>) => void;
}) {
  const amount = prompt.amount ?? 0;
  const [sel, setSel] = useState<Record<string, number>>({});
  const total = sumMap(sel);
  // Options may restrict which resources may be discarded; otherwise any held.
  const ids = (prompt.options.length ? prompt.options : Object.keys(resources)).filter((r) => r !== HIDDEN_KEY);

  const bump = (id: string, d: number) =>
    setSel((s) => {
      const cur = s[id] ?? 0;
      const next = Math.max(0, Math.min(resources[id] ?? 0, cur + d));
      if (d > 0 && total >= amount) return s;
      return { ...s, [id]: next };
    });

  return (
    <>
      <p>
        Select <b>{amount}</b> card{amount === 1 ? '' : 's'} to discard ({total}/{amount}).
      </p>
      <div className="g-stepper-list">
        {ids.map((id) => (
          <div key={id} className="g-stepper-row">
            <ResChip def={def} id={id} amount={resources[id] ?? 0} />
            <span className="g-grow">{byId(def.resources, id)?.name ?? id}</span>
            <button type="button" className="g-step" onClick={() => bump(id, -1)} disabled={!sel[id]} aria-label="less">−</button>
            <b className="g-step-val">{sel[id] ?? 0}</b>
            <button type="button" className="g-step" onClick={() => bump(id, 1)} disabled={(sel[id] ?? 0) >= (resources[id] ?? 0) || total >= amount} aria-label="more">+</button>
          </div>
        ))}
      </div>
      <div className="g-modal-foot">
        <button
          type="button"
          className="g-btn g-btn--primary"
          disabled={total !== amount}
          onClick={() => onSubmit(Object.fromEntries(Object.entries(sel).filter(([, v]) => v > 0)))}
        >
          Discard {total}/{amount}
        </button>
      </div>
    </>
  );
}

/** "Waiting for X…" line for prompts owned by other players. */
export function WaitingFor({ state, playerId }: { state: GameState; playerId: string }) {
  const others = state.prompts.filter((p) => p.player !== playerId);
  if (others.length === 0) return null;
  const seen = new Set<string>();
  const items = others.filter((p) => (seen.has(p.player) ? false : (seen.add(p.player), true)));
  return (
    <div className="g-waiting" role="status">
      {items.map((p) => {
        const pl = state.players.find((x) => x.id === p.player);
        return (
          <span key={p.id}>
            Waiting for <PlayerName p={pl} />
            {p.label ? <span className="g-muted"> — {p.label}</span> : null}…
          </span>
        );
      })}
    </div>
  );
}
