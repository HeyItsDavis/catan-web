/**
 * Trade panel (colonist style, opens above the hand): cards you give (added by clicking your hand
 * cards, removed by clicking them here), cards you want, then either trade with the bank / your
 * harbors (lights up when the selection matches your rates, AvailableMoves.bankRates) or send the
 * offer to some or all players. Also the live offers list.
 */
import type { AvailableMoves } from '../../engine';
import type { Command, GameDefinition, GameState, TradeOffer } from '../../engine/schema';
import { GameIcon } from '../shared/gameIcons';
import { MiniCards, ResCard } from './cards';
import { Avatar } from './Players';
import { byId, cleanMap, isRedacted, sumMap } from './util';

export interface TradeDraft {
  give: Record<string, number>;
  get: Record<string, number>;
  /** Players to offer to; null = everyone. */
  to: string[] | null;
}

export const emptyDraft = (): TradeDraft => ({ give: {}, get: {}, to: null });

/** Clicking a hand card: (open the draft and) put one more of it on the give side, up to what is held. */
export function offerCard(draft: TradeDraft | null, id: string, held: number): TradeDraft {
  const cur = draft ?? emptyDraft();
  const n = Math.min((cur.give[id] ?? 0) + 1, held);
  if (n <= 0) return cur;
  return { ...cur, give: { ...cur.give, [id]: n } };
}

/** Bank / harbor rate for one resource. */
export function bankRate(def: GameDefinition, moves: AvailableMoves, id: string): number {
  const r = byId(def.resources, id);
  return moves.bankRates[id] ?? (r ? def.trade.bankRates[r.kind] : undefined) ?? 4;
}

/** Can `give` -> `get` be done with the bank? Returns null if so, else why not. */
export function bankTradeProblem(def: GameDefinition, state: GameState, moves: AvailableMoves, give: Record<string, number>, get: Record<string, number>): string | null {
  const g = cleanMap(give), w = cleanMap(get);
  if (!Object.keys(g).length) return 'Choose cards to give';
  if (!Object.keys(w).length) return 'Choose what you want';
  let lots = 0;
  for (const [id, n] of Object.entries(g)) {
    const rate = bankRate(def, moves, id);
    if (n % rate !== 0) return `The bank takes ${byId(def.resources, id)?.name ?? id} in lots of ${rate} (${rate}:1)`;
    lots += n / rate;
  }
  if (Object.keys(w).some((id) => g[id])) return 'You cannot get a resource you give';
  const want = sumMap(w);
  if (lots !== want) return `Your cards are worth ${lots} card${lots === 1 ? '' : 's'} at the bank; you asked for ${want}`;
  const bankKnown = !state.settings.hideBankCards && Object.keys(state.bank).length > 0;
  if (bankKnown) {
    for (const [id, n] of Object.entries(w)) {
      const supply = state.bank[id];
      if (supply !== undefined && supply >= 0 && supply < n) return `The bank has only ${supply} ${byId(def.resources, id)?.name ?? id}`;
    }
  }
  return null;
}

interface PanelProps {
  def: GameDefinition;
  state: GameState;
  playerId: string;
  moves: AvailableMoves;
  send: (c: Command) => void;
  draft: TradeDraft;
  onChange: (d: TradeDraft) => void;
  onClose: () => void;
  /** Why trading is blocked right now (null = allowed). */
  blocked: string | null;
}

