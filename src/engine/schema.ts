/**
 * ============================================================================
 *  THE CONTRACT
 * ============================================================================
 * This file defines everything that a *mod* (a GameDefinition) can express,
 * plus the runtime shapes shared between engine, network, UI and editor.
 *
 * Design principles
 *  - The base game is itself just a mod (src/content/base). Nothing about
 *    "settlement", "road", "knight", "monopoly" is hard-coded in the engine.
 *  - Every rule is data built from a small vocabulary of composable blocks:
 *      Effect     – something that happens ("gain", "place", "repeat", ...)
 *      Condition  – a boolean test
 *      Expr       – a number (literal or formula)
 *      Trigger    – "when X happens, run these effects"
 *  - Effects that need a player decision (where to place, which resource,
 *    whom to rob) suspend the engine and raise a Prompt. The UI answers it
 *    with a `respond` command. The engine always computes the legal options,
 *    so the UI never re-implements rules.
 *  - Everything is JSON-serializable. Mods are plain .json files.
 *
 * Change policy: additive changes are fine (new ops, new optional fields).
 * Renames/removals must be coordinated because mods on disk depend on them.
 * ============================================================================
 */

export type Id = string;

/* ------------------------------------------------------------------------ */
/*  Board topology                                                           */
/* ------------------------------------------------------------------------ */

/** Axial hex coordinate. */
export interface HexCoord { q: number; r: number }
/** Canonical string ids (see engine/board/topology.ts): "h:q,r", "v:...", "e:..." */
export type HexId = string;
export type VertexId = string;
export type EdgeId = string;
export type LocationKind = 'hex' | 'vertex' | 'edge';
export type LocationId = HexId | VertexId | EdgeId;

/* ------------------------------------------------------------------------ */
/*  References used inside effects / conditions / expressions               */
/* ------------------------------------------------------------------------ */

/**
 * Who an effect applies to.
 *  'self'     – the player executing the effect (owner of the card/action/trigger)
 *  'current'  – the player whose turn it is
 *  'bank'     – only valid as a transfer source/target
 *  {var}      – a player bound earlier (e.g. by choosePlayer `as`)
 *  {ownerOf}  – owner of the piece at a bound location var (a piece instance id also works)
 */
export type PlayerRef =
  | 'self'
  | 'current'
  | 'bank'
  | { var: string }
  | { ownerOf: string };

/** Resource reference: literal id, or a var bound by chooseResource. */
export type ResourceRef = Id | { var: string };

/** Map resourceId -> amount (amount may be a formula). */
export type ResourceMap = Record<Id, Expr>;

/* ------------------------------------------------------------------------ */
/*  Expressions                                                              */
/* ------------------------------------------------------------------------ */

export type Expr =
  | number
  | { var: string }                       // bound variable (number)
  | { param: string }                     // lobby/mod setting value
  | { add: Expr[] }
  | { sub: [Expr, Expr] }
  | { mul: Expr[] }
  | { div: [Expr, Expr] }                 // floor division
  | { min: Expr[] }
  | { max: Expr[] }
  | { if: [Condition, Expr, Expr] }
  | { random: [Expr, Expr] }              // inclusive, uses seeded rng
  | { resourceCount: { player?: PlayerRef; resource?: ResourceRef | 'any'; kind?: ResourceKind } }
  | { pieceCount: PieceQuery }
  | { cardCount: { player?: PlayerRef; card?: Id; deck?: Id; played?: boolean } }
  | { stat: { player?: PlayerRef; key: string } }      // per-player counters (knightsPlayed, ...)
  | { global: string }                                 // global counters (barbarianPosition, ...)
  | { vp: PlayerRef }
  | { dice: 'total' | number }                         // last roll: total or die index
  | { playerCount: true }
  | { longestRoad: PlayerRef }                         // builtin graph metric
  /** A number stored on one piece (PieceInstance.state). `piece` is a var holding a piece instance id
   *  or a location id (first piece there). Missing piece/key = 0. */
  | { pieceState: { piece: string; key: string } }
  /** Sum of a state key over every piece matching the query (e.g. total strength of active knights:
   *  `{sumPieceState: {query: {tag: 'knight', owner: 'self', state: {active: 1}}, key: 'strength'}}`). */
  | { sumPieceState: { query: PieceQuery; key: string } }
  /** Amount of cargo carried by a piece (see loadCargo / addCargo). Omit `key` = total of all cargo. */
  | { cargoCount: { piece: string; key?: Id } }
  /** How many players satisfy `filter` (candidate bound as `as`). E.g. "nobody is stronger than p":
   *  `{cmp: [{countPlayers: {as: 'q', filter: {cmp: [strength(q), '>', strength(p)]}}}, '==', 0]}`. */
  | { countPlayers: { as: string; filter?: Condition } };

