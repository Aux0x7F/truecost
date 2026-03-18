# Testing Contract

`truecost` is the concrete product surface. Regressions here are user-visible immediately.

## Minimum bar

Changes to live state, cached state, comments, filters, maps, workspace surfaces, or collaborative units should have:

- a focused deterministic test for the data/state contract
- a focused surface test when a new render family is extracted from a page controller
- a browser regression when the failure mode is a runtime boot error, DOM lifecycle error, or broken attached-field interaction
- syntax validation for touched modules
- a clear statement of what user behavior was verified
- a compatibility note when introducing non-baseline browser features

## Required live-state cases

Where applicable, cover:

- cached-first render
- optimistic local updates
- reload resilience
- stale remote merge behavior
- nested thread integrity
- visible control effect after local mutation
- ranking and ordering rules when local mutation changes score or status
- manual verification for motion where visual continuity is part of the interaction contract
- manual verification that motion remains slow enough to perceive when timing is a user-facing part of the interaction
- if motion ends with viewport repositioning, verify that the resulting scroll is smooth and lands on the acted-on item

## Current commands

- `node --check <file>`
- `node --test tests/archive-surface.test.mjs`
- `node --test tests/shell-surfaces.test.mjs`
- `node --test tests/comment-refresh.test.mjs`
- `node --test tests/comment-vote-ranking.test.mjs`
- `node --test tests/public-state-store.test.mjs`
- `node --test tests/navigation-notification.test.mjs`
- `node --test tests/workspace-actions.test.mjs`
- `node --test tests/workspace-filters.test.mjs`
- `node --test tests/editor-shell.test.mjs`
- `node --test tests/map-surface.test.mjs`
- `node --test tests/submit-shell.test.mjs`
- `node --test tests/admin-editor-submit.browser.test.mjs`
Use the checked-in browser regression whenever a fix touches:

- admin/workspace boot
- editor boot or editor lifecycle
- attached autocomplete/dropdown geometry
- other runtime paths that unit tests can miss because the failure only appears in a real browser
