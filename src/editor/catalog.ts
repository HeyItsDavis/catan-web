/**
 * Block catalog: machine-readable metadata for every Effect op, Condition
 * variant and Expr variant in `engine/schema.ts`.
 *
 * The visual block editor, the plain-language describer, the structural
 * validator and (eventually) the generated docs are all driven by this file.
 * The records below are typed exhaustively (`Record<EffectOp, ...>` etc.), so
 * adding a new op to the schema without cataloguing it is a type error.
 */
import type {
  BuiltinEvent, Condition, Effect, EffectOp, Expr, LocationKind, TurnPhase,
} from '../engine/schema';
import { EVENT_PAYLOAD_VARS } from '../engine/schema';

/* ------------------------------------------------------------------------ */
/*  Types                                                                    */
/* ------------------------------------------------------------------------ */

export type Category =
  | 'Control flow' | 'Choices' | 'Resources' | 'Board' | 'Cards' | 'Scoring' | 'Turn'
  // conditions / exprs only
  | 'Logic' | 'Math';

export const EFFECT_CATEGORIES: Category[] = ['Control flow', 'Choices', 'Resources', 'Board', 'Cards', 'Scoring', 'Turn'];
export const CONDITION_CATEGORIES: Category[] = ['Logic', 'Turn', 'Resources', 'Board', 'Scoring'];
export const EXPR_CATEGORIES: Category[] = ['Math', 'Resources', 'Board', 'Cards', 'Scoring', 'Turn'];

/** What kind of value a variable holds. Used to filter var pickers. */
export type VarType = 'player' | 'resource' | 'location' | 'piece' | 'number' | 'any';

export type ParamKind =
  | 'expr'            // Expr (number or formula)
  | 'condition'       // Condition
  | 'effects'         // Effect[]
  | 'exprList'        // Expr[]
  | 'conditionList'   // Condition[]
  | 'exprMap'         // Record<string, Expr> (emit payload)
  | 'options'         // chooseOption options [{label, cond?, do}]
  | 'playerRef'       // PlayerRef
  | 'playerFilter'    // PlayerRef | 'any' | 'others'
  | 'resourceRef'     // Id | {var}  (+ `extra` literals such as 'random' / 'any')
  | 'resourceMap'     // Record<resourceId, Expr>
  | 'resourceIds'     // Id[] of resources
  | 'resourceKind'    // ResourceKind
  | 'pieceId' | 'pieceIds'  // Id, or Id | Id[] (see `multiple`)
  | 'cardId' | 'deckId' | 'tokenId' | 'settingId'
  | 'terrainId' | 'terrainIds'
  | 'locationKind'    // 'hex' | 'vertex' | 'edge'
  | 'locationChoice'  // LocationChoice
  | 'locationVar'     // string naming a bound location / piece var
  | 'pieceQuery'      // PieceQuery
  | 'varName'         // string: introduces a new var (see `binds`)
  | 'varRef'          // string: names an existing var
  | 'key'             // free string from a key space (stat, global, flag, pieceState)
  | 'event'           // trigger event name
  | 'phases'          // TurnPhase | TurnPhase[]
  | 'compareOp'
  | 'dice'            // 'total' | die index
  | 'numbers'         // number[]
  | 'string' | 'number' | 'boolean' | 'enum';

export interface ParamSpec {
  /** Field name on the node (for tuple shapes: a label for the slot). */
  name: string;
  label: string;
  kind: ParamKind;
  optional?: boolean;
  default?: unknown;
  /** enum choices */
  options?: readonly string[];
  /** Extra literal choices for reference pickers (e.g. 'random', 'choice', 'any'). */
  extra?: readonly string[];
  /** For pieceIds / terrainIds: accepts a single id OR a list ('either'), or always a list ('list'). */
  multiple?: 'either' | 'list';
  /** varName: what the new var holds. */
  binds?: VarType;
  /** varName: the var is only visible to this block's own children (loop variable). */
  loopVar?: boolean;
  /** varRef / locationVar: what the referenced var should hold. */
  varType?: VarType;
  /** key: which namespace the key lives in (used for suggestions). */
  keySpace?: 'stat' | 'global' | 'flag' | 'pieceState' | 'cargo';
  /** expr: null is allowed (e.g. setHexNumber clears the number). */
  nullable?: boolean;
  help?: string;
}

/**
 * How params map onto the JSON node.
 *  flat    – params are top-level fields (all Effects; the `flag` condition)
 *  object  – `{ key: { ...params } }`
 *  value   – `{ key: <single param> }`
 *  tuple   – `{ key: [p0, p1, ...] }`
 *  list    – `{ key: <single list param> }` (variadic)
 *  literal – no params (true, false, {playerCount: true}, plain number)
 */
export type BlockShape = 'flat' | 'object' | 'value' | 'tuple' | 'list' | 'literal';

export interface BlockSpec<T> {
  key: string;
  label: string;
  category: Category;
  description: string;
  shape: BlockShape;
  params: ParamSpec[];
  make: () => T;
}

/* ------------------------------------------------------------------------ */
/*  Small param helpers                                                      */
/* ------------------------------------------------------------------------ */

const P = {
  player: (label = 'Player', help = 'Defaults to the player running this.'): ParamSpec =>
    ({ name: 'player', label, kind: 'playerRef', optional: true, help }),
  label: (): ParamSpec => ({ name: 'label', label: 'Prompt text', kind: 'string', optional: true, help: 'What the player is asked.' }),
  optional: (): ParamSpec => ({ name: 'optional', label: 'Can skip', kind: 'boolean', optional: true }),
  as: (binds: VarType, def: string, optional = false, loopVar = false): ParamSpec =>
    ({ name: 'as', label: loopVar ? 'Call each one' : 'Remember as', kind: 'varName', binds, default: def, optional, loopVar }),
  amount: (name = 'amount', def: Expr = 1, optional = false): ParamSpec =>
    ({ name, label: name === 'amount' ? 'Amount' : cap(name), kind: 'expr', default: def, optional }),
  kind: (): ParamSpec => ({ name: 'kind', label: 'Resource kind', kind: 'resourceKind', optional: true }),
  at: (label = 'Location'): ParamSpec => ({ name: 'at', label, kind: 'locationVar', varType: 'location', default: 'at' }),
  asId: (def: string, loopVar = false): ParamSpec => ({
    name: 'asId', label: 'Remember the piece as', kind: 'varName', binds: 'piece', optional: true, default: def, loopVar,
    help: 'Optional: remembers this exact piece (not just its spot), e.g. to load cargo onto it or move it later.',
  }),
  piece: (): ParamSpec => ({ name: 'piece', label: 'Piece', kind: 'locationVar', varType: 'piece', default: 'pieceId', help: 'A remembered piece (or a spot: the first piece there).' }),
};

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ------------------------------------------------------------------------ */
/*  Effects                                                                  */
/* ------------------------------------------------------------------------ */

type EffectOf<K extends EffectOp> = Extract<Effect, { op: K }>;
export type EffectCatalog = { [K in EffectOp]: BlockSpec<EffectOf<K>> };

