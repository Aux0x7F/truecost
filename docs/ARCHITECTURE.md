# Architecture

This document captures the current operating model for The True Cost Project site.

## Repo boundary

The site depends on two sibling layers:

- `nostr-crdt`
  - generic CRDT transport over Nostr
- `nostr-site`
  - generic site framework, admin model, moderation model, peer pinner integration

`truecost` is the project-specific implementation layer.

## Product model

The publishing model is:

1. Visitors load static content first.
2. After load, the browser may connect to Nostr and receive newer live state.
3. If a live update is signed by a currently trusted admin, the client may apply that update as an overlay.
4. Peer pinner periodically materializes the latest trusted state into repo files and opens or updates a GitHub PR.
5. GitHub review and merge advance the static baseline.

This means the public site should feel static-first, but still allow live admin-authored updates between bakedowns.

## Cache-first live component contract

Every live component on the site should follow the same rule:

1. render static or cached baseline immediately
2. load fresher relay state in the background
3. patch the mounted component in place through the feature or component root that actually owns that state

Comments, filters, maps, workspace lists, notifications, and collaborative units should all behave that way.

A loading state is only appropriate when there is no useful cached or static baseline to show.

Network state and local draft UI state should stay separate. Background relay or cache updates must not replace unrelated active form DOM.

## Code layering

The implementation now follows four layers:

- `scripts/core`
  - transport wrappers
  - cache and public-state normalization
  - subscribed public-state store lifecycle
  - observed-region routing helpers for mounted shells and feature roots
  - query-state helpers for observed URL param routing
  - account action orchestration for login and password rotation commit boundaries
  - navigation UI state
  - notification state
  - viewer/session/request-signer controllers
  - workspace access, cache, projections, selectors, site-key, entity-form, and filter-data helpers
  - shared draft and review helpers
  - shared rendering helpers for loading, markdown, tags, and TOC
  - reusable rendering helpers for shared controls
- `scripts/features`
  - route-owned state + logic modules
  - feature-owned root observation and region routing
  - site runtime/bootstrap lifecycle
  - archive page
  - map page
  - markdown/article page
  - review workflow
  - workspace runtime
  - workspace shell
  - workspace tabs
  - workspace inbox/chat
  - workspace deep links
  - workspace mutations
  - workspace user lookup
  - any future route-level collaborative shells
- `scripts/surfaces`
  - composed surface modules that render and update one UI family at a time
  - profile overlays
  - archive
  - comments
  - investigation detail
  - map
  - review preview
  - static page edit
  - submit shell
  - workspace
  - workspace filters
  - workspace actions
  - workspace review and audit log
  - editor shell
- HTML documents
  - static baseline markup
  - mount points for live surfaces

`app.js` should stay a bootstrap and route-mount file, not a dumping ground for feature logic. Page files should compose shared features and surfaces. They should not reintroduce duplicate escaping, duplicate comment threading, duplicate request-signer logic, or duplicate attached-search behavior.

The CSS now follows the same split:

- `styles.css`
  - generated bundled stylesheet loaded by pages for first paint
- `styles/`
  - ordered source partials by shared foundation, surface family, and responsive override layer
  - shared control, dropdown, comment, workspace, editor, and responsive selector families should collapse into the early partials instead of being recopied per surface
- `tooling/build-styles.mjs`
  - rebuilds `styles.css` from the ordered source partials

That keeps the CSS boundary closer to the JS surface split instead of letting one root stylesheet keep absorbing every component family.

The codebase now applies this split to navigation, profile-menu state, notifications, archive, comments, investigation detail, static-page editing, submit shell rendering, public profile overlays, workspace rendering, workspace actions, workspace review/log rendering, map shells, editor-shell rendering, shared draft/review helpers, shared rendering helpers, request-signer helpers, workspace cache/access/projection helpers, and a shared `public-state-store` boundary for public, workspace, and editor controllers. Future refactors should keep reducing remaining heavy controllers into composed feature modules backed by explicit shared state helpers.

Mounted shell updates now also follow an observed-region rule:

