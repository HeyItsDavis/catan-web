# Modding guide

This guide is for game designers. It explains how rules are built in this game and gives
recipes you can copy. You don't need to write code: every rule is a small block of data. The
mod editor shows the same blocks with plain-language labels. The JSON in this guide is what
the editor saves.

The base game is a mod too (`src/content/base/index.ts`). Anything you see there, you can
change, replace or remove.

---

## 1. The building blocks

A mod is a collection of **definitions**:

| Definition | What it is | Examples |
|---|---|---|
| Resource | A card type in players' hands | brick, wool, cloth, coin |
| Terrain | A hex type and what it produces | forest → lumber, gold field → any |
| Piece | Something placed on the board | road, settlement, ship, knight, wagon |
| Card / Deck | Cards players draw and play | Knight, Monopoly, progress cards |
| Action | A button the player can press (a "recipe") | "Smoke fish: 2 fish + 1 lumber → 2 grain" |
| Token | A single movable marker | robber, pirate, merchant |
| Award | A title that goes to the leader | Longest Road, Largest Army, Metropolis |
| Trigger | "When X happens, do Y" | "When a 7 is rolled, discard and move the robber" |
| Map | A board layout | the standard island, an archipelago |
| Setting | A lobby option | "friendly robber", "barbarian strength" |

Rules inside those definitions use three kinds of blocks:

* **Steps** (effects) do something: *gain*, *place a piece*, *repeat*, *choose a player*…
* **Checks** (conditions) are yes/no questions: *is it my turn?*, *is this spot on the coast?*
* **Numbers** (expressions) are values or formulas: `2`, *my victory points*, *number of my cities × 2*.

You can nest blocks freely. For example, a step can repeat other steps, a check can combine
other checks with *all of* / *any of* / *not*, and a number can add other numbers.

---

## 2. Players: "you", "the current player", and named players

Every rule runs **on behalf of** someone, called **you** (`self`):

* the player who pressed the action button or played the card;
* for a trigger: the current player by default. Set *Runs for* to `eventPlayer` to run it for
  the player the event is about (for example, the player who received resources), or to
  `eachPlayer` to run it once for every player;
* for a piece's own trigger: the piece's owner.

Other ways to say "which player": `current` (whose turn it is), `bank`, a remembered player
(`{var: 'victim'}`), or *the owner of …* a remembered piece or spot (`{ownerOf: 'spot'}`).

---

## 3. Variables: remembering things

Many steps can **remember** what happened under a name (the *Remember as* field, `as` in JSON).
Later steps can then use that name.

| Step | Remembers |
|---|---|
| Choose a player (`choosePlayer`) | the player |
| Choose a resource (`chooseResource`) | the resource type |
| Choose a location (`chooseLocation`) | the hex / corner / edge |
| Choose a piece (`choosePiece`) | the piece's spot; with *Remember the piece as* (`asId`), the exact piece |
| Choose several (`chooseMany`) | each pick in turn, while its steps run; *Remember how many* (`countAs`) |
| Place / upgrade / downgrade / move a piece | the spot it ended up on; `asId` = the exact piece |
| Repeat | the round number (0, 1, 2…) |
| For each player / piece / location | the player / piece (spot; `asId` = the exact piece) / location of this round |
| Set variable (`setVar`) | a number |

Rules for names:

* A **spot** variable and a **piece** variable can be used in the same places. If you give a
  piece where a spot is expected, it means "where that piece is". If you give a spot where a
  piece is expected, it means "the piece on that spot".
* If a choice has no options (for example, nobody to rob), the variable is left **empty** and
  the rule keeps going. Use the *Variable is set* check (`varSet`) to test for this.
* Filters see the candidate under the name being chosen. In *Choose a player as "victim",
  only where …*, write the check about `victim`.