export interface PieceQuery {
  owner?: PlayerRef | 'any' | 'others';
  piece?: Id | Id[];
  /** Restrict to pieces adjacent to / located at a bound location var. */
  near?: string;
  /** Restrict to pieces touching hexes of these terrains. */
  onTerrain?: Id[];
  /** Pieces carrying a tag (see PieceDef.tags). */
  tag?: string;
  /** Pieces whose state has exactly these values (e.g. `{active: 1}`). Missing keys count as 0. */
  state?: Record<string, number>;
  /** Pieces on the same land region ("island") as the location in this var: a piece belongs to every
   *  region of the land hexes it touches. Regions = groups of non-water hexes joined by shared sides. */
  region?: string;
  /** Extra per-piece test. The candidate piece is bound as `candidate` (its location) and
   *  `candidateId` (its instance id); other vars stay visible. E.g. only pieces whose owner has more
   *  than 2 VP: `{cmp: [{vp: {ownerOf: 'candidateId'}}, '>', 2]}`. */
  where?: Condition;
}

/* ------------------------------------------------------------------------ */
/*  Conditions                                                               */
/* ------------------------------------------------------------------------ */

export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

export type Condition =
  | true
  | false
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { cmp: [Expr, CompareOp, Expr] }
  | { canAfford: { cost: ResourceMap; player?: PlayerRef } }
  | { isTurnOf: PlayerRef }
  | { phase: TurnPhase | TurnPhase[] }
  | { hasRolled: boolean }
  | { flag: string; player?: PlayerRef }                // boolean flags set by setFlag
  | { setting: string }                                 // boolean lobby setting is on
  | { samePlayer: [PlayerRef, PlayerRef] }
  | { varSet: string }
  /** A var holds exactly this id/text, e.g. on `piecePlaced`: `{varIs: {var: 'piece', value: 'settlement'}}`,
   *  on `awardChanged`: `{varIs: {var: 'award', value: 'longestRoad'}}`. (Numbers: use `cmp`.) */
  | { varIs: { var: string; value: string } }
  /** Location-scoped tests, used inside placement rules and choose filters. `at` is a var. */
  | { terrainIs: { at: string; terrain: Id | Id[] } }
  | { isWater: { at: string } }
  | { isCoastal: { at: string } }
  | { occupied: { at: string; piece?: Id | Id[]; owner?: PlayerRef | 'any' | 'others' } }
  | { adjacentTo: { at: string; piece?: Id | Id[]; owner?: PlayerRef | 'any' | 'others'; tag?: string } }
  | { connectedTo: { at: string; owner: PlayerRef; via?: Id[] } } // network reachability
  /** `minDistance` = minimum number of edges between `at` and any building (piece tagged 'building'
   *  or with productionMultiplier > 0). Default 2 = standard rule (adjacent vertices forbidden). */
  | { distanceRule: { at: string; minDistance?: number } }
  /** The token sits on `at` (with `near: true`: on `at` or on any location adjacent to it, e.g. a pirate
   *  on a hex blocks all six of its edges). */
  | { hasToken: { at: string; token: Id; near?: boolean } }
  | { hexNumberIn: { at: string; numbers: number[] } }
  /** Two bound location vars are adjacent (hex/vertex/edge incidence or neighbors). Used e.g. by the
   *  setup road rule: `{ isAdjacent: ['at', 'lastPlaced'] }` (engine binds `lastPlaced` during setup). */
  | { isAdjacent: [string, string] }
  /** The network piece at edge `at` sits at an OPEN END of its owner's route: at least one endpoint has
   *  no piece of the owner and no other edge of the owner's network (`via` piece types; default: pieces
   *  sharing the network of the piece at `at`). Seafarers: only such ships may move.
   *  `owner` defaults to the owner of the piece at `at`. */
  | { isNetworkEnd: { at: string; owner?: PlayerRef; via?: Id[] } }
  /** Two bound locations touch a common land region ("island"). See PieceQuery.region. */
  | { sameRegion: [string, string] }
  /** The location touches a hex that the map marks with this tag (MapDef hex `tags`): a hex tests itself,
   *  a vertex/edge tests ANY touching on-board hex. E.g. Seafarers: no starting settlement on an island the
   *  map tags 'foreign': `{not: {hexTag: {at: 'at', tag: 'foreign'}}}`. */
  | { hexTag: { at: string; tag: string } };

/* ------------------------------------------------------------------------ */
/*  Effects                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * Selector for a location the player must pick (or a pre-bound var).
 * If `at` is given, no prompt is raised.
 */
export interface LocationChoice {
  /** Use a previously bound location instead of prompting. */
  at?: string;
  /** Extra restriction on top of the piece's own placement rules. */
  where?: Condition;
  /** Prompt label shown to the player. */
  label?: string;
}