- if the shell structure is already mounted, features should update only the changed regions
- unchanged overlays and active form roots must be left in place
- full shell replacement is only appropriate when the structure itself changes

URL query params follow the same pattern:

- query params are shared observed state, not ad hoc page globals
- features subscribe only to the params they consume
- features route query changes to the DOM roots they own
- param writes should go through the shared query-state helper so history, popstate, and mounted surfaces stay in sync

Account auth flows follow a similar separation:

- identity-chain resolution belongs in shared resolvers and upstream session primitives
- session persistence belongs in session management, not UI handlers
- login and password rotation orchestration belongs in a dedicated account action layer
- login must not leak whether a password was previously valid; stale or superseded credentials should collapse to a generic mismatch at login time

The next tightening step is thinning the remaining account/profile/upload handler families the same way the workspace shell, tabs, inbox, site-key, selector, and mutation layers were reduced, then continuing feature-facing work on top of the normalized shell: collaborative editor rails, richer entity relationships, and broader live-unit coverage.

## Trust model

For now, an admin is an admin.

The client rule is:

- each live privileged update is signed by the admin's own key
- the client reconstructs the current admin set from the existing True Cost admin grant and revoke chain
- only updates from currently trusted admins are applied as live overlay

The inbox key is not the signing key for public live content updates.

## Collaborative units

The units already targeted for collaboration are:

- static pages such as `home`, `about`, `guide`, and other editable public sections
- investigations
- entity records and eventual wiki-like enrichment
- evidence-graph relationships and admin-only draft relationship overlays layered onto entity records

Recommended document ids:

- `page:<page-id>`
- `post:<slug-or-id>`
- `entity:<entity-id>`
- `relationship:<source>:<type>:<target>` when explicit relationship records graduate from local draft overlay into shared state

Each unit should collaborate independently. The site should not use one giant shared document.

## Current implementation

Today, True Cost already has:

- static-first pages
- relay-backed live state for admin actions, drafts, entities, comments, and submissions
- peer-pinner PR bakedown support
- in-place page editing and editorial review mechanics
- CRDT-backed live overlay plumbing for static page units
- trusted static-page live updates applied after the static baseline loads
- trusted investigation live updates applied in the editor and detail view on top of the static or draft baseline
- cached-first admin workspace boot, including admin tabs and inbox-aware state before relay sync completes
- a seeded evidence-graph and wiki layer:
  - `graph.html` for high-level graph exploration
  - `wiki.html` for entity wiki pages and directory search
  - admin-only local draft entities and draft relationships layered over the shared graph state until real relationship publishing lands

Today, True Cost does not yet have:

- archive-wide and entity-record live overlay coverage
- periodic PR cadence driven from the live collaborative unit layer instead of the older review queue
- published shared relationship records and relationship review workflow beyond the current local draft graph overlay

## Testing contract

Feature work is not complete until the expected behavior is covered at the right layer.

At minimum, changes to live or cached behavior should be covered for:

- cache-first restore
- optimistic update persistence
- reload resilience
- stale remote merge behavior
- hierarchy preservation for threaded data

## Target implementation

The next architectural shift is:

- expand `nostr-crdt` usage beyond static pages into investigations and entity records
- let `nostr-site` keep the trust and publishing policy
- let `truecost` define which units are collaborative and how they render

That should simplify:

- concurrent editing
- merge handling
- multi-admin live updates
- periodic bakedown into GitHub

## Pinner cadence

The pinner behavior is periodic PR generation, not per-edit PR generation.

Initial cadence:

- start around once per week while traffic is low
- increase toward once per day as activity justifies it

The pinner should materialize current trusted live state into repo files and update a PR on that cadence.

## Why this model

This keeps the UX simple:

- admins edit units
- visitors see trusted live improvements quickly
- the repo still remains the reviewed static baseline

It also keeps the system understandable:

- Nostr is transport
- CRDT handles shared state and merging
- `nostr-site` handles trust and publishing policy
- GitHub remains the reviewed static publication layer
