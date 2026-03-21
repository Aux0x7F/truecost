export function renderWorkspaceView({ workspaceState, deps = {} } = {}) {
  const passwordMinLength = Number(deps.passwordMinLength || 8) || 8;
  const currentUserIsAdmin = deps.currentUserIsAdmin || (() => false);
  const hasSession = Boolean(workspaceState?.session);
  const removedSession = deps.currentRemovedSessionAccount ? deps.currentRemovedSessionAccount() : null;
  const staleSession = deps.currentStaleSessionAccount ? deps.currentStaleSessionAccount() : null;
  const sessionConflict = deps.currentSessionUsernameConflict ? deps.currentSessionUsernameConflict() : { conflict: false };
  const title = !workspaceState?.session
    ? "Log in"
    : currentUserIsAdmin()
      ? "Workspace"
      : "Profile options";
  const lede = !workspaceState?.session
    ? "Use the same username and password each time to return to this account."
    : currentUserIsAdmin()
      ? "Manage users, submissions, entities, and post review."
      : "Update your profile and review your comments.";
  const tabsMarkup = (deps.tabButtons ? deps.tabButtons() : [])
    .map((tab) => deps.renderTabButton(tab))
    .join("");
  const paneMarkup = hasSession
    ? removedSession
      ? renderRemovedPane(deps)
      : staleSession
      ? renderStalePane(deps)
      : sessionConflict.conflict
      ? renderIntegrityPane(workspaceState, deps)
      : renderActivePane(workspaceState, deps, passwordMinLength)
    : renderLoginPane(passwordMinLength);
  const overlayMarkup = [
    deps.renderEntityModal?.() || "",
    deps.renderUserProfileModal?.() || "",
    deps.renderUserActionModal?.() || "",
    deps.renderCommentActionModal?.() || "",
    deps.renderSubmissionModal?.() || "",
    deps.renderPasswordRotationModal?.() || ""
  ].join("");

  return { title, lede, tabsMarkup, paneMarkup, overlayMarkup };
}

function renderActivePane(workspaceState, deps, passwordMinLength) {
  switch (workspaceState.activeTab) {
    case "dashboard":
      return renderDashboardPane(workspaceState, deps);
    case "users":
      return renderUsersPane(workspaceState, deps);
    case "submissions":
      return renderSubmissionsPane(workspaceState, deps);
    case "entities":
      return renderEntitiesPane(workspaceState, deps);
    case "review":
      return renderReviewPane(workspaceState, deps);
    case "log":
      return deps.renderLogPane();
    case "comments":
      return renderCommentsPane(workspaceState, deps);
    case "profile":
    default:
      return renderProfilePane(workspaceState, deps, passwordMinLength);
  }
}

function renderLoginPane(passwordMinLength = 8) {
  return `
    <section class="surface-panel workspace-auth">
      <form class="tip-form" data-login-form>
        <label>
          <span>Username</span>
          <input name="username" type="text" maxlength="40" placeholder="username" autocomplete="username" autocapitalize="none" spellcheck="false" required>
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" maxlength="120" minlength="${passwordMinLength}" placeholder="••••••••" autocomplete="current-password" required>
        </label>
        <div class="button-row">
          <button class="button" type="submit" data-login-submit>Create/Login</button>
        </div>
        <div class="status-box" data-workspace-status>Usernames are unique handles. This site uses your username and password to reopen the same account.</div>
      </form>
    </section>
  `;
}

function renderRemovedPane(deps) {
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const message = deps.currentRemovedSessionAccountMessage
    ? deps.currentRemovedSessionAccountMessage()
    : "This account has been removed from this site.";
  return `
    <section class="surface-panel">
      <div class="eyebrow">Account removed</div>
      <h2>Access is disabled</h2>
      <div class="status-box" data-state="error">${escapeHtml(message)}</div>
      <p class="muted-text">This client blocks profile updates, comments, votes, submissions, and chat for removed identities.</p>
      <div class="button-row">
        <button class="button" type="button" data-signout>Sign out</button>
      </div>
    </section>
  `;
}

