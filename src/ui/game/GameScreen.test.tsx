import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Prompt } from '../../engine/schema';
import { fakeAvailableMoves, fakeRedact, makeFixtureDef, makeFixtureState, ME, samplePrompt } from './dev/fixture';
import { EngineProvider, estimateVP, type EngineAdapter } from './engineContext';
import { GameScreen } from './GameScreen';

const adapter: EngineAdapter = {
  getAvailableMoves: fakeAvailableMoves,
  computeVP: (def, state, pid) => estimateVP(def, state, pid),
};

function render(state = makeFixtureState(), viewer = ME, engine: EngineAdapter | null = adapter) {
  const def = makeFixtureDef();
  const el = <GameScreen def={def} state={fakeRedact(state, viewer)} playerId={viewer} send={() => {}} chat={[]} sendChat={() => {}} />;
  return renderToString(engine ? <EngineProvider value={engine}>{el}</EngineProvider> : el);
}

describe('GameScreen (fixture)', () => {
  it('renders the board with highlighted location options', () => {
    const html = render();
    expect(html).toContain('g-board-svg');
    expect(html).toContain('g-hl-vertex');
    expect(html).toContain('Place a settlement');
  });

  it('renders with the real (stubbed) engine without crashing', () => {
    expect(render(makeFixtureState(), ME, null)).toContain('g-board-svg');
  });

  it('renders as another player (redacted view)', () => {
    expect(render(makeFixtureState(), 'p2')).toContain('Waiting for');
  });

  it.each(['discard', 'resource', 'player', 'card', 'piece', 'option'] as Prompt['kind'][])('renders %s prompt', (kind) => {
    const def = makeFixtureDef();
    const s = makeFixtureState();
    s.prompts = [samplePrompt(kind, s, def)];
    expect(render(s)).toContain(s.prompts[0].label.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'));
  });

  it('colonist layout: hand as cards, square action buttons, bank row, player panels, credits', () => {
    const html = render({ ...makeFixtureState(), prompts: [] }).replace(/<!-- -->/g, '');
    expect(html).toContain('data-testid="hand"');
    expect(html).toContain('data-anchor="bank"');
    expect(html).toContain('data-bank-res="wood"');
    expect(html).toMatch(/class="g-abtn[^"]*"[^>]*aria-label="Road"/);
    expect(html).toMatch(/aria-label="End turn"/);
    expect(html).toContain('data-player-panel="p2"');
    expect(html).toContain('title="Resource cards"');
    expect(html).toContain('title="Cards in hand"');
    expect(html).toContain('game-icons.net (CC BY 3.0)');
    // The opponent's hidden resource count is shown as a card back with a number.
    expect(html).toMatch(/data-player-panel="p2"[\s\S]*?title="Resource cards"><span class="g-rcard g-rcard--back/);
  });

  it('renders game over', () => {
    const s = makeFixtureState();
    s.winner = 'p2';
    s.phase = 'gameOver';
    expect(render(s)).toContain('Alice wins!');
  });
});