export const EFFECTS: EffectCatalog = {
  /* --- control flow --- */
  sequence: {
    key: 'sequence', label: 'Do in order', category: 'Control flow', shape: 'flat',
    description: 'Group several steps so they run one after another.',
    params: [{ name: 'do', label: 'Steps', kind: 'effects' }],
    make: () => ({ op: 'sequence', do: [] }),
  },
  repeat: {
    key: 'repeat', label: 'Repeat', category: 'Control flow', shape: 'flat',
    description: 'Run the steps inside a number of times (e.g. place 2 roads).',
    params: [
      { name: 'times', label: 'Times', kind: 'expr', default: 2 },
      { name: 'do', label: 'Steps', kind: 'effects' },
      { name: 'as', label: 'Count as', kind: 'varName', binds: 'number', optional: true, loopVar: true, default: 'i', help: 'Optional: name for the loop counter (0, 1, 2…).' },
    ],
    make: () => ({ op: 'repeat', times: 2, do: [] }),
  },
  if: {
    key: 'if', label: 'If / otherwise', category: 'Control flow', shape: 'flat',
    description: 'Only run some steps when a condition holds, with optional “otherwise” steps.',
    params: [
      { name: 'cond', label: 'If', kind: 'condition', default: true },
      { name: 'then', label: 'Then', kind: 'effects' },
      { name: 'else', label: 'Otherwise', kind: 'effects', optional: true },
    ],
    make: () => ({ op: 'if', cond: true, then: [] }),
  },
  forEachPlayer: {
    key: 'forEachPlayer', label: 'For each player', category: 'Control flow', shape: 'flat',
    description: 'Run the steps once for every player (optionally only those matching a filter).',
    params: [
      P.as('player', 'p', false, true),
      { name: 'filter', label: 'Only players where', kind: 'condition', optional: true },
      { name: 'order', label: 'Order', kind: 'enum', options: ['turn', 'simultaneous'], optional: true, help: 'Simultaneous lets everyone answer prompts at once (e.g. discarding on a 7).' },
      { name: 'do', label: 'Steps', kind: 'effects' },
    ],
    make: () => ({ op: 'forEachPlayer', as: 'p', do: [] }),
  },
  forEachPiece: {
    key: 'forEachPiece', label: 'For each piece', category: 'Control flow', shape: 'flat',
    description: 'Run the steps once for every piece on the board that matches a query.',
    params: [
      { name: 'query', label: 'Pieces', kind: 'pieceQuery', default: { owner: 'self' } },
      P.as('location', 'piece', false, true),
      P.asId('pieceId', true),
      { name: 'do', label: 'Steps', kind: 'effects' },
    ],
    make: () => ({ op: 'forEachPiece', query: { owner: 'self' }, as: 'piece', do: [] }),
  },
  forEachLocation: {
    key: 'forEachLocation', label: 'For each location', category: 'Control flow', shape: 'flat',
    description: 'Run the steps once for every hex, corner or edge that passes a check (e.g. every hidden hex next to a ship).',
    params: [
      { name: 'kind', label: 'Location type', kind: 'locationKind', default: 'hex' },
      P.as('location', 'loc', false, true),
      { name: 'filter', label: 'Only where', kind: 'condition', optional: true, help: 'The candidate is available under the “Call each one” name.' },
      { name: 'do', label: 'Steps', kind: 'effects' },
    ],
    make: () => ({ op: 'forEachLocation', kind: 'hex', as: 'loc', do: [] }),
  },
  chooseOption: {
    key: 'chooseOption', label: 'Choose one option', category: 'Choices', shape: 'flat',
    description: 'Ask a player to pick one of several labelled options, each with its own steps.',
    params: [
      P.player('Who chooses'),
      P.label(),
      { name: 'options', label: 'Options', kind: 'options' },
    ],
    make: () => ({ op: 'chooseOption', options: [{ label: 'Option A', do: [] }, { label: 'Option B', do: [] }] }),
  },
  setVar: {
    key: 'setVar', label: 'Set variable', category: 'Control flow', shape: 'flat',
    description: 'Remember a number under a name so later steps can use it.',
    params: [
      { name: 'name', label: 'Name', kind: 'varName', binds: 'number', default: 'n' },
      { name: 'value', label: 'Value', kind: 'expr', default: 0 },
    ],
    make: () => ({ op: 'setVar', name: 'n', value: 0 }),
  },
  emit: {
    key: 'emit', label: 'Fire custom event', category: 'Control flow', shape: 'flat',
    description: 'Announce a custom event that your own triggers can react to.',
    params: [
      { name: 'event', label: 'Event name', kind: 'event', default: 'myEvent' },
      { name: 'payload', label: 'Data', kind: 'exprMap', optional: true, help: 'Named numbers passed to the triggers.' },
    ],
    make: () => ({ op: 'emit', event: 'myEvent' }),
  },
  log: {
    key: 'log', label: 'Write to log', category: 'Control flow', shape: 'flat',
    description: 'Add a line of text to the game log.',
    params: [{ name: 'text', label: 'Text', kind: 'string', default: '' }],
    make: () => ({ op: 'log', text: '' }),
  },
  abortIf: {
    key: 'abortIf', label: 'Cancel if', category: 'Control flow', shape: 'flat',
    description: 'Cancel the whole action (and refund its cost) when a condition holds.',
    params: [
      { name: 'cond', label: 'Cancel if', kind: 'condition', default: false },
      { name: 'message', label: 'Message', kind: 'string', optional: true },
    ],
    make: () => ({ op: 'abortIf', cond: false }),
  },

  /* --- choices --- */
  choosePlayer: {
    key: 'choosePlayer', label: 'Choose a player', category: 'Choices', shape: 'flat',
    description: 'Ask a player to pick another player and remember the pick.',
    params: [
      P.player('Who chooses'),
      P.as('player', 'target'),
      { name: 'filter', label: 'Only players where', kind: 'condition', optional: true },
      P.label(),
      P.optional(),
    ],
    make: () => ({ op: 'choosePlayer', as: 'target' }),
  },
  chooseResource: {
    key: 'chooseResource', label: 'Choose a resource', category: 'Choices', shape: 'flat',
    description: 'Ask a player to name a resource type (e.g. for Monopoly) and remember it.',
    params: [
      P.player('Who chooses'),
      P.as('resource', 'res'),
      { name: 'options', label: 'Allowed resources', kind: 'resourceIds', optional: true, help: 'Leave empty to allow all of the kind.' },
      P.kind(),
      P.label(),
    ],
    make: () => ({ op: 'chooseResource', as: 'res' }),
  },
  chooseLocation: {
    key: 'chooseLocation', label: 'Choose a location', category: 'Choices', shape: 'flat',
    description: 'Ask a player to pick a hex, corner or edge on the board and remember it.',
    params: [
      P.player('Who chooses'),
      P.as('location', 'loc'),
      { name: 'kind', label: 'Location type', kind: 'locationKind', default: 'hex' },
      { name: 'filter', label: 'Allowed where', kind: 'condition', default: true, help: 'The candidate location is available as `at`.' },
      P.label(),
      P.optional(),
    ],
    make: () => ({ op: 'chooseLocation', as: 'loc', kind: 'hex', filter: true }),
  },
  choosePiece: {
    key: 'choosePiece', label: 'Choose a piece', category: 'Choices', shape: 'flat',
    description: 'Ask a player to pick a piece on the board and remember it.',
    params: [
      P.player('Who chooses'),
      P.as('location', 'piece'),
      { name: 'query', label: 'From pieces', kind: 'pieceQuery', default: { owner: 'self' } },
      { name: 'filter', label: 'Only where', kind: 'condition', optional: true },
      P.label(),
      P.optional(),
      P.asId('pieceId'),
    ],
    make: () => ({ op: 'choosePiece', as: 'piece', query: { owner: 'self' } }),
  },
  chooseMany: {
    key: 'chooseMany', label: 'Choose several', category: 'Choices', shape: 'flat',
    description: 'Ask a player to pick several different players, spots, pieces or resource types (one at a time), then run the steps once for each pick.',
    params: [
      { name: 'of', label: 'Pick', kind: 'enum', options: ['player', 'location', 'piece', 'resource'], default: 'player' },
      { name: 'count', label: 'Up to', kind: 'expr', default: 2 },
      { name: 'min', label: 'At least', kind: 'expr', optional: true, default: 0, help: 'The player may stop after this many picks. Default: must pick all.' },
      P.player('Who chooses'),
      P.as('any', 'pick', false, true),
      { name: 'filter', label: 'Only where', kind: 'condition', optional: true, help: 'The candidate is available under the “Call each one” name.' },
      { name: 'kind', label: 'Location type', kind: 'locationKind', optional: true, help: 'For picking locations.' },
      { name: 'query', label: 'From pieces', kind: 'pieceQuery', optional: true, help: 'For picking pieces.' },
      { name: 'options', label: 'Allowed resources', kind: 'resourceIds', optional: true, help: 'For picking resources.' },
      P.label(),
      { name: 'countAs', label: 'Remember how many as', kind: 'varName', binds: 'number', optional: true, default: 'picked' },
      { name: 'do', label: 'For each pick', kind: 'effects' },
    ],
    make: () => ({ op: 'chooseMany', of: 'player', count: 2, as: 'pick', do: [] }),
  },

  /* --- resources --- */
  gain: {
    key: 'gain', label: 'Gain resources', category: 'Resources', shape: 'flat',
    description: 'Take resources from the bank (limited by what the bank has).',
    params: [P.player(), { name: 'resources', label: 'Resources', kind: 'resourceMap', default: {} }],
    make: () => ({ op: 'gain', resources: {} }),
  },
  pay: {
    key: 'pay', label: 'Pay resources', category: 'Resources', shape: 'flat',
    description: 'Return resources to the bank. Fails the action if the player cannot afford it.',
    params: [P.player(), { name: 'resources', label: 'Resources', kind: 'resourceMap', default: {} }],
    make: () => ({ op: 'pay', resources: {} }),
  },
  transfer: {
    key: 'transfer', label: 'Transfer resources', category: 'Resources', shape: 'flat',
    description: 'Move resource cards from one player (or the bank) to another.',
    params: [
      { name: 'from', label: 'From', kind: 'playerRef', default: 'self' },
      { name: 'to', label: 'To', kind: 'playerRef', default: 'self' },
      { name: 'resource', label: 'Resource', kind: 'resourceRef', extra: ['random', 'choice'], default: 'random' },
      P.amount(),
    ],
    make: () => ({ op: 'transfer', from: { var: 'target' }, to: 'self', resource: 'random', amount: 1 }),
  },
  steal: {
    key: 'steal', label: 'Steal', category: 'Resources', shape: 'flat',
    description: 'Take random resource card(s) from a player.',
    params: [
      { name: 'from', label: 'From', kind: 'playerRef', default: { var: 'target' } },
      { name: 'to', label: 'To', kind: 'playerRef', optional: true, help: 'Defaults to the player running this.' },
      P.amount('amount', 1, true),
    ],
    make: () => ({ op: 'steal', from: { var: 'target' } }),
  },
  discard: {
    key: 'discard', label: 'Discard resources', category: 'Resources', shape: 'flat',
    description: 'A player picks resource cards to return to the bank.',
    params: [{ name: 'player', label: 'Player', kind: 'playerRef', default: 'self' }, P.amount(), P.kind()],
    make: () => ({ op: 'discard', player: 'self', amount: 1 }),
  },
  chooseAndGain: {
    key: 'chooseAndGain', label: 'Pick resources to gain', category: 'Resources', shape: 'flat',
    description: 'A player picks which resources to take from the bank (Year of Plenty style).',
    params: [
      P.player(),
      P.amount('amount', 2),
      { name: 'options', label: 'Allowed resources', kind: 'resourceIds', optional: true },
      P.kind(),
    ],
    make: () => ({ op: 'chooseAndGain', amount: 2 }),
  },
  produce: {
    key: 'produce', label: 'Run production', category: 'Resources', shape: 'flat',
    description: 'Hand out resources as if a number was rolled, or for a single hex.',
    params: [
      { name: 'roll', label: 'For number', kind: 'expr', optional: true, default: { dice: 'total' } },
      { name: 'hex', label: 'Only hex', kind: 'locationVar', varType: 'location', optional: true },
      { name: 'player', label: 'Only for player', kind: 'playerRef', optional: true },
    ],
    make: () => ({ op: 'produce', roll: { dice: 'total' } }),
  },
  grantTradeRate: {
    key: 'grantTradeRate', label: 'Grant trade rate', category: 'Resources', shape: 'flat',
    description: 'Give a player a better bank trade rate (like owning a harbor).',
    params: [
      P.player(),
      { name: 'resource', label: 'Resource', kind: 'resourceRef', extra: ['any'], default: 'any' },
      { name: 'ratio', label: 'Ratio (N:1)', kind: 'number', default: 2 },
      { name: 'until', label: 'Lasts', kind: 'enum', options: ['endOfTurn', 'forever'], optional: true },
    ],
    make: () => ({ op: 'grantTradeRate', resource: 'any', ratio: 2 }),
  },

  /* --- pieces & board --- */
  place: {
    key: 'place', label: 'Place a piece', category: 'Board', shape: 'flat',
    description: 'Put a piece on the board following its placement rules.',
    params: [
      { name: 'piece', label: 'Piece', kind: 'pieceId', default: '' },
      P.player(),
      { name: 'free', label: 'Free', kind: 'boolean', optional: true, help: 'Do not charge the piece cost.' },
      { name: 'ignoreConnection', label: 'Ignore connection', kind: 'boolean', optional: true },
      { name: 'location', label: 'Where', kind: 'locationChoice', optional: true },
      P.as('location', 'placed', true),
      P.asId('placedId'),
    ],
    make: () => ({ op: 'place', piece: '', free: true }),
  },
  upgrade: {
    key: 'upgrade', label: 'Upgrade a piece', category: 'Board', shape: 'flat',
    description: 'Replace one of your pieces with a better one (settlement → city).',
    params: [
      { name: 'from', label: 'From', kind: 'pieceIds', multiple: 'either', default: '' },
      { name: 'to', label: 'To', kind: 'pieceId', default: '' },
      P.player(),
      { name: 'free', label: 'Free', kind: 'boolean', optional: true },
      { name: 'location', label: 'Where', kind: 'locationChoice', optional: true },
      P.as('location', 'upgraded', true),
      P.asId('upgradedId'),
    ],
    make: () => ({ op: 'upgrade', from: '', to: '' }),
  },
  downgrade: {
    key: 'downgrade', label: 'Downgrade a piece', category: 'Board', shape: 'flat',
    description: 'Replace a player’s piece with a lesser one at the same spot (city → settlement). Their choice; free. If none of the lesser piece is left, the piece is lost.',
    params: [
      { name: 'from', label: 'From', kind: 'pieceIds', multiple: 'either', default: '' },
      { name: 'to', label: 'To', kind: 'pieceId', default: '' },
      P.player('Whose piece', 'The owner, who also picks which one. Defaults to the player running this.'),
      { name: 'location', label: 'Where', kind: 'locationChoice', optional: true },
      P.as('location', 'downgraded', true),
      P.asId('downgradedId'),
    ],
    make: () => ({ op: 'downgrade', from: '', to: '' }),
  },
  remove: {
    key: 'remove', label: 'Remove a piece', category: 'Board', shape: 'flat',
    description: 'Take a piece off the board.',
    params: [
      { name: 'query', label: 'Which pieces', kind: 'pieceQuery', default: { owner: 'any' } },
      { name: 'location', label: 'Where', kind: 'locationChoice', optional: true },
      { name: 'returnToSupply', label: 'Return to owner’s supply', kind: 'boolean', optional: true },
      P.as('location', 'removed', true),
    ],
    make: () => ({ op: 'remove', query: { owner: 'any' } }),
  },
  movePiece: {
    key: 'movePiece', label: 'Move a piece', category: 'Board', shape: 'flat',
    description: 'Move a piece to a new spot that follows its placement rules (or anywhere allowed), optionally only within a number of steps along an allowed path.',
    params: [
      { name: 'query', label: 'Which pieces', kind: 'pieceQuery', default: { owner: 'self' } },
      { name: 'from', label: 'From', kind: 'locationChoice', optional: true },
      { name: 'to', label: 'To', kind: 'locationChoice', optional: true },
      P.player('Who chooses', 'Defaults to the player running this. Use “the owner of …” to make another player move their piece.'),
      { name: 'anywhere', label: 'Ignore placement rules', kind: 'boolean', optional: true, help: 'Only the “To … where” check applies.' },
      { name: 'maxSteps', label: 'Within steps', kind: 'expr', optional: true, default: 3, help: 'Movement range: steps between neighbouring spots of the same kind.' },
      { name: 'path', label: 'Each step allowed where', kind: 'condition', optional: true, help: 'Checked for every step: `at` = next spot, `prev` = previous spot, `via` = what connects them.' },
      { name: 'stepsAs', label: 'Remember steps used as', kind: 'varName', binds: 'number', optional: true, default: 'steps' },
      P.as('location', 'movedTo', true),
      P.asId('movedId'),
    ],
    make: () => ({ op: 'movePiece', query: { owner: 'self' } }),
  },
  setPieceState: {
    key: 'setPieceState', label: 'Set piece state', category: 'Board', shape: 'flat',
    description: 'Change a number stored on a piece (e.g. knight active = 1, strength = 2).',
    params: [
      { name: 'at', label: 'Piece', kind: 'locationVar', varType: 'piece', default: 'piece' },
      { name: 'key', label: 'State', kind: 'key', keySpace: 'pieceState', default: 'active' },
      { name: 'value', label: 'Value', kind: 'expr', default: 1 },
    ],
    make: () => ({ op: 'setPieceState', at: 'piece', key: 'active', value: 1 }),
  },
  loadCargo: {
    key: 'loadCargo', label: 'Load cargo', category: 'Board', shape: 'flat',
    description: 'Move resource cards from a player’s hand onto a piece (a wagon, a ship). They travel with it.',
    params: [
      P.piece(),
      P.player('From player'),
      { name: 'resource', label: 'Resource', kind: 'resourceRef', extra: ['choice'], default: 'choice' },
      P.amount('amount', 1, true),
    ],
    make: () => ({ op: 'loadCargo', piece: 'pieceId', resource: 'choice' }),
  },
  unloadCargo: {
    key: 'unloadCargo', label: 'Unload cargo', category: 'Board', shape: 'flat',
    description: 'Move resource cargo off a piece into a player’s hand (or back to the bank).',
    params: [
      P.piece(),
      { name: 'to', label: 'To', kind: 'playerRef', optional: true, help: 'Defaults to the player running this. “The bank” returns it.' },
      { name: 'resource', label: 'Resource', kind: 'resourceRef', extra: ['all'], optional: true, default: 'all' },
      { name: 'amount', label: 'Amount', kind: 'expr', optional: true, default: 1, help: 'Leave out to unload all of it.' },
    ],
    make: () => ({ op: 'unloadCargo', piece: 'pieceId' }),
  },
  addCargo: {
    key: 'addCargo', label: 'Add goods to a piece', category: 'Board', shape: 'flat',
    description: 'Put (or with a negative amount, take away) goods on a piece, e.g. a settler on a ship. Not taken from anyone’s hand.',
    params: [
      P.piece(),
      { name: 'key', label: 'Goods', kind: 'key', keySpace: 'cargo', default: 'settler' },
      P.amount(),
    ],
    make: () => ({ op: 'addCargo', piece: 'pieceId', key: 'settler', amount: 1 }),
  },
  moveToken: {
    key: 'moveToken', label: 'Move a token', category: 'Board', shape: 'flat',
    description: 'Move a token such as the robber to a new spot.',
    params: [
      { name: 'token', label: 'Token', kind: 'tokenId', default: '' },
      { name: 'to', label: 'To', kind: 'locationChoice', optional: true },
      P.as('location', 'tokenAt', true),
    ],
    make: () => ({ op: 'moveToken', token: '' }),
  },
  setTerrain: {
    key: 'setTerrain', label: 'Change terrain', category: 'Board', shape: 'flat',
    description: 'Turn a hex into a different terrain.',
    params: [P.at('Hex'), { name: 'terrain', label: 'Terrain', kind: 'terrainId', default: '' }],
    make: () => ({ op: 'setTerrain', at: 'loc', terrain: '' }),
  },
  setHexNumber: {
    key: 'setHexNumber', label: 'Set hex number', category: 'Board', shape: 'flat',
    description: 'Change (or clear) the number token on a hex.',
    params: [P.at('Hex'), { name: 'number', label: 'Number', kind: 'expr', nullable: true, default: 6 }],
    make: () => ({ op: 'setHexNumber', at: 'loc', number: 6 }),
  },
  revealHex: {
    key: 'revealHex', label: 'Reveal hex', category: 'Board', shape: 'flat',
    description: 'Flip a hidden (fog) hex face-up.',
    params: [P.at('Hex')],
    make: () => ({ op: 'revealHex', at: 'loc' }),
  },

  /* --- cards --- */
  drawCard: {
    key: 'drawCard', label: 'Draw cards', category: 'Cards', shape: 'flat',
    description: 'Draw card(s) from the top of a deck into a player’s hand.',
    params: [
      { name: 'deck', label: 'Deck', kind: 'deckId', default: '' },
      P.player(),
      { name: 'count', label: 'How many', kind: 'expr', optional: true, default: 1 },
    ],
    make: () => ({ op: 'drawCard', deck: '' }),
  },
  giveCard: {
    key: 'giveCard', label: 'Give a card', category: 'Cards', shape: 'flat',
    description: 'Give a player a specific card from the supply (not from a deck).',
    params: [{ name: 'card', label: 'Card', kind: 'cardId', default: '' }, P.player()],
    make: () => ({ op: 'giveCard', card: '' }),
  },
  discardCard: {
    key: 'discardCard', label: 'Discard a card', category: 'Cards', shape: 'flat',
    description: 'A player loses a card from their hand.',
    params: [
      P.player(),
      { name: 'card', label: 'Card', kind: 'cardId', optional: true },
      { name: 'choose', label: 'Player chooses', kind: 'boolean', optional: true },
    ],
    make: () => ({ op: 'discardCard', choose: true }),
  },
  shuffleDeck: {
    key: 'shuffleDeck', label: 'Shuffle deck', category: 'Cards', shape: 'flat',
    description: 'Shuffle a deck.',
    params: [{ name: 'deck', label: 'Deck', kind: 'deckId', default: '' }],
    make: () => ({ op: 'shuffleDeck', deck: '' }),
  },

  /* --- scoring, stats & state --- */
  addVP: {
    key: 'addVP', label: 'Award victory points', category: 'Scoring', shape: 'flat',
    description: 'Give (or take away) permanent victory points.',
    params: [P.player(), P.amount(), { name: 'reason', label: 'Reason', kind: 'string', optional: true }],
    make: () => ({ op: 'addVP', amount: 1 }),
  },
  addStat: {
    key: 'addStat', label: 'Add to player stat', category: 'Scoring', shape: 'flat',
    description: 'Increase a per-player counter (e.g. knightsPlayed).',
    params: [P.player(), { name: 'key', label: 'Stat', kind: 'key', keySpace: 'stat', default: 'myStat' }, P.amount()],
    make: () => ({ op: 'addStat', key: 'myStat', amount: 1 }),
  },
  setStat: {
    key: 'setStat', label: 'Set player stat', category: 'Scoring', shape: 'flat',
    description: 'Set a per-player counter to a value.',
    params: [P.player(), { name: 'key', label: 'Stat', kind: 'key', keySpace: 'stat', default: 'myStat' }, { name: 'value', label: 'Value', kind: 'expr', default: 0 }],
    make: () => ({ op: 'setStat', key: 'myStat', value: 0 }),
  },
  addGlobal: {
    key: 'addGlobal', label: 'Add to global counter', category: 'Scoring', shape: 'flat',
    description: 'Increase a game-wide counter (e.g. barbarian position).',
    params: [{ name: 'key', label: 'Counter', kind: 'key', keySpace: 'global', default: 'myCounter' }, P.amount()],
    make: () => ({ op: 'addGlobal', key: 'myCounter', amount: 1 }),
  },
  setGlobal: {
    key: 'setGlobal', label: 'Set global counter', category: 'Scoring', shape: 'flat',
    description: 'Set a game-wide counter to a value.',
    params: [{ name: 'key', label: 'Counter', kind: 'key', keySpace: 'global', default: 'myCounter' }, { name: 'value', label: 'Value', kind: 'expr', default: 0 }],
    make: () => ({ op: 'setGlobal', key: 'myCounter', value: 0 }),
  },
  setFlag: {
    key: 'setFlag', label: 'Set a flag', category: 'Scoring', shape: 'flat',
    description: 'Switch an on/off marker on a player, optionally only until the end of the turn.',
    params: [
      P.player(),
      { name: 'flag', label: 'Flag', kind: 'key', keySpace: 'flag', default: 'myFlag' },
      { name: 'value', label: 'On', kind: 'boolean', default: true },
      { name: 'until', label: 'Lasts', kind: 'enum', options: ['endOfTurn', 'endOfRound', 'forever'], optional: true },
    ],
    make: () => ({ op: 'setFlag', flag: 'myFlag', value: true }),
  },

  /* --- turn flow --- */
  rollDice: {
    key: 'rollDice', label: 'Roll the dice', category: 'Turn', shape: 'flat',
    description: 'Roll the dice (fires the “dice rolled” event).',
    params: [], make: () => ({ op: 'rollDice' }),
  },
  extraBuildPhase: {
    key: 'extraBuildPhase', label: 'Special building phase', category: 'Turn', shape: 'flat',
    description: 'Let the other players build in turn (5–6 player rule).',
    params: [], make: () => ({ op: 'extraBuildPhase' }),
  },
  endTurn: {
    key: 'endTurn', label: 'End the turn', category: 'Turn', shape: 'flat',
    description: 'End the current player’s turn immediately.',
    params: [], make: () => ({ op: 'endTurn' }),
  },
  win: {
    key: 'win', label: 'Win the game', category: 'Turn', shape: 'flat',
    description: 'A player wins immediately.',
    params: [P.player()], make: () => ({ op: 'win' }),
  },
};

