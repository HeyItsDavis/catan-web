/** "Start from template" recipes: ready-made, valid starting points for common content. */
import type {
  ActionDef, AwardDef, CardDef, CollectionKey, DeckDef, GameDefinition, ModDef, PieceDef, ResourceDef,
  SettingDef, TerrainDef, TokenDef, TriggerDef,
} from '../engine/schema';
import { uniqueId } from './paths';

export interface TemplateCtx { def: GameDefinition; mod: ModDef }
export interface TemplateResult {
  additions: Partial<Record<CollectionKey, { id: string }[]>>;
  /** Item to open after inserting. */
  focus: { collection: CollectionKey; id: string };
}
export interface Template {
  id: string;
  label: string;
  description: string;
  collection: CollectionKey;
  make(ctx: TemplateCtx): TemplateResult;
}

function taken(ctx: TemplateCtx, k: CollectionKey): string[] {
  return [
    ...((ctx.def[k] ?? []) as { id: string }[]).map(x => x.id),
    ...((ctx.mod[k] ?? []) as { id: string }[]).map(x => x.id),
  ];
}

const firstResource = (ctx: TemplateCtx) => ctx.def.resources.find(r => r.kind === 'resource')?.id ?? ctx.def.resources[0]?.id;

function sampleCost(ctx: TemplateCtx, n = 2): Record<string, number> {
  const rs = ctx.def.resources.filter(r => r.kind === 'resource').slice(0, n);
  return Object.fromEntries(rs.map(r => [r.id, 1]));
}

