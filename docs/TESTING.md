# Testing

`truecost` is the user-facing site. If something slips here, people see it immediately. The testing bar should reflect that.

## Baseline

For most changes, the minimum bar is:

- a deterministic test for the state or rendering rule you changed
- a feature/runtime test when behavior moves out of an entry file
- a browser check when the bug depends on real DOM timing, boot order, layout, or interaction
- syntax/build validation for touched modules

Pure copy or cosmetic docs work does not need the full runtime suite. Live-state, shell, workspace, and authoring work does.

## What different changes need

### Runtime and projection changes

Cover:

- projection envelope behavior
- `status` changes that do not wipe last good `value`
- cached-first restore
- stale or degraded refresh behavior
- cross-tab or shared-runtime expectations when relevant

### Document and editor changes

Cover:

- immediate restore from durable document state
- draft/history round-trip
- document-controller behavior
- exporter behavior when storage or structured fields change
- structured image placement round-trip

### UI and surface changes

Cover:

- the surface that owns the behavior
- in-place patching instead of whole-shell replacement
- attached search/dropdown behavior when relevant
- preservation of active inputs during background updates

### Browser-sensitive changes

Browser checks are required when the failure depends on:

- boot order
- focus/blur timing
- dropdown geometry
- mounted-shell rerender boundaries
- first interaction timing
- service worker or build output behavior

### Auth and account changes

Cover:

- generic mismatch behavior for stale or superseded passwords
- password minimum enforcement in UI and action logic
- password reuse rejection before any session mutation
- current-owner validation before persisting a session
- support-bundle compatibility when upstream session behavior changes

## Core scenarios worth keeping honest

Where applicable, tests should exercise:

- cached-first render
- optimistic local change
- reload resilience
- stale merge against richer local state
- nested thread integrity
- visible control effect after mutation
- ranking or ordering rules
- session integrity and removed/conflict behavior
- shell or modal stability during background updates

## Current commands

- `node --check <file>`
- `node --test tests/runtime-client.test.mjs`
- `node --test tests/site-runtime.test.mjs`
- `node --test tests/navigation-notification.test.mjs`
- `node --test tests/account-actions.test.mjs`
- `node --test tests/workspace-actions.test.mjs`
- `node --test tests/workspace-runtime-projections.test.mjs`
- `node --test tests/document-local-state.test.mjs`
- `node --test tests/document-projection-sync.test.mjs`
- `node --test tests/editor-live-overlay.test.mjs`
- `node --test tests/graph-wiki.browser.test.mjs`
- `node --test tests/admin-editor-submit.browser.test.mjs`
- `npm run build`

`node --test tests\\*.test.mjs` remains the broad downstream sweep.

## When browser validation is mandatory

Use the checked-in browser regressions when a fix touches:

- admin/workspace boot
- shell interactivity timing
- cached-first admin rendering
- dropdown geometry or close behavior
- modal/input stability during rerenders
- editor boot or editor lifecycle
- projection-backed DOM timing that unit tests can miss