function renderIntegrityPane(workspaceState, deps) {
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const message = deps.currentSessionUsernameConflictMessage
    ? deps.currentSessionUsernameConflictMessage("publish from this account")
    : "This username is already taken on the network.";
  return `
    <section class="surface-panel">
      <div class="eyebrow">Username conflict</div>
      <h2>Choose a different username</h2>
      <div class="status-box" data-state="error">${escapeHtml(message)}</div>
      <p class="muted-text">This client blocks profile updates, comments, votes, submissions, and chat from conflicting username claims.</p>
      <div class="button-row">
        <button class="button" type="button" data-signout>Sign out</button>
      </div>
    </section>
  `;
}

function renderStalePane(deps) {
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const message = deps.currentStaleSessionMessage
    ? deps.currentStaleSessionMessage("publish from this account")
    : "This session is using an older password for this account.";
  return `
    <section class="surface-panel">
      <div class="eyebrow">Password changed</div>
      <h2>Sign in with the current password</h2>
      <div class="status-box" data-state="error">${escapeHtml(message)}</div>
      <p class="muted-text">Old keys are blocked once a newer password becomes the active signer for this account.</p>
      <div class="button-row">
        <button class="button" type="button" data-signout>Sign out</button>
      </div>
    </section>
  `;
}

function renderDashboardPane(workspaceState, deps) {
  const metrics = workspaceState.publicState?.metrics || {};
  const locationCount = new Set(
    (workspaceState.publicState?.approvedEntities || []).map((entity) => entity.location).filter(Boolean)
  ).size;
  const snapshot = workspaceState.publicState?.snapshotInfo || null;
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  return `
    <div class="workspace-grid">
      <section class="metric-grid">
        <article class="metric-card"><strong>${metrics.visitorCount24h || 0}</strong><p>Visitors (24h)</p></article>
        <article class="metric-card"><strong>${metrics.visitorCount7d || 0}</strong><p>Visitors (7d)</p></article>
        <article class="metric-card"><strong>${metrics.userCount || 0}</strong><p>Known users</p></article>
        <article class="metric-card"><strong>${metrics.submissionCount || 0}</strong><p>Submission threads</p></article>
        <article class="metric-card"><strong>${locationCount}</strong><p>Tracked locations</p></article>
        <article class="metric-card"><strong>${metrics.approvedEntityCount || 0}</strong><p>Approved entities</p></article>
        <article class="metric-card"><strong>${metrics.commentCount || 0}</strong><p>Visible comments</p></article>
        <article class="metric-card"><strong>${metrics.visitEventCount7d || 0}</strong><p>Visit pulses (7d)</p></article>
      </section>
      <section class="surface-panel">
        <div class="eyebrow">Snapshot</div>
        <h2>Static snapshot</h2>
        <p class="muted-text">Create a static snapshot of approved entities and posts. If GitHub is connected, this can also open or update a review PR.</p>
        <div class="button-row">
          <button class="button" type="button" data-request-snapshot>Create snapshot</button>
        </div>
        <div class="status-box">${escapeHtml(workspaceState.dashboardStatus || "No snapshot request sent yet.")}</div>
        ${deps.renderSnapshotSummary(snapshot)}
      </section>
    </div>
  `;
}

