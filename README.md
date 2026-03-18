# The True Cost Project

Static-first True Cost site draft for GitHub Pages with a shared Nostr-backed account, submission, entity, and draft layer.

The reusable framework now lives separately in the sibling `nostr-site` repo.

## Structure

- `scripts/`: True Cost browser code and route entrypoints
- `scripts/core/`: shared services, stores, controllers, formatting, and transport helpers
- `scripts/features/`: route-owned feature orchestration and lifecycle modules
- `scripts/surfaces/`: shared presentational UI families
- `docs/`: contract, operations, and roadmap documents for the current site
- `docs/README.md`: index of architecture, component, testing, browser-support, and operating contracts
- `vendor/nostr-site-support.esm.js`: vendored minified browser bundle built from `nostr-site/support-lib`
- sibling `nostr-site/`: standalone generic framework repo boundary, including the bundled `peer-pinner` package

## Pages

- `index.html`: landing page
- `investigations.html`: archive
- `investigation.html`: markdown-backed detail page with comments
- `guide.html`: markdown-backed guide
- `submit.html`: logged-in submission list, edit flow, and message thread
- `map.html`: entity map and geographic index
- `admin.html`: login, profile options, and role-based workspace
- `get-involved.html`, `about.html`, `merch.html`: supporting pages

## Content updates

### Investigations

1. Add or edit a markdown file in `content/investigations/`.
2. Add the filename to `content/investigations/index.json`.
3. Keep post metadata in the `<!--TCMETA ... -->` block at the top of the file.

### Guide

Edit `content/pages/guide.md`.

## Config

Update `scripts/core/site-config.js` for project links, relay list, and keys:

- `donateUrl`
- `merchUrl`
- `youtubeUrl`
- `contactEmail`
- `nostr.relays`
- `nostr.inboxPubkey`
- `nostr.rootAdminPubkey`

`nostr.inboxPubkey` is now the bootstrap / fallback inbox pubkey. Live site-key rotation events can move the active inbox pubkey forward without another config edit.

## Nostr model

- account login is deterministic from username + password, scoped to this project namespace
- account claims and profiles are public events
- submission bodies and submission chat use encrypted direct messages to the configured inbox key
- the active inbox key can rotate through public site-key events and encrypted re-shares to remaining admins
- admin grants, moderation actions, entities, drafts, comments, and submission status use public events

## Smoke testing

The generic live-browser smoke harness now lives in `nostr-site/tooling/browser-smoke`.

## Hardening

The production hardening and release checklist lives in the sibling `nostr-site` repo at `docs/SECURITY_CHECKLIST.md`. Use that as the release gate for this site along with the live smoke suite.

## Generic boundary

`truecost` now consumes the built `nostr-site` support bundle rather than maintaining its own local copy of the generic relay/CMS source layer.

See `docs/ARCHITECTURE.md` for the current static-baseline plus verified-live-overlay model and how this repo fits alongside `nostr-site` and `nostr-crdt`.
