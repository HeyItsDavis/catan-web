# Catan Web (moddable)

A browser-based, moddable take on Catan for playing online with friends.
Create a room, send the link, play. Everything — buildings, cards, decks,
resources, recipes — is data you can edit in the built-in mod editor.

* Play: https://heyitsdavis.github.io/catan-web/
* Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
* QA log (what is verified end to end, known issues): [docs/QA.md](docs/QA.md)

```
npm install
npm run dev      # local dev server
npm test         # engine tests
npm run build    # production build (deployed by GitHub Actions on push to main)
npm run e2e      # Playwright: two browsers play over PeerJS (needs internet; see docs/QA.md)
npm run e2e:pages  # same, against the production build served under /catan-web/
```

Unofficial fan project; not affiliated with Catan GmbH.

## Credits

Game-screen icons are from [game-icons.net](https://game-icons.net), licensed under
[CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). They are embedded as single-colour SVG paths in
`src/ui/shared/gameIconData.ts` (black background square removed, recoloured). Sources are in
[github.com/game-icons/icons](https://github.com/game-icons/icons).

| Used for | Icon | Author |
|---|---|---|
| lumber | [wood-pile](https://game-icons.net/1x1/delapouite/wood-pile.html) | Delapouite |
| brick | [brick-pile](https://game-icons.net/1x1/delapouite/brick-pile.html) | Delapouite |
| wool | [sheep](https://game-icons.net/1x1/delapouite/sheep.html) | Delapouite |
| grain | [wheat](https://game-icons.net/1x1/lorc/wheat.html) | Lorc |
| ore | [stone-pile](https://game-icons.net/1x1/delapouite/stone-pile.html) | Delapouite |
| paper | [scroll-unfurled](https://game-icons.net/1x1/lorc/scroll-unfurled.html) | Lorc |
| cloth | [rolled-cloth](https://game-icons.net/1x1/delapouite/rolled-cloth.html) | Delapouite |
| coin | [two-coins](https://game-icons.net/1x1/delapouite/two-coins.html) | Delapouite |
| fish | [double-fish](https://game-icons.net/1x1/delapouite/double-fish.html) | Delapouite |
| gold | [gold-bar](https://game-icons.net/1x1/willdabeast/gold-bar.html) | Willdabeast |
| spices | [hot-spices](https://game-icons.net/1x1/lorc/hot-spices.html) | Lorc |
| cardBack | [card-random](https://game-icons.net/1x1/faithtoken/card-random.html) | Faithtoken |
| devBack | [card-pickup](https://game-icons.net/1x1/quoting/card-pickup.html) | Quoting |
| buyCard | [buy-card](https://game-icons.net/1x1/delapouite/buy-card.html) | Delapouite |
| knight | [visored-helm](https://game-icons.net/1x1/lorc/visored-helm.html) | Lorc |
| victoryPoint | [laurel-crown](https://game-icons.net/1x1/lorc/laurel-crown.html) | Lorc |
| roadBuilding | [stone-path](https://game-icons.net/1x1/delapouite/stone-path.html) | Delapouite |
| plenty | [cornucopia](https://game-icons.net/1x1/delapouite/cornucopia.html) | Delapouite |
| monopoly | [crown-coin](https://game-icons.net/1x1/lorc/crown-coin.html) | Lorc |
| bank | [bank](https://game-icons.net/1x1/delapouite/bank.html) | Delapouite |
| trophy | [trophy](https://game-icons.net/1x1/lorc/trophy.html) | Lorc |
| army | [crossed-swords](https://game-icons.net/1x1/lorc/crossed-swords.html) | Lorc |
| road | [road](https://game-icons.net/1x1/delapouite/road.html) | Delapouite |
| trade | [trade](https://game-icons.net/1x1/lorc/trade.html) | Lorc |
| dice | [rolling-dices](https://game-icons.net/1x1/delapouite/rolling-dices.html) | Delapouite |
| hourglass | [hourglass](https://game-icons.net/1x1/lorc/hourglass.html) | Lorc |
| settlement | [house](https://game-icons.net/1x1/delapouite/house.html) | Delapouite |
| city | [castle](https://game-icons.net/1x1/delapouite/castle.html) | Delapouite |
| robber | [cowled](https://game-icons.net/1x1/lorc/cowled.html) | Lorc |
| ship | [caravel](https://game-icons.net/1x1/delapouite/caravel.html) | Delapouite |
| avatar | [meeple](https://game-icons.net/1x1/delapouite/meeple.html) | Delapouite |
