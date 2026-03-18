# Components Contract

This file describes the component families that `truecost` should keep converging toward.

It exists so repeated UI patterns are implemented once, reused, and tested against a stable expectation.

Component behavior that spans a whole UI family should live in `scripts/surfaces`, not be rebuilt inside page controllers. Route-owned orchestration belongs in `scripts/features`, and shared state/controllers belong in `scripts/core`.

## Global shell

### Header and navigation

- The site header is static-first and readable before JavaScript enhancement.
- The mobile nav toggle must have a discernible accessible name in HTML.
- The nav drawer is an overlay surface:
  - the drawer scrolls
  - the page behind it does not
  - opening or closing it must not reflow the whole page unexpectedly

### Footer

- The footer copy is a site-wide tagline, not a page-specific note.
- The footer content should stay structurally consistent across pages.
- Editable footer content should use the same in-place editing rules as editable hero content.

## Surface panels

### `surface-panel`

- Default card shell for content, rails, and focused sections.
- Panels in the same row should align visually and avoid arbitrary height drift.
- Button rows in cards should align to the bottom when the cards are presented as peers.

### Rails

- Rails are supporting surfaces, not the main story.
- Rails align to the top of the main content they support.
- Rails scroll internally when they exceed the viewport.
- On mobile, control rails move above results when they drive the result set.

## Search and filtering

### Attached search

- Search, lookup, and filter controls should use one attached pattern.
- Submit modal entity and location fields are part of the same pattern, not a separate form-specific widget family.
- Suggestions open from the field itself and overlay what sits below.
- Suggestions close on `Enter` and when the field loses focus.
- Refocusing a field with a current value may reopen its attached suggestions.
- Fields support:
  - `ArrowUp`
  - `ArrowDown`
  - `Enter`
  - `Escape`
  - clear `x` inside the field
- Clearing the field must clear the active filter state, not only the visible text.
- Loading belongs in the field itself when the field is the active surface.

### Checkbox controls

- Checkboxes should render as intentional controls, not default browser boxes dropped into otherwise custom panels.
- When a checkbox is presented as a full-width consent or settings row, the whole row should act as the control.
- The checked and focus states must remain obvious without relying on browser-default styling.

## Workspace surfaces

### Workspace lists and rails

- Workspace panes should render from one list/rail contract per data family, not bespoke per-tab markup.
- Search, stats, and filters belong in the supporting rail when they drive a list below.
- Background refresh should patch list rows and counts in place instead of rebuilding the entire workspace pane.

### Notifications and profile menu

- Notification state belongs inside the profile menu, not as a separate menu surface.
- The badge is the compact state; the expanded list is a child state of the same menu.
- Clearing or consuming notifications should update the list in place without collapsing unrelated controls.

## Threads and comments

### Comment thread view

- Comments are rendered from a derived thread structure, not ad hoc nesting.
- The shared renderer and motion behavior belong in one surface module, not parallel page-local copies.
- Root comments may rerank by karma.
- Replies stay attached to their parent thread and keep thread-local order.
- Orphans never promote to roots.
- Votes apply to comments and replies.
- Vote changes must update visible state immediately.
- Root reranking should translate smoothly and keep the acted-on card readable during motion.

### Thread actions

- Reply, delete, moderation, and vote controls are inline thread actions.
- User-facing destructive actions should act on the represented branch consistently.
- Local optimistic thread state should survive background refresh until confirmed relay state catches up.

## Loading and cache-first surfaces

### Live surfaces

These include:

- archive lists
- comments
- map/entity views
- workspace lists
- notifications
- collaborative overlays

Expected behavior:

1. render static or cached baseline immediately
2. load fresher data in the background
3. patch in place

Do not blank useful content while waiting for background state.

## Extraction boundary

- `scripts/core`
  - state stores
  - request-signing and session/viewer controllers
  - formatting and transport helpers
- `scripts/features`
  - route-owned state and lifecycle
  - runtime/bootstrap
  - page-level orchestration
- `scripts/surfaces`
  - render families and bounded interaction shells

Root entry files should mostly create these layers and mount them.

## Surface modules

Current extraction targets:

- `scripts/core/page-drafts.js`
- `scripts/core/request-signer.js`
- `scripts/core/rendering.js`
- `scripts/core/navigation-state.js`
- `scripts/core/notification-state.js`
- `scripts/core/viewer-controller.js`
- `scripts/features/site-runtime.js`
- `scripts/features/archive-page.js`
- `scripts/features/map-page.js`
- `scripts/features/markdown-page.js`
- `scripts/features/review-workflow.js`
- `scripts/surfaces/navigation.js`
- `scripts/surfaces/profile-overlays.js`
- `scripts/surfaces/comments.js`
- `scripts/surfaces/archive.js`
- `scripts/surfaces/review-preview.js`
- `scripts/surfaces/investigation-detail.js`
- `scripts/surfaces/static-page-edit.js`
- `scripts/surfaces/submit-shell.js`
- `scripts/surfaces/workspace.js`
- `scripts/surfaces/workspace-filters.js`
- `scripts/surfaces/workspace-actions.js`
- `scripts/surfaces/map.js`
- `scripts/surfaces/editor-shell.js`

The next convergence targets are:

- editor collaboration rail behavior when that feature lands
- narrower selectors behind the remaining admin controller flows
- any remaining page-controller-owned notification or moderation detail that still has not moved into shared features or surfaces

## Modals and action sheets

- Focused actions should happen in a modal or inline action sheet, not by replacing the whole page.
- Action menus should stay context-bound to the item they operate on.
- If an action navigates to a filtered or threaded context, wait for the target context to exist before final focusing.
- Repeated item-action patterns should converge into one action-sheet family before another list invents its own.
- The current modal family is:
  - public profile overlays
  - submit modals
  - workspace action modals
  - workspace filter/search rails
  - editor modals
  Those should keep sharing one shell vocabulary instead of drifting per page.

## Editor shell

- The editor is a composed surface:
  - writing area
  - metadata rail
  - collaboration rail
  - media insertion from the toolbar at cursor
- Metadata does not belong above the document body.
- The editor shell must stay mounted during background sync or repair.

## Map surfaces

- Maps should keep the map instance mounted through background refresh when possible.
- Map views should fit or focus the currently shown entities after the relevant data and layout are ready.
- Map interactions should not depend on full page rerender.

## Compliance rule

When a repeated pattern appears more than once, the next change should move it toward:

- a shared helper in `scripts/core`
- a shared rendering primitive
- or a documented component contract here before another divergent copy is introduced
