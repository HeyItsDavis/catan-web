/** Hand as cards, click-to-trade drafting, the trade panel's bank button, log lines and flights. */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GameState, LogEntry } from '../../engine/schema';
import { fakeAvailableMoves, fakeRedact, makeFixtureDef, makeFixtureState, ME } from './dev/fixture';
import { EngineProvider, estimateVP, type EngineAdapter } from './engineContext';
import { flightsFor, newLogEntries } from './flights';
import { GameScreen } from './GameScreen';
import { Hand } from './Hand';
import { LogLine } from './Info';
import { bankTradeProblem, emptyDraft, offerCard, TradePanel } from './Trade';

const def = makeFixtureDef();
const adapter: EngineAdapter = { getAvailableMoves: fakeAvailableMoves, computeVP: (d, s, pid) => estimateVP(d, s, pid) };
const clean = (html: string) => html.replace(/<!-- -->/g, '');

/** Fixture in the main phase of the viewer's turn, no prompts. */
function mainPhase(): GameState {
  return { ...makeFixtureState(), prompts: [], phase: 'main', hasRolled: true };
}

describe('hand', () => {
  const s = mainPhase();
  const me = s.players.find((p) => p.id === ME)!;
  const moves = fakeAvailableMoves(def, s, ME);

  it('renders one card stack per held resource with a count badge, in the resource colour', () => {
    const html = clean(renderToString(<Hand def={def} me={me} moves={moves} discardLimit={7} onResource={() => {}} onPlayCard={() => {}} />));
    for (const [id, n] of Object.entries(me.resources)) {
      if (n > 0) expect(html).toMatch(new RegExp(`data-hand-res="${id}"[^>]*aria-label="[^"]+ ×${n}"`));
      else expect(html).not.toContain(`data-hand-res="${id}"`);
    }
    expect(html).toContain('--rc:#3f8f3a'); // wood colour from the definition
    expect(html).toContain('class="g-count">3<');
    expect(html).toContain('g-hand-res--click');
  });

  it('shows deck cards face up with playable ones highlighted', () => {
    const html = clean(renderToString(<Hand def={def} me={me} moves={moves} discardLimit={7} onResource={() => {}} onPlayCard={() => {}} />));
    expect(html).toContain('data-deck="science"');
    expect(html).toMatch(/g-card--playable[^>]*data-card="yearOfPlenty"|data-card="yearOfPlenty"[^>]*g-card--playable/);
    expect(html).toContain('Year of Plenty');
  });

  it('cards offered in a trade leave the hand; not clickable while trading is blocked', () => {
    const html = clean(renderToString(<Hand def={def} me={me} moves={moves} discardLimit={7} offered={{ wood: 2 }} onResource={null} resourceHint="Not your turn" onPlayCard={() => {}} />));
    expect(html).toMatch(/data-hand-res="wood"[^>]*aria-label="Lumber ×1"/);
    expect(html).not.toContain('g-hand-res--click');
    expect(html).toContain('Not your turn');
  });
});

describe('click-to-trade', () => {
  it('each click on a hand card adds one to the give side, capped at what is held', () => {
    let d = offerCard(null, 'wood', 3);
    expect(d).toEqual({ give: { wood: 1 }, get: {}, to: null });
    d = offerCard(d, 'wood', 3);
    d = offerCard(d, 'ore', 3);
    d = offerCard(d, 'wood', 3);
    d = offerCard(d, 'wood', 3);
    expect(d.give).toEqual({ wood: 3, ore: 1 });
    expect(offerCard(null, 'coin', 0).give).toEqual({});
  });

  it('the bank button lights up only when the selection matches the rates', () => {
    const s = mainPhase();
    s.players = s.players.map((p) => (p.id === ME ? { ...p, resources: { ...p.resources, ore: 8 } } : p));
    const moves = fakeAvailableMoves(def, s, ME);
    const rate = moves.bankRates.ore;
    expect(bankTradeProblem(def, s, moves, { ore: rate }, { wood: 1 })).toBeNull();
    expect(bankTradeProblem(def, s, moves, { ore: rate - 1 }, { wood: 1 })).toMatch(/lots of/);
    expect(bankTradeProblem(def, s, moves, { ore: rate }, { wood: 2 })).toMatch(/worth 1 card/);
    expect(bankTradeProblem(def, s, moves, { ore: rate }, { ore: 1 })).toMatch(/cannot get/);
    expect(bankTradeProblem(def, s, moves, {}, { ore: 1 })).toMatch(/give/);

    const panel = (give: Record<string, number>, get: Record<string, number>) => clean(renderToString(
      <TradePanel def={def} state={s} playerId={ME} moves={moves} send={() => {}} draft={{ give, get, to: null }} onChange={() => {}} onClose={() => {}} blocked={null} />,
    ));
    const bankBtn = (html: string) => /<button[^>]*aria-label="Trade with bank"[^>]*>/.exec(html)![0];
    expect(bankBtn(panel({ ore: rate }, { wood: 1 }))).not.toContain('disabled');
    expect(bankBtn(panel({ ore: rate }, { wood: 1 }))).toContain('g-tp-bank--ready');
    expect(bankBtn(panel({ ore: 1 }, { wood: 1 }))).toContain('disabled');
    // The offer side: given cards show with counts and can be clicked to remove.
    const html = panel({ ore: 2 }, { wood: 1 });
    expect(html).toContain('aria-label="remove Ore"');
    expect(html).toContain('aria-label="less Lumber"');
    expect(html).toMatch(/<button[^>]*class="g-btn g-btn--primary"[^>]*>Send offer/);
  });

  it('the game screen opens the trade panel with the draft and marks hand cards clickable', () => {
    const html = clean(renderToString(
      <EngineProvider value={adapter}>
        <GameScreen def={def} state={fakeRedact(mainPhase(), ME)} playerId={ME} send={() => {}} chat={[]} sendChat={() => {}} />
      </EngineProvider>,
    ));
    expect(html).toContain('data-testid="hand"');
    expect(html).toContain('g-hand-res--click');
    expect(html).toContain('aria-label="Trade"');
    expect(emptyDraft()).toEqual({ give: {}, get: {}, to: null });
  });
});