/**
 * Variable binding conventions (engine decisions, the editor relies on these):
 *  - `as` on place / upgrade / remove / moveToken / movePiece binds the LOCATION id (vertex/edge/hex id)
 *    the piece/token ended up at (null if nothing happened). To reach the piece, use location-scoped
 *    conditions (`occupied`, `{ownerOf: <var>}`) or `setPieceState { at: <var> }`.
 *  - setPieceState.at is a LOCATION var (the first piece at that location is modified).
 *  - Choose filters see the CANDIDATE under the op's own `as` name:
 *      choosePlayer.filter  -> `{var: <as>}` is the candidate player id
 *      chooseLocation.filter / choosePiece.filter -> `<as>` is the candidate location id
 *      forEachPlayer.filter -> `{var: <as>}` is the candidate player
 *    (`at` is NOT rebound, so an enclosing `at`, e.g. the robber hex in TokenDef.onMove, stays visible.)
 *  - LocationChoice.where, PlacementRule.where/setupWhere and TokenDef.where see the candidate as `at`.
 *  - During setup the engine binds `lastPlaced` = location of the previous piece placed this setup turn.
 *  - Action effects get `piece` (location) and `pieceId` for piece actions; card effects get `card`.
 *  - choosePlayer without a filter offers every player except `self`. Empty option lists bind null
 *    and continue (use `{varSet}` to test); they never deadlock.
 *  - PIECE IDS: `asId` on place / upgrade / downgrade / choosePiece / movePiece / forEachPiece binds the
 *    piece INSTANCE id. Anywhere a location var is expected (`at`, `near`, `ownerOf`, `piece`...), a var
 *    holding a piece instance id also works and means "that exact piece" / "where that piece is".
 *  - chooseMany binds `as` to each picked item in turn while running `do` (a loop var), and `countAs`
 *    (if given) to how many were picked.
 *  - movePiece.path sees the next step as `at`, the previous location as `prev` and the connecting
 *    location as `via` (the edge between two vertices, the vertex between two edges, the side between
 *    two hexes).
 */