function renderProfilePane(workspaceState, deps, passwordMinLength = 8) {
  const current = deps.currentUser();
  const karma = deps.resolveWorkspaceUserKarma(workspaceState.viewer?.pubkey || "");
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const claimedUsername = String(
    current?.claimedUsername ||
      current?.username ||
      workspaceState?.session?.username ||
      ""
  ).trim();
  return `
    <section class="surface-panel">
      <div class="eyebrow">Profile</div>
      <h2>Profile settings</h2>
      <div class="tag-row">
        <span class="tag">Karma ${deps.formatWorkspaceKarma(karma)}</span>
        ${claimedUsername ? `<span class="tag">@${escapeHtml(claimedUsername)}</span>` : ""}
      </div>
      <p class="muted-text">Usernames are fixed account handles. Profile settings update the public details attached to your current handle.</p>
      <form class="tip-form" data-profile-form>
        <label>
          <span>Bio</span>
          <textarea name="bio" placeholder="Short bio">${escapeHtml(current?.bio || "")}</textarea>
        </label>
        <label>
          <span>Avatar</span>
          <input name="avatarFile" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif">
        </label>
        <label>
          <span>Social links</span>
          <textarea name="socialLinks" placeholder="One URL per line">${escapeHtml((current?.socialLinks || []).join("\n"))}</textarea>
        </label>
        <div class="button-row">
          <button class="button" type="submit">Save profile</button>
          <button class="button-ghost" type="button" data-open-password-rotation data-password-min-length="${passwordMinLength}">Change password</button>
        </div>
        <div class="status-box" data-workspace-status>${deps.currentUserIsAdmin() ? escapeHtml(deps.renderSiteKeyShareStatus()) : "Save changes to update your public profile."}</div>
      </form>
    </section>
  `;
}

function renderUsersPane(workspaceState, deps) {
  const visibleUsers = deps.visibleWorkspaceUsers();
  return `
    <div class="workspace-grid workspace-grid--rail">
      <section class="surface-panel">
        <div class="eyebrow">User Management</div>
        <h2>Shared roster</h2>
        <div class="roster-list">
          ${
            visibleUsers.length
              ? visibleUsers.map((user) => deps.renderUserCard(user)).join("")
              : `<div class="empty-state">No users visible yet.</div>`
          }
        </div>
      </section>
      <aside class="workspace-rail-stack">
        <section class="surface-panel workspace-rail-panel">
          ${deps.renderSearchField({
            srLabel: "Username",
            inputAttributes: {
              class: "workspace-search__input",
              "data-quick-user-input": true,
              type: "text",
              maxlength: "80",
              placeholder: "username",
              value: workspaceState.userLookupQuery || "",
              autocomplete: "off"
            },
            clearButton: workspaceState.userLookupQuery && !workspaceState.userLookupLoading
              ? {
                  attributes: { "data-clear-user-lookup": true },
                  ariaLabel: "Clear lookup"
                }
              : null,
            loading: workspaceState.userLookupLoading
          })}
          <div class="workspace-filter-row">
            <label class="workspace-filter-field">
              <span>Karma</span>
              <select data-user-filter-karma>
                ${deps.renderKarmaSelectOptions(workspaceState.userFilters.karma)}
              </select>
            </label>
            <label class="workspace-filter-field">
              <span>Role</span>
              <select data-user-filter-role>
                ${deps.renderRoleSelectOptions(workspaceState.userFilters.role)}
              </select>
            </label>
          </div>
          ${
            workspaceState.userDirectStatus
              ? `<div class="status-box">${deps.escapeHtml(workspaceState.userDirectStatus)}</div>`
              : ""
          }
          ${deps.renderLookupCandidate()}
        </section>
        <section class="surface-panel workspace-rail-panel">
          ${deps.renderUserStatsCard()}
        </section>
      </aside>
    </div>
  `;
}

