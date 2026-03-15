# Architecture

This document captures the intended operating model for The True Cost Project site so it does not depend on chat history.

## Repo boundary

The site depends on two sibling layers:

- `nostr-crdt`
  - generic CRDT transport over Nostr
- `nostr-site`
  - generic site framework, admin model, moderation model, peer pinner integration

`truecost` is the project-specific implementation layer.

## Product model

The intended publishing model is:

1. Visitors load static content first.
2. After load, the browser may connect to Nostr and receive newer live state.
3. If a live update is signed by a currently trusted admin, the client may apply that update as an overlay.
4. Peer pinner periodically materializes the latest trusted state into repo files and opens or updates a GitHub PR.
5. GitHub review and merge advance the static baseline.

This means the public site should feel static-first, but still allow live admin-authored updates between bakedowns.

## Trust model

For now, an admin is an admin.

The intended client rule is:

- each live privileged update is signed by the admin's own key
- the client reconstructs the current admin set from the existing True Cost admin grant and revoke chain
- only updates from currently trusted admins are applied as live overlay

The inbox key is not the signing key for public live content updates.

## Collaborative units

The units that should become collaborative over time are:

- static pages such as `home`, `about`, `guide`, and other editable public sections
- investigations
- entity records and eventual wiki-like enrichment

Recommended document ids:

- `page:<page-id>`
- `post:<slug-or-id>`
- `entity:<entity-id>`

Each unit should collaborate independently. The site should not use one giant shared document.

## Current implementation

Today, True Cost already has:

- static-first pages
- relay-backed live state for admin actions, drafts, entities, comments, and submissions
- peer-pinner PR bakedown support
- in-place page editing and editorial review mechanics

Today, True Cost does not yet have:

- generic CRDT-backed live collaborative units
- live trusted overlay derived from CRDT document state

## Target implementation

The next architectural shift should be:

- use `nostr-crdt` for collaborative units that need shared state
- let `nostr-site` provide the trust and publishing policy
- let `truecost` define which units are collaborative and how they render

That should simplify:

- concurrent editing
- merge handling
- multi-admin live updates
- periodic bakedown into GitHub

## Pinner cadence

The intended pinner behavior is periodic PR generation, not per-edit PR generation.

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
