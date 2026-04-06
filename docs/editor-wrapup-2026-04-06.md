# Investigation Editor Wrap-Up

Date: 2026-04-06
Branch: `issue-127-investigation-editor-reset`

## Current State

This branch contains the large embedded editor reset pass for investigations.

What is in place:
- compact investigation editor shell with mock-mode header treatment
- single-row ribbon with grouped controls
- wrapped-object insert menu for image, banner, and entity
- generic multimedia model for `image`, `captioned_image`, and `banner`
- current-document citation flow with inline superscripts and citations tile
- local-first image asset library and multimedia draft flow
- downstream investigation document serialization for multimedia and baked asset paths
- editor/browser coverage for the current authoring path

## Validated Today

Commands run successfully:

```powershell
npm run build
node --test tests\editor-shell.test.mjs tests\investigation-document.test.mjs tests\site-template-build.test.mjs tests\editor-authoring.browser.test.mjs
```

## Known Shape Of The Work

This is a substantial branch, not a small patch:
- modified tracked files across app, editor runtime, workspace, styles, tests, and vendored upstream support assets
- new untracked files for styleguide, editor schema/assets helpers, and editor-focused tests

## What To Keep If We Pivot Away

The parts most worth salvaging even if the embedded editor direction is dropped:
- structured investigation document model and baked asset path handling
- image asset helper layer
- editor style guide and interaction notes
- tests capturing citation/media/entity authoring expectations
- vendored upstream support sync points

## What Not To Sink More Time Into Right Now

If the product direction is moving away from embedded editing, avoid spending more time on:
- deeper polish of embedded drag/resize interaction
- more toolbar micro-interaction tuning
- further snap-in UX refinement
- broader editor-only browser coverage beyond what already protects the current branch

## Files To Start With Later

- `scripts/features/editor-runtime.js`
- `scripts/surfaces/editor-shell.js`
- `scripts/core/investigation-document.js`
- `scripts/core/investigation-editor-schema.js`
- `styles/03-editor.css`
- `tests/editor-authoring.browser.test.mjs`
- `docs/editor-styleguide.md`

## Operational Loose End Closed Today

Both pinner services on the lab laptop are reachable again:
- Truecost pinner: `10.0.198.110:4858`
- NK3 pinner: `10.0.198.110:4848`

The fixes were:
- open Fedora firewall ports for both services
- add a systemd override so `nk3-peer-pinner.service` binds to `0.0.0.0`