function renderSubmissionsPane(workspaceState, deps) {
  if (deps.currentUserHasInboxAccess()) {
    const filteredSubmissions = deps.filterInboxSubmissions(workspaceState.inboxSubmissions);
    const filterSuggestions = deps.renderSubmissionFilterSuggestions();
    return `
      <section class="surface-panel">
        <div class="eyebrow">Encrypted submissions</div>
        <h2>Shared inbox</h2>
        <div class="workspace-filter-bar">
          ${deps.renderSearchField({
            srLabel: "Filter submissions",
            inputAttributes: {
              class: "workspace-search__input",
              "data-submission-filter-input": true,
              type: "text",
              maxlength: "240",
              placeholder: "Filter by status, user, type, location, or entity",
              value: workspaceState.submissionFilters.query || "",
              autocomplete: "off"
            },
            clearButton: workspaceState.submissionFilters.query
              ? {
                  attributes: { "data-clear-submission-filter": true },
                  ariaLabel: "Clear submission filters"
                }
              : null,
            resultsHtml: filterSuggestions
          })}
        </div>
        <div class="roster-list">
          ${
            workspaceState.inboxLoading
              ? deps.renderLoadingState("Looking up submissions...")
              : filteredSubmissions.length
                ? filteredSubmissions.map((item) => deps.renderSubmissionCard(item)).join("")
                : `<div class="empty-state">No submissions decrypted from the inbox yet.</div>`
          }
        </div>
      </section>
    `;
  }

  return `
    <section class="surface-panel">
      <div class="eyebrow">Submission intake</div>
      <h2>Metadata view</h2>
      <p class="muted-text">${
        deps.currentUserPendingKeyRequest() || workspaceState.keyRequestState === "pending"
          ? "The shared inbox is still syncing to this admin account."
          : "This admin account can manage public status updates while the shared inbox catches up."
      }</p>
      <div class="roster-list">
        ${
          (workspaceState.publicState?.users || [])
            .filter((user) => user.submissionCount > 0)
            .map(
              (user) => `
                <article class="roster-item">
                  ${deps.renderUserIdentityButton(user)}
                  <span>${user.submissionCount} submission threads</span>
                </article>
              `
            )
            .join("") || `<div class="empty-state">No submission metadata visible yet.</div>`
        }
      </div>
    </section>
  `;
}

function renderEntitiesPane(workspaceState, deps) {
  const visibleEntities = deps.visibleWorkspaceEntities();
  return `
    <div class="workspace-grid workspace-grid--rail">
      <section class="surface-panel">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Entities</div>
            <h2>Locations and targets</h2>
          </div>
          <button class="button" type="button" data-open-entity-modal>Add entity</button>
        </div>
        <div class="roster-list">
          ${
            visibleEntities.length
              ? visibleEntities
                  .map(
                    (entity) => `
                      <article class="roster-item">
                        <div class="workspace-list__row">
                          <div>
                            <strong>${deps.escapeHtml(entity.name)}</strong>
                            <span>${deps.escapeHtml(entity.location)} • ${deps.escapeHtml(entity.type)}</span>
                          </div>
                          <div class="tag-row">
                            <span class="tag">${deps.escapeHtml(entity.status)}</span>
                          </div>
                        </div>
                        <span>${deps.escapeHtml(entity.notes || "No public note yet.")}</span>
                        ${
                          deps.currentUserIsAdmin()
                            ? `
                              <div class="button-row button-row--tight">
                                ${entity.status !== "deleted" ? `<button class="button-ghost" type="button" data-edit-entity="${entity.slug}">Edit</button>` : ""}
                                ${
                                  entity.status === "pending"
                                    ? `
                                      <button class="button-ghost" type="button" data-entity-action="approve" data-entity-slug="${entity.slug}">Approve</button>
                                      <button class="button-ghost" type="button" data-entity-action="deny" data-entity-slug="${entity.slug}">Deny</button>
                                    `
                                    : `<button class="button-ghost" type="button" data-entity-action="delete" data-entity-slug="${entity.slug}">Delete</button>`
                                }
                              </div>
                            `
                            : ""
                        }
                      </article>
                    `
                  )
                  .join("")
              : `<div class="empty-state">No entities match these filters yet.</div>`
          }
        </div>
      </section>
      <aside class="workspace-rail-stack">
        <section class="surface-panel workspace-rail-panel">
          ${deps.renderEntityManagementRail()}
        </section>
      </aside>
    </div>
  `;
}