export function TradePanel({ def, state, playerId, moves, send, draft, onChange, onClose, blocked }: PanelProps) {
  const me = state.players.find((p) => p.id === playerId)!;
  const others = state.players.filter((p) => p.id !== playerId);
  const held = (id: string) => (isRedacted(me) ? 0 : me.resources[id] ?? 0);
  // The hand may have changed since cards were picked: never offer more than is held.
  const give = cleanMap(Object.fromEntries(Object.entries(draft.give).map(([id, n]) => [id, Math.min(n, held(id))])));
  const get = cleanMap(draft.get);
  const set = (d: Partial<TradeDraft>) => onChange({ ...draft, give, get, ...d });

  const bankWhy = blocked ?? bankTradeProblem(def, state, moves, give, get);
  const overlap = Object.keys(get).some((id) => give[id]);
  const offerWhy = blocked
    ?? (!def.trade.playerTrading ? 'Player trading is off in this game' : null)
    ?? (!others.length ? 'Nobody to trade with' : null)
    ?? (!sumMap(give) ? 'Choose cards to give (click your hand)' : null)
    ?? (!sumMap(get) ? 'Choose what you want' : null)
    ?? (overlap ? 'You cannot ask for a resource you give' : null)
    ?? (draft.to !== null && draft.to.length === 0 ? 'Choose who to offer to' : null);

  const rates = def.resources.map((r) => ({ r, rate: bankRate(def, moves, r.id), dflt: def.trade.bankRates[r.kind] ?? 4 }));
  const giveRates = Object.keys(give).map((id) => bankRate(def, moves, id));
  const rateText = giveRates.length && giveRates.every((x) => x === giveRates[0]) ? `${giveRates[0]}:1` : '';

  const toggleTo = (pid: string) => {
    const cur = draft.to ?? others.map((p) => p.id);
    const next = cur.includes(pid) ? cur.filter((x) => x !== pid) : [...cur, pid];
    set({ to: next.length === others.length ? null : next });
  };

  return (
    <section className="g-tradepanel" role="dialog" aria-label="Trade">
      <header className="g-tp-head">
        <GameIcon name="trade" size={20} />
        <b>Trade</b>
        {blocked && <span className="g-tp-blocked">{blocked}</span>}
        <button type="button" className="g-x" onClick={onClose} aria-label="Close">×</button>
      </header>

      <div className="g-tp-row">
        <span className="g-tp-label">You give</span>
        <div className="g-tp-cards" data-testid="trade-give">
          {Object.keys(give).length === 0 && <span className="g-tp-hint">Click cards in your hand to offer them</span>}
          {def.resources.filter((r) => give[r.id]).map((r) => (
            <button
              key={r.id}
              type="button"
              className="g-tp-card"
              aria-label={`remove ${r.name}`}
              title={`${give[r.id]} ${r.name} — click to take one back`}
              onClick={() => set({ give: cleanMap({ ...give, [r.id]: give[r.id] - 1 }) })}
            >
              <ResCard def={def} id={r.id} size="md" count={give[r.id]} title="" />
            </button>
          ))}
        </div>
      </div>

      <div className="g-tp-row">
        <span className="g-tp-label">You get</span>
        <div className="g-tp-cards g-tp-want" data-testid="trade-get">
          {def.resources.map((r) => {
            const n = get[r.id] ?? 0;
            return (
              <span key={r.id} className={`g-tp-wantcard${n ? ' g-tp-wantcard--on' : ''}`}>
                <button
                  type="button"
                  className="g-tp-card"
                  aria-label={`want ${r.name}`}
                  data-get-res={r.id}
                  title={`Ask for one more ${r.name}`}
                  onClick={() => set({ get: { ...get, [r.id]: n + 1 } })}
                >
                  <ResCard def={def} id={r.id} size="md" count={n || undefined} title="" />
                </button>
                {n > 0 && (
                  <button type="button" className="g-tp-less" aria-label={`less ${r.name}`} onClick={() => set({ get: cleanMap({ ...get, [r.id]: n - 1 }) })}>
                    −
                  </button>
                )}
              </span>
            );
          })}
        </div>
      </div>

      <div className="g-tp-rates" aria-label="Your bank rates">
        {rates.map(({ r, rate, dflt }) => (
          <span key={r.id} className={`g-tp-rate${rate < dflt ? ' g-tp-rate--good' : ''}`} title={`${r.name}: give ${rate} for 1`}>
            <ResCard def={def} id={r.id} size="xs" title="" />
            {rate}:1
          </span>
        ))}
      </div>

      <footer className="g-tp-foot">
        <button
          type="button"
          className={`g-btn g-tp-bank${bankWhy ? '' : ' g-tp-bank--ready'}`}
          disabled={!!bankWhy}
          title={bankWhy ?? 'Trade with the bank'}
          aria-label="Trade with bank"
          onClick={() => {
            send({ type: 'bankTrade', give, get });
            onClose();
          }}
        >
          <GameIcon name="bank" size={20} />
          Bank{rateText && <span className="g-tp-ratio">{rateText}</span>}
        </button>
        {def.trade.playerTrading && others.length > 0 && (
          <div className="g-tp-to" role="group" aria-label="Offer to">
            {others.map((p) => {
              const on = draft.to === null || draft.to.includes(p.id);
              return (
                <button key={p.id} type="button" className={`g-tp-player${on ? ' g-tp-player--on' : ''}`} aria-pressed={on} title={on ? `Offer to ${p.name}` : `Not offering to ${p.name}`} onClick={() => toggleTo(p.id)}>
                  <Avatar color={p.color} size={22} />
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
        {def.trade.playerTrading && (
          <button
            type="button"
            className="g-btn g-btn--primary"
            disabled={!!offerWhy}
            title={offerWhy ?? 'Send this offer'}
            onClick={() => {
              send({ type: 'offerTrade', to: draft.to, give, get });
              onClose();
            }}
          >
            Send offer
          </button>
        )}
      </footer>
      {(bankWhy && offerWhy && (sumMap(give) > 0 || sumMap(get) > 0)) && !blocked && (
        <div className="g-tp-why g-muted g-small">{bankWhy}</div>
      )}
    </section>
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
    <section className="g-offers" aria-label="Trade offers">
      {visible.map((t) => {
        const from = state.players.find((p) => p.id === t.from);
        const mine = t.from === playerId;
        const myResp = t.responses[playerId] ?? 'pending';
        return (
          <div key={t.id} className={`g-offer${mine ? ' g-offer--mine' : ''}`} style={{ ['--pc' as string]: from?.color ?? '#888' }}>
            <div className="g-offer-head">
              <Avatar color={from?.color ?? '#888'} size={22} />
              <b>{mine ? 'Your offer' : `${from?.name ?? '?'} offers`}</b>
              {t.to && <span className="g-muted g-small">to {t.to.map((id) => state.players.find((p) => p.id === id)?.name ?? id).join(', ')}</span>}
            </div>
            <div className="g-offer-body">
              <span className="g-offer-side">
                <span className="g-small g-muted">{mine ? 'You give' : 'You get'}</span>
                <MiniCards def={def} res={t.give} maxEach={5} size="sm" />
              </span>
              <GameIcon name="trade" size={16} className="g-arrow" />
              <span className="g-offer-side">
                <span className="g-small g-muted">{mine ? 'You get' : 'You give'}</span>
                <MiniCards def={def} res={t.get} maxEach={5} size="sm" />
              </span>
            </div>
            {mine ? (
              <div className="g-offer-resps">
                {Object.entries(t.responses)
                  .filter(([pid]) => pid !== playerId)
                  .map(([pid, r]) => {
                    const p = state.players.find((x) => x.id === pid);
                    return (
                      <span key={pid} className={`g-resp g-resp--${r}`}>
                        <Avatar color={p?.color ?? '#888'} size={18} />
                        {p?.name ?? pid}
                        {r === 'accept' ? (
                          <button type="button" className="g-btn g-btn--sm g-btn--primary" onClick={() => send({ type: 'confirmTrade', tradeId: t.id, withPlayer: pid })}>
                            Trade
                          </button>
                        ) : (
                          <span className="g-small">{r === 'reject' ? ' ✗ declined' : ' …'}</span>
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