/* ------------------------------------------------------------------------ */
/*  Conditions                                                               */
/* ------------------------------------------------------------------------ */

type UnionKeys<T> = T extends object ? keyof T : never;
/** Discriminating key of each Condition variant ('player' is a secondary key of `flag`). */
export type ConditionKind = 'true' | 'false' | Exclude<UnionKeys<Exclude<Condition, boolean>>, 'player'>;
/** Discriminating key of each Expr variant. */
export type ExprKind = 'number' | UnionKeys<Exclude<Expr, number>>;

export type ConditionCatalog = { [K in ConditionKind]: BlockSpec<Condition> };
export type ExprCatalog = { [K in ExprKind]: BlockSpec<Expr> };

const at = (label = 'Location'): ParamSpec => ({ name: 'at', label, kind: 'locationVar', varType: 'location', default: 'at' });

export const CONDITIONS: ConditionCatalog = {
  true: {
    key: 'true', label: 'Always', category: 'Logic', shape: 'literal',
    description: 'Always true.', params: [], make: () => true,
  },
  false: {
    key: 'false', label: 'Never', category: 'Logic', shape: 'literal',
    description: 'Always false.', params: [], make: () => false,
  },
  all: {
    key: 'all', label: 'All of', category: 'Logic', shape: 'list',
    description: 'True when every check inside is true.',
    params: [{ name: 'items', label: 'Checks', kind: 'conditionList' }],
    make: () => ({ all: [true] }),
  },
  any: {
    key: 'any', label: 'Any of', category: 'Logic', shape: 'list',
    description: 'True when at least one check inside is true.',
    params: [{ name: 'items', label: 'Checks', kind: 'conditionList' }],
    make: () => ({ any: [true] }),
  },
  not: {
    key: 'not', label: 'Not', category: 'Logic', shape: 'value',
    description: 'Flips a check: true becomes false and vice versa.',
    params: [{ name: 'cond', label: 'Check', kind: 'condition', default: true }],
    make: () => ({ not: true }),
  },
  cmp: {
    key: 'cmp', label: 'Compare numbers', category: 'Logic', shape: 'tuple',
    description: 'Compare two numbers or formulas (e.g. your VP ≥ 8).',
    params: [
      { name: 'left', label: 'Left', kind: 'expr', default: 0 },
      { name: 'op', label: 'Is', kind: 'compareOp', default: '>=' },
      { name: 'right', label: 'Right', kind: 'expr', default: 0 },
    ],
    make: () => ({ cmp: [{ vp: 'self' }, '>=', 8] }),
  },
  canAfford: {
    key: 'canAfford', label: 'Can afford', category: 'Resources', shape: 'object',
    description: 'True when the player holds at least these resources.',
    params: [{ name: 'cost', label: 'Cost', kind: 'resourceMap', default: {} }, P.player()],
    make: () => ({ canAfford: { cost: {} } }),
  },
  isTurnOf: {
    key: 'isTurnOf', label: 'Is the turn of', category: 'Turn', shape: 'value',
    description: 'True when it is this player’s turn.',
    params: [{ name: 'player', label: 'Player', kind: 'playerRef', default: 'self' }],
    make: () => ({ isTurnOf: 'self' }),
  },
  phase: {
    key: 'phase', label: 'Turn phase is', category: 'Turn', shape: 'value',
    description: 'True during the given phase(s) of the turn.',
    params: [{ name: 'phase', label: 'Phase', kind: 'phases', default: 'main' }],
    make: () => ({ phase: 'main' }),
  },
  hasRolled: {
    key: 'hasRolled', label: 'Dice rolled this turn', category: 'Turn', shape: 'value',
    description: 'True if the dice have (or have not) been rolled this turn.',
    params: [{ name: 'value', label: 'Has rolled', kind: 'boolean', default: true }],
    make: () => ({ hasRolled: true }),
  },
  flag: {
    key: 'flag', label: 'Flag is on', category: 'Scoring', shape: 'flat',
    description: 'True when a player’s on/off flag (set by “Set a flag”) is on.',
    params: [{ name: 'flag', label: 'Flag', kind: 'key', keySpace: 'flag', default: 'myFlag' }, P.player()],
    make: () => ({ flag: 'myFlag' }),
  },
  setting: {
    key: 'setting', label: 'Lobby setting is on', category: 'Logic', shape: 'value',
    description: 'True when an on/off lobby setting is switched on.',
    params: [{ name: 'setting', label: 'Setting', kind: 'settingId', default: '' }],
    make: () => ({ setting: '' }),
  },
  samePlayer: {
    key: 'samePlayer', label: 'Same player', category: 'Turn', shape: 'tuple',
    description: 'True when two player references are the same person.',
    params: [
      { name: 'a', label: 'Player', kind: 'playerRef', default: 'self' },
      { name: 'b', label: 'Is', kind: 'playerRef', default: 'current' },
    ],
    make: () => ({ samePlayer: ['self', 'current'] }),
  },
  varSet: {
    key: 'varSet', label: 'Variable is set', category: 'Logic', shape: 'value',
    description: 'True when a variable has been given a value (e.g. an optional choice was made).',
    params: [{ name: 'var', label: 'Variable', kind: 'varRef', varType: 'any', default: '' }],
    make: () => ({ varSet: '' }),
  },
  varIs: {
    key: 'varIs', label: 'Variable is', category: 'Logic', shape: 'object',
    description: 'True when a remembered value is exactly this id or text (e.g. the piece placed is “settlement”, the award is “longestRoad”).',
    params: [
      { name: 'var', label: 'Variable', kind: 'varRef', varType: 'any', default: 'piece' },
      { name: 'value', label: 'Is', kind: 'string', default: '' },
    ],
    make: () => ({ varIs: { var: 'piece', value: '' } }),
  },
  terrainIs: {
    key: 'terrainIs', label: 'Terrain is', category: 'Board', shape: 'object',
    description: 'True when the location is (or touches) one of these terrains.',
    params: [at(), { name: 'terrain', label: 'Terrain', kind: 'terrainIds', multiple: 'either', default: '' }],
    make: () => ({ terrainIs: { at: 'at', terrain: '' } }),
  },
  isWater: {
    key: 'isWater', label: 'Is water', category: 'Board', shape: 'object',
    description: 'True when the location is water.',
    params: [at()], make: () => ({ isWater: { at: 'at' } }),
  },
  isCoastal: {
    key: 'isCoastal', label: 'Is coastal', category: 'Board', shape: 'object',
    description: 'True when the location touches both land and water.',
    params: [at()], make: () => ({ isCoastal: { at: 'at' } }),
  },
  occupied: {
    key: 'occupied', label: 'Is occupied', category: 'Board', shape: 'object',
    description: 'True when a piece (optionally of a type / owner) sits on the location.',
    params: [
      at(),
      { name: 'piece', label: 'Piece', kind: 'pieceIds', multiple: 'either', optional: true },
      { name: 'owner', label: 'Owner', kind: 'playerFilter', optional: true },
    ],
    make: () => ({ occupied: { at: 'at' } }),
  },
  adjacentTo: {
    key: 'adjacentTo', label: 'Is next to', category: 'Board', shape: 'object',
    description: 'True when a matching piece is next to the location.',
    params: [
      at(),
      { name: 'piece', label: 'Piece', kind: 'pieceIds', multiple: 'either', optional: true },
      { name: 'owner', label: 'Owner', kind: 'playerFilter', optional: true },
      { name: 'tag', label: 'Tag', kind: 'string', optional: true },
    ],
    make: () => ({ adjacentTo: { at: 'at', owner: 'self' } }),
  },
  connectedTo: {
    key: 'connectedTo', label: 'Connects to network', category: 'Board', shape: 'object',
    description: 'True when the location connects to the player’s network of roads (or other pieces).',
    params: [
      at(),
      { name: 'owner', label: 'Owner', kind: 'playerRef', default: 'self' },
      { name: 'via', label: 'Via pieces', kind: 'pieceIds', multiple: 'list', optional: true },
    ],
    make: () => ({ connectedTo: { at: 'at', owner: 'self' } }),
  },
  distanceRule: {
    key: 'distanceRule', label: 'Distance rule', category: 'Board', shape: 'object',
    description: 'True when no corner piece is within N edges (the classic “no neighbours” rule).',
    params: [at(), { name: 'minDistance', label: 'Min distance', kind: 'number', optional: true, default: 2 }],
    make: () => ({ distanceRule: { at: 'at' } }),
  },
  hasToken: {
    key: 'hasToken', label: 'Has token', category: 'Board', shape: 'object',
    description: 'True when a token (e.g. the robber) is on the location — or, with “or next to it”, on a neighbouring spot (a pirate blocks the edges of its hex).',
    params: [
      at(), { name: 'token', label: 'Token', kind: 'tokenId', default: '' },
      { name: 'near', label: 'Or next to it', kind: 'boolean', optional: true },
    ],
    make: () => ({ hasToken: { at: 'at', token: '' } }),
  },
  isAdjacent: {
    key: 'isAdjacent', label: 'Locations touch', category: 'Board', shape: 'tuple',
    description: 'True when two chosen locations are next to each other (e.g. a road touching the settlement just placed).',
    params: [
      { name: 'a', label: 'Location', kind: 'locationVar', default: 'at' },
      { name: 'b', label: 'Touches', kind: 'locationVar', default: 'lastPlaced' },
    ],
    make: () => ({ isAdjacent: ['at', 'lastPlaced'] }),
  },
  hexNumberIn: {
    key: 'hexNumberIn', label: 'Hex number is', category: 'Board', shape: 'object',
    description: 'True when the hex’s number token is one of these numbers.',
    params: [at(), { name: 'numbers', label: 'Numbers', kind: 'numbers', default: [6, 8] }],
    make: () => ({ hexNumberIn: { at: 'at', numbers: [6, 8] } }),
  },
  isNetworkEnd: {
    key: 'isNetworkEnd', label: 'Is an open end of a route', category: 'Board', shape: 'object',
    description: 'True when the road/ship on this edge is at a loose end of its owner’s route (one end touches none of their buildings or other route pieces). Seafarers: only such ships may move.',
    params: [
      at('Edge'),
      { name: 'owner', label: 'Owner', kind: 'playerRef', optional: true, help: 'Defaults to the owner of the piece on the edge.' },
      { name: 'via', label: 'Route pieces', kind: 'pieceIds', multiple: 'list', optional: true, help: 'Which pieces form the route. Default: pieces of the same network.' },
    ],
    make: () => ({ isNetworkEnd: { at: 'at' } }),
  },
  sameRegion: {
    key: 'sameRegion', label: 'On the same island', category: 'Board', shape: 'tuple',
    description: 'True when two locations touch the same island (a group of connected land hexes).',
    params: [
      { name: 'a', label: 'Location', kind: 'locationVar', default: 'at' },
      { name: 'b', label: 'Same island as', kind: 'locationVar', default: 'lastPlaced' },
    ],
    make: () => ({ sameRegion: ['at', 'lastPlaced'] }),
  },
  hexTag: {
    key: 'hexTag', label: 'Hex is marked', category: 'Board', shape: 'object',
    description: 'True when the location touches a hex that the map marks with this tag (e.g. “foreign” islands where nobody may start).',
    params: [at(), { name: 'tag', label: 'Mark', kind: 'string', default: '' }],
    make: () => ({ hexTag: { at: 'at', tag: '' } }),
  },
};

