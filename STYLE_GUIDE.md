# Style Guide

## Purpose
This file is the UI contract for `truecost`.

It exists to keep the public site coherent while the codebase continues to grow:
- one visual language
- one interaction language
- one set of component expectations
- less page-by-page drift

See [COMPONENTS.md](./COMPONENTS.md) for the expected reusable component families.

## Product Shape
- Static baseline first. Every public page should render useful content before live data arrives.
- Live overlay second. New relay data should enrich or update the current view without blanking the baseline.
- Public pages stay crawlable and readable without client-side authoring state.
- Interactive behavior should feel like a web app without becoming a full SPA.

## Layout Rules
- The main content column is primary.
- Side rails are support surfaces, not the main story.
- Side rails should align to the top of the content card they support.
- Sticky rails must scroll internally when their content exceeds the viewport.
- On mobile, filter/control rails should move above results when they drive the result list.

## Core Primitives
- `surface-panel`: the default card shell
- `button` / `button-ghost`: primary and secondary actions
- `tag-row` / `tag`: compact metadata and states
- `workspace-search`: attached search/autocomplete field
- `workspace-select`: full-width select control
- `picker-results--dropdown`: attached pseudo-dropdown, always anchored to its field
- `modal-card`: focused tasks, not long-form page replacement

Do not create a new card/button/search pattern when one of these can be extended.

The shared JS entry points for these primitives belong in `scripts/core`:
- `text-utils.js`
- `comment-utils.js`
- `comment-ranking.js`
- `search-controls.js`
- `public-state.js`

Whole UI families that compose those primitives belong in `scripts/surfaces`, not directly in page controllers.

Current extracted surface families:

- `navigation`
- `archive`
- `comments`
- `workspace`

## Interaction Rules
- Search suggestions open from the field itself and overlay content below them.
- `x` inside a search field must clear both the field and the active filter state.
- Keyboard support is required for attached dropdowns:
  - `ArrowDown`
  - `ArrowUp`
  - `Enter`
  - `Escape`
- Spinners belong inside the control or component that is loading.
- Loading should preserve expected layout space; do not collapse sections while data is pending.
- Background refreshes should update data in place, not rebuild whole panels unless structure truly changed.
- If useful cached data exists, render it first and update in place instead of showing a blank loading state.
- Interactive buttons and toggles must have a discernible accessible name in the static HTML, not only after JavaScript enhancement.

## Content Rules
- User-facing text should be plain and direct.
- Avoid implementation language in the interface.
- Titles and body copy should not inherit decorative styling intended for labels or badges.
- Calls to action should point people toward action, not explain implementation details.

## Comment and Thread Rules
- Top-level comments may be ranked.
- Replies stay structurally attached to their parent thread.
- Replies should not be re-ranked in a way that breaks conversation flow.
- Optimistic comment updates should resolve in place instead of replacing the whole comment surface.
- Every comment and reply may accumulate karma.
- Vote controls must update the visible score immediately.
- Root comment vote changes may rerank the root list.
- Reply vote changes must not reorder the thread.
- If a root comment reranks, the card should translate smoothly into place on a clearly readable timescale, not snap or finish so fast that the motion is hard to perceive.
- During that motion, the voted root card should stay visually above neighboring cards and remain opaque enough that cards do not appear to move through each other.
- When the motion completes, the viewport should ease back to the voted root card rather than snapping.

## Editor Rules
- The editor is the primary authoring surface, not a form with extras.
- Toolbar actions belong in the toolbar, at cursor, with predictable results.
- Metadata and collaboration controls belong in a right rail, not above the writing surface.
- The editor shell must remain mounted during background state repair.

## State and Rendering Rules
- Separate long-lived state from DOM rendering concerns.
- Cached state should render immediately when trustworthy.
- Live updates should patch the current surface instead of tearing it down.
- Partial relay reads should not erase richer cached state.
- Any reusable state/render pattern should be moved toward a shared helper before duplicating it again.

## Testing Expectations
- A live-surface change should ship with a regression test for the data contract it depends on.
- Claims about reload behavior, stale merges, or thread integrity should be backed by deterministic tests, not only manual checking.
- Browser-sensitive features should follow [BROWSER_SUPPORT.md](./BROWSER_SUPPORT.md).

## Next Convergence Targets
- reusable filter/search rail components
- reusable modal/action-sheet patterns
- reusable card families
- reusable live list/thread rendering helpers
- reusable editor-side rails and collaboration UI
