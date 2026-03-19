import {
  draftOwnerPubkey,
  draftReviewAction,
  draftStatusLabel as reviewStatusLabel,
  isPageDraft,
  pageDraftActionLabel,
  pageDraftHref,
  pageDraftLabel
} from "../core/page-drafts.js";
import { escapeAttribute, escapeHtml } from "../core/text-utils.js";
import { trimmed } from "../core/rendering.js";

export function renderSnapshotSummary(snapshot) {
  if (!snapshot) {
    return `<p class="muted-text">No baked snapshot event is visible yet.</p>`;
  }
  const generatedAt = snapshot.generated_at
    ? new Date(snapshot.generated_at).toLocaleString()
    : new Date((snapshot.event?.created_at || snapshot.version_ts || 0) * 1000).toLocaleString();
  const prUrl = snapshot.git?.pr_url || "";
  const branch = snapshot.git?.branch || "";
  const commit = snapshot.git?.commit || "";
  return `
    <div class="roster-list">
      <article class="roster-item">
        <strong>Latest snapshot</strong>
        <span>${escapeHtml(snapshot.status || "ready")} • ${escapeHtml(generatedAt)}</span>
        <span>${escapeHtml(`${snapshot.counts?.posts || 0} posts • ${snapshot.counts?.entities || 0} entities`)}</span>
        ${
          branch
            ? `<span class="mono">${escapeHtml(branch)}${commit ? ` @ ${escapeHtml(String(commit).slice(0, 12))}` : ""}</span>`
            : ""
        }
        ${prUrl ? `<a class="text-link" href="${escapeAttribute(prUrl)}" target="_blank" rel="noreferrer">Open PR</a>` : ""}
      </article>
    </div>
  `;
}

export function renderReviewCard(draft, deps = {}) {
  const authorPubkey = draftOwnerPubkey(draft);
  const author = deps.resolveWorkspaceUser?.(authorPubkey) || null;
  const authorLabel = author?.displayName || author?.username || deps.shortKey?.(authorPubkey) || authorPubkey;
  const revisionLabel = draft.revisionCount > 1 ? `${draft.revisionCount} saved versions` : "1 saved version";
  const pageDraft = isPageDraft(draft);
  return `
    <article class="review-card">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(draft.title)}</strong>
          <span>${escapeHtml(draft.date)} • ${escapeHtml(revisionLabel)}</span>
        </div>
        <div class="tag-row">
          <span class="tag">${escapeHtml(pageDraft ? pageDraftLabel(draft) : "Investigation")}</span>
          <span class="tag">Ready for review</span>
        </div>
      </div>
      <p class="review-card__summary">${escapeHtml(draft.summary || "No summary added yet.")}</p>
      <span class="muted-text">By ${escapeHtml(authorLabel)}${!pageDraft && draft.entity_refs?.length ? ` • ${escapeHtml(draft.entity_refs.map(deps.resolveEntityDisplayValue).join(", "))}` : ""}</span>
      <div class="button-row button-row--tight">
        <a class="text-link" href="${escapeAttribute(reviewedDraftHref(draft, "candidate"))}">Open preview</a>
        <button class="button-ghost" type="button" data-review-action="approve" data-draft-slug="${escapeAttribute(draft.slug)}">Approve for publish</button>
        <button class="button-ghost" type="button" data-review-action="revise" data-draft-slug="${escapeAttribute(draft.slug)}">Request revision</button>
        <button class="button-ghost" type="button" data-review-action="deny" data-draft-slug="${escapeAttribute(draft.slug)}">Deny</button>
      </div>
    </article>
  `;
}

export function renderReviewedCard(draft) {
  const reviewAction = draftReviewAction(draft);
  const pageDraft = isPageDraft(draft);
  return `
    <article class="review-card review-card--history">
      <strong>${escapeHtml(draft.title)}</strong>
      <span>${escapeHtml(reviewStatusLabel(draft.status, reviewAction))} • ${escapeHtml(draft.date)}</span>
      <p class="review-card__summary">${escapeHtml(trimmed(draft.summary || draft.markdown || "", 180))}</p>
      <div class="tag-row"><span class="tag">${escapeHtml(pageDraft ? pageDraftLabel(draft) : "Investigation")}</span></div>
      <div class="button-row button-row--tight">
        <a class="text-link" href="${escapeAttribute(reviewedDraftHref(draft))}">${escapeHtml(reviewedDraftAction(draft))}</a>
      </div>
    </article>
  `;
}

