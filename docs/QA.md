# QA log

Integration + QA pass after the engine, network/lobby, game UI and mod editor workstreams
were merged. "Verified" means driven end to end in real Chromium windows by Playwright
(`e2e/`), with two separate browser contexts (host + guest) talking over the **public
PeerJS cloud broker**, unless noted otherwise.

## How to run

```
npm run e2e          # all multiplayer/editor specs against the Vite dev server (:5199)
npm run e2e:pages    # production build served under /catan-web/ (GitHub Pages layout, :5299)
npx playwright test game.spec --headed   # watch one
```

* E2E is **not** part of `npm test` (vitest excludes `e2e/**`) and CI does not run it.
  It needs internet access (PeerJS broker at 0.peerjs.com + Google STUN).
* Screenshots land in `e2e/.shots/` (git-ignored); failures keep a trace in `e2e/.results/`.
* **Test hooks** (`src/net/testHooks.ts`): in the dev server, or in any build opened with
  `?testhooks` in the URL (e.g. `/?testhooks#/room/ABC234`), the *host* tab exposes
  `window.__hexlands` with `game()`, `lobby()`, `forceNextRoll(total)`, `giveResources(pid, map)`,
  `stackDeck(deck, cardIds)`, `setTokenVP(pid, n)` and `patchGame(fn)`. Tests use them only to
  steer randomness (dice, deck order) and hand out resources; every player action goes
  through the real UI. `forceNextRoll` searches for an RNG state that yields the total, so
  the engine itself is untouched. Hooks only affect rooms the caller hosts (the host is
  authoritative anyway).
* The public broker was reliable throughout (dozens of runs, no retries needed), so no
  local PeerJS server was added. If it ever becomes flaky, the `peer` npm package +
  a `PEER_SERVER` env read in `src/net/peerTransport.ts` would be the place to add one.

## Verified end to end

