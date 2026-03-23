# Browser Support

`truecost` should behave well across current Chromium, Firefox, and Safari-family browsers. The site is static-first, so the baseline cannot depend on one engine getting every enhancement right.

## Baseline

The site must still work without:

- JavaScript-enhanced labels
- backdrop blur
- custom scrollbar reservation
- Web Animations API
- every relay succeeding

If an enhancement is unsupported, the page should stay readable, navigable, and usable.

## Enhancement rules

- guard non-baseline CSS with `@supports`
- include vendor-prefixed variants when they are still the real path
- gate non-baseline JS behind capability checks
- respect `prefers-reduced-motion`

## Accessibility rules

- controls need a discernible accessible name in static HTML
- if JS changes a control’s meaning, keep `aria-*` and visual state aligned

## Current feature notes

- `backdrop-filter`
  - fallback: translucent background without blur
- `scrollbar-gutter`
  - fallback: normal scroll behavior
- reorder motion
  - fallback: no animation or a simple transform path

## Validation

When a change introduces browser-sensitive behavior:

- keep a fallback path in code
- note the decision in the PR
- do at least one manual check in the browser most likely to disagree with Chromium
