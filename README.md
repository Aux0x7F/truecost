# The True Cost Project

True Cost is the concrete site repo: public pages, operator workflows, site styling, and project-specific policy built on top of [`nostr-site`](https://github.com/Aux0x7F/nostr-site). The site stays static-first, then layers in live relay-backed state where it helps.

## What lives here

- public pages and site copy
- investigation content and page templates
- site-specific workspace, moderation, and publishing flows
- styling, layout, and downstream UI choices
- the vendored browser support bundle built from `nostr-site`

## How this fits with the sibling repos

- [`nostr-site`](https://github.com/Aux0x7F/nostr-site)
  - reusable framework/runtime layer
  - projections, document runtime, template shells, support bundle, and pinner integration
- [`nostr-crdt`](https://github.com/YousefED/nostr-crdt)
  - transport and sync layer for collaborative units

`truecost` is where the abstract pieces turn into the actual site.

## Repo layout

- `site-src/`
  - page sources and page definitions
- `content/`
  - investigations, guide content, and baked data
- `scripts/core/`
  - shared site-side controllers, runtime adapters, and helpers
- `scripts/features/`
  - route and feature orchestration
- `scripts/surfaces/`
  - reusable rendering families
- `styles/`
  - ordered stylesheet partials bundled into `styles.css`
- `docs/`
  - architecture, workflow, testing, operations, and style notes
- `dist/`
  - generated deploy output

## Build and output

`npm run build` rebuilds the bundled site output in `dist/`.

That build:

- generates HTML from `site-src`
- rebuilds `styles.css`
- bundles browser scripts
- copies content, assets, and fonts needed for deploys

Repo root is source. `dist/` is the browser artifact.

## Start here

- Want the big picture?
  - [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- Working on UI or page behavior?
  - [docs/COMPONENTS.md](./docs/COMPONENTS.md)
  - [docs/STYLE_GUIDE.md](./docs/STYLE_GUIDE.md)
- Touching runtime behavior or edge cases?
  - [docs/TESTING.md](./docs/TESTING.md)
- Running the site or thinking about bakedown?
  - [docs/OPERATIONS.md](./docs/OPERATIONS.md)
- Want the roadmap and current priorities?
  - [docs/ROADMAP.md](./docs/ROADMAP.md)
- Need the docs map?
  - [docs/README.md](./docs/README.md)