/* ------------------------------------------------------------------------ */
/*  Exprs                                                                    */
/* ------------------------------------------------------------------------ */

export const EXPRS: ExprCatalog = {
  number: {
    key: 'number', label: 'Number', category: 'Math', shape: 'literal',
    description: 'A plain number.', params: [], make: () => 1,
  },
  var: {
    key: 'var', label: 'Variable', category: 'Math', shape: 'value',
    description: 'A number remembered earlier (set variable, loop counter, event data).',
    params: [{ name: 'var', label: 'Variable', kind: 'varRef', varType: 'number', default: '' }],
    make: () => ({ var: '' }),
  },
  param: {
    key: 'param', label: 'Lobby setting', category: 'Math', shape: 'value',
    description: 'The value of a number setting chosen in the lobby.',
    params: [{ name: 'param', label: 'Setting', kind: 'settingId', default: '' }],
    make: () => ({ param: '' }),
  },
  add: {
    key: 'add', label: 'Add', category: 'Math', shape: 'list',
    description: 'The sum of several numbers.',
    params: [{ name: 'items', label: 'Numbers', kind: 'exprList' }],
    make: () => ({ add: [1, 1] }),
  },
  sub: {
    key: 'sub', label: 'Subtract', category: 'Math', shape: 'tuple',
    description: 'One number minus another.',
    params: [{ name: 'a', label: 'From', kind: 'expr', default: 0 }, { name: 'b', label: 'Subtract', kind: 'expr', default: 0 }],
    make: () => ({ sub: [0, 0] }),
  },
  mul: {
    key: 'mul', label: 'Multiply', category: 'Math', shape: 'list',
    description: 'The product of several numbers.',
    params: [{ name: 'items', label: 'Numbers', kind: 'exprList' }],
    make: () => ({ mul: [1, 1] }),
  },
  div: {
    key: 'div', label: 'Divide', category: 'Math', shape: 'tuple',
    description: 'One number divided by another, rounded down.',
    params: [{ name: 'a', label: 'Divide', kind: 'expr', default: 0 }, { name: 'b', label: 'By', kind: 'expr', default: 2 }],
    make: () => ({ div: [0, 2] }),
  },
  min: {
    key: 'min', label: 'Smallest of', category: 'Math', shape: 'list',
    description: 'The smallest of several numbers.',
    params: [{ name: 'items', label: 'Numbers', kind: 'exprList' }],
    make: () => ({ min: [0, 0] }),
  },
  max: {
    key: 'max', label: 'Largest of', category: 'Math', shape: 'list',
    description: 'The largest of several numbers.',
    params: [{ name: 'items', label: 'Numbers', kind: 'exprList' }],
    make: () => ({ max: [0, 0] }),
  },
  if: {
    key: 'if', label: 'If / otherwise', category: 'Math', shape: 'tuple',
    description: 'Pick one number when a condition holds, another otherwise.',
    params: [
      { name: 'cond', label: 'If', kind: 'condition', default: true },
      { name: 'then', label: 'Then', kind: 'expr', default: 1 },
      { name: 'else', label: 'Otherwise', kind: 'expr', default: 0 },
    ],
    make: () => ({ if: [true, 1, 0] }),
  },
  random: {
    key: 'random', label: 'Random number', category: 'Math', shape: 'tuple',
    description: 'A random whole number between two values (inclusive).',
    params: [{ name: 'lo', label: 'From', kind: 'expr', default: 1 }, { name: 'hi', label: 'To', kind: 'expr', default: 6 }],
    make: () => ({ random: [1, 6] }),
  },
  resourceCount: {
    key: 'resourceCount', label: 'Resources held', category: 'Resources', shape: 'object',
    description: 'How many resource cards a player holds (of one type, a kind, or all).',
    params: [
      P.player(),
      { name: 'resource', label: 'Resource', kind: 'resourceRef', extra: ['any'], optional: true },
      P.kind(),
    ],
    make: () => ({ resourceCount: { player: 'self' } }),
  },
  pieceCount: {
    key: 'pieceCount', label: 'Pieces on board', category: 'Board', shape: 'value',
    description: 'How many pieces on the board match a query.',
    params: [{ name: 'query', label: 'Pieces', kind: 'pieceQuery', default: { owner: 'self' } }],
    make: () => ({ pieceCount: { owner: 'self' } }),
  },
  cardCount: {
    key: 'cardCount', label: 'Cards held', category: 'Cards', shape: 'object',
    description: 'How many cards a player holds or has played.',
    params: [
      P.player(),
      { name: 'card', label: 'Card', kind: 'cardId', optional: true },
      { name: 'deck', label: 'From deck', kind: 'deckId', optional: true },
      { name: 'played', label: 'Played cards', kind: 'boolean', optional: true },
    ],
    make: () => ({ cardCount: { player: 'self' } }),
  },
  stat: {
    key: 'stat', label: 'Player stat', category: 'Scoring', shape: 'object',
    description: 'A per-player counter (e.g. knightsPlayed).',
    params: [P.player(), { name: 'key', label: 'Stat', kind: 'key', keySpace: 'stat', default: 'myStat' }],
    make: () => ({ stat: { key: 'myStat' } }),
  },
  global: {
    key: 'global', label: 'Global counter', category: 'Scoring', shape: 'value',
    description: 'A game-wide counter (e.g. barbarian position).',
    params: [{ name: 'key', label: 'Counter', kind: 'key', keySpace: 'global', default: 'myCounter' }],
    make: () => ({ global: 'myCounter' }),
  },
  vp: {
    key: 'vp', label: 'Victory points', category: 'Scoring', shape: 'value',
    description: 'A player’s current victory points.',
    params: [{ name: 'player', label: 'Player', kind: 'playerRef', default: 'self' }],
    make: () => ({ vp: 'self' }),
  },
  dice: {
    key: 'dice', label: 'Dice roll', category: 'Turn', shape: 'value',
    description: 'The last dice roll: the total, or one die.',
    params: [{ name: 'die', label: 'Which', kind: 'dice', default: 'total' }],
    make: () => ({ dice: 'total' }),
  },
  playerCount: {
    key: 'playerCount', label: 'Number of players', category: 'Turn', shape: 'literal',
    description: 'How many players are in the game.',
    params: [], make: () => ({ playerCount: true }),
  },
  longestRoad: {
    key: 'longestRoad', label: 'Longest road length', category: 'Board', shape: 'value',
    description: 'Length of a player’s longest continuous road.',
    params: [{ name: 'player', label: 'Player', kind: 'playerRef', default: 'self' }],
    make: () => ({ longestRoad: 'self' }),
  },
  pieceState: {
    key: 'pieceState', label: 'Piece state', category: 'Board', shape: 'object',
    description: 'A number stored on one piece (e.g. a knight’s strength). 0 if not set.',
    params: [
      { name: 'piece', label: 'Piece', kind: 'locationVar', varType: 'piece', default: 'piece' },
      { name: 'key', label: 'State', kind: 'key', keySpace: 'pieceState', default: 'strength' },
    ],
    make: () => ({ pieceState: { piece: 'piece', key: 'strength' } }),
  },
  sumPieceState: {
    key: 'sumPieceState', label: 'Total piece state', category: 'Board', shape: 'object',
    description: 'Adds up a number stored on every matching piece (e.g. the strength of all active knights).',
    params: [
      { name: 'query', label: 'Pieces', kind: 'pieceQuery', default: { owner: 'self' } },
      { name: 'key', label: 'State', kind: 'key', keySpace: 'pieceState', default: 'strength' },
    ],
    make: () => ({ sumPieceState: { query: { owner: 'self' }, key: 'strength' } }),
  },
  cargoCount: {
    key: 'cargoCount', label: 'Cargo carried', category: 'Board', shape: 'object',
    description: 'How much a piece carries: of one resource/goods, or everything.',
    params: [
      { name: 'piece', label: 'Piece', kind: 'locationVar', varType: 'piece', default: 'pieceId' },
      { name: 'key', label: 'Goods', kind: 'key', keySpace: 'cargo', optional: true },
    ],
    make: () => ({ cargoCount: { piece: 'pieceId' } }),
  },
  countPlayers: {
    key: 'countPlayers', label: 'Number of players where', category: 'Turn', shape: 'object',
    description: 'How many players pass a check, e.g. “nobody has more knights than you” = this is 0 for players with more.',
    params: [
      { name: 'as', label: 'Call each one', kind: 'varName', binds: 'player', default: 'q', loopVar: true },
      { name: 'filter', label: 'Where', kind: 'condition', optional: true, default: true },
    ],
    make: () => ({ countPlayers: { as: 'q' } }),
  },
};

