# True Cost Docs

This folder is the working handbook for the site. Start with the doc that matches the job in front of you instead of reading everything in order.

## Start here if you want to...

### Understand the system

- [ARCHITECTURE.md](./ARCHITECTURE.md)
  - how the site is split, how live state works, and what owns what
- [OPERATIONS.md](./OPERATIONS.md)
  - how the live site, bakedown, and review flow are meant to run

### Work on UI and rendering

- [COMPONENTS.md](./COMPONENTS.md)
  - shared UI families, ownership boundaries, and expected behavior
- [STYLE_GUIDE.md](./STYLE_GUIDE.md)
  - layout, motion, content, and interaction feel
- [BROWSER_SUPPORT.md](./BROWSER_SUPPORT.md)
  - fallback and enhancement rules

### Make or review a change

- [CONTRIBUTING.md](./CONTRIBUTING.md)
  - branch shape, PR expectations, and merge workflow
- [TESTING.md](./TESTING.md)
  - what to cover before merge

### See what is changing next

- [ROADMAP.md](./ROADMAP.md)
  - recent wins, current focus, and longer bets

## Neighboring repos

- [`nostr-site`](https://github.com/Aux0x7F/nostr-site)
  - shared framework/runtime layer
- [`nostr-crdt`](https://github.com/YousefED/nostr-crdt)
  - transport and sync layer

If you are trying to understand a generic runtime behavior first, read the matching doc in `nostr-site`, then come back here for the site-specific implementation.