function renderReviewPane(workspaceState, deps) {
  const drafts = (workspaceState.publicState?.drafts || []).slice();
  const pending = drafts.filter((draft) => ["candidate", "submitted", "review"].includes(String(draft.status || "").toLowerCase()));
  const recentlyDecided = drafts
    .filter((draft) => ["approved", "revision", "denied"].includes(String(draft.status || "").toLowerCase()))
    .slice(0, 10);
  return `
    <div class="review-stack">
      <section class="surface-panel">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Post Review</div>
            <h2>Ready for review</h2>
          </div>
          <div class="tag-row">
            <span class="tag">${pending.length} waiting</span>
          </div>
        </div>
        <p class="muted-text">Investigations and page updates land here once they are submitted for review. Approving keeps the latest cleartext version in the next bakedown queue.</p>
        <div class="roster-list">
          ${
            pending.length
              ? pending.map((draft) => deps.renderReviewCard(draft)).join("")
              : `<div class="empty-state">No updates are waiting for review.</div>`
          }
        </div>
      </section>
      <section class="surface-panel">
        <div class="eyebrow">Recent decisions</div>
        <h2>Reviewed updates</h2>
        <div class="roster-list">
          ${
            recentlyDecided.length
              ? recentlyDecided.map((draft) => deps.renderReviewedCard(draft)).join("")
              : `<div class="empty-state">Approved, denied, and revision requests will appear here.</div>`
          }
        </div>
      </section>
    </div>
  `;
}

function renderCommentsPane(workspaceState, deps) {
  const ownComments = workspaceState.publicState?.commentsByAuthor.get(workspaceState.viewer?.pubkey || "") || [];
  if (deps.currentUserIsAdmin()) {
    const allComments = deps.filterWorkspaceComments((workspaceState.publicState?.allComments || []).slice().reverse());
    const hiddenCount = workspaceState.publicState?.hiddenComments?.length || 0;
    return `
      <section class="surface-panel">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Comments</div>
            <h2>Review comments</h2>
          </div>
          <div class="tag-row">
            <span class="tag">${allComments.length - hiddenCount} shown</span>
            <span class="tag">${hiddenCount} hidden</span>
          </div>
        </div>
        <div class="workspace-filter-bar">
          ${deps.renderSearchField({
            srLabel: "Search comments",
            inputAttributes: {
              class: "workspace-search__input",
              "data-comment-filter-query": true,
              type: "text",
              maxlength: "120",
              placeholder: "Search comments or users",
              value: workspaceState.commentFilters.query || "",
              autocomplete: "off"
            },
            clearButton: workspaceState.commentFilters.query
              ? {
                  attributes: { "data-clear-comment-filter": true },
                  ariaLabel: "Clear comment search"
                }
              : null
          })}
          <label class="workspace-select">
            <span class="sr-only">Filter by role</span>
            <select data-comment-filter-role>
              <option value="">All roles</option>
              <option value="admin" ${workspaceState.commentFilters.role === "admin" ? "selected" : ""}>Admin</option>
              <option value="user" ${workspaceState.commentFilters.role === "user" ? "selected" : ""}>User</option>
            </select>
          </label>
          <label class="workspace-select">
            <span class="sr-only">Filter by karma</span>
            <select data-comment-filter-karma>
              ${deps.renderKarmaSelectOptions(workspaceState.commentFilters.karma)}
            </select>
          </label>
        </div>
        <div class="roster-list">
          ${
            allComments.length
              ? allComments.map((comment) => deps.renderModerationComment(comment)).join("")
              : `<div class="empty-state">No comments yet.</div>`
          }
        </div>
      </section>
    `;
  }
  return `
    <section class="surface-panel">
      <div class="eyebrow">Comments</div>
      <h2>Your comments</h2>
      <div class="roster-list">
        ${
          ownComments.length
            ? ownComments
                .slice()
                .reverse()
                .map((comment) => deps.renderOwnCommentRow(comment))
                .join("")
            : `<div class="empty-state">No comments yet.</div>`
        }
      </div>
    </section>
  `;
}