| Spec | What it covers |
|---|---|
| `game.spec.ts` | Host creates room → copies invite link (real clipboard) → guest opens it, enters name → guest picks a color → host changes VP, discard limit, dice mode, friendly robber; guest sees each change → lobby chat → ready → start → both players complete setup by clicking highlighted vertices/edges → forced roll shows on both screens → build a road → bank trade (port rate aware) → player trade offer → accept → confirm → buy a dev card (not playable same turn; opponent sees a hidden card) → 7: both players discard via the dialog, robber moved next to the opponent, steal → **guest reloads mid-game** and is back in the same state → **host reloads**: room id re-registered, game resumed at the same version, guest reconnects by itself and play continues → Year of Plenty played. No console errors. |
| `cards.spec.ts` | Turn timer setting → exactly one countdown per screen; city upgrade on own settlement; Knight before rolling (robber + steal, "Knights played" visible to opponent, one dev card per turn); Road Building (2 free roads); Monopoly; in-game chat; winning → "You win!/X wins!" dialog for both. |
| `timer.spec.ts` | Host clock fast-forwarded past a 60 s timer during setup → the idle player's settlement and road are placed for them, chat says so. |
| `phone.spec.ts` | Guest on a 390×844 touch viewport: lobby, setup by *tapping* on-screen highlights, roll, trade dialog, discard dialog. Screenshots reviewed. |
| `lobby.spec.ts` | Same player in two tabs (newest tab wins, old tab stops and offers Retry — no seat ping-pong); host Leave → "Resume room" on the home page → guest reconnects; join by typing the code on the home page; kick (kicked player sees why); late joiner gets "Game already in progress"; host closes the room → guests see "Room closed". |
| `mod.spec.ts` | In the editor UI: new mod → rename → Resource + terrain template (renamed "Spice"; the terrain's produce map follows the new id) → Building template → Recipe action → Deck → Development card added to the new deck → On/off lobby setting → autosaved, "No problems" from editor + engine validator → Export downloads the JSON. In a room: host adds the mod from the library, guest sees it, mod's lobby setting is shown to both and synced → game shows Spice in hands, Bazaar build button, "Buy Spice Deck" → the **guest uses the recipe** (disabled before rolling, +1 VP, disabled again by the per-turn limit). Second test: upload a `.json` mod in the lobby; its 12 VP target becomes the room default; its action appears for both. |
| `pages.spec.ts` | `npm run build` served under `/catan-web/`: assets load, room URL and **invite link keep `/catan-web/`**, guest joins via that link, `#/editor` deep link works (lazy chunk loads from the subpath), no test hooks in production. |
| `screens.spec.ts` | Screenshots of home, editor (empty + with a mod, pieces tab), `#/dev/game`, 404 at 1400×900 and 390×844; fails on console errors. Also reviewed by hand: lobby, game, trade, discard, robber, game-over, editor at 1280×720, 1024×768, 820×1180. |

Unit tests added: editor ↔ engine sync (`src/editor/logic.test.ts`), id rename refactor
(`src/editor/rename.test.ts`), turn-timer auto-play driving 30 turns × 4 seeds with the real
engine (`src/net/autoplay.test.ts`), second-tab takeover (`src/net/host.test.ts`), mod
VP/discard defaults (`src/net/lobby.test.ts`).

## Bugs found and fixed

**Network / lobby**
1. *Seat ping-pong*: opening the room in a second tab made the two tabs kick each other forever
   (each auto-reconnected and stole the seat back). Host now sends an additive
   `{t:'replaced'}` message; the old tab stops with "This room is open in another tab" + Retry.
2. The "Disconnected: …" banner lost its reason after 4 s (the toast auto-clear wiped the
   shared error). Errors are only auto-dismissed while connected.
3. A mod's `victoryPoints` / `discardLimit` were silently ignored: the lobby kept 10 VP and
   the lobby value overrides the definition. Untouched values now follow the rules' defaults
   when mods change; host-customised values are kept.
4. Turn timer did nothing when it ran out (TODO in host). The host now plays a minimal legal
   move for the idle player (`src/net/autoplay.ts`) and posts a chat line.
5. Two countdowns on screen when the timer was on (room page's fixed one + game screen's
   client-side estimate that reset on reconnect). One host-driven countdown in the turn bar.
6. Guests saw "Removed from room" when the host closed the room → "Room closed".

**Game UI**
7. `piece` prompts were unanswerable: the engine offers piece *locations*, the UI looked for
   piece *instance ids* (affects choosePiece, remove/move-piece prompts — knights, ships…).
   The board now highlights pieces at the offered locations and answers with the option.
8. Log lines repeated the player's name ("**Bob** Bob places a Road").
9. Phone (≤720 px): End turn was scrolled off the action bar; opponents were at the very
   bottom. Roll + End turn now sit together at the start, opponents in a row above the board.
   721–1100 px: opponents moved above the board instead of below the action bar.

**Mod editor**
10. Editor events used guessed payload vars; now derived from the engine's
    `EVENT_PAYLOAD_VARS` (+ `event`). Var scopes follow the documented binding rules: choose
    filters see the candidate under the op's own `as` (they offered `at` before); `setupWhere`
    sees `lastPlaced`; actions get `piece`/`pieceId`; cards get `card`; piece triggers get
    `this`/`thisId`; `forEachPiece`/`choosePiece` bind locations.
11. The base mod showed validation errors in the editor: builtin lobby settings
    (`friendlyRobber`, `discardLimit`, …) weren't accepted as `{setting}`/`{param}` refs; they are
    now known and offered in the picker ("Lobby settings").
12. Renaming an item (whose id follows its name) left dangling references — e.g. renaming the
    template resource broke the terrain producing it. Id changes now rewrite references across
    the mod (`src/editor/rename.ts`); clearing a name no longer blanks the id.
13. `#/editor`: the editor was `position: fixed` over the app's top bar. It now fills the space
    under the shared top bar (duplicate home link removed). On phones the library, item list and
    form stack and the problems panel is an overlay, closed by default.

**Build**
14. Editor and `#/dev/game` are lazy-loaded (main chunk 685 kB → 500 kB).

Map option label no longer repeats the player range ("Standard (3-4 players) (2–4 players)");
the kick button has an accessible name.

## Schema / engine changes

* **None to the engine or `schema.ts`.** (The engine was used as-is; all fixes were in net,
  UI, editor and tests.)
* Additive protocol message `ServerMessage { t: 'replaced'; message }` (`src/net/protocol.ts`).
* Additive optional `timer` prop on `GameScreen` (`src/ui/slots.ts`, `src/ui/game/GameScreen.tsx`).
* New `HostRoom.applyAs(playerId, cmd, note?)` and test-only `HostRoom.debugSetGame(state)`.

## Known issues / not done

* **Turn-timer auto-moves are minimal**: they never build or trade, pick the *first* legal
  option for placements/robber, and discard the most plentiful cards. Good enough to keep a
  game moving when someone walks away.
* `forceNextRoll` searches RNG states, so it only works for dice the engine rolls from the
  seeded RNG (fine for base dice and event dice).
* The base map is named "Standard (3-4 players)" but allows 2 players (content, left as is).
* Board highlights for vertical edges have a zero-width bounding box (only matters to
  automation; clicks work).
* The board on phones is small (hexes ≈ 40 px); spots are tappable but pinch-zoom helps.
* Discarding many cards means many "+" taps (no "auto-pick" helper in the dialog).
* No local PeerJS server option (the public broker was reliable); e2e needs internet.
* Host reload relies on the broker releasing the old peer id; it was immediate in testing,
  but the UI tolerates up to a minute ("Re-registering room code…").
