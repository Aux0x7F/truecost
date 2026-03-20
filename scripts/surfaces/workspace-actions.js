export function renderUserStatsCard(workspaceState, deps = {}) {
  const stats = deps.workspaceUserStats();
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const buckets = [
    { label: "Below zero", value: "lt0", count: stats.karmaBuckets.lt0 || 0 },
    { label: "0 to 5", value: "0-5", count: stats.karmaBuckets["0-5"] || 0 },
    { label: "6 to 50", value: "6-50", count: stats.karmaBuckets["6-50"] || 0 },
    { label: "51 to 500", value: "51-500", count: stats.karmaBuckets["51-500"] || 0 },
    { label: "Above 500", value: "gt500", count: stats.karmaBuckets.gt500 || 0 }
  ];
  return `
    <div class="eyebrow">User stats</div>
    <div class="workspace-stats-card">
      <button class="workspace-stats-card__item" type="button" data-user-stats-filter="">
        <strong>${stats.total}</strong>
        <span>Users</span>
      </button>
      <button class="workspace-stats-card__item" type="button" data-user-stats-filter="">
        <strong>${stats.active}</strong>
        <span>Active</span>
      </button>
      <div class="workspace-stats-card__grid">
        ${buckets
          .map(
            (bucket) => `
              <button class="workspace-stats-card__item${workspaceState.userFilters.karma === bucket.value ? " is-active" : ""}" type="button" data-user-stats-filter="${bucket.value}">
                <strong>${bucket.count}</strong>
                <span>${escapeHtml(bucket.label)}</span>
              </button>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

export function renderUserCard(user, workspaceState, deps = {}) {
  const isRootAdmin = user.pubkey === workspaceState.publicState?.rootAdminPubkey;
  const canManage = deps.currentUserIsAdmin() && !isRootAdmin && user.pubkey !== workspaceState.viewer?.pubkey;
  const submissionHref = `./investigations.html?author=${encodeURIComponent(user.username || user.pubkey)}`;
  const commentHref = `./admin.html?tab=comments&user=${encodeURIComponent(user.username || user.pubkey)}`;
  const karma = deps.resolveWorkspaceUserKarma(user.pubkey);
  const usernameConflict = deps.userHasUsernameConflict ? deps.userHasUsernameConflict(user) : Boolean(user?.usernameConflict);
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  return `
    <article class="roster-item" id="user-${escapeAttribute(user.pubkey)}" data-user-card="${escapeAttribute(user.pubkey)}" ${usernameConflict ? 'data-account-integrity="conflict"' : ""}>
      <div class="workspace-list__row">
        <div>
          ${deps.renderUserIdentityButton(user)}
        </div>
        <div class="tag-row">
          ${usernameConflict ? `<span class="tag tag--danger">Username conflict</span>` : ""}
          <span class="tag">Karma ${deps.formatWorkspaceKarma(karma)}</span>
          ${user.isAdmin ? `<span class="tag">admin</span>` : ""}
          ${user.moderation ? `<span class="tag">${escapeHtml(user.moderation.action)}</span>` : ""}
        </div>
      </div>
      ${
        usernameConflict
          ? `<span class="muted-text">This account claimed @${escapeHtml(user.claimedUsername || "")}, but another pubkey owns that username. Local clients should treat this identity as blocked until it uses a unique username.</span>`
          : ""
      }
      <div class="workspace-stat-links">
        <a class="text-link" href="${escapeAttribute(submissionHref)}">${user.submissionCount} submissions</a>
        <a class="text-link" href="${escapeAttribute(commentHref)}">${user.commentCount} comments</a>
      </div>
      ${
        canManage
          ? `
            <div class="button-row button-row--tight">
              <button class="button" type="button" data-open-user-action="${user.pubkey}">Take action</button>
              ${
                user.isAdmin && deps.userNeedsCurrentSiteKey(user)
                  ? `<button class="button-ghost" type="button" data-user-action="share-site-key" data-target-pubkey="${user.pubkey}">Share site key</button>`
                  : ""
              }
            </div>
          `
          : isRootAdmin
            ? `<div class="tag-row"><span class="tag">root</span></div>`
            : ""
      }
    </article>
  `;
}

export function renderLookupCandidate(workspaceState, deps = {}) {
  const user = workspaceState.userLookupResult;
  if (!user) return "";
  const karma = deps.resolveWorkspaceUserKarma(user.pubkey);
  const usernameConflict = deps.userHasUsernameConflict ? deps.userHasUsernameConflict(user) : Boolean(user?.usernameConflict);
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  return `
    <article class="roster-item" data-user-card="${escapeAttribute(user.pubkey)}" ${usernameConflict ? 'data-account-integrity="conflict"' : ""}>
      <div class="workspace-list__row">
        <div>
          ${deps.renderUserIdentityButton(user)}
        </div>
        <div class="tag-row">
          ${usernameConflict ? `<span class="tag tag--danger">Username conflict</span>` : ""}
          <span class="tag">Karma ${deps.formatWorkspaceKarma(karma)}</span>
          ${user.isAdmin ? `<span class="tag">admin</span>` : `<span class="tag">member</span>`}
        </div>
      </div>
      ${
        usernameConflict
          ? `<span class="muted-text">This account claimed a username that is already owned elsewhere on the network.</span>`
          : ""
      }
      ${
        deps.currentUserIsAdmin() &&
        user.pubkey !== workspaceState.viewer?.pubkey &&
        user.pubkey !== workspaceState.publicState?.rootAdminPubkey
          ? `<div class="button-row button-row--tight"><button class="button" type="button" data-open-user-action="${user.pubkey}">Take action</button></div>`
          : ""
      }
    </article>
  `;
}

export function renderUserProfileModal(workspaceState, deps = {}) {
  const user = deps.resolveWorkspaceUser(workspaceState.userModalPubkey);
  if (!user) return "";
  const displayName = user.displayName || user.username || user.claimedUsername || deps.shortKey(user.pubkey);
  const usernameConflict = deps.userHasUsernameConflict ? deps.userHasUsernameConflict(user) : Boolean(user?.usernameConflict);
  const avatarUrl = deps.safeWorkspaceAvatarUrl(user.avatarUrl || "");
  const socialLinks = deps.safeWorkspaceSocialLinks(user);
  const karma = deps.resolveWorkspaceUserKarma(user.pubkey);
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  return `
    <div class="modal-backdrop">
      <section class="modal-card user-profile-modal">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Profile</div>
            <h2>${escapeHtml(displayName)}</h2>
          </div>
          <button class="button-ghost" type="button" data-modal-close>Close</button>
        </div>
        <div class="user-profile-modal__hero">
          <div class="user-profile-modal__avatar-wrap">
            ${
              avatarUrl
                ? `<span class="user-profile-modal__avatar user-profile-modal__avatar--image"><img src="${escapeAttribute(avatarUrl)}" alt="${escapeAttribute(displayName)}"></span>`
                : `<span class="user-profile-modal__avatar">${escapeHtml(deps.profileInitials(displayName))}</span>`
            }
          </div>
          <div class="user-profile-modal__copy">
            ${user.username ? `<strong>@${escapeHtml(user.username)}</strong>` : ""}
            ${!user.username && user.claimedUsername ? `<strong>Claimed @${escapeHtml(user.claimedUsername)}</strong>` : ""}
            ${usernameConflict ? `<div class="status-box" data-state="error">This username claim conflicts with an older identity on the network.</div>` : ""}
            <span class="muted-text">Karma ${deps.formatWorkspaceKarma(karma)}</span>
            <p>${escapeHtml(user.bio || "No bio added yet.")}</p>
          </div>
        </div>
        ${
          socialLinks.length
            ? `<div class="user-profile-modal__links">${socialLinks.map((link) => `<a class="text-link" href="${escapeAttribute(link)}" target="_blank" rel="noreferrer">${escapeHtml(link)}</a>`).join("")}</div>`
            : ""
        }
      </section>
    </div>
  `;
}

export function renderUserActionModal(workspaceState, deps = {}) {
  const user = deps.resolveWorkspaceUser(workspaceState.userActionModal?.pubkey || "");
  if (!user || !deps.currentUserIsAdmin()) return "";
  const isRootAdmin = user.pubkey === workspaceState.publicState?.rootAdminPubkey;
  const canManage = !isRootAdmin && user.pubkey !== workspaceState.viewer?.pubkey;
  if (!canManage) return "";
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  return `
    <div class="modal-backdrop">
      <section class="modal-card">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">User action</div>
            <h2>${escapeHtml(user.displayName || user.username || deps.shortKey(user.pubkey))}</h2>
          </div>
          <button class="button-ghost" type="button" data-modal-close>Close</button>
        </div>
        <div class="roster-list">
          <article class="roster-item">
            <strong>Role</strong>
            <span>${user.isAdmin ? "Admin" : "Member"}</span>
          </article>
        </div>
        <div class="button-row">
          <button class="button" type="button" data-user-action="admin" data-target-pubkey="${user.pubkey}" ${user.isAdmin ? 'data-mode="revoke"' : 'data-mode="grant"'}>${user.isAdmin ? "Remove admin" : "Make admin"}</button>
          ${
            !user.isAdmin
              ? `
                <button class="button-ghost" type="button" data-user-action="mod" data-target-pubkey="${user.pubkey}" data-mode="temp-ban">Temp ban</button>
                <button class="button-ghost" type="button" data-user-action="mod" data-target-pubkey="${user.pubkey}" data-mode="full-ban">Full ban</button>
                ${
                  user.moderation
                    ? `<button class="button-ghost" type="button" data-user-action="mod" data-target-pubkey="${user.pubkey}" data-mode="clear">Lift restrictions</button>`
                    : ""
                }
              `
              : ""
          }
          ${
            user.isAdmin && deps.userNeedsCurrentSiteKey(user)
              ? `<button class="button-ghost" type="button" data-user-action="share-site-key" data-target-pubkey="${user.pubkey}">Share site key</button>`
              : ""
          }
        </div>
      </section>
    </div>
  `;
}

export function renderCommentActionModal(workspaceState, deps = {}) {
  const modal = workspaceState.commentActionModal;
  if (!modal) return "";
  const comment = (workspaceState.publicState?.allComments || []).find((item) => item.id === modal.commentId);
  if (!comment) return "";
  const threadHref = `./investigation.html?slug=${encodeURIComponent(comment.post_slug)}&comment=${encodeURIComponent(comment.id)}`;
  const author = deps.resolveWorkspaceUser(comment.author);
  const action = comment.visibility === "hidden" ? "restore" : "hide";
  if (modal.mode === "moderate" && !deps.currentUserIsAdmin()) return "";
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  return `
    <div class="modal-backdrop">
      <section class="modal-card">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Comment</div>
            <h2>${modal.mode === "edit" ? "Edit comment" : modal.mode === "delete" ? "Delete comment" : "Take action"}</h2>
          </div>
          <button class="button-ghost" type="button" data-modal-close>Close</button>
        </div>
        <form class="tip-form" data-comment-action-form>
          <input name="commentId" type="hidden" value="${escapeAttribute(comment.id)}">
          <input name="mode" type="hidden" value="${escapeAttribute(modal.mode)}">
          <div class="roster-list">
            <article class="roster-item">
              <strong>${escapeHtml(author?.displayName || author?.username || deps.shortKey(comment.author))}</strong>
              <span>${escapeHtml(deps.trimmed(comment.markdown, 280))}</span>
            </article>
          </div>
          ${
            modal.mode === "edit"
              ? `<label><span>Comment</span><textarea name="markdown" required>${escapeHtml(comment.markdown || "")}</textarea></label>`
              : modal.mode === "delete"
                ? `<p class="muted-text">Deleting your comment also removes its replies from the public thread.</p>`
                : ""
          }
          ${
            modal.mode === "moderate"
              ? `<label><span>Moderation note</span><textarea name="note" placeholder="Optional note for this action">${escapeHtml(comment.moderation?.note || "")}</textarea></label>`
              : ""
          }
          <div class="button-row">
            <a class="button-ghost" href="${escapeAttribute(threadHref)}">Go to post</a>
            <button class="button-ghost" type="button" data-open-user-modal="${escapeAttribute(comment.author)}">Go to user</button>
            ${
              modal.mode === "moderate"
                ? `<button class="button" type="submit">${action === "restore" ? "Restore comment" : "Hide comment"}</button>`
                : modal.mode === "edit"
                  ? `<button class="button" type="submit">Save comment</button>`
                  : `<button class="button" type="submit">Delete comment</button>`
            }
          </div>
        </form>
      </section>
    </div>
  `;
}

export function renderSubmissionCard(item, workspaceState, deps = {}) {
  const latest = item.latest?.payload || {};
  const reviewState = deps.deriveSubmissionReviewState ? deps.deriveSubmissionReviewState(item) : {};
  const statusTags = deps.renderSubmissionStatusTags
    ? deps.renderSubmissionStatusTags(reviewState)
    : "";
  const entityRefs = Array.isArray(latest.entity_refs) ? latest.entity_refs : [];
  const attachmentSummary = Array.isArray(latest.attachments)
    ? latest.attachments
    : latest.attachment
      ? [latest.attachment]
      : [];
  const author = deps.resolveWorkspaceUser ? deps.resolveWorkspaceUser(item.author) : null;
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  return `
    <article class="roster-item">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(latest.subject || "Untitled submission")}</strong>
          <span>${escapeHtml(latest.location || "No location supplied")}</span>
        </div>
        <div class="tag-row">${statusTags}</div>
      </div>
      <span>${escapeHtml(deps.trimmed(latest.details || "", 180))}</span>
      ${
        deps.renderUserIdentityButton
          ? `<div>${deps.renderUserIdentityButton(author || { pubkey: item.author, displayName: author?.displayName || author?.username || "Member" }, item.author)}</div>`
          : ""
      }
      ${
        entityRefs.length
          ? `<span class="muted-text">Entities: ${escapeHtml(entityRefs.map(deps.resolveEntityDisplayValue).join(", "))}</span>`
          : ""
      }
      ${
        latest.suggested_entity?.name
          ? `<span class="muted-text">Suggested entity: ${escapeHtml(latest.suggested_entity.name)}${latest.suggested_entity.location ? ` • ${escapeHtml(latest.suggested_entity.location)}` : ""}</span>`
          : ""
      }
      ${
        attachmentSummary.length
          ? `<span class="muted-text">Attachments: ${escapeHtml(attachmentSummary.map((attachment) => deps.describeSubmissionAttachment ? deps.describeSubmissionAttachment(attachment) : String(attachment?.type || attachment?.mime || "file")).join(", "))}</span>`
          : ""
      }
      <div class="button-row button-row--tight">
        <button class="button" type="button" data-open-submission="${escapeAttribute(item.id)}">View</button>
        ${
          reviewState.viewerConfirmed
            ? `<button class="button-ghost" type="button" data-submission-action="status" data-submission-id="${escapeAttribute(item.id)}" data-author-pubkey="${escapeAttribute(item.author)}" data-status="unconfirmed">Unconfirm</button>`
            : `<button class="button-ghost" type="button" data-submission-action="status" data-submission-id="${escapeAttribute(item.id)}" data-author-pubkey="${escapeAttribute(item.author)}" data-status="confirmed">Confirm</button>`
        }
        ${
          reviewState.confirmCount
            ? ""
            : `<button class="button-ghost" type="button" data-submission-action="status" data-submission-id="${escapeAttribute(item.id)}" data-author-pubkey="${escapeAttribute(item.author)}" data-status="deleted">Delete</button>`
        }
      </div>
    </article>
  `;
}

export function renderSubmissionModal(workspaceState, deps = {}) {
  const modal = workspaceState.submissionModal;
  if (!modal || !deps.currentUserHasInboxAccess()) return "";
  const item = workspaceState.inboxSubmissions.find((entry) => entry.id === modal.submissionId);
  if (!item) return "";
  const latest = item.latest?.payload || {};
  const reviewState = deps.deriveSubmissionReviewState(item);
  const author = deps.resolveWorkspaceUser(item.author);
  const attachment = latest.attachment || null;
  const chatState = workspaceState.chatModal?.submissionId === item.id ? workspaceState.chatModal : null;
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  return `
    <div class="modal-backdrop">
      <section class="modal-card modal-card--wide">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Submission</div>
            <h2>${escapeHtml(latest.subject || "Untitled submission")}</h2>
          </div>
          <button class="button-ghost" type="button" data-modal-close>Close</button>
        </div>
        <div class="roster-list">
          <article class="roster-item">
            <strong>From</strong>
            <div>${deps.renderUserIdentityButton(author || { pubkey: item.author, displayName: author?.displayName || author?.username || "Member" }, item.author)}</div>
          </article>
          <article class="roster-item">
            <strong>Location</strong>
            <span>${escapeHtml(latest.location || "No location supplied")}</span>
          </article>
          ${
            Array.isArray(latest.entity_refs) && latest.entity_refs.length
              ? `<article class="roster-item"><strong>Entities</strong><span>${escapeHtml(latest.entity_refs.map(deps.resolveEntityDisplayValue).join(", "))}</span></article>`
              : ""
          }
          ${
            latest.suggested_entity?.name
              ? `<article class="roster-item"><strong>Suggested entity</strong><span>${escapeHtml(latest.suggested_entity.name)}${latest.suggested_entity.location ? ` • ${escapeHtml(latest.suggested_entity.location)}` : ""}</span></article>`
              : ""
          }
          <article class="roster-item">
            <strong>Details</strong>
            <span>${escapeHtml(latest.details || "No written details supplied.")}</span>
          </article>
          ${
            attachment?.url
              ? `<article class="roster-item"><strong>Attachment</strong><span>${escapeHtml(deps.describeSubmissionAttachment(attachment))}</span><div class="button-row button-row--tight"><button class="button-ghost" type="button" data-download-attachment="${item.id}">Download</button></div></article>`
              : ""
          }
        </div>
        ${renderSubmissionChatPanel(item, chatState, workspaceState, deps)}
        <div class="button-row">
          <button class="button-ghost" type="button" data-open-chat="${item.id}" data-chat-target="${item.author}">${chatState ? "Hide chat" : "Open chat"}</button>
          <button class="button" type="button" data-submission-action="status" data-submission-id="${item.id}" data-author-pubkey="${item.author}" data-status="${reviewState.viewerConfirmed ? "unconfirmed" : "confirmed"}">
            ${reviewState.viewerConfirmed ? "Unconfirm" : "Confirm"}
          </button>
          ${
            !reviewState.confirmCount
              ? `<button class="button-ghost" type="button" data-submission-action="status" data-submission-id="${item.id}" data-author-pubkey="${item.author}" data-status="deleted">Delete</button>`
              : ""
          }
        </div>
      </section>
    </div>
  `;
}

export function renderSubmissionChatPanel(item, chatState, workspaceState, deps = {}) {
  if (!chatState) return "";
  const messages = Array.isArray(chatState.messages) ? chatState.messages : [];
  const loading = Boolean(chatState.loading);
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  return `
    <section class="submission-chat-panel">
      <div class="workspace-list__row">
        <div>
          <div class="eyebrow">Submission chat</div>
          <h3>Conversation</h3>
        </div>
      </div>
      <div class="chat-thread">
        ${
          loading
            ? deps.renderLoadingState("Looking up chat...")
            : messages.length
              ? messages
                  .map(
                    (message) => `
                      <article class="chat-message ${message.author === workspaceState.viewer?.pubkey ? "is-self" : ""}">
                        <strong>${message.author === workspaceState.viewer?.pubkey ? "You" : deps.shortKey(message.author)}</strong>
                        <p>${escapeHtml(message.payload.body || "")}</p>
                      </article>
                    `
                  )
                  .join("")
              : `<div class="empty-state">No messages yet.</div>`
        }
      </div>
      <form class="tip-form" data-chat-form>
        <input name="submissionId" type="hidden" value="${escapeAttribute(item.id)}">
        <input name="targetPubkey" type="hidden" value="${escapeAttribute(chatState.targetPubkey || item.author)}">
        <label>
          <span>Reply</span>
          <textarea name="body" placeholder="Write a reply" required></textarea>
        </label>
        <div class="button-row">
          <button class="button" type="submit">Send message</button>
        </div>
      </form>
    </section>
  `;
}

export function renderModerationComment(comment, workspaceState, deps = {}) {
  const author = deps.resolveWorkspaceUser(comment.author);
  const authorLabel = author?.displayName || author?.username || deps.shortKey(comment.author);
  const menuOpen = workspaceState.commentMenuId === comment.id;
  const preview = deps.trimmed(comment.markdown, 220);
  const threadHref = `./investigation.html?slug=${encodeURIComponent(comment.post_slug)}&comment=${encodeURIComponent(comment.id)}`;
  const karma = deps.resolveWorkspaceCommentKarma(comment);
  const tone = deps.commentToneState(karma);
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  return `
    <article class="roster-item" data-comment-tone="${escapeAttribute(tone.tone)}" style="--comment-review-tone:${escapeAttribute(tone.amount)};">
      <div class="workspace-list__row">
        <div>
          ${deps.renderUserIdentityButton(author || { pubkey: comment.author, displayName: authorLabel, username: author?.username || "" }, comment.author)}
          <span>${escapeHtml(comment.post_slug)} • ${escapeHtml(new Date(comment.created_at * 1000).toLocaleString())}</span>
        </div>
        <div class="tag-row">
          <span class="tag">Karma ${deps.formatWorkspaceKarma(karma)}</span>
          <button class="button-ghost button-ghost--icon" type="button" data-comment-menu-toggle="${escapeAttribute(comment.id)}" aria-label="Comment actions">...</button>
        </div>
      </div>
      <span>${escapeHtml(preview)}</span>
      ${
        comment.moderation?.note
          ? `<span class="muted-text">Moderation note: ${escapeHtml(comment.moderation.note)}</span>`
          : ""
      }
      ${
        menuOpen
          ? `<div class="inline-action-menu"><a class="text-link" href="${escapeAttribute(threadHref)}">View thread</a><button class="button" type="button" data-open-comment-action="${escapeAttribute(comment.id)}" data-comment-mode="moderate">Take action</button></div>`
          : ""
      }
    </article>
  `;
}

export function renderOwnCommentRow(comment, workspaceState, deps = {}) {
  const menuOpen = workspaceState.ownCommentMenuId === comment.id;
  const karma = deps.resolveWorkspaceCommentKarma(comment);
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  return `
    <article class="roster-item">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(comment.post_slug)}</strong>
          <span>${escapeHtml(new Date(comment.created_at * 1000).toLocaleString())}</span>
        </div>
        <div class="tag-row">
          <span class="tag">Karma ${deps.formatWorkspaceKarma(karma)}</span>
          <button class="button-ghost button-ghost--icon" type="button" data-own-comment-menu-toggle="${escapeAttribute(comment.id)}" aria-label="Comment options">...</button>
        </div>
      </div>
      <span>${escapeHtml(deps.trimmed(comment.markdown, 220))}</span>
      ${
        menuOpen
          ? `<div class="inline-action-menu"><button class="button-ghost" type="button" data-open-comment-action="${escapeAttribute(comment.id)}" data-comment-mode="edit">Edit</button><button class="button-ghost" type="button" data-open-comment-action="${escapeAttribute(comment.id)}" data-comment-mode="delete">Delete</button></div>`
          : ""
      }
    </article>
  `;
}

export function renderEntityModal(workspaceState, deps = {}) {
  if (!workspaceState.entityModal) return "";
  const draft = workspaceState.entityModal;
  const title = draft.mode === "edit" ? "Edit entity" : "Add entity";
  const actionLabel = draft.mode === "edit" ? "Save entity" : "Publish entity";
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  return `
    <div class="modal-backdrop">
      <section class="modal-card">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Entity</div>
            <h2>${title}</h2>
          </div>
          <button class="button-ghost" type="button" data-modal-close>Close</button>
        </div>
        <form class="tip-form" data-entity-form>
          <input name="slug" type="hidden" value="${escapeAttribute(draft.slug || "")}">
          <input name="status" type="hidden" value="${escapeAttribute(draft.status || "")}">
          <label>
            <span>Name</span>
            <input name="name" type="text" maxlength="140" value="${escapeAttribute(draft.seedName || "")}" required>
          </label>
          <div class="tip-form__split">
            <label>
              <span>Location</span>
              <input name="location" type="text" maxlength="160" placeholder="City, state" value="${escapeAttribute(draft.seedLocation || "")}" autocomplete="address-level2" required>
            </label>
            <label>
              <span>Type</span>
              <input name="type" type="text" maxlength="80" placeholder="factory farm, store, headquarters" value="${escapeAttribute(draft.seedType || "")}">
            </label>
          </div>
          <div class="tip-form__split">
            <label>
              <span>Latitude</span>
              <input name="lat" type="number" step="0.0001" value="${escapeAttribute(draft.seedLat || "")}">
            </label>
            <label>
              <span>Longitude</span>
              <input name="lng" type="number" step="0.0001" value="${escapeAttribute(draft.seedLng || "")}">
            </label>
          </div>
          <label>
            <span>Notes</span>
            <textarea name="notes" placeholder="Short note for the map and index">${escapeHtml(draft.seedNotes || "")}</textarea>
          </label>
          <div class="button-row">
            <button class="button" type="submit">${actionLabel}</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

export function renderChatModal(workspaceState, deps = {}) {
  if (!workspaceState.chatModal) return "";
  const submission = workspaceState.inboxSubmissions.find((item) => item.id === workspaceState.chatModal.submissionId);
  const messages = workspaceState.chatModal.messages || [];
  const loading = workspaceState.chatModal.loading;
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  return `
    <div class="modal-backdrop">
      <section class="modal-card modal-card--wide">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Submission chat</div>
            <h2>${escapeHtml(submission?.latest?.payload?.subject || workspaceState.chatModal.submissionId)}</h2>
          </div>
          <button class="button-ghost" type="button" data-modal-close>Close</button>
        </div>
        <div class="chat-thread">
          ${
            loading
              ? deps.renderLoadingState("Looking up chat...")
              : messages.length
                ? messages
                    .map(
                      (message) => `
                        <article class="chat-message ${message.author === workspaceState.viewer?.pubkey ? "is-self" : ""}">
                          <strong>${message.author === workspaceState.viewer?.pubkey ? "You" : deps.shortKey(message.author)}</strong>
                          <p>${escapeHtml(message.payload.body || "")}</p>
                        </article>
                      `
                    )
                    .join("")
                : `<div class="empty-state">No messages yet.</div>`
          }
        </div>
        <form class="tip-form" data-chat-form>
          <input name="submissionId" type="hidden" value="${deps.escapeAttribute(workspaceState.chatModal.submissionId)}">
          <input name="targetPubkey" type="hidden" value="${deps.escapeAttribute(workspaceState.chatModal.targetPubkey)}">
          <label>
            <span>Reply</span>
            <textarea name="body" placeholder="Write a reply" required></textarea>
          </label>
          <div class="button-row">
            <button class="button" type="submit">Send message</button>
          </div>
        </form>
      </section>
    </div>
  `;
}
