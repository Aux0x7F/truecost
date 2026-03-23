# Components

This file is the shared playbook for UI families in `truecost`. Use it to keep repeated patterns aligned instead of rebuilding them ad hoc in page logic.

## Ownership

Keep the split simple:

- `scripts/core`
  - shared controllers, state helpers, and view-model helpers
- `scripts/features`
  - route and feature orchestration
- `scripts/surfaces`
  - rendering families and DOM patching

Features subscribe to the state they need. Surfaces render and patch their own regions. Unrelated updates should not recreate active inputs, open modals, or rails that did not change.

## Global shell

### Header and navigation

- The shell must be readable before enhancement.
- Public navigation should feel interactive early, even before heavier route features arrive.
- `Explore` groups the public discovery pages.
- `Map` is always public. It is never gated by account or relay state.
- The nav drawer is an overlay, not a page-layout event.

### Footer

- Footer structure stays consistent across pages.
- Footer content should read like site framing, not an implementation note.

## Panels, rails, and cards

### Panels

- `surface-panel` is the default shell for cards, rails, and focused blocks.
- Prefer extending it over inventing a new one-off wrapper.

### Rails

- Rails support the main content column.
- They align to the top of the content they support.
- They scroll internally when needed.
- On mobile, rails that drive results move above the result set.

### Cards and lists

- Repeated list/card families should share structure and action placement.
- Refreshes should patch rows and counts in place when possible.

## Search and dropdowns

Use one attached-field pattern for:

- archive search
- workspace search and filters
- graph search
- wiki search
- submit modal entity and location pickers

That pattern should:

- open from the field itself
- overlay what sits below it
- support keyboard navigation
- clear both visible text and active filter state

## Graph and wiki surfaces

- The graph rail owns graph search, filters, and the current-node summary.
- The wiki rail owns quick facts, relationships, citations, and graph navigation for the current entity.
- Shared graph data logic should live in data helpers, not in page-specific DOM code.
- Site-specific layout and moderation behavior stay here, not upstream.

## Workspace surfaces

### Workspace shell

- Tabs, pane content, and overlays should patch independently.
- Cached admin state should render useful shell state before a full sync finishes.

### User and moderation rails

- Search, filters, and summary stats belong in the rail when they drive a list.
- Removed users stay hidden by default unless the UI explicitly asks for them.

### Notifications and profile menu

- Notifications live inside the profile menu family.
- Badge state and expanded list state belong to the same surface.

### Account/profile flows

- Usernames are immutable account handles.
- Profile settings should not render editable username or display-name fields.
- Password and session warnings should replace only the affected pane, not the entire workspace shell.

## Editor and authoring surfaces

- The editor is a composed shell, not a long form with helpers bolted on.
- Writing surface, metadata rail, and collaboration/live state should stay separate.
- Background sync must not tear down the editor shell.
- Investigation image placement needs to survive the full path through local state, export, and rendering.
