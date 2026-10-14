/** Render tests for the expansion-facing game UI: piece state & cargo, piece actions, multi-select
 *  and movement prompts, commodities / decks / globals / awards, Seafarers visuals. */
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildDefinition } from '../../engine';
import { mergeDisplay } from '../../engine/merge';
import type { GameDefinition, GameState, ModDef } from '../../engine/schema';
import { baseMod } from '../../content/base';
import { fakeAvailableMoves, fakeRedact, makeFixtureDef, makeFixtureState, ME, sampleMovePrompt, sampleMultiPrompt } from './dev/fixture';
import { cargoChips, faceInfo, globalRows, isShipLike, pieceBadges, pieceInactive, pieceSummary, pluralKind, visibleStats } from './display';
import { EngineProvider, estimateVP, type EngineAdapter } from './engineContext';
import { GameScreen } from './GameScreen';
import { PieceMenu } from './PieceMenu';

const adapter: EngineAdapter = {
  getAvailableMoves: fakeAvailableMoves,
  computeVP: (def, state, pid) => estimateVP(def, state, pid),
};

function render(state: GameState, def: GameDefinition = makeFixtureDef(), viewer = ME) {
  return renderToString(
    <EngineProvider value={adapter}>
      <GameScreen def={def} state={fakeRedact(state, viewer, def)} playerId={viewer} send={() => {}} chat={[]} sendChat={() => {}} />
    </EngineProvider>,
  ).replace(/<!-- -->/g, '');
}

const idle = (): GameState => ({ ...makeFixtureState(), prompts: [] });

describe('board: piece state, cargo, seafarers visuals', () => {
  const html = render(idle());

  it('draws knight strength pips and dims inactive (toggle) pieces', () => {
    expect(html).toContain('g-pip-on');
    expect(html).toContain('g-pip-off');
    expect(html).toContain('g-piece--inactive');
  });

  it('draws cargo chips and a tag-based ship with its wake', () => {
    expect(html).toContain('g-cargo');
    expect(html).toContain('g-wake');
    expect(html).toMatch(/Ship — You · carrying 2 Lumber, 1 Settler/);
  });

  it('marks gold fields and fog hexes', () => {
    expect(html).toContain('g-goldbadge');
    expect(html).toContain('g-hex--gold');
    expect(html).toContain('g-hex--fog');
    expect(html).toContain('of your choice');
  });

  it('pieces are tappable (menu) with hit targets', () => {
    expect(html).toContain('g-piece--tap');
    expect(html).toContain('g-hit');
  });
});

describe('panels: hand, decks, globals, awards, dice', () => {
  const html = render(idle());

  it('groups resources by kind', () => {
    expect(html).toContain('Commodities');
    expect(html).toContain('data-kind="commodity"');
  });

  it('groups cards by deck with hand-limit warnings and the discard warning', () => {
    expect(html).toContain('data-deck="science"');
    expect(html).toContain('Hand limit reached (4)');
    expect(html).toMatch(/more than 7/);
  });

  it("shows other players' public-deck cards face up", () => {
    expect(html).toContain('Defender');
  });

  it('renders globals with hints, hides hidden ones, shows unlisted ones', () => {
    expect(html).toContain('Barbarian ship');
    expect(html).toContain('g-track');
    expect(html).toContain('Merchant fleet turns');
    expect(html).not.toContain('Internal counter');
  });

  it('lists awards incl. keepUntilBeaten and labelled stats', () => {
    expect(html).toContain('kept until beaten');
    expect(html).toContain('Science Metropolis');
    expect(html).toContain('Knights played: 1');
  });

  it('labels and colours event-die faces', () => {
    expect(html).toContain('data-face="green"');
    expect(html).toContain('g-eventdie-label');
  });

  it('groups piece actions into one action-bar button per action', () => {
    expect(html).toContain('Promote');
    expect(html).toContain('2/2');
    expect((html.match(/>Promote</g) ?? []).length).toBe(1);
  });
});

describe('prompts', () => {
  it('movement prompts highlight destinations distinctly and ring the moving piece', () => {
    const s = idle();
    s.prompts = [sampleMovePrompt(s)];
    const html = render(s);
    expect(html).toContain('g-hl--move');
    expect(html).toContain('g-moving-ring');
    expect(html).toContain('reachable spot');
    expect(html).toContain('g-ghost');
  });

  it('multi-select location prompt shows progress, chosen marks and Done', () => {
    const s = idle();
    s.prompts = [sampleMultiPrompt(s, makeFixtureDef(), 'location')];
    const html = render(s);
    expect(html).toContain('Pick 1–4');
    expect(html).toContain('g-chosen');
    expect(html).toContain('Done (2)');
    expect(html).not.toContain('(3/4)');
  });

  it('multi-select player prompt lists already chosen players', () => {
    const s = idle();
    s.prompts = [sampleMultiPrompt(s, makeFixtureDef(), 'player')];
    const html = render(s);
    expect(html).toContain('Chosen:');
    expect(html).toContain('Pick 1–3');
  });
});

