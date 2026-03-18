# Browser Support Contract

`truecost` is static-first and should degrade cleanly across current Chromium, Firefox, and Safari-family browsers.

## Baseline rule

The baseline experience must work without:

- JavaScript-enhanced labels
- backdrop blur
- custom scrollbar reservation
- Web Animations API
- any one specific relay succeeding

Unsupported enhancements may be ignored by a browser, but that must not break layout, access, or core navigation.

## Progressive enhancement rules

- Put non-baseline CSS features behind `@supports`.
- Use vendor-prefixed variants where that is still the real compatibility path.
- Keep the fallback visual treatment acceptable before enhancement applies.
- Put non-baseline JS features behind capability checks.
- For motion, provide a real fallback path and respect `prefers-reduced-motion`.

## Accessibility rules

- Interactive controls must have a discernible accessible name in the static HTML, not only after JavaScript runs.
- If JS changes the meaning of a control, update `aria-label` and related state along with the visual state.

## Current feature rules

- `backdrop-filter`
  - fallback: translucent background without blur
  - enhancement: gated with `@supports`, include `-webkit-backdrop-filter`
- `scrollbar-gutter`
  - fallback: ordinary scroll container
  - enhancement: gated with `@supports`
- reorder motion
  - fallback: no motion or JS fallback transform path
  - enhancement: WAAPI when available

## Validation expectation

Changes that introduce new browser-sensitive features should include:

- at least one fallback path in code
- a note about the compatibility decision in the PR
- a quick manual pass on the browser most likely to disagree with Chromium
