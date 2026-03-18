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
- The framework/template repo now follows the same direction with matching extracted surface families instead of keeping that logic only in one large template controller.
- `styles.css` is now a small manifest that imports ordered partials in `styles/`, so the stylesheet boundary matches the broader surface-family split instead of living as one multi-thousand-line file.

## Near Term

- Expand the normalized collaborative shell into editor presence, quote-linked discussion, and broader live-unit coverage for entities and the archive.
- Keep trimming duplicated rules inside the new stylesheet partials so the structural split is followed by real reduction in total CSS bulk, not only a smaller manifest file.
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