/* ------------------------------------------------------------------------ */
/*  Triggers / events                                                        */
/* ------------------------------------------------------------------------ */

export interface EventVar { name: string; type: VarType; description: string }
export interface EventSpec { label: string; description: string; vars: EventVar[] }

/** Type + description of each payload var name (see EVENT_PAYLOAD_VARS in engine/schema.ts). */
const PAYLOAD_VAR_INFO: Record<string, Omit<EventVar, 'name'>> = {
  player: { type: 'player', description: 'The player concerned' },
  owner: { type: 'player', description: 'The piece’s owner' },
  previous: { type: 'player', description: 'Previous holder (may be empty)' },
  with: { type: 'player', description: 'Trade partner (a player, or "bank")' },
  total: { type: 'number', description: 'Sum of the dice' },
  die0: { type: 'number', description: 'First die' },
  die1: { type: 'number', description: 'Second die' },
  event0: { type: 'any', description: 'Face of the first event die' },
  roll: { type: 'number', description: 'The number produced (empty when a single hex produced)' },
  amount: { type: 'number', description: 'How many' },
  hex: { type: 'location', description: 'The hex that produced' },
  at: { type: 'location', description: 'Where it happened' },
  piece: { type: 'any', description: 'The piece TYPE id (e.g. "settlement")' },
  from: { type: 'location', description: 'Previous location' },
  token: { type: 'any', description: 'Token id' },
  terrain: { type: 'any', description: 'Terrain id' },
  card: { type: 'any', description: 'Card id' },
  deck: { type: 'any', description: 'Deck id' },
  resource: { type: 'resource', description: 'Resource id' },
  award: { type: 'any', description: 'Award id' },
  pieceId: { type: 'piece', description: 'That exact piece' },
  steps: { type: 'number', description: 'Steps used (when moved with a range)' },
};

