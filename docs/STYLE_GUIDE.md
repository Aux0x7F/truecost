# Style Guide

The site should feel deliberate, readable, and trustworthy. The point is not novelty for its own sake. The point is to make a serious site feel alive without turning it into a generic app shell.

## Product feel

- static content first
- live updates layered in, not shoved in front
- strong main column, supporting rails
- direct copy over implementation-heavy language
- interactions that feel responsive without becoming noisy

## Layout rules

- the main content column leads
- rails support the main story
- rails should align to the content they support
- sticky rails scroll internally when needed
- on mobile, control rails move above results

## Shared primitives

Prefer extending the shared families before inventing a new one:

- `surface-panel`
- primary and ghost buttons
- tag rows and compact metadata
- attached search/select controls
- modal cards

Repeated styling belongs in shared layers before another page copies it again.

## Interaction rules

- loading belongs in the thing that is loading
- useful cached state should render immediately
- background refresh should patch in place
- attached dropdowns should feel anchored to their field
- keyboard support matters for pseudo-dropdowns
- interactive controls need accessible names in the static HTML

## Copy rules

- keep interface language plain and direct
- avoid implementation jargon in the UI
- labels should be short and clear
- calls to action should point at the next move, not explain the system

## Motion and feedback

- motion should clarify change, not decorate it
- rank changes and repositioning should be readable at a glance
- reduced-motion preferences must be respected
- if motion is not well-supported, the fallback still has to feel clean

## Editor feel

- the editor is the main authoring surface
- metadata belongs beside the writing surface
- background sync must not tear down the shell
- image handling should feel intentional and predictable