export type Effect =
  /* --- control flow --- */
  | { op: 'sequence'; do: Effect[] }
  | { op: 'repeat'; times: Expr; do: Effect[]; as?: string }      // as = loop index var
  | { op: 'if'; cond: Condition; then: Effect[]; else?: Effect[] }
  | { op: 'forEachPlayer'; filter?: Condition; as: string; do: Effect[]; order?: 'turn' | 'simultaneous' }
  | { op: 'forEachPiece'; query: PieceQuery; as: string; do: Effect[]; asId?: string }
  /** Run `do` for every board location of `kind` passing `filter` (candidate bound as `as`), in board
   *  order. E.g. reveal every hidden hex next to a ship: kind 'hex', filter isAdjacent [as, 'ship']. */
  | { op: 'forEachLocation'; kind: LocationKind; as: string; do: Effect[]; filter?: Condition }
  | { op: 'chooseOption'; player?: PlayerRef; label?: string; options: { label: string; cond?: Condition; do: Effect[] }[] }
  | { op: 'setVar'; name: string; value: Expr }
  | { op: 'emit'; event: string; payload?: Record<string, Expr> } // fires custom triggers
  | { op: 'log'; text: string }
  | { op: 'abortIf'; cond: Condition; message?: string }           // cancel the whole action (refund)

  /* --- player choices (bind a var, raise a prompt) --- */
  | { op: 'choosePlayer'; player?: PlayerRef; as: string; filter?: Condition; label?: string; optional?: boolean }
  | { op: 'chooseResource'; player?: PlayerRef; as: string; options?: Id[]; kind?: ResourceKind; label?: string }
  | { op: 'chooseLocation'; player?: PlayerRef; as: string; kind: LocationKind; filter: Condition; label?: string; optional?: boolean }
  | { op: 'choosePiece'; player?: PlayerRef; as: string; query: PieceQuery; filter?: Condition; label?: string; optional?: boolean; asId?: string }
  /** Multi-select: `player` picks up to `count` DISTINCT items of one kind, one prompt at a time
   *  (after `min` picks, default = count, they may stop). Then `do` runs once per picked item with `as`
   *  bound to it. `of` picks players / locations (`kind`) / pieces (`query`, binds their location) /
   *  resource types (`options`). `filter` sees the candidate as `as`. */
  | { op: 'chooseMany'; of: 'player' | 'location' | 'piece' | 'resource'; player?: PlayerRef; count: Expr; min?: Expr; as: string; do: Effect[];
      filter?: Condition; kind?: LocationKind; query?: PieceQuery; options?: Id[]; label?: string; countAs?: string }

  /* --- resources --- */
  | { op: 'gain'; player?: PlayerRef; resources: ResourceMap }     // from bank (limited by bank supply)
  | { op: 'pay'; player?: PlayerRef; resources: ResourceMap }      // to bank (fails if unaffordable)
  | { op: 'transfer'; from: PlayerRef; to: PlayerRef; resource: ResourceRef | 'random' | 'choice'; amount: Expr }
  | { op: 'steal'; from: PlayerRef; to?: PlayerRef; amount?: Expr }  // random card(s)
  | { op: 'discard'; player: PlayerRef; amount: Expr; kind?: ResourceKind } // player chooses which
  | { op: 'chooseAndGain'; player?: PlayerRef; amount: Expr; options?: Id[]; kind?: ResourceKind } // year-of-plenty style
  | { op: 'produce'; roll?: Expr; hex?: string; player?: PlayerRef } // run production for a number or one hex

  /* --- pieces & board --- */
  | { op: 'place'; piece: Id; player?: PlayerRef; free?: boolean; ignoreConnection?: boolean; location?: LocationChoice; as?: string; asId?: string }
  | { op: 'upgrade'; from: Id | Id[]; to: Id; player?: PlayerRef; free?: boolean; location?: LocationChoice; as?: string; asId?: string }
  /** Replace one of `player`'s pieces of a `from` type with a lesser `to` piece at the same spot (city ->
   *  settlement). Free, ignores placement rules. `player` (default self) owns the piece and chooses it.
   *  If `to` has no supply left the piece is simply removed. Fires `pieceDowngraded`. Cargo is kept. */
  | { op: 'downgrade'; from: Id | Id[]; to: Id; player?: PlayerRef; location?: LocationChoice; as?: string; asId?: string }
  | { op: 'remove'; query: PieceQuery; location?: LocationChoice; returnToSupply?: boolean; as?: string }
  /**
   * Move a piece. `player` (default self) chooses the piece (from) and the destination (to); this may
   * be another player, e.g. `{ownerOf: 'spot'}` to make a displaced knight's owner relocate it.
   * Destinations must satisfy the piece's own placement rules for its owner (evaluated with the piece
   * lifted off the board) unless `anywhere` is true, plus `to.where`.
   * Range: with `maxSteps` the destination must be reachable in at most that many steps between
   * neighbouring locations of the piece's kind, every step satisfying `path` (see binding conventions).
   * `stepsAs` binds the steps used (for per-step costs / movement points). `as` binds the new location
   * (null if nothing moved), `asId` the piece id. Cargo travels with the piece.
   */
  | { op: 'movePiece'; query: PieceQuery; from?: LocationChoice; to?: LocationChoice; player?: PlayerRef; anywhere?: boolean;
      maxSteps?: Expr; path?: Condition; stepsAs?: string; as?: string; asId?: string }
  | { op: 'setPieceState'; at: string; key: string; value: Expr }  // e.g. knight active=1, strength=2
  /** Move resource cards from a player's hand onto a piece (a wagon, a ship). 'choice' = the player
   *  picks which resource. Moves at most what they hold. Cargo resources return to the bank if the
   *  piece leaves the board. */
  | { op: 'loadCargo'; piece: string; player?: PlayerRef; resource: ResourceRef | 'choice'; amount?: Expr }
  /** Move resource cargo off a piece into a player's hand (`to`, default self; 'bank' = return it).
   *  `resource` omitted / 'all' = every resource carried. `amount` omitted = all of it. */
  | { op: 'unloadCargo'; piece: string; to?: PlayerRef; resource?: ResourceRef | 'all'; amount?: Expr }
  /** Add (or with a negative amount, remove) abstract goods carried by a piece, e.g. a 'settler' on a
   *  ship or 'spice' on a wagon. Not taken from anyone's hand. Never goes below 0. */
  | { op: 'addCargo'; piece: string; key: Id; amount: Expr }
  | { op: 'moveToken'; token: Id; to?: LocationChoice; as?: string }
  | { op: 'setTerrain'; at: string; terrain: Id }                   // fog reveal, terraforming
  | { op: 'setHexNumber'; at: string; number: Expr | null }
  | { op: 'revealHex'; at: string }                                 // fog of war

  /* --- cards --- */
  | { op: 'drawCard'; deck: Id; player?: PlayerRef; count?: Expr }
  | { op: 'giveCard'; card: Id; player?: PlayerRef }                 // from supply, not a deck
  | { op: 'discardCard'; player?: PlayerRef; card?: Id; choose?: boolean }
  | { op: 'shuffleDeck'; deck: Id }

  /* --- scoring, stats & state --- */
  | { op: 'addVP'; player?: PlayerRef; amount: Expr; reason?: string } // permanent "tokens" VP
  | { op: 'addStat'; player?: PlayerRef; key: string; amount: Expr }
  | { op: 'setStat'; player?: PlayerRef; key: string; value: Expr }
  | { op: 'addGlobal'; key: string; amount: Expr }
  | { op: 'setGlobal'; key: string; value: Expr }
  | { op: 'setFlag'; player?: PlayerRef; flag: string; value: boolean; until?: 'endOfTurn' | 'endOfRound' | 'forever' }
  | { op: 'grantTradeRate'; player?: PlayerRef; resource: ResourceRef | 'any'; ratio: number; until?: 'endOfTurn' | 'forever' }

  /* --- turn flow --- */
  | { op: 'rollDice' }
  | { op: 'extraBuildPhase' }      // 5-6 player special building phase
  | { op: 'endTurn' }
  | { op: 'win'; player?: PlayerRef };

export type EffectOp = Effect['op'];