/** Per-event overrides where a var name means something else. */
const PAYLOAD_VAR_OVERRIDES: Partial<Record<BuiltinEvent, Record<string, Omit<EventVar, 'name'>>>> = {
  pieceUpgraded: { from: { type: 'any', description: 'The old piece TYPE id' } },
  pieceDowngraded: { from: { type: 'any', description: 'The type it was before' }, piece: { type: 'any', description: 'The new piece TYPE id (empty if removed)' } },
  playerProduction: { amount: { type: 'number', description: 'Resources received (0 = nothing)' } },
  tokenMoved: { at: { type: 'location', description: 'New location' }, from: { type: 'location', description: 'Previous location (may be empty)' } },
  hexRevealed: { at: { type: 'location', description: 'The hex' } },
};

const EVENT_TEXT: Record<BuiltinEvent, { label: string; description: string }> = {
  gameStart: { label: 'Game starts', description: 'Once, before setup begins.' },
  setupComplete: { label: 'Setup finished', description: 'After the last setup placement.' },
  turnStart: { label: 'Turn starts', description: 'At the start of each turn.' },
  turnEnd: { label: 'Turn ends', description: 'At the end of each turn.' },
  roundEnd: { label: 'Round ends', description: 'After every player has had a turn.' },
  diceRolled: { label: 'Dice rolled', description: 'Right after the dice are rolled. Each event die also fires an event named after the face rolled.' },
  production: { label: 'Production', description: 'When resources are produced.' },
  piecePlaced: { label: 'Piece placed', description: 'Whenever a piece is put on the board.' },
  pieceUpgraded: { label: 'Piece upgraded', description: 'Whenever a piece is upgraded.' },
  pieceRemoved: { label: 'Piece removed', description: 'Whenever a piece leaves the board.' },
  pieceMoved: { label: 'Piece moved', description: 'Whenever a piece moves.' },
  pieceDowngraded: { label: 'Piece downgraded', description: 'When a piece is reduced to a lesser one (city → settlement).' },
  playerProduction: { label: 'Player production', description: 'After each production, once per player: how many resources they received (0 = nothing).' },
  tokenMoved: { label: 'Token moved', description: 'Whenever a token (robber…) moves.' },
  hexRevealed: { label: 'Hex revealed', description: 'When a fog hex is flipped.' },
  cardDrawn: { label: 'Card drawn', description: 'When a card is drawn from a deck.' },
  cardPlayed: { label: 'Card played', description: 'When a card is played.' },
  resourceGained: { label: 'Resource gained', description: 'Whenever a player gains resources.' },
  resourceLost: { label: 'Resource lost', description: 'Whenever a player loses resources.' },
  tradeCompleted: { label: 'Trade completed', description: 'After any trade.' },
  awardChanged: { label: 'Award changed hands', description: 'When an award (Longest Road…) moves.' },
};

