/** Bank/port trade + player-offer builder dialog, and the live offers list. */
import { useState } from 'react';
import type { AvailableMoves } from '../../engine';
import type { Command, GameDefinition, GameState, TradeOffer } from '../../engine/schema';
import { PlayerDot, PlayerName, ResChip } from './chips';
import { byId, cleanMap, isRedacted, sumMap } from './util';

interface DialogProps {
  def: GameDefinition;
  state: GameState;
  playerId: string;
  moves: AvailableMoves;
  send: (c: Command) => void;
  onClose: () => void;
}

export function TradeDialog(props: DialogProps) {
  const { def, onClose } = props;
  const [tab, setTab] = useState<'bank' | 'players'>('bank');
  return (
    <div className="g-modal-backdrop" onClick={onClose}>
      <div className="g-modal g-modal--wide" role="dialog" aria-label="Trade" onClick={(e) => e.stopPropagation()}>
        <div className="g-modal-head">
          <div className="g-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'bank'} className={tab === 'bank' ? 'g-tab g-tab--on' : 'g-tab'} onClick={() => setTab('bank')}>
              Bank &amp; ports
            </button>
            {def.trade.playerTrading && (
              <button type="button" role="tab" aria-selected={tab === 'players'} className={tab === 'players' ? 'g-tab g-tab--on' : 'g-tab'} onClick={() => setTab('players')}>
                Players
              </button>
            )}
          </div>
          <button type="button" className="g-x" onClick={onClose} aria-label="Close">×</button>
        </div>
        {tab === 'bank' ? <BankTrade {...props} /> : <PlayerTrade {...props} />}
      </div>
    </div>
  );
}

function BankTrade({ def, state, playerId, moves, send, onClose }: DialogProps) {
  const me = state.players.find((p) => p.id === playerId)!;
  const [give, setGive] = useState<Record<string, number>>({});
  const [get, setGet] = useState<Record<string, number>>({});
  const rate = (id: string) => {
    const r = byId(def.resources, id);
    return moves.bankRates[id] ?? (r ? def.trade.bankRates[r.kind] : undefined) ?? 4;
  };
  const lots = Object.entries(give).reduce((a, [id, n]) => a + n / rate(id), 0);
  const want = sumMap(get);
  const bankKnown = !state.settings.hideBankCards && Object.keys(state.bank).length > 0;
  const ok = lots > 0 && lots === want;

  return (
    <div className="g-trade">
      <div className="g-trade-col">
        <h4>You give</h4>
        <p className="g-muted g-small">Click to add one trade lot at your rate.</p>
        <div className="g-trade-pool">
          {def.resources.map((r) => {
            const have = (me.resources[r.id] ?? 0) - (give[r.id] ?? 0);
            const rt = rate(r.id);
            return (
              <button
                key={r.id}
                type="button"
                className="g-trade-res"
                disabled={have < rt}
                title={`${r.name}: ${rt}:1`}
                onClick={() => setGive((g) => ({ ...g, [r.id]: (g[r.id] ?? 0) + rt }))}
              >
                <ResChip def={def} id={r.id} amount={me.resources[r.id] ?? 0} />
                <span className={rt < 4 ? 'g-rate g-rate--good' : 'g-rate'}>{rt}:1</span>
              </button>
            );
          })}
        </div>
        <Selection def={def} map={give} onRemove={(id) => setGive((g) => cleanMap({ ...g, [id]: (g[id] ?? 0) - rate(id) }))} />
      </div>
      <div className="g-trade-col">
        <h4>You get</h4>
        <p className="g-muted g-small">One card per lot given.</p>
        <div className="g-trade-pool">
          {def.resources.map((r) => {
            const supply = state.bank[r.id];
            const out = bankKnown && supply !== undefined && supply >= 0 && supply - (get[r.id] ?? 0) <= 0;
            return (
              <button
                key={r.id}
                type="button"
                className="g-trade-res"
                disabled={out || give[r.id] !== undefined}
                title={out ? `${r.name}: bank is out` : r.name}
                onClick={() => setGet((g) => ({ ...g, [r.id]: (g[r.id] ?? 0) + 1 }))}
              >
                <ResChip def={def} id={r.id} amount={bankKnown && supply !== undefined && supply >= 0 ? supply : undefined} />
              </button>
            );
          })}
        </div>
        <Selection def={def} map={get} onRemove={(id) => setGet((g) => cleanMap({ ...g, [id]: (g[id] ?? 0) - 1 }))} />
      </div>
      <div className="g-modal-foot g-trade-foot">
        <span className="g-muted">
          {lots} lot{lots === 1 ? '' : 's'} → {want} card{want === 1 ? '' : 's'}
        </span>
        <button type="button" className="g-btn g-btn--ghost" onClick={() => { setGive({}); setGet({}); }}>
          Clear
        </button>
        <button
          type="button"
          className="g-btn g-btn--primary"
          disabled={!ok}
          onClick={() => {
            send({ type: 'bankTrade', give: cleanMap(give), get: cleanMap(get) });
            onClose();
          }}
        >
          Trade with bank
        </button>
      </div>
    </div>
  );
}

