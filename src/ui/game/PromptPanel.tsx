/**
 * UI for answering this player's pending prompt. Location / piece prompts are
 * answered on the board (this shows a banner); everything else is a panel.
 */
import { useState } from 'react';
import type { Command, GameDefinition, GameState, Prompt } from '../../engine/schema';
import { PlayerName, ResChip } from './chips';
import { byId, HIDDEN_KEY, sumMap } from './util';

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

  const skip = prompt.optional ? (
    <button type="button" className="g-btn g-btn--ghost" onClick={() => respond(null)}>
      Skip
    </button>
  ) : null;

  const me = state.players.find((p) => p.id === playerId);

  if (prompt.kind === 'location' || prompt.kind === 'piece') {
    return (
      <div className="g-prompt-banner" role="status">
        <span className="g-prompt-pulse" />
        <span>{prompt.label || (prompt.kind === 'piece' ? 'Choose a piece on the board' : 'Choose a location on the board')}</span>
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
          {prompt.options.map((cid) => {
            const inst = me?.hand.find((c) => c.id === cid) ?? me?.played.find((c) => c.id === cid);
            const card = byId(def.cards, inst?.card ?? cid);
            return (
              <button key={cid} type="button" className="g-choice" onClick={() => respond(cid)} title={card?.description}>
                <b>{card?.name ?? cid}</b>
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
      <div className="g-modal" role="dialog" aria-label={prompt.label}>
        <h3>{prompt.label || 'Make a choice'}</h3>
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