/* ------------------------------------------------------------------------ */
/*  Triggers                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * Builtin events emitted by the engine. Custom strings (from `emit`) also work; their payload vars
 * are the `emit` payload keys plus `player` (the emitter).
 * Every trigger also gets `event` (the event name). Payload vars per builtin event: see
 * EVENT_PAYLOAD_VARS below. Player-valued vars hold player ids, location vars hold location ids,
 * `piece`/`from` hold piece TYPE ids, `card` a card def id.
 *
 * Event dice: rolling fires `diceRolled` with `event0`, `event1`... = the face strings of the event
 * dice (also `eventDie_<dieId>`), and then fires one custom event per event die NAMED BY ITS FACE
 * string (payload: total, player, face). E.g. a face 'barbarian' fires triggers with `on: 'barbarian'`.
 */
export type BuiltinEvent =
  | 'gameStart' | 'setupComplete'
  | 'turnStart' | 'turnEnd' | 'roundEnd'
  | 'diceRolled' | 'production'
  | 'piecePlaced' | 'pieceUpgraded' | 'pieceRemoved' | 'pieceMoved' | 'pieceDowngraded'
  | 'playerProduction'
  | 'tokenMoved' | 'hexRevealed'
  | 'cardDrawn' | 'cardPlayed'
  | 'resourceGained' | 'resourceLost'
  | 'tradeCompleted' | 'awardChanged';

export const EVENT_PAYLOAD_VARS: Record<BuiltinEvent, string[]> = {
  gameStart: [],
  setupComplete: [],
  turnStart: ['player'],
  turnEnd: ['player'],
  roundEnd: [],
  diceRolled: ['total', 'player', 'die0', 'die1', 'event0'],   // dieN per numeric die, eventN per event die
  production: ['roll', 'hex'],                                  // roll = number rolled (null when one hex produced)
  piecePlaced: ['piece', 'at', 'owner', 'player', 'pieceId'],
  pieceUpgraded: ['from', 'piece', 'at', 'owner', 'player', 'pieceId'],
  pieceRemoved: ['piece', 'at', 'owner', 'player', 'pieceId'],
  pieceMoved: ['piece', 'from', 'at', 'owner', 'player', 'pieceId', 'steps'], // `from` = previous location; steps null without maxSteps
  pieceDowngraded: ['from', 'piece', 'at', 'owner', 'player', 'pieceId'],    // piece = the new type (null if removed)
  /** After every production run, once per player (turn order): amount = total resources received
   *  (0 = nothing, e.g. for an "aqueduct" rule), including owed gold-field picks. */
  playerProduction: ['player', 'amount', 'roll', 'hex'],
  tokenMoved: ['token', 'at', 'from', 'player'],               // `from` = previous location (or null)
  hexRevealed: ['at', 'terrain', 'player'],
  cardDrawn: ['card', 'deck', 'player'],
  cardPlayed: ['card', 'deck', 'player'],
  resourceGained: ['player', 'resource', 'amount'],
  resourceLost: ['player', 'resource', 'amount'],
  tradeCompleted: ['player', 'with'],                          // with = player id or 'bank'
  awardChanged: ['award', 'player', 'previous'],               // player/previous may be null
};

export interface TriggerDef {
  id: Id;
  on: BuiltinEvent | string;
  /** Only fire if this holds (payload vars are bound). */
  when?: Condition;
  /** Whose perspective 'self' refers to. Default 'current'. For piece events, the owner. */
  as?: 'current' | 'eventPlayer' | 'eachPlayer';
  do: Effect[];
  /** Lower runs first. Default 0. */
  priority?: number;
}

/* ------------------------------------------------------------------------ */
/*  Definitions (the content of a mod)                                       */
/* ------------------------------------------------------------------------ */

export type ResourceKind = 'resource' | 'commodity' | string;

export interface ResourceDef {
  id: Id;
  name: string;
  color: string;          // css color
  icon?: string;          // icon key (see ui/icons) or emoji
  kind: ResourceKind;     // standard bank-trade rates apply per kind
  bankSupply: number;     // -1 = unlimited
}

export interface TerrainDef {
  id: Id;
  name: string;
  color: string;
  icon?: string;
  water?: boolean;
  /** What a vertex piece with productionMultiplier 1 gets when this hex's number rolls. */
  produces?: ResourceMap;
  /** Whether this terrain receives a number token on generated maps. */
  numbered?: boolean;
  /** Gold field style: player chooses resource(s) instead. */
  producesChoice?: { amount: number; options?: Id[] };
  /** Fog: shown as hidden until revealed. */
  hidden?: boolean;
}

export interface PlacementRule {
  /** Where on the board this piece sits. */
  on: LocationKind;
  /** Must be true for a location to be legal (bound var `at` = candidate location). */
  where: Condition;
  /** Looser rules used during the setup phase (default: same as `where` minus connection). */
  setupWhere?: Condition;
}

