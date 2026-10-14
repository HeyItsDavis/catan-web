# Architecture

A moddable, browser-only, online hex-trading game in the style of Catan.
Hosted as static files on GitHub Pages. No backend.

## Big picture

```
 ┌──────────── host browser ────────────┐        ┌──── guest browser ────┐
 │  UI (React)                          │        │  UI (React)           │
 │    │ commands        ▲ redacted state│        │   │ commands   ▲ state │
 │  net/host  ── engine (pure TS) ──────┼─PeerJS─┼─ net/client ──┘       │
 └──────────────────────────────────────┘ WebRTC └───────────────────────┘
```

* **Host-authoritative peer-to-peer.** The player who creates a room *is* the
  server. Their browser runs the engine and sends a redacted state to each guest
  after every change. Guests send `Command`s. The room code is the host's PeerJS id,
  and the share link is `<site>/#/room/<code>`.
* The host must keep their tab open. The host autosaves the game to localStorage, so
  a refreshed host can resume, and guests reconnect automatically.
* **The engine is pure.** It has no DOM, network or React, and it's deterministic
  given its seed. That makes it unit-testable and lets the mod editor run a
  sandbox preview.

## Directory ownership

| Path | Owner workstream | Notes |
|---|---|---|
| `src/engine/schema.ts` | contract (manager) | Make additive changes only. Note them in the PR/commit message. |
| `src/engine/board/topology.ts` | contract | Hex/vertex/edge ids and pixel geometry. |
| `src/engine/**` | engine | Interpreter, rules, map generation, validation. |
| `src/content/base/` | engine | The base game, **written as a mod** (`ModDef`). |
| `src/content/expansions/` | content | Seafarers, C&K, T&B, E&P, 5–6 players, as mods. |
| `src/net/**` | network | PeerJS host/client, lobby state, reconnection, persistence. |
| `src/ui/game/**` | game UI | Board renderer (SVG), hand, action bar, trade, log, prompts. |
| `src/ui/lobby/**` | network | Home page, room creation, lobby settings screen. |
| `src/ui/editor/**` | editor | The mod editor GUI. |
| `src/ui/shared/**` | shared | Icons, colors, primitive components. Coordinate on additions. |

## The modding model (read `src/engine/schema.ts`)

The base game is just a mod. Everything is composed from these pieces:

* **Definitions**: resources, terrains, pieces (settlement, road, ship, knight…),
  cards, decks, actions (named, costed player actions, i.e. "recipes"), tokens
  (robber, pirate, merchant), awards (longest road), ports, maps, settings, dice,
  and setup rounds.
* **Effects**: a small instruction set (`gain`, `place`, `remove`, `repeat`,
  `choosePlayer`, `moveToken`, `drawCard`, …). For example, *Road Building* is
  `repeat 2 × place road (free)`.
* **Conditions & Exprs**: booleans and formulas over game state.
* **Triggers**: `on` an event, run effects. The 7 → discard → robber flow in
  the base game is a trigger on `diceRolled`, not engine code.

Mods merge by id onto what they `extend`: the same id replaces an entry, a new id
adds one, and `remove` deletes. A room carries the full `ModDef` JSON of every mod it
uses, so guests never need to install anything.

### Engine interpreter

Effects run on an explicit stack (`GameState.stack`). When an effect needs
input, the engine pushes a `Prompt` (with **all legal options precomputed**)
and stops. A `respond` command binds the answer to the prompt's `as` var and
resumes. That keeps the state serializable at every point, so it can be saved
or sent over the network mid-action.

## Lobby settings (colonist.io-like)

Map, max players, VP to win, discard limit, dice mode (random/balanced),
friendly robber, hide bank cards, turn timer, randomized turn order, and mods
plus their declared settings.

## Conventions

* TypeScript strict. Use `npm run typecheck`, `npm test` (vitest) and `npm run build`.
* Engine changes need unit tests. The base game should be playable end to end in a
  headless test (`src/engine/__tests__/simulate.test.ts`).
* Art uses flat colors plus simple inline SVG icons. Don't commit third-party art.
