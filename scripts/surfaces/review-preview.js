import {
  draftOwnerPubkey,
  draftReviewAction,
  draftStatusLabel,
  isPageDraft,
  normalizeDraftStatus,
  pageDraftActionLabel,
  pageDraftHref,
  pageDraftLabel
} from "../core/page-drafts.js";
import { escapeAttribute, escapeHtml } from "../core/text-utils.js";

export function shortReviewKey(value) {
  const clean = String(value || "").trim();
  return clean.length > 12 ? `${clean.slice(0, 8)}...${clean.slice(-4)}` : clean || "Editor";
}

export function renderReviewPreviewPanel(draft, options = {}) {
  const publicState = options.publicState || {};
  const formatDate = options.formatDate || ((value) => String(value || ""));
  const owner = publicState?.users?.find?.((user) => user.pubkey === draftOwnerPubkey(draft)) || null;
  const ownerLabel = owner?.displayName || owner?.username || shortReviewKey(draftOwnerPubkey(draft));
  const status = normalizeDraftStatus(draft.status);
  const reviewAction = draftReviewAction(draft);
  const canReview = ["candidate", "review", "submitted"].includes(status);
  const pageDraft = isPageDraft(draft);
  const previewLabel = pageDraft ? "Page review" : "Review preview";
  const openHref = pageDraft
    ? pageDraftHref(draft, draft.status)
    : status === "revision"
      ? `./editor.html?slug=${encodeURIComponent(draft.slug)}`
      : "./investigations.html";
  const openLabel = pageDraft
    ? pageDraftActionLabel(draft, draft.status)
    : status === "revision"
      ? "Open in editor"
      : "Back to investigations";

  return `
    <div class="eyebrow">${escapeHtml(previewLabel)}</div>
    <h3>${escapeHtml(draftStatusLabel(status, reviewAction))}</h3>
    <p class="muted-text">Submitted by ${escapeHtml(ownerLabel)}. This view is read-only so the review decision happens against what was actually submitted.</p>
    <div class="tag-row">
      <span class="tag">${escapeHtml(pageDraft ? pageDraftLabel(draft) : "Investigation")}</span>
      <span class="tag">${escapeHtml(draftStatusLabel(status, reviewAction))}</span>
      <span class="tag">${escapeHtml(formatDate(draft.date))}</span>
    </div>
    <div class="button-row button-row--tight">
      ${
        canReview
          ? `
            <button class="button" type="button" data-review-action="approve" data-draft-slug="${escapeAttribute(draft.slug)}">Approve</button>
            <button class="button-ghost" type="button" data-review-action="revise" data-draft-slug="${escapeAttribute(draft.slug)}">Request revision</button>
            <button class="button-ghost" type="button" data-review-action="deny" data-draft-slug="${escapeAttribute(draft.slug)}">Deny</button>
          `
          : `<a class="button-ghost" href="${escapeAttribute(openHref)}">${escapeHtml(openLabel)}</a>`
      }
    </div>
    ${
      canReview
        ? ""
        : `<p class="muted-text">${
            status === "revision"
              ? pageDraft
                ? "Revision has been requested on this page update."
                : "Revision has been requested on this investigation."
              : pageDraft
                ? "This page update is not waiting for review right now."
                : "This investigation is not waiting for review right now."
          }</p>`
    }
  `;
}

export function bindReviewPreviewPanel(panel, draft, onAction) {
  const handler = typeof onAction === "function" ? onAction : async () => {};
  const buttons = panel?.querySelectorAll?.("[data-review-action]") || [];
  for (const button of buttons) {
    button.addEventListener("click", async () => {
      await handler(draft, button);
    });
  }
}