/** Every trigger also gets `event` (the event name). */
const EVENT_NAME_VAR: EventVar = { name: 'event', type: 'any', description: 'The event name' };

/** Type/description of payload var `name` of `event` (custom events: emit payload keys are numbers). */
export function payloadVar(event: string, name: string): EventVar {
  const info = PAYLOAD_VAR_OVERRIDES[event as BuiltinEvent]?.[name] ?? PAYLOAD_VAR_INFO[name] ?? { type: 'any' as VarType, description: name };
  return { name, ...info };
}

/**
 * Builtin trigger events and their payload vars, derived from the engine's EVENT_PAYLOAD_VARS
 * so the editor's var pickers always match what the engine binds.
 */
export const EVENTS: Record<BuiltinEvent, EventSpec> = Object.fromEntries(
  (Object.keys(EVENT_TEXT) as BuiltinEvent[]).map((ev) => [ev, {
    ...EVENT_TEXT[ev],
    vars: [...(EVENT_PAYLOAD_VARS[ev] ?? []).map((n) => payloadVar(ev, n)), EVENT_NAME_VAR],
  }]),
) as Record<BuiltinEvent, EventSpec>;

/**
 * Builtin lobby settings readable with {param} / {setting} besides mod SettingDefs
 * (mirrors LOBBY_KEYS in engine/context.ts).
 */