describe('log lines with resource flows', () => {
  const s = mainPhase();
  const line = (e: LogEntry) => clean(renderToString(<LogLine def={def} state={s} e={e} />));

  it('production: "Name got" with mini cards', () => {
    const html = line({ turn: 1, player: ME, text: 'You receives 2 Lumber', kind: 'production', flows: [{ from: 'bank', to: ME, res: { wood: 2 }, at: 'h:0,0' }] });
    expect(html).toContain('got');
    expect((html.match(/data-res="wood"/g) ?? []).length).toBe(2);
  });

  it('steal seen by a third player: card backs', () => {
    const html = line({ turn: 1, player: 'p2', text: 'Alice stole 1 card(s) from Bob', kind: 'steal', flows: [{ from: 'p3', to: 'p2', res: { '?': 1 }, hidden: true }] });
    expect(html).toContain('stole');
    expect(html).toContain('g-rcard--back');
    expect(html).toContain('Bob');
  });

  it('roll shows dice, build shows the piece, unknown kinds fall back to text', () => {
    expect(line({ turn: 1, player: ME, text: 'You rolls 8', kind: 'roll', dice: [3, 5] })).toContain('die 5');
    expect(line({ turn: 1, player: ME, text: 'You places a Road', kind: 'build', piece: 'road', at: 'e:0,0,NE' })).toMatch(/built a.*Road/);
    expect(line({ turn: 1, player: ME, text: 'You plays Year of Plenty', kind: 'playCard', card: 'yearOfPlenty' })).toContain('plays Year of Plenty');
  });
});

describe('flights', () => {
  const s0 = mainPhase();
  const add = (s: GameState, ...e: LogEntry[]): GameState => ({ ...s, version: s.version + 1, log: [...s.log, ...e] });
  const prod: LogEntry = { turn: 1, player: ME, text: 'x', kind: 'production', flows: [{ from: 'bank', to: ME, res: { wood: 2, ore: 1 }, at: 'h:0,0' }] };

  it('finds the new entries, also when the log was trimmed at the front', () => {
    const s1 = add(s0, prod);
    expect(newLogEntries(s0, s1)).toEqual([prod]);
    expect(newLogEntries(null, s1)).toEqual([]);
    const a: LogEntry = { turn: 2, text: 'a' }, b: LogEntry = { turn: 2, text: 'b' };
    const trimmed = { ...s1, version: s1.version + 1, log: [...s1.log.slice(2), a, b] };
    expect(newLogEntries(s1, trimmed)).toEqual([a, b]);
  });

  it('one flight per card from the hex (production) or the bank, capped', () => {
    const f = flightsFor([prod]);
    expect(f).toHaveLength(3);
    expect(f[0]).toMatchObject({ res: 'wood', from: { kind: 'hex', id: 'h:0,0' }, to: { kind: 'player', id: ME, res: 'wood' } });
    const big: LogEntry = { turn: 1, text: 'x', flows: Array.from({ length: 4 }, (_, i) => ({ from: 'bank', to: `p${i}`, res: { wood: 9, ore: 9 } })) };
    expect(flightsFor([big]).length).toBeLessThanOrEqual(36);
    const spend: LogEntry = { turn: 1, text: 'x', kind: 'build', flows: [{ from: ME, to: 'bank', res: { wood: 1 } }] };
    expect(flightsFor([spend])[0]).toMatchObject({ from: { kind: 'player', id: ME }, to: { kind: 'bank', res: 'wood' } });
  });
});
