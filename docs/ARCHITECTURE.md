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

Publication remains static-first:

- generated HTML must stay meaningful and crawlable without JavaScript
- browser runtime is progressive enhancement only
- pinner performs final bakedown from approved structured content and projections
- browser-side snapshot/publish work should not be treated as the final publication renderer

## Cache-first live component contract

Every live component on the site should follow the same rule:

1. render static or cached baseline immediately
2. load fresher relay state in the background
3. patch the mounted component in place through the feature or component root that actually owns that state

Comments, filters, maps, workspace lists, notifications, and collaborative units should all behave that way.

A loading state is only appropriate when there is no useful cached or static baseline to show.

Network state and local draft UI state should stay separate. Background relay or cache updates must not replace unrelated active form DOM.

## Browser runtime split

The browser runtime is now moving toward four explicit layers:

- shared worker
  - same-origin runtime owner
  - auth/session and signing actions
  - relay subscriptions and reducers
  - cross-tab projection state
- IndexedDB
  - durable local database
  - raw events
  - reduced public-state tables
  - graph/wiki projections
  - comment and notification tables
  - document checkpoints and account metadata
- service worker
  - shell/assets/content/materialized-snapshot cache only
  - not the primary live reducer runtime
- feature subscriptions
  - page and shell features subscribe to projection slices and update only the DOM roots they own

This is the intended division of responsibility:

- presentation should not own wallet or key logic
- same-origin tabs may share session/runtime state
- different origins must not share worker/session state
- features should render from local durable state first, then reconcile live state in the background

## Code layering

The implementation now follows four layers:

- `scripts/core`
  - transport wrappers
  - cache and public-state normalization
  - shared runtime client and host glue
  - durable runtime projection helpers
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
  - structured investigation document bridge and image-placement helpers
- `scripts/features`
  - route-owned state + logic modules
  - feature-owned root observation and region routing
  - site runtime/bootstrap lifecycle
  - archive page
  - map page
  - markdown/article page
  - review workflow
  - workspace account/login/profile/password flows
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

The runtime-specific files now begin to follow a matching split:

- `site-runtime-worker.js`
  - shared-worker entry
- `scripts/core/site-runtime-host.js`
  - browser-side runtime host bridge
- `scripts/core/runtime-client.js`
  - page/shell client for worker-backed actions and projection subscriptions
- `scripts/core/runtime-document.js`
  - structured-document controller bridge
- `scripts/core/runtime-public-state.js`
  - runtime-backed public projection helpers
- `scripts/core/runtime-projections.js`
  - named projection accessors and subscription helpers

`app.js` should stay a bootstrap and route-mount file, not a dumping ground for feature logic. Page files should compose shared features and surfaces. They should not reintroduce duplicate escaping, duplicate comment threading, duplicate request-signer logic, or duplicate attached-search behavior.

Public pages now also have an immediate-shell boundary:

- `scripts/shell.js`
  - renders the nav/profile shell from local session state as soon as the document is ready
  - keeps public navigation interactive before the heavier runtime and route features finish booting
  - owns the global auth modal and service-worker registration
- `scripts/app.js`
  - upgrades that shell with live public state, notifications, overlays, and route-owned features
  - loads heavier route features through a shared feature manifest instead of importing every public feature synchronously
- `scripts/core/page-router.js`
  - provides the shared route-mount pattern so page entry files stop hand-rolling their own scheduling logic
- `scripts/core/feature-manifest.js`
  - caches and preloads route feature modules so public boot can stay interactive before every feature payload arrives

The CSS now follows the same split:

- `styles.css`
  - generated bundled stylesheet loaded by pages for first paint
- `styles/`
  - ordered source partials by shared foundation, surface family, and responsive override layer
  - shared control, dropdown, comment, workspace, editor, and responsive selector families should collapse into the early partials instead of being recopied per surface
- `tooling/build-styles.mjs`
  - rebuilds `styles.css` from the ordered source partials
- `site-src/`
  - source page bodies and template inputs used by the build
  - page definitions carry bakedown-relevant metadata such as template kind, content collections, and interactive mounts
- `build.mjs`
  - renders site HTML from `site-src` into `dist/` only
  - creates a minified `dist/` artifact with ESM code-split browser entrypoints and minified HTML for deploys
  - emits a versioned service worker aligned with the rendered page/input manifest

That keeps the CSS boundary closer to the JS surface split instead of letting one root stylesheet keep absorbing every component family.

The codebase now applies this split to navigation, profile-menu state, notifications, archive, comments, investigation detail, static-page editing, submit shell rendering and submit public-state hydration, public profile overlays, workspace rendering, workspace actions, workspace review/log rendering, map shells, editor-shell rendering, shared draft/review helpers, shared rendering helpers, request-signer helpers, workspace cache/access/projection helpers, workspace account flows, and a shared runtime-backed public-state store boundary for public, workspace, editor, and submit controllers. Future refactors should keep reducing remaining heavy controllers into composed feature modules backed by explicit shared state helpers.