export interface PieceDef {
  id: Id;
  name: string;
  icon?: string;
  /** Per-player supply. -1 = unlimited. */
  supply: number;
  placement: PlacementRule;
  /** Cost to build via the standard "build" action. Omit = not directly buildable. */
  cost?: ResourceMap;
  /** If set, building this replaces a piece of one of these types at the same location. */
  upgradesFrom?: Id[];
  vp?: number;
  /** Resource multiplier for production on adjacent hexes (settlement 1, city 2). Works for corner
   *  pieces (3 hexes), edge pieces (the 2 hexes beside the edge) and hex pieces (that hex). */
  productionMultiplier?: number;
  /** Extra production rules (e.g. C&K city on forest also gives paper). */
  productionBonus?: { terrain: Id; gives: ResourceMap }[];
  /** Counts as a link for longest-road style networks. */
  network?: Id;               // e.g. 'roads' (roads + ships could share 'trade-route')
  /** Breaks other players' networks when placed on a vertex. Default true for vertex pieces. */
  breaksNetworks?: boolean;
  /** For mixed networks (e.g. roads and ships sharing network 'route'): where a route may switch
   *  between this piece type and a different piece type. 'anyVertex' (default) = anywhere;
   *  'ownPiece' = only at a vertex holding one of the owner's pieces (Seafarers: road <-> ship only
   *  via a settlement). Used by the longest-route metric; for placement use `connectedTo.via`. */
  networkSwitchAt?: 'anyVertex' | 'ownPiece';
  tags?: string[];            // free-form, e.g. 'knight', 'building', 'ship'
  /** Initial per-piece state (knight strength, active...). */
  initialState?: Record<string, number>;
  /** Actions available on an owned piece (e.g. activate knight, move ship). */
  pieceActions?: Id[];
  /** Triggers attached to this piece type. */
  triggers?: TriggerDef[];
}

export interface CardDef {
  id: Id;
  name: string;
  description: string;
  icon?: string;
  /** When it may be played. */
  play: {
    timing: 'ownTurn' | 'ownTurnBeforeRoll' | 'ownTurnAfterRoll' | 'anyTime' | 'never' | 'immediate';
    /** Cannot be played the turn it was acquired. Default true for ownTurn timings. */
    notOnAcquiredTurn?: boolean;
    /** Shares a "one per turn" budget with other cards in the same group. */
    limitGroup?: string;
    cond?: Condition;
  };
  effect: Effect[];
  /** Hidden VP while held (Victory Point card). */
  vp?: number;
  /** Stat to increment when played (e.g. 'knightsPlayed' for largest army). */
  countsAs?: string;
  /** After play: discard to deck bottom / removed / stays in front of player. */
  afterPlay?: 'discard' | 'returnToDeck' | 'keepFaceUp';
  /** Max copies held at once (C&K hand limit is per deck, see DeckDef). */
}

export interface DeckDef {
  id: Id;
  name: string;
  color?: string;
  cards: { card: Id; count: number }[];
  /** Cost to buy one card via the standard "buy card" action. Omit = cannot be bought. */
  cost?: ResourceMap;
  /** Cards are visible to everyone in front of the holder. */
  public?: boolean;
  /** Max cards from this deck in hand. */
  handLimit?: number;
  reshuffleDiscards?: boolean;
}

/** A named player action — "recipes" live here. Shows up as a button in the UI. */
export interface ActionDef {
  id: Id;
  name: string;
  description?: string;
  icon?: string;
  cost?: ResourceMap;
  /** Who can see/press it and when. */
  available: Condition;
  effect: Effect[];
  /** Max uses per turn (undefined = unlimited). */
  limitPerTurn?: number;
  /** Shown in a group in the action bar. */
  group?: 'build' | 'cards' | 'trade' | 'special' | string;
}

export interface TokenDef {
  id: Id;
  name: string;
  icon?: string;
  on: LocationKind;
  /** Legal positions when moved. Var `at` is the candidate. */
  where: Condition;
  /** Hexes with this token do not produce. */
  blocksProduction?: boolean;
  /** Effects run after the token is moved (e.g. steal from adjacent player). `at` is bound. */
  onMove?: Effect[];
  /** Initial placement on map generation: 'firstOfTerrain' = the first hex (in map order) whose
   *  terrain is `startTerrain`; 'none' / omitted = off the board until moved. */
  start?: 'firstOfTerrain' | 'none';
  startTerrain?: Id;
}

export interface AwardDef {
  id: Id;
  name: string;
  vp: number;
  /** Per-player score, evaluated once per player with `self` = the player being scored.
   *  The award goes to the strictly highest player >= min. */
  metric: Expr;
  min: number;
  /** Holder keeps it on ties (true for Longest Road / Largest Army). */
  holderKeepsOnTie?: boolean;
  /** 'highest' (default): re-evaluated all the time; the holder loses it when no longer qualifying.
   *  'keepUntilBeaten': once won, the holder keeps it (even if their own score drops, even below `min`)
   *  until another player's score STRICTLY exceeds the holder's (C&K metropolis). */
  mode?: 'highest' | 'keepUntilBeaten';
}

export interface PortDef {
  id: Id;
  /** Resource this port trades, or 'any' (3:1 generic). */
  resource: Id | 'any';
  ratio: number;
}

