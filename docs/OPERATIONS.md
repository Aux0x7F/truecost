# Operations Contract

This document captures the project-level operating expectations for True Cost.

It is intentionally separate from `ARCHITECTURE.md`:

- `ARCHITECTURE.md` describes the model
- `OPERATIONS.md` describes how the model should be run

## Public experience

- visitors receive static content first
- the browser may then apply trusted live updates
- when relay reads are incomplete, browsers may request repair and other peers may rebroadcast cached original public events
- GitHub Pages remains the reviewed baseline

## Admin experience

- admins edit collaborative units
- edits can propagate live to connected clients once trusted
- the repo does not need to be touched for day-to-day publishing changes

## Bakedown cadence

Current cadence:

- low traffic: around once per week
- higher traffic: around once per day

This cadence should be configurable on the pinner side.

## Trust rule

For now, all admins are equal.

That means:

- an admin-signed live update is eligible to affect visible state
- the client still verifies that the signer is currently in the valid admin set

## Collaborative unit priority

The priority order for collaborative units is:

1. static pages
2. investigations
3. entity and wiki records

This order should guide implementation work and bakedown support.

## Review boundary

Human review remains at the GitHub PR layer.

Live site behavior and static repo state can differ temporarily, but the PR is what advances the static baseline.