Static page snapshots now also follow the document/runtime path instead of a page-specific projection cache:

- static page snapshot content is stored through the runtime document controller
- page-backed structured document metadata carries keyed page content plus snapshot timestamps
- editor page lifecycle now boots through a feature controller instead of ad hoc page-script event wiring

Mounted shell updates now also follow an observed-region rule:

- if the shell structure is already mounted, features should update only the changed regions
- unchanged overlays and active form roots must be left in place
- full shell replacement is only appropriate when the structure itself changes

URL query params follow the same pattern:

- query params are shared observed state, not ad hoc page globals
- features subscribe only to the params they consume
- features route query changes to the DOM roots they own
- param writes should go through the shared query-state helper so history, popstate, and mounted surfaces stay in sync

Static markup now follows a matching source/build rule:

- source HTML bodies live in `site-src/main/*.html`
- page metadata and bakedown-facing template inputs live in `site-src/pages.mjs`
- deployable page HTML lives in `dist/`; repo-root page HTML is treated as legacy and removed
- page shells and bakedown inputs should stay aligned so static snapshots can be materialized from the same page definitions the build already uses
- browser-side publish/snapshot should feed structured content and projection state to pinner, not bypass the bakedown templates

Account auth flows follow a similar separation:

- identity-chain resolution belongs in shared resolvers and upstream session primitives
- session persistence belongs in session management, not UI handlers
- login and password rotation orchestration belongs in a dedicated account action layer
- login must not leak whether a password was previously valid; stale or superseded credentials should collapse to a generic mismatch at login time

The next tightening step is thinning the remaining upload, moderation-detail, and other handler-heavy families the same way the workspace account, shell, tabs, inbox, site-key, selector, and mutation layers were reduced, then continuing feature-facing work on top of the normalized shell: collaborative editor rails, richer entity relationships, and broader live-unit coverage.

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

Structured content is now the intended long-term authoring source for those units. Markdown may remain as a compatibility/export format, but not as the final authoring model.

Recommended document ids:

- `page:<page-id>`
- `post:<slug-or-id>`
- `entity:<entity-id>`
- `relationship:<source>:<type>:<target>` when explicit relationship records graduate from local draft overlay into shared state

Each unit should collaborate independently. The site should not use one giant shared document.

## Structured document contract

Investigations, wiki pages, and eventually static pages should move to a structured document model with:

- document schema
- document controller
- document store
- room adapter
- exporters

Exporters should derive:

- public HTML
- search text
- citations
- entity refs
- relationship candidates

The first pass may keep the current editor UI as an adapter if that accelerates delivery, but the stored document model should still be structured rather than markdown-first.

Investigation image handling is now a required document capability. It must preserve:

- drag placement
- float left
- float right
- center
- full width
- fill-crop box

Those image-placement modes must round-trip through:

- local persistence
- CRDT collaboration
- export and bakedown
- public HTML rendering

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
  - admin-only runtime-owned draft entities and draft relationships layered over the shared graph state until real relationship publishing lands
- source-templated page generation:
  - `site-src/main/*.html` for page bodies
  - `site-src/pages.mjs` for page definitions and bakedown-facing template inputs
- `build.mjs` as the source of generated `dist/` HTML and assets
- shell-owned auth entry:
  - logged-out navigation opens a global create/login modal on any public page
  - session changes are routed back into workspace, submit, and editor shells through shared events
- deferred route feature loading:
  - shell and page chrome mount immediately
  - route features load by manifest and reconcile in the background
- a versioned service worker for static pages, first-paint assets, and content/index warm cache
- shared-worker runtime primitives and IndexedDB-backed runtime storage
- runtime client and host glue for worker-owned projections
- projection envelopes with `value`, `status`, `digest`, and `updatedAt`, retaining last-good values through degraded refreshes
- a downstream structured-document bridge for investigations while the current editor UI remains a transitional adapter
- graph/wiki relationship derivation from investigation relationship candidates, including admin draft overlays

Today, True Cost does not yet have:

- archive-wide and entity-record live overlay coverage
- periodic PR cadence driven from the live collaborative unit layer instead of the older review queue
- published shared relationship records and relationship review workflow beyond the current local draft graph overlay
- full worker-owned projection reduction for every major route family
- a full structured-document-native editor UI beyond the current adapter layer

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

- let `nostr-site` own shared worker/runtime, projection, and structured-document primitives
- let `truecost` consume those primitives with project-specific features, surfaces, and visual language
- move more reduction and cross-tab runtime state into the shared worker
- keep pinner as the owner of final static bakedown from approved structured content and projections

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