export interface DiceDef {
  /** Standard numeric dice summed for production. */
  numeric: { sides: number }[];
  /** Optional extra dice whose faces fire events (C&K event die). */
  eventDice?: { id: Id; faces: string[] }[];
  /** Lobby can switch to "balanced" (deck-of-dice) mode. */
}

/** A turn's built-in phases. Mods hook in with triggers; they don't replace the skeleton. */
export type TurnPhase = 'setup' | 'preRoll' | 'main' | 'specialBuild' | 'gameOver';

export interface SetupRound {
  /** Pieces each player places in order this round. */
  place: { piece: Id; free?: boolean }[];
  order: 'forward' | 'reverse';
  /** Grant resources from hexes adjacent to the last vertex piece placed (2nd settlement rule). */
  grantStartingResources?: boolean;
}

export interface TradeRules {
  /** Default bank rate per resource kind (resource 4, commodity 4). */
  bankRates: Record<ResourceKind, number>;
  playerTrading: boolean;
  /** Only the current player may initiate trades. */
  onlyCurrentPlayer: boolean;
}

/** Declares a lobby setting the mod exposes; readable via {param} / {setting}. */
export interface SettingDef {
  id: Id;
  name: string;
  type: 'number' | 'boolean' | 'select';
  default: number | boolean | string;
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
}

/** A map the lobby can pick. */
export interface MapDef {
  id: Id;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  /** Fixed hexes. `terrain` may be a bag name prefixed with '@' to draw randomly. */
  /** `hidden`: the hex starts face-down (fog) whatever its terrain, until a `revealHex`.
   *  `tags`: free-form marks copied to HexState.tags and tested with the `hexTag` condition
   *  (e.g. 'foreign' islands where players may not start). */
  hexes: { q: number; r: number; terrain: Id; number?: number | '@'; port?: { port: Id | '@'; side: number }; hidden?: boolean; tags?: string[] }[];
  /** Bags used for random terrain and number assignment. */
  terrainBags?: Record<string, Id[]>;
  numberBag?: number[];
  portBag?: Id[];
  /** Forbid adjacent 6/8 when shuffling numbers. */
  noAdjacentRedNumbers?: boolean;
}

export interface ModMeta {
  id: Id;
  name: string;
  version: string;
  author?: string;
  description?: string;
  /** Mods applied before this one (usually ['base']). */
  extends?: Id[];
}

/**
 * A mod. Each collection is merged by id onto whatever it extends:
 * same id = replace, new id = add, listed in `remove` = delete.
 */
export interface ModDef {
  meta: ModMeta;
  resources?: ResourceDef[];
  terrains?: TerrainDef[];
  pieces?: PieceDef[];
  cards?: CardDef[];
  decks?: DeckDef[];
  actions?: ActionDef[];
  tokens?: TokenDef[];
  awards?: AwardDef[];
  ports?: PortDef[];
  maps?: MapDef[];
  triggers?: TriggerDef[];
  settings?: SettingDef[];
  dice?: DiceDef;
  setup?: SetupRound[];
  trade?: Partial<TradeRules>;
  /** Base victory point target (lobby can override). */
  victoryPoints?: number;
  /** Discard limit on 7 (lobby can override). */
  discardLimit?: number;
  remove?: Partial<Record<CollectionKey, Id[]>>;
}

export type CollectionKey =
  | 'resources' | 'terrains' | 'pieces' | 'cards' | 'decks' | 'actions'
  | 'tokens' | 'awards' | 'ports' | 'maps' | 'triggers' | 'settings';

/** The fully merged result of base + mods. Everything required. */
export interface GameDefinition {
  mods: ModMeta[];
  resources: ResourceDef[];
  terrains: TerrainDef[];
  pieces: PieceDef[];
  cards: CardDef[];
  decks: DeckDef[];
  actions: ActionDef[];
  tokens: TokenDef[];
  awards: AwardDef[];
  ports: PortDef[];
  maps: MapDef[];
  triggers: TriggerDef[];
  settings: SettingDef[];
  dice: DiceDef;
  setup: SetupRound[];
  trade: TradeRules;
  victoryPoints: number;
  discardLimit: number;
}

/* ------------------------------------------------------------------------ */
/*  Lobby                                                                    */
/* ------------------------------------------------------------------------ */

/** colonist.io-style room settings. Host edits, everyone sees. */
export interface LobbySettings {
  mapId: Id;
  maxPlayers: number;               // 2..8
  victoryPoints: number;
  discardLimit: number;
  diceMode: 'random' | 'balanced';
  friendlyRobber: boolean;          // can't rob players with <= 2 VP
  hideBankCards: boolean;
  turnTimerSeconds: number;         // 0 = off
  randomizeTurnOrder: boolean;
  /** Mod ids applied in order on top of 'base'. Full ModDefs travel with the room. */
  mods: Id[];
  /** Values for mod-declared SettingDefs. */
  modSettings: Record<Id, number | boolean | string>;
}

export interface LobbyPlayer {
  id: string;           // stable per browser (localStorage)
  name: string;
  color: string;
  isHost: boolean;
  connected: boolean;
  ready: boolean;
}