function PlayerTrade({ def, state, playerId, send, onClose }: DialogProps) {
  const me = state.players.find((p) => p.id === playerId)!;
  const others = state.players.filter((p) => p.id !== playerId);
  const [give, setGive] = useState<Record<string, number>>({});
  const [get, setGet] = useState<Record<string, number>>({});
  const [to, setTo] = useState<string[] | null>(null);
  const ok = sumMap(give) > 0 && sumMap(get) > 0 && (to === null || to.length > 0)
    && Object.keys(give).every((id) => !get[id]);

  const stepper = (map: Record<string, number>, set: (m: Record<string, number>) => void, max?: (id: string) => number) =>
    def.resources.map((r) => {
      const v = map[r.id] ?? 0;
      const lim = max ? max(r.id) : Infinity;
      return (
        <div key={r.id} className="g-stepper-row">
          <ResChip def={def} id={r.id} amount={max ? lim : undefined} small />
          <span className="g-grow g-small">{r.name}</span>
          <button type="button" className="g-step" disabled={v <= 0} onClick={() => set(cleanMap({ ...map, [r.id]: v - 1 }))} aria-label={`less ${r.name}`}>−</button>
          <b className="g-step-val">{v}</b>
          <button type="button" className="g-step" disabled={v >= lim} onClick={() => set({ ...map, [r.id]: v + 1 })} aria-label={`more ${r.name}`}>+</button>
        </div>
      );
    });

  return (
    <div className="g-trade">
      <div className="g-trade-col">
        <h4>You give</h4>
        <div className="g-stepper-list">{stepper(give, setGive, (id) => (isRedacted(me) ? 0 : me.resources[id] ?? 0))}</div>
      </div>
      <div className="g-trade-col">
        <h4>You want</h4>
        <div className="g-stepper-list">{stepper(get, setGet)}</div>
      </div>
      <div className="g-trade-to">
        <span className="g-muted">Offer to:</span>
        <label className="g-check">
          <input type="checkbox" checked={to === null} onChange={(e) => setTo(e.target.checked ? null : [])} /> Everyone
        </label>
        {to !== null &&
          others.map((p) => (
            <label key={p.id} className="g-check">
              <input
                type="checkbox"
                checked={to.includes(p.id)}
                onChange={(e) => setTo(e.target.checked ? [...to, p.id] : to.filter((x) => x !== p.id))}
              />
              <PlayerDot color={p.color} /> {p.name}
            </label>
          ))}
      </div>
      <div className="g-modal-foot g-trade-foot">
        <button type="button" className="g-btn g-btn--ghost" onClick={() => { setGive({}); setGet({}); }}>
          Clear
        </button>
        <button
          type="button"
          className="g-btn g-btn--primary"
          disabled={!ok}
          onClick={() => {
            send({ type: 'offerTrade', to, give: cleanMap(give), get: cleanMap(get) });
            onClose();
          }}
        >
          Send offer
        </button>
      </div>
    </div>
  );
}

function Selection({ def, map, onRemove }: { def: GameDefinition; map: Record<string, number>; onRemove: (id: string) => void }) {
  const entries = Object.entries(map).filter(([, n]) => n > 0);
  return (
    <div className="g-trade-sel">
      {entries.length === 0 ? (
        <span className="g-muted g-small">nothing selected</span>
      ) : (
        entries.map(([id, n]) => (
          <button key={id} type="button" className="g-unbtn" onClick={() => onRemove(id)} title="Remove">
            <ResChip def={def} id={id} amount={n} />
          </button>
        ))
      )}
    </div>
  );
}

function MapChips({ def, map }: { def: GameDefinition; map: Record<string, number> }) {
  return (
    <span className="g-cost">
      {Object.entries(map).map(([id, n]) => (
        <ResChip key={id} def={def} id={id} amount={n} small />
      ))}
    </span>
  );
}

/* ------------------------------ live offers ------------------------------ */

export function TradeOffers({ def, state, playerId, send }: { def: GameDefinition; state: GameState; playerId: string; send: (c: Command) => void }) {
  const me = state.players.find((p) => p.id === playerId);
  const visible = state.trades.filter((t) => t.from === playerId || t.to === null || t.to.includes(playerId));
  if (visible.length === 0) return null;
  const canAfford = (t: TradeOffer) =>
    !!me && !isRedacted(me) && Object.entries(t.get).every(([id, n]) => (me.resources[id] ?? 0) >= n);

  return (
    <section className="g-panel g-offers" aria-label="Trade offers">
      <h4>Trade offers</h4>
      {visible.map((t) => {
        const from = state.players.find((p) => p.id === t.from);
        const mine = t.from === playerId;
        const myResp = t.responses[playerId] ?? 'pending';
        return (
          <div key={t.id} className={`g-offer${mine ? ' g-offer--mine' : ''}`}>
            <div className="g-offer-head">
              {mine ? <b>Your offer</b> : <PlayerName p={from} />}
              {t.to && <span className="g-muted g-small">to {t.to.map((id) => state.players.find((p) => p.id === id)?.name ?? id).join(', ')}</span>}
            </div>
            <div className="g-offer-body">
              <span className="g-small g-muted">{mine ? 'give' : 'they give'}</span> <MapChips def={def} map={t.give} />
              <span className="g-arrow">⇄</span>
              <span className="g-small g-muted">{mine ? 'get' : 'you give'}</span> <MapChips def={def} map={t.get} />
            </div>
            {mine ? (
              <div className="g-offer-resps">
                {Object.entries(t.responses)
                  .filter(([pid]) => pid !== playerId)
                  .map(([pid, r]) => {
                    const p = state.players.find((x) => x.id === pid);
                    return (
                      <span key={pid} className={`g-resp g-resp--${r}`}>
                        <PlayerDot color={p?.color ?? '#888'} />
                        {p?.name ?? pid}
                        {r === 'accept' ? (
                          <button type="button" className="g-btn g-btn--sm g-btn--primary" onClick={() => send({ type: 'confirmTrade', tradeId: t.id, withPlayer: pid })}>
                            Trade
                          </button>
                        ) : (
                          <span className="g-small"> {r === 'reject' ? '✗' : '…'}</span>
                        )}
                      </span>
                    );
                  })}
                <button type="button" className="g-btn g-btn--sm g-btn--ghost" onClick={() => send({ type: 'cancelTrade', tradeId: t.id })}>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="g-offer-resps">
                {myResp === 'pending' ? (
                  <>
                    <button
                      type="button"
                      className="g-btn g-btn--sm g-btn--primary"
                      disabled={!canAfford(t)}
                      title={canAfford(t) ? 'Accept' : 'You cannot afford this'}
                      onClick={() => send({ type: 'respondTrade', tradeId: t.id, accept: true })}
                    >
                      Accept
                    </button>
                    <button type="button" className="g-btn g-btn--sm" onClick={() => send({ type: 'respondTrade', tradeId: t.id, accept: false })}>
                      Reject
                    </button>
                  </>
                ) : (
                  <span className={`g-resp g-resp--${myResp}`}>
                    {myResp === 'accept' ? 'Accepted — waiting for confirmation' : 'Rejected'}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
