# Architecture

`truecost` is the concrete site layer. It owns the public experience, operator workflows, project policy, site copy, and styling. It builds on [`nostr-site`](https://github.com/Aux0x7F/nostr-site), which in turn uses [`nostr-crdt`](https://github.com/YousefED/nostr-crdt) for collaborative transport.

## Repo split

- `nostr-crdt`
  - sync and transport
- `nostr-site`
  - generic site runtime, projections, document plumbing, pinner integration
- `truecost`
  - actual site behavior, visuals, content model, moderation flow, and operator choices

The framework stays generic upstream. Site-specific behavior stays here.

## How the site works

The site is static-first:

1. GitHub Pages serves a built snapshot.
2. The browser boots the shell immediately.
3. Runtime state restores from local durable data when it can.
4. Live relay state reconciles in the background.
5. Mounted features patch their own regions instead of rebuilding whole pages.

That keeps the site readable without JavaScript and still lets the live layer do useful work after load.

## Browser runtime

The browser runtime is split into four jobs:

- shared worker
  - same-origin runtime owner
  - auth/session actions
  - relay-backed reductions
  - shared projection state
- IndexedDB
  - durable local store for projections, document state, cached events, and session metadata
- service worker
  - cache and fetch boundary for pages, assets, and materialized snapshots
- feature controllers
  - subscribe to projection slices and patch only the DOM roots they own

Shared projections use one envelope shape:

- `value`
- `status`
- `digest`
- `updatedAt`

If a refresh degrades or comes back empty, the runtime updates `status` without wiping the last good `value`.

## Code layout

- `scripts/core/`
  - runtime adapters, controllers, state helpers, projection helpers, and shared utilities
- `scripts/features/`
  - route-level orchestration and lifecycle
- `scripts/surfaces/`
  - reusable rendering families and DOM-facing UI helpers

Keep the split strict:

- persistent shared state belongs in runtime/document helpers
- orchestration belongs in features
- rendering belongs in surfaces
- tab-local UI state stays local to the page

## Publication and bakedown

The browser is not the final publisher.

The publishing path is:

1. live state exists on relays
2. admins work against the live layer
3. pinner materializes approved state into static output
4. GitHub review and merge advance the baseline

That means:

- public HTML stays crawlable
- the browser is progressive enhancement, not the source of truth for publication output
- built pages and bakedown inputs need to stay aligned

## Current authoring model

The site now has a runtime-backed document layer and a structured-document path for richer authored units. Investigations still carry transitional markdown-compatible behavior in places, but document state, projection state, and publication state are no longer page-local one-offs.

## A few terms

- static-first
  - the built site must already be useful before live state arrives
- live overlay
  - relay-backed updates applied after load when they are trusted
- projection
  - a reduced runtime view of shared state
- document controller
  - the layer that owns document open/apply/close behavior
- bakedown
  - turning approved live state back into reviewed static output
- pinner
  - the service that materializes approved state and opens or updates PRs
