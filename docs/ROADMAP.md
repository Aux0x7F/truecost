# Roadmap

The big architecture cleanup is now in place. The site has a shared runtime/document model, thinner route files, generated output in `dist/`, and a clearer split between runtime state, feature orchestration, and rendering.

## Recently finished

- hard cutover away from the old local seam files and page-owned cache model
- route-thin admin, editor, and site runtime entrypoints
- runtime-backed projections for public state, notifications, posts, workspace state, and documents
- `dist/`-only site output with source pages in `site-src`
- graph/wiki foundation with shared data helpers and downstream UI shells
- observed region updates that stop unrelated async work from blowing away active UI
- stronger account/session handling and clearer profile rules

## Current focus

- turn the current graph/wiki foundation into a fuller research tool
- move from seeded or draft-only relationship assumptions toward published relationship records and review flow
- keep deepening the structured-document path so authoring no longer depends on old markdown-first assumptions
- keep tightening operator workflows, browser checks, and degraded-mode behavior

## Next likely moves

- richer graph relationship review and evidence flow
- a more native structured-document editor path
- stronger browser smoke coverage around operator-critical flows
- more reusable live-unit shells for archive, entity, and collaborative records
- clearer publish/history views before bakedown

## Longer bets

- richer wiki/entity modeling, qualifiers, and time-bounded relationships
- stronger collaboration rails for editor and review workflows
- better map and archive views as the dataset grows
- cleaner handoff and operations for non-developer site operators