export function renderLogPane(workspaceState, deps = {}) {
  const logEvents = (workspaceState?.publicState?.rawEvents || [])
    .filter((event) => (deps.logKinds || []).includes(Number(event.kind)))
    .slice(0, 40);
  return `
    <section class="surface-panel">
      <div class="eyebrow">Log</div>
      <h2>Audit events</h2>
      <div class="roster-list">
        ${
          logEvents.length
            ? logEvents.map((event) => renderLogEvent(event, deps)).join("")
            : `<div class="empty-state">No audit events visible yet.</div>`
        }
      </div>
    </section>
  `;
}

function reviewedDraftHref(draft, statusOverride = "") {
  const status = String(statusOverride || draft?.status || "").trim().toLowerCase();
  if (isPageDraft(draft)) return pageDraftHref(draft, status);
  return status === "revision"
    ? `./editor.html?slug=${encodeURIComponent(draft.slug)}`
    : `./investigation.html?draft=${encodeURIComponent(draft.slug)}`;
}

function reviewedDraftAction(draft) {
  if (isPageDraft(draft)) {
    return pageDraftActionLabel(draft, draft?.status);
  }
  return String(draft?.status || "").trim().toLowerCase() === "revision"
    ? "Open draft"
    : "Open preview";
}

function renderLogEvent(event, deps) {
  const target = logTarget(event, deps);
  return `
    <article class="roster-item">
      <strong>${escapeHtml(logLabel(event, deps))}</strong>
      <span>${escapeHtml(target.description)}</span>
      <div class="button-row button-row--tight">
        <a class="text-link" href="${escapeAttribute(target.href)}">Open</a>
      </div>
    </article>
  `;
}

function logLabel(event, deps) {
  const kind = Number(event.kind);
  const labels = deps.logLabels || {};
  return labels[kind] || `Event ${event.kind}`;
}

function logTarget(event, deps) {
  const slug = deps.firstTag?.(event, "d") || "";
  const targetPubkey = deps.firstTag?.(event, "p") || event.pubkey;
  const targetUser = deps.resolveWorkspaceUser?.(targetPubkey) || null;
  const targetLabel = targetUser?.displayName || targetUser?.username || deps.shortKey?.(targetPubkey) || targetPubkey;
  const kinds = deps.siteKinds || {};
  switch (Number(event.kind)) {
    case kinds.snapshot:
    case kinds.snapshotRequest:
      return { href: "./admin.html?tab=dashboard", description: slug || deps.shortKey?.(event.pubkey) || event.pubkey };
    case kinds.adminClaim:
    case kinds.adminRole:
    case kinds.userMod:
    case kinds.adminKeyShare:
    case kinds.siteKey:
      return {
        href: `./admin.html?tab=users&user=${encodeURIComponent(targetPubkey)}`,
        description: targetLabel
      };
    case kinds.entity:
      return { href: "./admin.html?tab=entities", description: slug || deps.shortKey?.(event.pubkey) || event.pubkey };
    case kinds.draft:
      return { href: "./admin.html?tab=review", description: slug || deps.shortKey?.(event.pubkey) || event.pubkey };
    case kinds.commentMod:
      return { href: "./admin.html?tab=comments", description: deps.firstTag?.(event, "e") || deps.shortKey?.(event.pubkey) || event.pubkey };
    case kinds.submissionStatus:
      return { href: "./admin.html?tab=submissions", description: slug || deps.shortKey?.(event.pubkey) || event.pubkey };
    default:
      return { href: "./admin.html?tab=dashboard", description: deps.shortKey?.(event.pubkey) || event.pubkey };
  }
}