export const TEMPLATES: Template[] = [
  {
    id: 'building', label: 'Building with recipe', collection: 'pieces',
    description: 'A corner building with a cost, 1 VP and production — like a settlement.',
    make(ctx) {
      const id = uniqueId('my-building', taken(ctx, 'pieces'));
      const piece: PieceDef = {
        id, name: 'My building', supply: 5, vp: 1, productionMultiplier: 1, tags: ['building'],
        cost: sampleCost(ctx, 3),
        placement: {
          on: 'vertex',
          where: { all: [{ distanceRule: { at: 'at' } }, { connectedTo: { at: 'at', owner: 'self' } }] },
        },
      };
      return { additions: { pieces: [piece] }, focus: { collection: 'pieces', id } };
    },
  },
  {
    id: 'route', label: 'Road-like piece', collection: 'pieces',
    description: 'An edge piece that extends your network (counts for longest road).',
    make(ctx) {
      const id = uniqueId('my-route', taken(ctx, 'pieces'));
      const piece: PieceDef = {
        id, name: 'My route', supply: 15, network: 'roads', cost: sampleCost(ctx, 2),
        placement: { on: 'edge', where: { all: [{ not: { occupied: { at: 'at' } } }, { connectedTo: { at: 'at', owner: 'self' } }] } },
      };
      return { additions: { pieces: [piece] }, focus: { collection: 'pieces', id } };
    },
  },
  {
    id: 'upgrade', label: 'Upgrade building', collection: 'pieces',
    description: 'Replaces an existing building of yours (like settlement → city).',
    make(ctx) {
      const id = uniqueId('my-upgrade', taken(ctx, 'pieces'));
      const from = ctx.def.pieces.find(p => p.placement?.on === 'vertex')?.id;
      const piece: PieceDef = {
        id, name: 'My upgrade', supply: 4, vp: 2, productionMultiplier: 2, cost: sampleCost(ctx, 2),
        upgradesFrom: from ? [from] : [],
        placement: { on: 'vertex', where: { occupied: { at: 'at', owner: 'self', ...(from ? { piece: from } : {}) } } },
      };
      return { additions: { pieces: [piece] }, focus: { collection: 'pieces', id } };
    },
  },
  {
    id: 'devcard', label: 'Development card', collection: 'cards',
    description: 'A playable card with an effect. Remember to add it to a deck.',
    make(ctx) {
      const id = uniqueId('my-card', taken(ctx, 'cards'));
      const r = firstResource(ctx);
      const card: CardDef = {
        id, name: 'My card', description: 'Describe what the card does.',
        play: { timing: 'ownTurn', limitGroup: 'development' },
        effect: [{ op: 'gain', resources: r ? { [r]: 2 } : {} }],
        afterPlay: 'discard',
      };
      return { additions: { cards: [card] }, focus: { collection: 'cards', id } };
    },
  },
  {
    id: 'vpcard', label: 'Victory point card', collection: 'cards',
    description: 'A hidden card worth victory points while held.',
    make(ctx) {
      const id = uniqueId('my-vp-card', taken(ctx, 'cards'));
      const card: CardDef = { id, name: 'Monument', description: '1 victory point.', play: { timing: 'never' }, effect: [], vp: 1 };
      return { additions: { cards: [card] }, focus: { collection: 'cards', id } };
    },
  },
  {
    id: 'resource-terrain', label: 'Resource + terrain', collection: 'resources',
    description: 'A new resource and a numbered terrain that produces it.',
    make(ctx) {
      const rid = uniqueId('my-resource', taken(ctx, 'resources'));
      const tid = uniqueId('my-terrain', taken(ctx, 'terrains'));
      const res: ResourceDef = { id: rid, name: 'My resource', color: '#c8a2c8', kind: 'resource', bankSupply: 19 };
      const ter: TerrainDef = { id: tid, name: 'My terrain', color: '#9b7bb5', produces: { [rid]: 1 }, numbered: true };
      return { additions: { resources: [res], terrains: [ter] }, focus: { collection: 'resources', id: rid } };
    },
  },
  {
    id: 'deck', label: 'Deck', collection: 'decks',
    description: 'A buyable deck of cards.',
    make(ctx) {
      const id = uniqueId('my-deck', taken(ctx, 'decks'));
      const deck: DeckDef = { id, name: 'My deck', cards: [], cost: sampleCost(ctx, 3), reshuffleDiscards: false };
      return { additions: { decks: [deck] }, focus: { collection: 'decks', id } };
    },
  },
  {
    id: 'recipe', label: 'Recipe action', collection: 'actions',
    description: 'A button that turns some resources into something else on your turn.',
    make(ctx) {
      const id = uniqueId('my-recipe', taken(ctx, 'actions'));
      const action: ActionDef = {
        id, name: 'My recipe', description: 'Trade resources for victory points.', group: 'special',
        cost: sampleCost(ctx, 2),
        available: { all: [{ isTurnOf: 'self' }, { hasRolled: true }] },
        effect: [{ op: 'addVP', amount: 1, reason: 'My recipe' }],
        limitPerTurn: 1,
      };
      return { additions: { actions: [action] }, focus: { collection: 'actions', id } };
    },
  },
  {
    id: 'trigger-roll', label: 'When a number is rolled', collection: 'triggers',
    description: 'Do something whenever a particular dice total comes up.',
    make(ctx) {
      const id = uniqueId('on-roll', taken(ctx, 'triggers'));
      const r = firstResource(ctx);
      const t: TriggerDef = {
        id, on: 'diceRolled', when: { cmp: [{ var: 'total' }, '==', 2] },
        do: [{ op: 'forEachPlayer', as: 'p', do: [{ op: 'gain', player: { var: 'p' }, resources: r ? { [r]: 1 } : {} }] }],
      };
      return { additions: { triggers: [t] }, focus: { collection: 'triggers', id } };
    },
  },
  {
    id: 'trigger-turn', label: 'At the start of each turn', collection: 'triggers',
    description: 'Run steps at the start of every player’s turn.',
    make(ctx) {
      const id = uniqueId('on-turn-start', taken(ctx, 'triggers'));
      const t: TriggerDef = { id, on: 'turnStart', do: [{ op: 'log', text: 'A new turn begins' }] };
      return { additions: { triggers: [t] }, focus: { collection: 'triggers', id } };
    },
  },
  {
    id: 'token', label: 'Robber-like token', collection: 'tokens',
    description: 'A token on a hex that blocks production and steals when moved.',
    make(ctx) {
      const id = uniqueId('my-token', taken(ctx, 'tokens'));
      const tok: TokenDef = {
        id, name: 'My token', on: 'hex', where: { not: { isWater: { at: 'at' } } }, blocksProduction: true, start: 'none',
        onMove: [
          { op: 'choosePlayer', as: 'victim', optional: true, filter: true, label: 'Steal from whom?' },
          { op: 'if', cond: { varSet: 'victim' }, then: [{ op: 'steal', from: { var: 'victim' } }] },
        ],
      };
      return { additions: { tokens: [tok] }, focus: { collection: 'tokens', id } };
    },
  },
  {
    id: 'award', label: 'Award', collection: 'awards',
    description: 'Bonus VP for whoever leads a stat (like Largest Army).',
    make(ctx) {
      const id = uniqueId('my-award', taken(ctx, 'awards'));
      const a: AwardDef = { id, name: 'My award', vp: 2, metric: { stat: { key: 'myStat' } }, min: 3, holderKeepsOnTie: true };
      return { additions: { awards: [a] }, focus: { collection: 'awards', id } };
    },
  },
  {
    id: 'setting-number', label: 'Number setting', collection: 'settings',
    description: 'A number the host picks in the lobby; read it with the “Lobby setting” formula.',
    make(ctx) {
      const id = uniqueId('my-number', taken(ctx, 'settings'));
      const s: SettingDef = { id, name: 'My number', type: 'number', default: 1, min: 0, max: 10 };
      return { additions: { settings: [s] }, focus: { collection: 'settings', id } };
    },
  },
  {
    id: 'setting-toggle', label: 'On/off setting', collection: 'settings',
    description: 'A switch the host flips in the lobby; test it with “Lobby setting is on”.',
    make(ctx) {
      const id = uniqueId('my-toggle', taken(ctx, 'settings'));
      const s: SettingDef = { id, name: 'My toggle', type: 'boolean', default: false };
      return { additions: { settings: [s] }, focus: { collection: 'settings', id } };
    },
  },
];

/** Apply a template's additions to a mod (immutably). */
export function applyTemplate(mod: ModDef, result: TemplateResult): ModDef {
  const next = { ...mod } as Record<string, unknown>;
  for (const [k, items] of Object.entries(result.additions)) {
    next[k] = [...(((mod as unknown as Record<string, unknown>)[k] as unknown[]) ?? []), ...(items ?? [])];
  }
  return next as unknown as ModDef;
}
