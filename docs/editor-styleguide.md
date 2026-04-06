# Investigation Editor Style Guide

## Interaction Principles

- Lists are the primary utility surface for object-based tools.
- The top row in a list is the intuitive add action for that object type.
- `Done` completes the current add/edit flow. It does not implicitly insert a new object unless the flow is explicitly an insertion action.
- Clicking a library row edits that library prototype.
- Clicking the square `+` on a library row inserts that object at the authoring cursor.
- Clicking an object already in the document edits that inserted instance, not the library prototype it may have come from.

## Toolbar Behavior

- Toolbar utilities should morph directly from their trigger buttons.
- Popovers should attach just below their trigger and overflow down over the document region, not expand inside the ribbon scroller.
- The toolbar and document should read as one surface with a divider, not as unrelated floating panels.
- Control strips should read as a single attached unit: one pill or bar with internal dividers rather than many separate buttons.

## Rail and Snap-ins

- Snap-ins should lead with the active interactive surface instead of decorative blank space.
- Eyebrow headings identify the tool, but the list or form should begin immediately below.
- Field-adjacent controls should visually attach to the field they influence.

## Object Authoring

- Wrapped objects use a shared mental model: list -> add/edit flow -> insert from list.
- Dragging should feel like grasping a real object, not like the document is constantly re-laying itself out under the cursor.
- During drag:
  - show the grasped object
  - show where it will be dropped
  - show edge affinity when it will clamp
  - avoid live reflow during pointer move
- Resize should snap to clear stepped widths rather than drift continuously.

## Media

- Crop handles must remain reachable from inside the crop border.
- Crop aspect ratio controls and transform controls should each be presented as a single strip with dividers.
- Banner defaults in TrueCost use the TrueCost accent background and light text.
- Banner and caption previews must reflect the current draft state immediately.

## Visual Language

- Use familiar visual conventions to reduce friction:
  - rounded control strips for grouped actions
  - squarer field and insert affordances where precision/action is implied
  - lighter secondary styling for metadata and outbound links
- The goal is immediate legibility and low-friction intuition, not ornamental complexity.
