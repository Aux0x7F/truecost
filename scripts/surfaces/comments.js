import { resolveCommentVoteSummary, resolveCurrentVoteForComment } from "../core/comment-ranking.js";
import { escapeAttribute, escapeHtml } from "../core/text-utils.js";

export function captureRootCommentPositions(panel) {
  if (!(panel instanceof HTMLElement)) return new Map();
  const positions = new Map();
  for (const card of panel.querySelectorAll('.comment-list > .comment-card[data-comment-root="true"]')) {
    if (!(card instanceof HTMLElement)) continue;
    const id = String(card.getAttribute("data-comment-id") || "").trim();
    if (!id) continue;
    const rect = card.getBoundingClientRect();
    positions.set(id, { top: rect.top, left: rect.left });
  }
  return positions;
}

export function animateRootCommentReorder(panel, previousPositions, anchorCommentId = "", options = {}) {
  if (!(panel instanceof HTMLElement) || !(previousPositions instanceof Map) || !previousPositions.size) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  const duration = Number.isFinite(options.duration) ? options.duration : 1120;
  const easing = String(options.easing || "cubic-bezier(0.16, 1, 0.3, 1)");
  const anchorId = String(anchorCommentId || "").trim();
  const moved = [];
  for (const card of panel.querySelectorAll('.comment-list > .comment-card[data-comment-root="true"]')) {
    if (!(card instanceof HTMLElement)) continue;
    const id = String(card.getAttribute("data-comment-id") || "").trim();
    const prior = previousPositions.get(id);
    if (!prior) continue;
    const nextRect = card.getBoundingClientRect();
    const deltaY = prior.top - nextRect.top;
    const deltaX = prior.left - nextRect.left;
    if (Math.abs(deltaY) < 1 && Math.abs(deltaX) < 1) continue;
    moved.push({ card, deltaX, deltaY, isAnchor: id === anchorId });
  }
  if (!moved.length) return;

  for (const item of moved) {
    item.card.classList.add("comment-card--reordering");
    item.card.classList.toggle("comment-card--reordering-target", item.isAnchor);
    item.card.getAnimations?.().forEach((animation) => animation.cancel());
    item.card.style.transition = "";
    item.card.style.transform = "";
  }

  for (const item of moved) {
    if (typeof item.card.animate === "function") {
      item.card.animate(
        [
          { transform: `translate(${item.deltaX}px, ${item.deltaY}px)` },
          { transform: "translate(0px, 0px)" }
        ],
        {
          duration,
          easing,
          fill: "both"
        }
      );
      continue;
    }
    item.card.style.transition = "none";
    item.card.style.transform = `translate(${item.deltaX}px, ${item.deltaY}px)`;
    void item.card.offsetWidth;
    item.card.style.transition = `transform ${duration}ms ${easing}`;
    item.card.style.transform = "";
  }

  window.setTimeout(() => {
    for (const item of moved) {
      item.card.classList.remove("comment-card--reordering");
      item.card.classList.remove("comment-card--reordering-target");
      item.card.style.transition = "";
      item.card.style.transform = "";
    }
    if (anchorId) {
      const anchor = panel.querySelector(`[data-comment-id="${CSS.escape(anchorId)}"]`);
      if (anchor instanceof HTMLElement) {
        anchor.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, duration + 80);
}

export function renderComment(comment, publicState, options = {}, deps = {}, depth = 0) {
  const author = publicState.users.find((user) => user.pubkey === comment.author);
  const authorLabel = author?.displayName || author?.username || "User";
  const replies = Array.isArray(comment.replies) ? comment.replies : [];
  const voteSummary = resolveCommentVoteSummary(publicState, comment.id);
  const viewerVote = options.viewerPubkey ? resolveCurrentVoteForComment(publicState, comment.id, options.viewerPubkey) : 0;
  const canDelete = Boolean(options.viewerPubkey) && comment.author === options.viewerPubkey;
  const replyForm = options.canReply && options.replyTargetId === comment.id && typeof deps.renderInlineReplyForm === "function"
    ? deps.renderInlineReplyForm(comment, publicState)
    : "";
  const renderAvatarBadge = deps.renderAvatarBadge || (() => "");
  const formatDateTime = deps.formatDateTime || ((value) => String(value || ""));
  const renderMiniMarkdown = deps.renderMiniMarkdown || ((value) => escapeHtml(value));
  return `
    <article class="comment-card ${depth ? "comment-card--reply" : ""}" id="comment-${escapeAttribute(comment.id)}" data-comment-id="${escapeAttribute(comment.id)}" data-comment-root="${depth ? "false" : "true"}">
      <div class="comment-card__shell">
        <button class="comment-card__avatar-button" type="button" data-open-user="${escapeAttribute(comment.author)}" aria-label="Open ${escapeAttribute(authorLabel)}">
          ${renderAvatarBadge(author, authorLabel, "comment-card__avatar")}
        </button>
        <div class="comment-card__main">
          <div class="comment-card__meta">
            <div>
              <button class="comment-card__author-button" type="button" data-open-user="${escapeAttribute(comment.author)}">${escapeHtml(authorLabel)}</button>
              <span>${formatDateTime(comment.created_at)}</span>
            </div>
          </div>
          <div class="comment-card__body">${renderMiniMarkdown(comment.markdown)}</div>
          <div class="comment-card__toolbar">
            <div class="comment-card__votes" aria-label="Comment score">
              <button
                type="button"
                class="comment-vote ${viewerVote > 0 ? "is-active" : ""}"
                data-comment-vote="${escapeAttribute(comment.id)}"
                data-comment-vote-value="1"
                aria-label="Upvote comment"
                aria-pressed="${viewerVote > 0 ? "true" : "false"}"
                ${options.canVote ? "" : "disabled"}
              >▲</button>
              <span class="comment-card__score" data-comment-score-value="${escapeAttribute(comment.id)}">${voteSummary.score}</span>
              <button
                type="button"
                class="comment-vote ${viewerVote < 0 ? "is-active" : ""}"
                data-comment-vote="${escapeAttribute(comment.id)}"
                data-comment-vote-value="-1"
                aria-label="Downvote comment"
                aria-pressed="${viewerVote < 0 ? "true" : "false"}"
                ${options.canVote ? "" : "disabled"}
              >▼</button>
            </div>
            <div class="comment-card__actions">
              ${options.canReply ? `<button type="button" class="button-ghost" data-reply-comment="${escapeAttribute(comment.id)}">Reply</button>` : ""}
              ${canDelete ? `<button type="button" class="button-ghost" data-delete-comment="${escapeAttribute(comment.id)}">Delete</button>` : ""}
              ${options.isAdmin ? `<button type="button" class="button-ghost" data-hide-comment="${escapeAttribute(comment.id)}">Hide</button>` : ""}
            </div>
          </div>
          ${replyForm}
          ${
            replies.length
              ? `<div class="comment-card__children">${replies.map((reply) => renderComment(reply, publicState, options, deps, depth + 1)).join("")}</div>`
              : ""
          }
        </div>
      </div>
    </article>
  `;
}

export function renderCommentCountLabel(count) {
  return `${count} visible comment${count === 1 ? "" : "s"}`;
}

export function updateRenderedCommentVoteState(scope, commentId, publicState, viewerPubkey = "") {
  const commentKey = CSS.escape(String(commentId || "").trim());
  const container = scope instanceof HTMLElement
    ? scope.querySelector(`[data-comment-id="${commentKey}"]`)
    : null;
  if (!(container instanceof HTMLElement)) return;
  const summary = resolveCommentVoteSummary(publicState, commentId);
  const currentVote = resolveCurrentVoteForComment(publicState, commentId, viewerPubkey);
  const score = container.querySelector(`[data-comment-score-value="${commentKey}"]`);
  if (score instanceof HTMLElement) score.textContent = String(summary.score);
  for (const button of container.querySelectorAll(`[data-comment-vote="${commentKey}"]`)) {
    const value = Number(button.getAttribute("data-comment-vote-value") || 0);
    const active = currentVote === value && value !== 0;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}
