import {
  applyCommentVoteToPublicState,
  commentAffectsThreadRanking,
  rankVisibleCommentThreads,
  resolveCommentVoteSummary,
  resolveCurrentVoteForComment
} from "../core/comment-ranking.js";
import {
  collectRecordBranchIds as collectCommentBranchIds,
  dedupeRecordsById as dedupeCommentList
} from "../core/comment-utils.js";
import {
  buildRemovedAccountMessage,
  buildStaleSessionMessage,
  buildUsernameConflictMessage,
  resolveRemovedSessionAccount,
  resolveStaleSessionAccount,
  resolveSessionUsernameConflict
} from "../core/account-integrity.js";
import { applyDerivedCommentState } from "../core/public-state.js";
import { formatDateTime } from "../core/formatting.js";
import { renderAvatarBadge } from "../core/profile-markup.js";
import { profileInitials } from "../surfaces/navigation.js";
import {
  animateRootCommentReorder,
  captureRootCommentPositions,
  renderComment,
  renderCommentCountLabel,
  updateRenderedCommentVoteState
} from "../surfaces/comments.js";
import { escapeHtml } from "../core/text-utils.js";

export function createMarkdownPageFeature({
  site,
  state,
  viewerController,
  getPublicState,
  getRequestSignerSecretKey,
  commitLocalPublicState,
  publishTaggedJson,
  sanitizeTrustedHtml,
  buildToc,
  renderError,
  renderLoadingState,
  renderMiniMarkdown,
  renderMarkedHtml,
  fetchText,
  slugify,
  enrichEntityReferences
} = {}) {
  function mount() {
    void initMarkdownArticles();
  }

  async function initMarkdownArticles() {
    const article = document.querySelector("[data-markdown-article]");
    if (!(article instanceof HTMLElement)) return;
    article.innerHTML = renderLoadingState("Looking up article...");

    try {
      const source = article.getAttribute("data-markdown-src");
      if (!source) throw new Error("Markdown source missing.");
      const markdown = await fetchText(source);
      renderMarkdown(article, markdown);
      buildToc(article, document.querySelector("[data-article-toc]"));
      const publicState = await getPublicState();
      enrichArticleEntities(article, publicState);
    } catch {
      renderError(article, "This article could not be loaded.");
    }
  }

  async function renderComments(postSlug, publicState) {
    const panel = document.querySelector("[data-comment-panel]");
    if (!(panel instanceof HTMLElement)) return;

    const isLoggedIn = Boolean(state.session);
    const removedAccount = resolveRemovedSessionAccount(publicState, state.session);
    const staleSession = resolveStaleSessionAccount(publicState, state.session);
    const usernameIntegrity = resolveSessionUsernameConflict(publicState, state.session);
    const isAdmin = Boolean(state.viewer && viewerController.trustedPubkeys(publicState).includes(state.viewer.pubkey));
    const viewerPubkey = viewerController.sessionPubkey();
    const threadedComments = rankVisibleCommentThreads(publicState.commentThreadsByPost?.get(postSlug) || [], publicState, viewerPubkey);
    const renderedCount = countRenderedCommentNodes(threadedComments);
    const currentUser = isLoggedIn && viewerPubkey ? publicState.users.find((user) => user.pubkey === viewerPubkey) || null : null;
    const replyTargetId = state.commentReply?.postSlug === postSlug ? state.commentReply.commentId : "";
    if (replyTargetId && !publicState.commentIndex?.get(replyTargetId)) {
      state.commentReply = null;
    }

    panel.innerHTML = `
      <div class="comment-panel__head">
        <div><div class="eyebrow">Discussion</div><h2>Comments</h2></div>
        <p>${renderCommentCountLabel(renderedCount)}</p>
      </div>
      ${
        isLoggedIn
          ? removedAccount
            ? `
              <div class="status-box" data-state="error">${escapeHtml(
                buildRemovedAccountMessage({
                  claimedUsername: removedAccount.claimedUsername || removedAccount.username || state.session?.username
                })
              )}</div>
            `
            : staleSession
            ? `
              <div class="status-box" data-state="error">${escapeHtml(
                buildStaleSessionMessage({
                  claimedUsername: staleSession.claimedUsername || state.session?.username,
                  currentContext: "comment from this account"
                })
              )}</div>
            `
            : usernameIntegrity.conflict
            ? `
              <div class="status-box" data-state="error">${escapeHtml(
                buildUsernameConflictMessage({
                  claimedUsername: usernameIntegrity.claimedUsername,
                  action: "comment from this account"
                })
              )}</div>
            `
            : `
            <section class="comment-composer">
              ${renderAvatarBadge(currentUser, state.session?.username || "You", "comment-composer__avatar", profileInitials)}
              <form class="comment-composer__form" data-comment-form="root">
                <div class="comment-composer__head"><strong>Add a comment</strong><span>Markdown works here. Keep it specific and tied to the post.</span></div>
                <label class="sr-only" for="commentComposerInput">Comment</label>
                <textarea id="commentComposerInput" class="comment-composer__input" name="markdown" placeholder="Write a comment..." required></textarea>
                <div class="comment-composer__footer"><span class="muted-text">Comments show up with your profile.</span><button class="button" type="submit">Post comment</button></div>
                <div class="status-box" data-comment-status aria-live="polite"></div>
              </form>
            </section>
          `
          : `<div class="empty-state">Log in to comment or reply.</div>`
      }
      ${
        !removedAccount && !staleSession && !usernameIntegrity.conflict && threadedComments.length
          ? `<div class="comment-list">${threadedComments.map((comment) =>
              renderComment(
                comment,
                publicState,
                {
                  isAdmin,
                  canReply: isLoggedIn && !removedAccount && !staleSession && !usernameIntegrity.conflict,
                  canVote: isLoggedIn && !removedAccount && !staleSession && !usernameIntegrity.conflict,
                  replyTargetId,
                  viewerPubkey
                },
                {
                  formatDateTime,
                  renderAvatarBadge: (user, fallbackLabel, className) => renderAvatarBadge(user, fallbackLabel, className, profileInitials),
                  renderInlineReplyForm,
                  renderMiniMarkdown: (markdown) => renderMiniMarkdown(markdown, sanitizeTrustedHtml)
                }
              )
            ).join("")}</div>`
          : !removedAccount && !staleSession && !usernameIntegrity.conflict && isLoggedIn
            ? `<div class="comment-list"><div class="empty-state">No comments yet. Start the discussion.</div></div>`
            : ""
      }
    `;

    bindCommentComposer(panel, postSlug, usernameIntegrity, removedAccount, staleSession);
    bindReplyControls(panel, postSlug, publicState, usernameIntegrity, removedAccount, staleSession);
    bindCommentActions(panel, postSlug, publicState, viewerPubkey, usernameIntegrity, removedAccount, staleSession);
    focusRequestedComment(postSlug);
  }

  function renderMarkdown(node, markdown) {
    node.innerHTML = renderMarkedHtml(markdown, { breaks: false, articleImages: true }, sanitizeTrustedHtml);
    for (const heading of node.querySelectorAll("h2, h3")) {
      heading.id = heading.id || slugify(heading.textContent || "section");
    }
    for (const link of node.querySelectorAll("a[href]")) {
      const href = link.getAttribute("href") || "";
      if (/^https?:\/\//.test(href)) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
    }
  }

  function enrichArticleEntities(scope, publicState) {
    if (!scope || !publicState?.approvedEntities?.length) return;
    enrichEntityReferences(scope, publicState.approvedEntities);
  }

  function bindCommentComposer(panel, postSlug, usernameIntegrity, removedAccount, staleSession) {
    const rootForm = panel.querySelector('[data-comment-form="root"]');
    if (!(rootForm instanceof HTMLFormElement)) return;
    rootForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = panel.querySelector("[data-comment-status]");
      const textarea = rootForm.elements.namedItem("markdown");
      const submitButton = rootForm.querySelector('button[type="submit"]');
      const markdown = String(textarea?.value || "").trim();
      if (!markdown) return;
      try {
        if (removedAccount) {
          throw new Error(
            buildRemovedAccountMessage({
              claimedUsername: removedAccount.claimedUsername || removedAccount.username || state.session?.username
            })
          );
        }
        if (staleSession) {
          throw new Error(
            buildStaleSessionMessage({
              claimedUsername: staleSession.claimedUsername || state.session?.username,
              currentContext: "comment from this account"
            })
          );
        }
        if (usernameIntegrity.conflict) {
          throw new Error(
            buildUsernameConflictMessage({
              claimedUsername: usernameIntegrity.claimedUsername,
              action: "comment from this account"
            })
          );
        }
        const viewer = await viewerController.get();
        if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true;
        if (status instanceof HTMLElement) {
          status.textContent = "Posting comment...";
          status.dataset.state = "pending";
        }
        const result = await publishTaggedJson({
          kind: site.nostr.kinds.comment,
          secretKeyHex: state.session.secretKeyHex,
          tags: [["a", postSlug]],
          content: { post_slug: postSlug, markdown, parent_id: "", root_id: "" }
        });
        rootForm.reset();
        appendLocalComment({
          id: result.event.id,
          post_slug: postSlug,
          markdown,
          author: viewer.pubkey,
          parent_id: "",
          root_id: "",
          created_at: Number(result.event.created_at || Math.floor(Date.now() / 1000))
        });
        state.viewer = viewer;
        await renderComments(postSlug, state.publicState);
      } catch (error) {
        if (status instanceof HTMLElement) {
          status.textContent = String(error?.message || error || "Comment failed.");
          status.dataset.state = "error";
        }
      } finally {
        if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false;
      }
    });
  }

  function bindReplyControls(panel, postSlug, publicState, usernameIntegrity, removedAccount, staleSession) {
    for (const replyButton of panel.querySelectorAll("[data-reply-comment]")) {
      replyButton.addEventListener("click", async () => {
        state.commentReply = { postSlug, commentId: replyButton.getAttribute("data-reply-comment") || "" };
        await renderComments(postSlug, publicState);
        const input = panel.querySelector('[data-comment-form="reply"] textarea');
        if (input instanceof HTMLTextAreaElement) input.focus();
      });
    }

    for (const cancelReply of panel.querySelectorAll("[data-cancel-reply]")) {
      cancelReply.addEventListener("click", async () => {
        state.commentReply = null;
        await renderComments(postSlug, publicState);
      });
    }

    for (const replyForm of panel.querySelectorAll('[data-comment-form="reply"]')) {
      replyForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (!(form instanceof HTMLFormElement)) return;
        const parentId = form.getAttribute("data-parent-id") || "";
        const replyTarget = publicState.commentIndex?.get(parentId) || null;
        const textarea = form.elements.namedItem("markdown");
        const submitButton = form.querySelector('button[type="submit"]');
        const status = form.querySelector("[data-comment-status]");
        const markdown = String(textarea?.value || "").trim();
        if (!markdown || !replyTarget) return;
        const rootId = String(replyTarget.root_id || replyTarget.parent_id || replyTarget.id || "").trim();
        try {
          if (removedAccount) {
            throw new Error(
              buildRemovedAccountMessage({
                claimedUsername: removedAccount.claimedUsername || removedAccount.username || state.session?.username
              })
            );
          }
          if (staleSession) {
            throw new Error(
              buildStaleSessionMessage({
                claimedUsername: staleSession.claimedUsername || state.session?.username,
                currentContext: "reply from this account"
              })
            );
          }
          if (usernameIntegrity.conflict) {
            throw new Error(
              buildUsernameConflictMessage({
                claimedUsername: usernameIntegrity.claimedUsername,
                action: "reply from this account"
              })
            );
          }
          const viewer = await viewerController.get();
          if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true;
          if (status instanceof HTMLElement) {
            status.textContent = "Posting reply...";
            status.dataset.state = "pending";
          }
          const result = await publishTaggedJson({
            kind: site.nostr.kinds.comment,
            secretKeyHex: state.session.secretKeyHex,
            tags: [["a", postSlug], ["e", parentId], ["parent", parentId], ...(rootId ? [["root", rootId]] : [])],
            content: { post_slug: postSlug, markdown, parent_id: parentId, root_id: rootId }
          });
          appendLocalComment({
            id: result.event.id,
            post_slug: postSlug,
            markdown,
            author: viewer.pubkey,
            parent_id: parentId,
            root_id: rootId,
            created_at: Number(result.event.created_at || Math.floor(Date.now() / 1000))
          });
          state.viewer = viewer;
          state.commentReply = null;
          await renderComments(postSlug, state.publicState);
        } catch (error) {
          if (status instanceof HTMLElement) {
            status.textContent = String(error?.message || error || "Reply failed.");
            status.dataset.state = "error";
          }
        } finally {
          if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false;
        }
      });
    }
  }

  function bindCommentActions(panel, postSlug, publicState, viewerPubkey, usernameIntegrity, removedAccount, staleSession) {
    for (const button of panel.querySelectorAll("[data-hide-comment]")) {
      button.addEventListener("click", async () => {
        try {
          await publishTaggedJson({
            kind: site.nostr.kinds.commentMod,
            secretKeyHex: state.session.secretKeyHex,
            tags: [["e", button.getAttribute("data-hide-comment") || ""], ["op", "hide"]],
            content: { target_id: button.getAttribute("data-hide-comment") || "", action: "hide" }
          });
          state.publicState = await getPublicState(true);
          await renderComments(postSlug, state.publicState);
        } catch {
          return;
        }
      });
    }

    for (const button of panel.querySelectorAll("[data-delete-comment]")) {
      button.addEventListener("click", async () => {
        if (!state.session?.secretKeyHex || !viewerPubkey) return;
        if (removedAccount) return;
        if (staleSession) return;
        if (usernameIntegrity.conflict) return;
        const commentId = String(button.getAttribute("data-delete-comment") || "").trim();
        const targetComment = publicState.commentIndex?.get(commentId) || null;
        if (!targetComment || targetComment.author !== viewerPubkey) return;
        if (!window.confirm("Delete this comment and its replies?")) return;
        try {
          button.disabled = true;
          applyLocalCommentDeletion(commentId, "Deleted by author");
          await renderComments(postSlug, state.publicState);
          await publishTaggedJson({
            kind: site.nostr.kinds.commentMod,
            secretKeyHex: state.session.secretKeyHex,
            tags: [["e", commentId], ["op", "hide"]],
            content: { target_id: commentId, action: "hide", note: "Deleted by author" }
          });
        } catch {
          state.publicState = await getPublicState(true);
          await renderComments(postSlug, state.publicState);
        }
      });
    }

    for (const button of panel.querySelectorAll("[data-comment-vote]")) {
      button.addEventListener("click", async () => {
        if (!state.session?.secretKeyHex || !viewerPubkey) return;
        if (removedAccount) return;
        if (staleSession) return;
        if (usernameIntegrity.conflict) return;
        const commentId = String(button.getAttribute("data-comment-vote") || "").trim();
        const requestedValue = Number(button.getAttribute("data-comment-vote-value") || 0);
        if (!commentId || !Number.isFinite(requestedValue) || ![1, -1].includes(requestedValue)) return;
        const currentValue = resolveCurrentVoteForComment(publicState, commentId, viewerPubkey);
        const nextValue = currentValue === requestedValue ? 0 : requestedValue;
        const reranksRoots = commentAffectsThreadRanking(state.publicState, commentId);
        const rootPositions = reranksRoots ? captureRootCommentPositions(panel) : null;
        try {
          button.disabled = true;
          commitLocalPublicState(applyCommentVoteToPublicState(state.publicState, commentId, viewerPubkey, nextValue));
          if (reranksRoots) {
            await renderComments(postSlug, state.publicState);
            animateRootCommentReorder(panel, rootPositions, commentId);
          } else {
            updateRenderedCommentVoteState(panel, commentId, state.publicState, viewerPubkey);
          }
          await publishTaggedJson({
            kind: site.nostr.kinds.commentVote,
            secretKeyHex: state.session.secretKeyHex,
            tags: [["d", `comment-vote:${commentId}`], ["e", commentId], ["v", String(nextValue)], ["op", nextValue > 0 ? "upvote" : nextValue < 0 ? "downvote" : "clear"]],
            content: { target_id: commentId, value: nextValue }
          });
        } catch {
          commitLocalPublicState(applyCommentVoteToPublicState(state.publicState, commentId, viewerPubkey, currentValue));
          if (reranksRoots) {
            await renderComments(postSlug, state.publicState);
            animateRootCommentReorder(panel, rootPositions, commentId);
          } else {
            updateRenderedCommentVoteState(panel, commentId, state.publicState, viewerPubkey);
          }
        } finally {
          button.disabled = false;
        }
      });
    }
  }

  function renderInlineReplyForm(comment, publicState) {
    return `<form class="comment-reply-form" data-comment-form="reply" data-parent-id="${comment.id}"><div class="comment-reply-form__head"><strong>Reply to ${escapeHtml(commentAuthorLabel(comment, publicState))}</strong><span>Your reply will appear directly in this thread.</span></div><textarea name="markdown" placeholder="Write a reply..." required></textarea><div class="comment-reply-form__actions"><button class="button-ghost" type="button" data-cancel-reply>Cancel</button><button class="button" type="submit">Reply</button></div><div class="status-box" data-comment-status aria-live="polite"></div></form>`;
  }

  function appendLocalComment(comment) {
    if (!state.publicState) return;
    const nextAllComments = dedupeCommentList([...(state.publicState.allComments || []), comment]);
    commitLocalPublicState(applyDerivedCommentState(state.publicState, nextAllComments));
  }

  function applyLocalCommentDeletion(commentId, note = "Deleted by author") {
    if (!state.publicState?.allComments) return;
    const branchIds = collectCommentBranchIds(state.publicState.allComments, commentId);
    if (!branchIds.length) return;
    const branchSet = new Set(branchIds);
    const moderation = { action: "hide", note: String(note || "").trim(), updated_at: Math.floor(Date.now() / 1000), by: state.viewer?.pubkey || "" };
    const nextComments = (state.publicState.allComments || []).map((comment) => {
      if (!branchSet.has(String(comment.id || "").trim())) return comment;
      return {
        ...comment,
        visibility: "hidden",
        moderation: String(comment.id || "").trim() === String(commentId || "").trim() ? moderation : comment.moderation || moderation
      };
    });
    commitLocalPublicState(applyDerivedCommentState(state.publicState, nextComments));
  }

  function countRenderedCommentNodes(nodes) {
    return (Array.isArray(nodes) ? nodes : []).reduce((total, node) => total + 1 + countRenderedCommentNodes(node?.replies || []), 0);
  }

  function focusRequestedComment(postSlug, attempt = 0) {
    const requestedId = String(new URLSearchParams(window.location.search).get("comment") || "").trim();
    if (!requestedId || state.highlightedCommentId === requestedId) return;
    const target = document.querySelector(`[data-comment-id="${CSS.escape(requestedId)}"]`);
    if (!(target instanceof HTMLElement)) {
      if (attempt < 20) window.setTimeout(() => focusRequestedComment(postSlug, attempt + 1), Math.min(600 + attempt * 120, 1800));
      return;
    }
    const container = target.closest(".comment-card");
    (container instanceof HTMLElement ? container : target).scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("comment-card--focus");
    state.highlightedCommentId = requestedId;
    window.setTimeout(() => target.classList.remove("comment-card--focus"), 1800);
  }

  function commentAuthorLabel(comment, publicState) {
    const author = publicState.users.find((user) => user.pubkey === comment.author);
    return author?.displayName || author?.username || "User";
  }

  function resolveUserKarma(publicState, pubkey) {
    const cleanPubkey = String(pubkey || "").trim().toLowerCase();
    if (!cleanPubkey) return 0;
    const comments = publicState?.commentsByAuthor instanceof Map ? publicState.commentsByAuthor.get(cleanPubkey) || [] : [];
    return comments.reduce((total, comment) => total + resolveCommentVoteSummary(publicState, comment.id).score, 0);
  }

  function formatKarma(value) {
    const score = Number(value || 0) || 0;
    return score > 0 ? `+${score}` : String(score);
  }

  async function refreshVisibleCommentThread() {
    const panel = document.querySelector("[data-comment-panel]");
    if (!(panel instanceof HTMLElement) || panel.hidden) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest("[data-comment-panel]")) return;
    const params = new URLSearchParams(window.location.search);
    const draftSlug = cleanSlug(params.get("draft") || "");
    if (draftSlug) return;
    const slug = cleanSlug(params.get("slug") || "");
    if (!slug || !state.publicState) return;
    await renderComments(slug, state.publicState);
  }

  return {
    mount,
    enrichArticleEntities,
    renderComments,
    renderMarkdown,
    commentAuthorLabel,
    resolveUserKarma,
    formatKarma,
    refreshVisibleCommentThread
  };
}
