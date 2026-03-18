# Testing Contract

`truecost` is the concrete product surface. Regressions here are user-visible immediately.

## Minimum bar

Changes to live state, cached state, comments, filters, maps, workspace surfaces, or collaborative units should have:

- a focused deterministic test for the data/state contract
- syntax validation for touched modules
- a clear statement of what user behavior was verified

## Required live-state cases

Where applicable, cover:

- cached-first render
- optimistic local updates
- reload resilience
- stale remote merge behavior
- nested thread integrity
- visible control effect after local mutation
- ranking and ordering rules when local mutation changes score or status
- manual verification for motion where visual continuity is part of the interaction contract

## Current commands

- `node --check <file>`
- `node --test tests/comment-refresh.test.mjs`
- `node --test tests/comment-vote-ranking.test.mjs`

Higher-level browser validation should continue in the sibling `nostr-site` smoke tooling until `truecost` has its own expanded harness.
