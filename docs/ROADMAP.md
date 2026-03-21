# Roadmap

The current build is meant to be a practical, low-overhead publishing and coordination system for accountability work. The public site is already in place; the next phase is focused on making the operator workflow more durable, easier to run, and safer to hand off.

## Completed Recently

- Contract, operations, and roadmap docs now live under `docs/` instead of cluttering the repo root.
- Static-first live overlays are in for editable pages and investigation detail/editor flows.
- Cache-first restore and background patching are now the documented live-surface contract.
- Comment threading now uses a shared derived structure with regression coverage for reload and stale-refresh behavior.
- Comment votes and karma now have an explicit contract: all comments and replies can receive karma, only roots rerank, and root reranks use readable motion.
- Browser compatibility is now a documented contract, with current fallbacks in place for blur, scrollbar reservation, and static accessible nav labels.
- Branch-purpose-squash is now the documented contribution pattern.
- The first broad surface split is in place: navigation, archive, comments, and workspace rendering now have dedicated modules instead of living only inside page controllers.
- Workspace action sheets, map shells, and editor-shell rendering are now split into dedicated surface modules instead of staying buried in page controllers.
- Public, workspace, and editor controllers now share one extracted public-state store boundary for cache-first hydrate, repair-peer lifecycle, and refresh scheduling.
- Notification state and profile-menu UI state now live in dedicated core modules instead of page-controller sprawl.
- Public profile overlays and submit-shell rendering now live in dedicated surface modules, so the full modal family follows the same surface pattern.
- Workspace filter/search rails and picker suggestion markup now live in dedicated surface modules instead of staying embedded in admin controllers.
- The workspace now boots from cached admin state, so trusted admin tabs and inbox-aware controls can render before relay sync completes.
- The primary public nav now uses `Explore` to group `Investigations` and `Map`, and non-admin archive cards no longer expose status pills.
- Shared page-draft/review helpers now live in `scripts/core/page-drafts.js` instead of being reimplemented per controller.
- Shared loading, tag-link, markdown, TOC, and truncation helpers now live in `scripts/core/rendering.js` instead of staying in the main public controller.
- `app.js` has now had its largest remaining lifecycle families pulled out: investigation detail/live overlay and static page editing now live in dedicated surface modules instead of the page controller.
- `app.js` is now a route/bootstrap entrypoint backed by explicit `scripts/core`, `scripts/features`, and `scripts/surfaces` layers instead of a large mixed-responsibility controller.
- The framework/template repo now follows the same direction with matching extracted surface families instead of keeping that logic only in one large template controller.
- Pages now load a bundled `styles.css` file rebuilt from ordered source partials in `styles/`, so first paint no longer waits on an import chain or a pile of separate stylesheet requests.
- The stylesheet convergence pass now pushes repeated dropdown, shell, workspace, and comment rules up into the shared cascade instead of only redistributing them across files.
- Site fonts are now self-hosted, so public pages no longer need client requests to Google for typography.
- The workspace controller has been reduced again: admin shell rendering, tab state, inbox/chat flow, site-key handling, selectors, and mutation handlers now live in dedicated workspace modules instead of one large page controller.
- Mounted workspace/admin, submit, and editor shells now use observed region updates so unrelated async state changes do not replace active form roots or open overlays.
- Workspace login, profile save, and password rotation now live behind a dedicated workspace account controller instead of staying embedded in `admin.js`.

## Near Term

- Expand the normalized collaborative shell into editor presence, quote-linked discussion, and broader live-unit coverage for entities and the archive.
- Keep tightening the remaining large CSS families, especially `02-content.css`, `06-workspace.css`, and the still-heavy shared foundation layer, so convergence continues after the bundled-first-paint pass.
- Continue the same direct reduction work on the remaining controller hotspots, with upload and moderation-detail handler families now the main `admin.js` target after the workspace-account extraction pass.
- Apply the same controller-to-feature reduction pass to the remaining editor/workspace hotspots that still own too much orchestration locally.
- Extend the live collaborative layer from static pages and investigation detail/editor flows into the archive and entity records without regressing the static-first baseline.
- Add clearer history and conflict handling for live collaborative units before each bakedown cycle, so operators can see what will ship and why.
- Expand end-to-end browser validation around submissions, moderation, publishing, comment handling, and browser-compat fallbacks before each release.
- Keep improving relay compatibility and degraded-mode behavior so the site remains usable even when some relays are noisy or incomplete.
- Harden the admin lifecycle so role changes, approvals, and revocations stay easy to operate and hard to misuse.
- Tighten the Linux pinner setup path into a repeatable install, update, and recovery workflow for non-developer operators.

## Publishing Workflow

- Continue treating live relay state as the working layer and reviewed repository content as the stable snapshot layer.
- Improve the bakedown path so trusted live content, including collaborative page updates, can be reviewed and merged cleanly without turning day-to-day publishing into a developer task.
- Refine the audit trail around admin actions, submission handling, and publishing events.

## Longer Term

- Expand transparent page editing beyond hero sections and add stronger review/history handling around queued page snapshots.
- Deepen image handling inside the document editor, including richer placement controls and polished publish-path validation through the existing blob workflow.
- Add a navigable entity wiki that can enrich facilities, companies, agencies, and related records with expandable fields, history, clearer cross-links into investigations and the map, and a richer type / class / taxonomy model.
- Add collaborative editing for investigations and wiki-like records so more than one approved user can work in the same unit without relying only on queued revisions and review handoffs.
- Add stronger map and archive views as the entity and location dataset grows.
- Improve collaboration tools for volunteers, including clearer review states and richer discussion around submissions.
- Package the reusable parts of the system so future campaign sites can launch with less custom setup.