/* ------------------------------------------------------------------------ */
/*  Runtime state                                                            */
/* ------------------------------------------------------------------------ */

export interface PieceInstance {
  id: string;
  type: Id;
  owner: string;          // player id
  at: LocationId;
  state: Record<string, number>;
  /** Goods carried by the piece (resource ids or free keys); see loadCargo / addCargo. */
  cargo?: Record<Id, number>;
}

export interface CardInstance {
  id: string;
  card: Id;
  deck: Id;
  acquiredTurn: number;
}

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  resources: Record<Id, number>;
  hand: CardInstance[];
  played: CardInstance[];
  stats: Record<string, number>;
  flags: Record<string, { value: boolean; until: 'endOfTurn' | 'endOfRound' | 'forever' }>;
  tokenVP: number;
  tradeRates: { resource: Id | 'any'; ratio: number; until: 'endOfTurn' | 'forever' }[];
  actionUses: Record<Id, number>;   // reset each turn
  cardPlaysThisTurn: Record<string, number>; // by limitGroup
}

export interface HexState {
  id: HexId;
  coord: HexCoord;
  terrain: Id;
  number: number | null;
  revealed: boolean;
  /** Marks from the map (MapDef hex `tags`), tested by the `hexTag` condition. */
  tags?: string[];
}

export interface PortInstance {
  port: Id;
  /** The two vertices that grant this port. */
  vertices: [VertexId, VertexId];
  hex: HexId;
  side: number;
}

export interface Prompt {
  id: string;
  player: string;
  kind: 'location' | 'player' | 'resource' | 'option' | 'discard' | 'card' | 'piece' | 'tradeResponse';
  label: string;
  /** Legal answers. For locations: location ids; resources: ids; options: indexes as strings. */
  options: string[];
  /** For discard: how many to discard. */
  amount?: number;
  optional?: boolean;
  /** Human-readable labels parallel to `options` (chooseOption labels, player names...). */
  optionLabels?: string[];
  /** Piece being placed/moved, for UI previews of location prompts. */
  piece?: Id;
}

export interface TradeOffer {
  id: string;
  from: string;
  /** Specific players or null = everyone. */
  to: string[] | null;
  give: Record<Id, number>;
  get: Record<Id, number>;
  responses: Record<string, 'accept' | 'reject' | 'pending'>;
}

export interface LogEntry {
  turn: number;
  player?: string;
  text: string;
}

export interface GameState {
  /** Monotonic, increments on every applied command. Used for sync. */
  version: number;
  seed: number;
  rngState: number;
  settings: LobbySettings;
  players: PlayerState[];
  turnOrder: string[];
  currentPlayerIndex: number;
  turn: number;
  phase: TurnPhase;
  /** Setup progress: which round and step. */
  setupProgress?: { round: number; playerIndex: number; step: number };
  hasRolled: boolean;
  lastRoll: { dice: number[]; event?: string[]; total: number } | null;
  hexes: Record<HexId, HexState>;
  pieces: PieceInstance[];
  tokens: Record<Id, LocationId | null>;
  ports: PortInstance[];
  decks: Record<Id, { draw: string[]; discard: string[] }>;  // card def ids
  bank: Record<Id, number>;
  globals: Record<string, number>;
  awards: Record<Id, string | null>;
  /** Pending player decisions. The engine is suspended until the head is answered. */
  prompts: Prompt[];
  /** Serialized interpreter continuation (engine-internal). */
  stack: unknown[];
  trades: TradeOffer[];
  log: LogEntry[];
  winner: string | null;
  /** Engine-internal id counter (pieces, cards, prompts, trades). */
  idCounter?: number;
  /** Balanced dice mode: remaining shuffled combination indexes (hidden by redaction). */
  diceDeck?: number[];
  /** Special building phase in progress: builders still to go, and the index of the turn player. */
  specialBuild?: { queue: string[]; turnPlayerIndex: number };
  /** ms timestamp when the current turn (or setup placement) began; set from the optional `now`
   *  argument of createGame/applyCommand (the engine never reads the clock itself). */
  turnStartedAt?: number;
}

/* ------------------------------------------------------------------------ */
/*  Commands (client -> host)                                                */
/* ------------------------------------------------------------------------ */

export type Command =
  | { type: 'rollDice' }
  | { type: 'build'; piece: Id }                      // starts placement prompt
  | { type: 'buyCard'; deck: Id }
  | { type: 'playCard'; cardInstance: string }
  | { type: 'doAction'; action: Id; pieceId?: string }
  | { type: 'respond'; promptId: string; answer: string | string[] | Record<Id, number> | null }
  | { type: 'bankTrade'; give: Record<Id, number>; get: Record<Id, number> }
  | { type: 'offerTrade'; to: string[] | null; give: Record<Id, number>; get: Record<Id, number> }
  | { type: 'respondTrade'; tradeId: string; accept: boolean }
  | { type: 'confirmTrade'; tradeId: string; withPlayer: string }
  | { type: 'cancelTrade'; tradeId: string }
  | { type: 'endTurn' };

export type CommandResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };
