# Testing Contract

`truecost` is the concrete product surface. Regressions here are user-visible immediately.

## Minimum bar

Changes to live state, cached state, comments, filters, maps, workspace surfaces, or collaborative units should have:

- a focused deterministic test for the data/state contract
- a focused feature/runtime test when route-owned logic moves out of a root controller
- a focused surface test when a new render family is extracted from a page controller
- a browser regression when the failure mode is a runtime boot error, DOM lifecycle error, or broken attached-field interaction
- a browser or controller regression when the failure mode is an unrelated rerender wiping active local input state
- syntax validation for touched modules
- a clear statement of what user behavior was verified
- a compatibility note when introducing non-baseline browser features
- a bundle or source-contract check when a change alters first-paint assets such as `styles.css`

Pure presentation refinements should be checked in manual design runs unless they change runtime behavior or a documented interaction contract.

Authentication and password-rotation work must also cover:

- generic login mismatch behavior for stale or superseded passwords
- minimum password length enforcement in both rendered fields and action-layer validation
- synchronous password-reuse rejection before any session/history mutation
- rotation commit boundaries, so failed follow-up work does not leave local session/history in a contradictory state
- vendored support-lib contract checks when upstream session primitives change

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
- `node --test tests/notification-builder.test.mjs`
- `node --test tests/page-drafts.test.mjs`
- `node --test tests/public-state-store.test.mjs`
- `node --test tests/workspace-actions.test.mjs`
- `node --test tests/workspace-filters.test.mjs`
- `node --test tests/editor-shell.test.mjs`
- `node --test tests/investigation-detail-surface.test.mjs`
- `node --test tests/map-surface.test.mjs`
- `node --test tests/static-page-edit.test.mjs`
- `node --test tests/submit-shell.test.mjs`
- `node --test tests/observed-regions.test.mjs`
- `node --test tests/admin-editor-submit.browser.test.mjs`
- `node --test tests/account-actions.test.mjs`
- `node --test tests/session-api-vendor.test.mjs`
- `node --test tests/stylesheets-bundle.test.mjs`
- `node --test tests/page-router.test.mjs`
- `node --test tests/workspace-shell.test.mjs`
- `node --test tests/workspace-tabs.test.mjs`
- `node --test tests/workspace-site-key.test.mjs`
- `node --test tests/workspace-selectors.test.mjs`
- `npm run build`
Use the checked-in browser regression whenever a fix touches:

- admin/workspace boot
- cached-first admin tab and control visibility
- session-integrity gating for conflicting username claims
- session-integrity gating for removed identities
- create/login refusal and next-available username actions for taken handles
- editor boot or editor lifecycle
- attached autocomplete/dropdown geometry
- attached autocomplete close behavior on `Enter` or blur
- mounted-shell rerender boundaries, such as password modal inputs surviving unrelated workspace pane updates
- immediate-shell boot and first-interaction timing for public navigation
- other runtime paths that unit tests can miss because the failure only appears in a real browser