export const LOBBY_SETTINGS: { id: string; label: string }[] = [
  { id: 'victoryPoints', label: 'Points to win' },
  { id: 'discardLimit', label: 'Discard limit' },
  { id: 'maxPlayers', label: 'Max players' },
  { id: 'turnTimerSeconds', label: 'Turn timer (seconds)' },
  { id: 'friendlyRobber', label: 'Friendly robber' },
  { id: 'hideBankCards', label: 'Hide bank cards' },
  { id: 'randomizeTurnOrder', label: 'Randomize turn order' },
  { id: 'diceMode', label: 'Dice mode' },
  { id: 'mapId', label: 'Map' },
];

export const TURN_PHASES: TurnPhase[] = ['setup', 'preRoll', 'main', 'specialBuild', 'gameOver'];
export const LOCATION_KINDS: LocationKind[] = ['hex', 'vertex', 'edge'];
export const COMPARE_OPS = ['==', '!=', '<', '<=', '>', '>='] as const;

/* ------------------------------------------------------------------------ */
/*  Node helpers (shape-aware reading / writing)                             */
/* ------------------------------------------------------------------------ */

export function effectSpec(e: Effect): BlockSpec<Effect> | undefined {
  return (EFFECTS as unknown as Record<string, BlockSpec<Effect>>)[(e as { op?: string })?.op ?? ''];
}

export function conditionKind(c: Condition): ConditionKind | undefined {
  if (c === true) return 'true';
  if (c === false) return 'false';
  if (!c || typeof c !== 'object') return undefined;
  for (const k of Object.keys(c)) if (k in CONDITIONS && k !== 'true' && k !== 'false') return k as ConditionKind;
  return undefined;
}

export function exprKind(e: Expr): ExprKind | undefined {
  if (typeof e === 'number') return 'number';
  if (!e || typeof e !== 'object') return undefined;
  for (const k of Object.keys(e)) if (k in EXPRS && k !== 'number') return k as ExprKind;
  return undefined;
}

export function conditionSpec(c: Condition): BlockSpec<Condition> | undefined {
  const k = conditionKind(c);
  return k ? CONDITIONS[k] : undefined;
}
export function exprSpec(e: Expr): BlockSpec<Expr> | undefined {
  const k = exprKind(e);
  return k ? EXPRS[k] : undefined;
}

type Obj = Record<string, unknown>;

/** Read the params of a node into a flat {paramName: value} record. */
export function readParams(spec: BlockSpec<unknown>, node: unknown): Obj {
  const n = (node ?? {}) as Obj;
  switch (spec.shape) {
    case 'literal': return {};
    case 'flat': {
      const out: Obj = {};
      for (const p of spec.params) out[p.name] = n[p.name];
      return out;
    }
    case 'object': return { ...((n[spec.key] ?? {}) as Obj) };
    case 'value': return { [spec.params[0].name]: n[spec.key] };
    case 'list': return { [spec.params[0].name]: n[spec.key] ?? [] };
    case 'tuple': {
      const arr = (Array.isArray(n[spec.key]) ? n[spec.key] : []) as unknown[];
      const out: Obj = {};
      spec.params.forEach((p, i) => { out[p.name] = arr[i]; });
      return out;
    }
  }
}

/** Build a node from a flat param record (drops undefined optional fields). */
export function writeParams<T>(spec: BlockSpec<T>, values: Obj, original?: unknown): T {
  switch (spec.shape) {
    case 'literal': return spec.make();
    case 'flat': {
      const out: Obj = {};
      const orig = (original ?? {}) as Obj;
      const made = spec.make() as unknown;
      if (made && typeof made === 'object' && 'op' in made) out.op = (made as Obj).op;
      for (const p of spec.params) if (values[p.name] !== undefined) out[p.name] = values[p.name];
      // keep unknown extra fields the catalog doesn't know about
      for (const k of Object.keys(orig)) if (!(k in out) && k !== 'op' && !spec.params.some(p => p.name === k)) out[k] = orig[k];
      return out as T;
    }
    case 'object': {
      const inner: Obj = {};
      for (const p of spec.params) if (values[p.name] !== undefined) inner[p.name] = values[p.name];
      return { [spec.key]: inner } as T;
    }
    case 'value': return { [spec.key]: values[spec.params[0].name] } as T;
    case 'list': return { [spec.key]: values[spec.params[0].name] ?? [] } as T;
    case 'tuple': return { [spec.key]: spec.params.map(p => values[p.name] ?? p.default) } as T;
  }
}

/** Path segment (relative to the node) where a param's value lives — used for JSON-path navigation. */
export function paramPathSegments(spec: BlockSpec<unknown>, paramName: string): (string | number)[] {
  switch (spec.shape) {
    case 'flat': return [paramName];
    case 'object': return [spec.key, paramName];
    case 'value': case 'list': return [spec.key];
    case 'tuple': return [spec.key, spec.params.findIndex(p => p.name === paramName)];
    case 'literal': return [];
  }
}

/** A sensible empty value for a param kind (used when switching an optional param on). */
export function defaultForParam(p: ParamSpec): unknown {
  if (p.default !== undefined) return structuredClone(p.default);
  switch (p.kind) {
    case 'expr': return 1;
    case 'condition': return true;
    case 'effects': case 'exprList': case 'conditionList': case 'resourceIds': case 'numbers': return [];
    case 'resourceMap': case 'exprMap': case 'pieceQuery': case 'locationChoice': return {};
    case 'options': return [{ label: 'Option', do: [] }];
    case 'playerRef': return 'self';
    case 'playerFilter': return 'any';
    case 'boolean': return true;
    case 'number': return 0;
    case 'enum': return p.options?.[0] ?? '';
    case 'locationKind': return 'hex';
    case 'phases': return 'main';
    case 'compareOp': return '>=';
    case 'dice': return 'total';
    case 'pieceIds': case 'terrainIds': return p.multiple === 'list' ? [] : '';
    default: return '';
  }
}

/** Flat list of all blocks for a family, for searchable menus. */
export function blockList(family: 'effect' | 'condition' | 'expr'): BlockSpec<unknown>[] {
  const rec = family === 'effect' ? EFFECTS : family === 'condition' ? CONDITIONS : EXPRS;
  return Object.values(rec) as BlockSpec<unknown>[];
}
