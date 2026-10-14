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
