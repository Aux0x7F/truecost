# Operations

This is the day-to-day operating model for the site.

## Public baseline

Readers get a built static site first. Live state can enrich that baseline later, but the baseline still has to stand on its own.

That means:

- GitHub Pages is the reviewed public snapshot
- relay-backed state can update the live experience between bakedowns
- incomplete relay reads should degrade gracefully instead of blanking the site

## Admin workflow

Admins work against the live layer:

- edit and review collaborative units
- moderate public state
- manage submissions
- request bakedowns when the live state is ready to turn into a reviewed snapshot

The repo should not need hand edits for routine live operations.

## Bakedown cadence

Use a cadence that matches activity:

- quieter periods: around weekly
- active periods: around daily

The exact timing belongs to the pinner and operator workflow, not to the browser.

## Trust and review

Current rule:

- trusted admin signatures can affect the live layer
- GitHub review and merge still decide what becomes the next static baseline

Live behavior can move ahead of the committed snapshot for a while. That is expected. Review is still the line that advances the built site.