describe('piece menu', () => {
  it("lists the piece's state, cargo and its actions for the owner", () => {
    const def = makeFixtureDef();
    const s = idle();
    const knight = s.pieces.find((p) => p.owner === ME && p.type === 'knight' && !p.state.active)!;
    const moves = fakeAvailableMoves(def, s, ME);
    const html = renderToString(
      <PieceMenu def={def} state={s} playerId={ME} pieceId={knight.id} at={{ x: 10, y: 10, w: 400, h: 400 }} moves={moves} blocked={null} send={() => {}} onClose={() => {}} />,
    );
    expect(html).toContain('Strength');
    expect(html).toContain('Activate');
    expect(html).toContain('Move knight');
    const ship = s.pieces.find((p) => p.owner === ME && p.type === 'ship')!;
    const h2 = renderToString(
      <PieceMenu def={def} state={s} playerId="p2" pieceId={ship.id} at={{ x: 10, y: 10 }} moves={moves} blocked={null} send={() => {}} onClose={() => {}} />,
    );
    expect(h2).toContain('Carrying');
    expect(h2).not.toContain('Move ship'); // not the viewer's piece
  });
});

describe('display helpers', () => {
  const def = makeFixtureDef();
  it('badges: hinted styles, default numbers without hints', () => {
    const knight = def.pieces.find((p) => p.id === 'knight')!;
    const inst = { id: 'x', type: 'knight', owner: ME, at: 'v:0,0,N', state: { strength: 2, active: 0 } };
    expect(pieceBadges(knight, inst).map((b) => b.style)).toEqual(['pips', 'toggle']);
    expect(pieceInactive(knight, inst)).toBe(true);
    const plain = { ...knight, display: undefined };
    expect(pieceBadges(plain, inst)).toEqual([{ key: 'strength', label: 'Strength', value: 2, style: 'number', max: 3 }]);
    expect(pieceInactive(plain, inst)).toBe(false);
  });
  it('cargo, ships, summaries, kinds, stats, faces, globals', () => {
    const s = idle();
    const ship = s.pieces.find((p) => p.type === 'ship' && p.owner === ME)!;
    expect(cargoChips(def, def.pieces.find((p) => p.id === 'ship'), ship).map((c) => c.key)).toEqual(['wood', 'settler']);
    expect(cargoChips(def, { ...def.pieces.find((p) => p.id === 'ship')!, display: { showCargo: false } }, ship)).toEqual([]);
    expect(isShipLike(def.pieces.find((p) => p.id === 'ship'))).toBe(true);
    expect(isShipLike(def.pieces.find((p) => p.id === 'road'))).toBe(false);
    expect(pieceSummary(def, s, ship)).toContain('carrying');
    expect(pluralKind('commodity')).toBe('Commodities');
    expect(pluralKind('resource')).toBe('Resources');
    expect(visibleStats(def, { knightsPlayed: 2, internalCounter: 3, zero: 0 })).toEqual([{ key: 'knightsPlayed', label: 'Knights played', icon: 'knight', value: 2 }]);
    expect(faceInfo(def, 'ship')).toMatchObject({ label: 'Barbarians', icon: 'ship' });
    expect(faceInfo({ ...def, display: undefined }, 'blue').color).toBeTruthy();
    expect(globalRows(def, s).map((r) => r.key)).toEqual(['barbarians', 'merchantFleetTurns']);
  });
});

describe('display hints merge (engine)', () => {
  it('merges by key across mods and survives buildDefinition', () => {
    expect(mergeDisplay({ globals: [{ key: 'a', label: 'A' }] }, { globals: [{ key: 'a', label: 'A2' }, { key: 'b' }], eventFaces: [{ face: 'x' }] }))
      .toEqual({ globals: [{ key: 'a', label: 'A2' }, { key: 'b' }], eventFaces: [{ face: 'x' }] });
    const mod: ModDef = { meta: { id: 'd', name: 'd', version: '1', extends: ['base'] }, display: { stats: [{ key: 'k', label: 'Kay' }] } };
    const def = buildDefinition([baseMod, mod]);
    expect(def.display?.stats).toEqual([{ key: 'k', label: 'Kay' }]);
  });
});