* Some names are always available in certain places:
  * Placement rules, token spots and *Where* filters on placing or moving: `at` is the
    candidate spot.
  * Setup: `lastPlaced` is the piece you placed just before in this setup turn.
  * Piece actions: `piece` (its spot) and `pieceId` (the piece).
  * Cards: `card`.
  * Piece triggers: `this` (the piece's spot) and `thisId` (the piece).
  * Piece filters (*Only pieces where* on a piece query): `candidate` and `candidateId`.
  * Movement paths: `at` (the next step), `prev` (the previous one) and `via` (what connects
    them, for example the road between two corners).

---

## 4. Triggers, events and their data

A trigger says **on** an event, **when** a check holds, **do** these steps. Every trigger can
read the event's data as variables. `event` holds the event name.

| Event | When | Data |
|---|---|---|
| `gameStart` | once, before setup | — |
| `setupComplete` | after the last setup placement | — |
| `turnStart` / `turnEnd` | each turn | `player` |
| `roundEnd` | after everyone has had a turn | — |
| `diceRolled` | right after a roll | `total`, `player`, `die0`, `die1`, … ; event dice: `event0`, `eventDie_<id>` |
| *(event die face)* | after `diceRolled`, once per event die, **named by the face** (for example `barbarianShip`) | `total`, `player`, `face` |
| `production` | after resources are handed out | `roll`, `hex` |
| `playerProduction` | after production, **once per player** | `player`, `amount` (0 = got nothing), `roll`, `hex` |
| `piecePlaced` | a piece is put on the board | `piece` (type), `at`, `owner`, `player`, `pieceId` |
| `pieceUpgraded` | a piece is upgraded | `from` (old type), `piece`, `at`, `owner`, `player`, `pieceId` |
| `pieceDowngraded` | a piece is reduced (city → settlement) | `from`, `piece` (empty if it was lost), `at`, `owner`, `player`, `pieceId` |
| `pieceRemoved` | a piece leaves the board | `piece`, `at`, `owner`, `player`, `pieceId` |
| `pieceMoved` | a piece moves | `piece`, `from` (old spot), `at`, `owner`, `player`, `pieceId`, `steps` |
| `tokenMoved` | the robber (or another token) moves | `token`, `at`, `from`, `player` |
| `hexRevealed` | a fog hex is flipped | `at`, `terrain`, `player` |
| `cardDrawn` / `cardPlayed` | cards | `card`, `deck`, `player` |
| `resourceGained` / `resourceLost` | any resource movement | `player`, `resource`, `amount` |
| `tradeCompleted` | any trade | `player`, `with` |
| `awardChanged` | an award changes hands | `award`, `player` (new holder or empty), `previous` |
| *your own name* | the *Fire custom event* step (`emit`) | the data you attach, plus `player` |

Use **Variable is** (`varIs`) to test event data that is an id, for example
`{varIs: {var: 'piece', value: 'settlement'}}`. Use **Compare numbers** (`cmp`) for numbers.

---

## 5. Pieces

A piece has a **placement rule**: a check that must hold for the candidate spot `at`. Common
checks are *is occupied*, *is water*, *is coastal*, *connects to network*, *distance rule* and
*has token*. Pieces can also have:

* `cost` (the standard Build button), `vp`, and `productionMultiplier` (settlement 1, city 2).
* `upgradesFrom`: building it replaces one of these pieces.
* `network`: pieces with the same network form routes (Longest Road).
  `networkSwitchAt: 'ownPiece'` means a route may switch between this piece type and another
  type only at one of the owner's buildings. In Seafarers, a road and a ship only join at a
  settlement.
* `initialState`: numbers stored on each piece, such as `{active: 0, strength: 1}`. Read them
  with *Piece state* (`pieceState`), total them with *Total piece state* (`sumPieceState`),
  and change them with *Set piece state*.
* `pieceActions`: buttons that appear for each of the player's pieces of this type, such as
  *Activate knight* or *Move ship*.
* **Cargo**: any piece can carry goods. *Load cargo* moves resource cards from a hand onto the
  piece. *Unload cargo* gives them back to a player or the bank. *Add goods to a piece* adds
  abstract goods such as a `settler` or `marble`. *Cargo carried* (`cargoCount`) reads them.
  Cargo moves with the piece. If the piece leaves the board, its resource cargo goes back to
  the bank.

**Piece queries** pick a set of pieces. You can filter by owner, type, tag, *near* a spot,
*touching terrain*, *with state* (for example `{active: 1}`), *on the same island as* a spot,
and *only pieces where* (any check about `candidate` / `candidateId`).

**Islands** (regions) are groups of land hexes that touch side by side. *On the same island*
(`sameRegion`) and the piece-query filter *same island* (`region`) use them.

---

## 6. Recipes

### Road Building: "place 2 roads for free"
```json
{ "op": "repeat", "times": 2, "do": [{ "op": "place", "piece": "road", "free": true }] }
```

### Monopoly: "name a resource; everyone gives you all of theirs"
```json
[
  { "op": "chooseResource", "as": "res", "kind": "resource" },
  { "op": "forEachPlayer", "as": "p", "filter": { "not": { "samePlayer": [{ "var": "p" }, "self"] } },
    "do": [{ "op": "transfer", "from": { "var": "p" }, "to": "self", "resource": { "var": "res" },
             "amount": { "resourceCount": { "player": { "var": "p" }, "resource": { "var": "res" } } } }] }
]
```

### A card that steals from everyone
```json
{ "op": "forEachPlayer", "as": "p", "filter": { "not": { "samePlayer": [{ "var": "p" }, "self"] } },
  "do": [{ "op": "steal", "from": { "var": "p" } }] }
```

### A recipe: "2 sheep → 1 cloth" (an action button)
```json
{ "id": "weave", "name": "Weave cloth", "group": "special",
  "cost": { "wool": 2 },
  "available": { "all": [{ "isTurnOf": "self" }, { "phase": "main" }] },
  "effect": [{ "op": "gain", "resources": { "cloth": 1 } }],
  "limitPerTurn": 1 }
```
Add `cloth` as a resource first, for example with `kind: 'commodity'` so it trades at the commodity rate.

### A building that produces on 2 hexes
Any piece with a `productionMultiplier` collects from every hex it touches when that hex's
number is rolled:

* on a corner (`placement.on: 'vertex'`): 3 hexes, like a settlement;
* on an edge (`placement.on: 'edge'`): the **2 hexes** on either side;
* on a hex (`placement.on: 'hex'`): only that hex.

So a "mill" that produces from 2 hexes is an edge piece:
```json
{ "id": "mill", "name": "Mill", "supply": 2, "cost": { "brick": 1, "grain": 2 }, "productionMultiplier": 1,
  "placement": { "on": "edge", "where": { "all": [
    { "not": { "occupied": { "at": "at" } } }, { "not": { "isWater": { "at": "at" } } },
    { "connectedTo": { "at": "at", "owner": "self" } } ] } } }
```
To make it produce something special on certain terrains, add a `productionBonus`, for example
`[{ "terrain": "fields", "gives": { "flour": 1 } }]`.

### Doing something for every spot: reveal the fog around a ship
```json
{ "op": "forEachLocation", "kind": "hex", "as": "h",
  "filter": { "isAdjacent": ["h", "pieceId"] },
  "do": [{ "op": "revealHex", "at": "h" }] }
```

### "Players with 2 or fewer points can't be robbed" (friendly robber on the hex itself)
Put it in the robber token's `where`:
```json
{ "cmp": [{ "pieceCount": { "near": "at", "tag": "building",
    "where": { "cmp": [{ "vp": { "ownerOf": "candidateId" } }, "<=", 2] } } }, "==", 0] }
```

### "The first time a player does X"
Use a flag that lasts forever:
```json
{ "on": "piecePlaced", "as": "eventPlayer",
  "when": { "all": [{ "varIs": { "var": "piece", "value": "ship" } }, { "not": { "flag": "sailor" } }] },
  "do": [{ "op": "setFlag", "flag": "sailor", "value": true }, { "op": "addVP", "amount": 1 }] }
```

### Seafarers: first settlement on a new island = 2 VP
```json
{ "on": "piecePlaced", "as": "eventPlayer",
  "when": { "all": [{ "not": { "phase": "setup" } }, { "varIs": { "var": "piece", "value": "settlement" } },
    { "cmp": [{ "pieceCount": { "owner": "self", "tag": "building", "region": "at" } }, "==", 1] }] },
  "do": [{ "op": "addVP", "amount": 2, "reason": "new island" }] }
```

### Seafarers: ships
* Ship placement: `{ connectedTo: { at: 'at', owner: 'self', via: ['ship'] } }` means
  "touches another of your ships or one of your buildings". Give roads `via: ['road']` the same
  way.
* The pirate blocks ships on the edges of its hex:
  `{ not: { hasToken: { at: 'at', token: 'pirate', near: true } } }`.
* Moving a ship (a piece action): available when
  `{ isNetworkEnd: { at: 'pieceId', via: ['ship'] } }`, then
  `{ op: 'movePiece', query: { piece: 'ship', owner: 'self' }, from: { at: 'pieceId' } }`.

### Cities & Knights
* Total active knight strength: `{ sumPieceState: { query: { tag: 'knight', state: { active: 1 } }, key: 'strength' } }`.
* "Nobody is stronger than p":
  `{ cmp: [{ countPlayers: { as: 'q', filter: { cmp: [strength(q), '>', strength(p)] } } }, '==', 0] }`.
* Barbarians win: `{ op: 'downgrade', from: 'city', to: 'settlement', player: { var: 'p' } }`.
  The owner picks which city.
* Knight displacement: choose the weaker knight (`asId`), then
  `movePiece … player: { ownerOf: 'victimKnight' }` so its owner moves it. If it has nowhere
  to go, remove it. Then move your own knight in.
* Metropolis: an award with `mode: 'keepUntilBeaten'`. When `awardChanged` fires,
  `upgrade` a city of the new holder and `downgrade` the metropolis of the previous one.
* Aqueduct: on `playerProduction` with `amount == 0`, run *Pick resources to gain* (amount 1).
* Event die: a face such as `politics` fires an event of the same name. Draw a card when
  `{ dice: 1 } <= politics level + 1`.
* Per-deck hand limits: the deck's `handLimit`. A limit shared by several decks: a `cardDrawn`
  trigger (*Runs for* `eventPlayer`) that checks `cardCount` and runs *Discard a card* (`choose`).
* Spy: *Take a card from a player* (`takeCard`, `choose: true`): the taker looks at the hand and picks.
* Alchemist: *Roll the dice* with *Fixed results* (`rollDice` `values: [yellow, red]`). Event dice still roll.
* The full expansion is in `src/content/expansions/cities-knights/index.ts`.

### Traders & Barbarians: wagons with cargo
* Move along roads with movement points:
  `{ op: 'movePiece', …, anywhere: true, maxSteps: { sub: [4, { stat: { key: 'moved' } }] },
  path: { occupied: { at: 'via', piece: 'road' } }, stepsAs: 'st' }`, then
  `addStat moved += st`. Reset `moved` on `turnStart`.
* Load at a quarry: `addCargo marble 1`. Deliver: a `pieceMoved` trigger that checks the
  terrain at `at` and `cargoCount`, then `addCargo -1` and `addVP`.

### Explorers & Pirates: a ship carrying a settler
* *Load a settler* (piece action with a cost): `addCargo settler 1`.
* *Sail*: `movePiece` with `maxSteps` and a `path` over water.
* *Found a settlement*:
  `place settlement (free, ignore connection) where isAdjacent(at, pieceId)`, then
  `addCargo settler -1`.

### Missions and objectives
Missions are triggers that combine stats and flags. Count progress with `addStat`, and finish
the mission with a check like `cmp stat ≥ 3` and `not flag missionDone`. Then reward the
player and set the flag.

### Choosing several things at once
```json
{ "op": "chooseMany", "of": "player", "count": 2, "min": 0, "as": "target",
  "do": [{ "op": "steal", "from": { "var": "target" } }] }
```
The player picks up to 2 **different** players, one prompt at a time, and may stop early (`min: 0`).

---

## 7. Awards

An award has a per-player `metric` (a number; "you" is the player being scored) and a `min`.
By default (`mode: 'highest'`) it goes to the strict leader. `holderKeepsOnTie` lets the
holder keep it on a tie. With `mode: 'keepUntilBeaten'`, the holder keeps it until someone
**strictly exceeds** the holder's own score, even if the holder's score later drops.

---

## 8. Good to know

* Steps that need a decision pause the game and ask the player. The game always computes the
  legal options for them.
* *Cancel if* (`abortIf`) cancels the whole action and refunds its cost.
* *Move a piece* checks the piece's own placement rules, as seen by its owner, with the piece
  lifted off the board. Add *Ignore placement rules* (`anywhere`) to use only your
  *To … where* check.
* `loadCargo` takes cards out of a hand, and `addCargo` creates goods from nothing. Use
  `addCargo` for goods that aren't resource cards.
* Limits today: trade counter-offers are not supported, and variables can't hold lists (use
  `chooseMany` or `forEachPiece` instead).
