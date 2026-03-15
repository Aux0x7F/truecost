import SITE from "./core/site-config.js";
import { buildDraftMarkdown, createUniqueSlug, splitTags } from "./core/content-utils.js";
import {
  cleanSlug,
  decryptUploadedBlob,
  deriveIdentity,
  ensureEventToolsLoaded,
  generateSecretKeyHex,
  loadAdminKeyShare,
  loadAdminKeyShares,
  loadInboxSubmissions,
  loadPublicState,
  lookupUsers,
  loadSubmissionThread,
  normalizeUsername,
  publishAdminKeyShare,
  publishAdminKeyRequest,
  publishSiteKeyEvent,
  publishSubmissionChat,
  publishTaggedJson,
  resolveSitePubkey,
  shortKey,
  uploadPublicBlob
} from "./core/nostr.js";
import { getStoredSession, rebroadcastAccount, signInWithCredentials } from "./core/session.js";

const workspaceState = {
  session: getStoredSession(),
  viewer: null,
  publicState: null,
  siteKeyShares: [],
  siteKeyShare: null,
  inboxSubmissions: [],
  staticSlugs: [],
  activeTab: "login",
  entityModal: null,
  chatModal: null,
  exportValue: "",
  dashboardStatus: "",
  userDirectStatus: "",
  userLookupQuery: "",
  userLookupResult: null,
  keyRequestState: "",
  keyRequestTimer: 0,
  backgroundSyncTimer: 0,
  backgroundSyncInFlight: false,
  inboxLoading: false,
  respondedKeyRequests: new Set(),
  keyRequestCache: null
};

document.addEventListener("DOMContentLoaded", () => {
  if (!document.querySelector("[data-workspace-page]")) return;
  bindWorkspace();
  document.addEventListener("visibilitychange", handleWorkspaceVisibilityChange);
  window.addEventListener("focus", handleWorkspaceWindowFocus);
  void refreshWorkspace();
});

function bindWorkspace() {
  const shell = document.querySelector("[data-workspace-shell]");
  if (!shell) return;

  shell.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const tab = target.closest("[data-workspace-tab]");
    if (tab) {
      setActiveTab(tab.getAttribute("data-workspace-tab") || "profile");
      renderWorkspace();
      return;
    }

    const openEntityModal = target.closest("[data-open-entity-modal]");
    if (openEntityModal) {
      workspaceState.entityModal = createEntityModalState(openEntityModal);
      renderWorkspace();
      return;
    }

    const moderationButton = target.closest("[data-user-action]");
    if (moderationButton) {
      await handleUserAction(moderationButton);
      return;
    }

    const directUserAction = target.closest("[data-quick-user-action]");
    if (directUserAction) {
      await handleDirectUserAction(directUserAction);
      return;
    }

    const findUserAction = target.closest("[data-find-user]");
    if (findUserAction) {
      await handleDirectUserLookup();
      return;
    }

    const entityAction = target.closest("[data-entity-action]");
    if (entityAction) {
      await handleEntityAction(entityAction);
      return;
    }

    const commentAction = target.closest("[data-comment-action]");
    if (commentAction) {
      await handleCommentAction(commentAction);
      return;
    }

    const reviewAction = target.closest("[data-review-action]");
    if (reviewAction) {
      await handleReviewAction(reviewAction);
      return;
    }

    const entityPick = target.closest("[data-entity-pick]");
    if (entityPick) {
      applyEntityPick(entityPick);
      return;
    }

    const locationPick = target.closest("[data-location-pick]");
    if (locationPick) {
      applyLocationPick(locationPick);
      return;
    }

    const submissionAction = target.closest("[data-submission-action]");
    if (submissionAction) {
      await handleSubmissionAction(submissionAction);
      return;
    }

    const attachmentAction = target.closest("[data-download-attachment]");
    if (attachmentAction) {
      await handleAttachmentDownload(attachmentAction);
      return;
    }

    const snapshotRequest = target.closest("[data-request-snapshot]");
    if (snapshotRequest) {
      await handleSnapshotRequest(snapshotRequest);
      return;
    }

    const openChat = target.closest("[data-open-chat]");
    if (openChat) {
      workspaceState.chatModal = {
        submissionId: openChat.getAttribute("data-open-chat") || "",
        targetPubkey: openChat.getAttribute("data-chat-target") || "",
        loading: true,
        messages: []
      };
      renderWorkspace();
      await hydrateChatModal();
      return;
    }

    if (target.closest("[data-modal-close]")) {
      workspaceState.entityModal = null;
      workspaceState.chatModal = null;
      renderWorkspace();
    }
  });

  shell.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();

    if (form.matches("[data-login-form]")) {
      await handleLogin(form);
      return;
    }
    if (form.matches("[data-profile-form]")) {
      await handleProfileSave(form);
      return;
    }
    if (form.matches("[data-entity-form]")) {
      await handleEntitySave(form);
      return;
    }
    if (form.matches("[data-chat-form]")) {
      await handleChatSend(form);
    }
  });

  shell.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches("[data-entity-picker-input], [data-location-input]")) {
      hydrateWorkspaceEnhancements();
    }
  });
}

async function refreshWorkspace(force = false) {
  if (workspaceState.keyRequestTimer) {
    window.clearTimeout(workspaceState.keyRequestTimer);
    workspaceState.keyRequestTimer = 0;
  }
  if (workspaceState.backgroundSyncTimer) {
    window.clearTimeout(workspaceState.backgroundSyncTimer);
    workspaceState.backgroundSyncTimer = 0;
  }
  workspaceState.session = getStoredSession();
  workspaceState.viewer = null;
  if (!workspaceState.session) {
    workspaceState.publicState = workspaceState.publicState || null;
    workspaceState.siteKeyShares = [];
    workspaceState.siteKeyShare = null;
    workspaceState.inboxSubmissions = [];
    workspaceState.activeTab = "login";
    renderWorkspace();
    return;
  }

  renderWorkspaceLoading("Looking up workspace...");
  await ensureEventToolsLoaded();
  await hydrateWorkspaceState(force);
  workspaceState.staticSlugs = await loadStaticSlugs().catch(() => []);
  workspaceState.activeTab = chooseInitialTab(workspaceState.activeTab);
  renderWorkspace();
  await maybeResolveUserDeepLink();
  workspaceState.keyRequestState = "";
  await maybeAutoRespondToKeyRequests().catch(() => {});
  await maybeEnsureCurrentKeyRequest().catch(() => {
    workspaceState.keyRequestState = "error";
  });
  if (currentUserHasInboxAccess()) {
    void hydrateInboxSubmissions();
  } else {
    workspaceState.inboxLoading = false;
    workspaceState.inboxSubmissions = [];
  }
  scheduleWorkspaceSync();
}

function renderWorkspaceLoading(message) {
  const shell = document.querySelector("[data-workspace-shell]");
  const title = document.querySelector("[data-workspace-title]");
  const lede = document.querySelector("[data-workspace-lede]");
  if (title) title.textContent = "Workspace";
  if (lede) lede.textContent = message;
  if (shell) shell.innerHTML = renderLoadingState(message);
}

function handleWorkspaceVisibilityChange() {
  if (document.visibilityState === "visible") {
    void syncWorkspaceState(true);
  }
}

function handleWorkspaceWindowFocus() {
  void syncWorkspaceState(true);
}

async function hydrateWorkspaceState(force = false) {
  workspaceState.session = getStoredSession();
  workspaceState.viewer = workspaceState.session
    ? deriveIdentity(workspaceState.session.secretKeyHex)
    : null;
  const cachedShares = loadCachedSiteKeyShares();
  const [publicState, remoteShares] = await Promise.all([
    loadPublicState(force),
    workspaceState.session
      ? loadAdminKeyShares(workspaceState.session.secretKeyHex).catch(() => [])
      : Promise.resolve([])
  ]);
  workspaceState.publicState = publicState;
  const activeSitePubkey = resolveSitePubkey(workspaceState.publicState);
  let mergedShares = mergeSiteKeyShares(remoteShares, cachedShares);
  if (workspaceState.session && activeSitePubkey && !findSiteKeyShareInList(mergedShares, activeSitePubkey)) {
    const currentShare = await loadAdminKeyShare(workspaceState.session.secretKeyHex, activeSitePubkey).catch(() => null);
    mergedShares = mergeSiteKeyShares(currentShare ? [currentShare, ...mergedShares] : mergedShares, []);
  }
  workspaceState.siteKeyShares = mergedShares;
  persistCachedSiteKeyShares(workspaceState.siteKeyShares);
  workspaceState.siteKeyShare = findSiteKeyShareInList(
    workspaceState.siteKeyShares,
    activeSitePubkey
  );
}

function captureWorkspaceAccessState() {
  return JSON.stringify({
    sessionPubkey: workspaceState.viewer?.pubkey || "",
    admin: currentUserIsAdmin(),
    inbox: currentUserHasInboxAccess(),
    activeSitePubkey: activeSitePubkey()
  });
}

function captureWorkspaceDataState() {
  const publicState = workspaceState.publicState || {};
  return JSON.stringify({
    tab: workspaceState.activeTab,
    keyState: workspaceState.keyRequestState || "",
    users: (publicState.users || []).map((user) => `${user.pubkey}:${user.isAdmin ? 1 : 0}:${user.submissionCount || 0}:${user.commentCount || 0}`),
    pendingKeyRequests: (publicState.pendingAdminKeyRequests || []).map((request) => `${request.id}:${request.requester_pubkey}:${request.site_pubkey}`),
    submissions: (workspaceState.inboxSubmissions || []).map((submission) => `${submission.id}:${submission.latest?.status || submission.status || ""}`),
    entities: (publicState.entities || []).map((entity) => `${entity.slug}:${entity.status}`),
    drafts: (publicState.drafts || []).map((draft) => `${draft.slug}:${draft.status}:${draft.id || draft.created_at || ""}`),
    comments: (publicState.allComments || []).map((comment) => `${comment.id}:${comment.visibility || "visible"}`),
    snapshot: publicState.snapshotInfo?.id || "",
    metrics: publicState.metrics || {}
  });
}

function workspaceSyncDelayMs() {
  if (!workspaceState.session) return 0;
  if (currentUserIsAdmin() && !currentUserHasInboxAccess()) return 2600;
  if (currentUserIsAdmin()) return 6000;
  return 15000;
}

function scheduleWorkspaceSync(delay = workspaceSyncDelayMs()) {
  if (workspaceState.backgroundSyncTimer) {
    window.clearTimeout(workspaceState.backgroundSyncTimer);
    workspaceState.backgroundSyncTimer = 0;
  }
  if (!delay || document.visibilityState === "hidden") return;
  workspaceState.backgroundSyncTimer = window.setTimeout(() => {
    void syncWorkspaceState(true);
  }, delay);
}

async function syncWorkspaceState(force = true) {
  if (workspaceState.backgroundSyncInFlight) return;
  if (!document.querySelector("[data-workspace-page]")) return;
  if (document.visibilityState === "hidden") {
    scheduleWorkspaceSync();
    return;
  }
  if (!getStoredSession()) return;

  const beforeAccess = captureWorkspaceAccessState();
  const beforeData = captureWorkspaceDataState();
  workspaceState.backgroundSyncInFlight = true;
  let didRefresh = false;
  try {
    await ensureEventToolsLoaded();
    await hydrateWorkspaceState(force);
    workspaceState.keyRequestState = "";
    await maybeAutoRespondToKeyRequests().catch(() => {});
    await maybeEnsureCurrentKeyRequest().catch(() => {
      workspaceState.keyRequestState = "error";
    });
    if (currentUserHasInboxAccess()) {
      void hydrateInboxSubmissions();
    } else {
      workspaceState.inboxLoading = false;
      workspaceState.inboxSubmissions = [];
    }
    workspaceState.staticSlugs = await loadStaticSlugs().catch(() => []);
    workspaceState.activeTab = chooseInitialTab(workspaceState.activeTab);
    const afterAccess = captureWorkspaceAccessState();
    const afterData = captureWorkspaceDataState();
    if (beforeAccess !== afterAccess) {
      didRefresh = true;
      renderWorkspace({ soft: true });
    } else if (beforeData !== afterData && shouldSoftRefreshWorkspace()) {
      didRefresh = true;
      renderWorkspace({ soft: true });
    }
    await maybeOpenAdminChatFromUrl();
    await maybeResolveUserDeepLink();
  } finally {
    workspaceState.backgroundSyncInFlight = false;
    if (!didRefresh) scheduleWorkspaceSync();
  }
}

function renderWorkspace(options = {}) {
  const soft = Boolean(options.soft);
  const shell = document.querySelector("[data-workspace-shell]");
  const title = document.querySelector("[data-workspace-title]");
  const lede = document.querySelector("[data-workspace-lede]");
  if (!shell || !title || !lede) return;

  if (!workspaceState.session) {
    title.textContent = "Log in";
    lede.textContent = "Use the same username and password each time to return to this account.";
    shell.innerHTML = renderLoginPane();
    return;
  }

  const admin = currentUserIsAdmin();
  title.textContent = admin ? "Workspace" : "Profile options";
  lede.textContent = admin
    ? "Manage users, submissions, entities, and post review."
    : "Update your profile and review your comments.";

  const tabsMarkup = tabButtons().map((tab) => renderTabButton(tab)).join("");
  const paneMarkup = renderActivePane();
  const overlayMarkup = `${renderEntityModal()}${renderChatModal()}`;
  const tabs = shell.querySelector("[data-workspace-tabs]");
  const pane = shell.querySelector("[data-workspace-pane]");
  const overlays = shell.querySelector("[data-workspace-overlays]");

  if (soft && tabs && pane && overlays) {
    tabs.innerHTML = tabsMarkup;
    pane.innerHTML = paneMarkup;
    overlays.innerHTML = overlayMarkup;
  } else {
    shell.innerHTML = `
      <div class="workspace-tabs" data-workspace-tabs>
        ${tabsMarkup}
      </div>
      <div class="workspace-pane" data-workspace-pane>
        ${paneMarkup}
      </div>
      <div data-workspace-overlays>
        ${overlayMarkup}
      </div>
    `;
  }
  hydrateWorkspaceEnhancements();
}

function renderLoginPane() {
  return `
    <section class="surface-panel workspace-auth">
      <form class="tip-form" data-login-form>
        <label>
          <span>Username</span>
          <input name="username" type="text" maxlength="40" placeholder="field-notes" required>
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" maxlength="120" placeholder="••••••••" required>
        </label>
        <div class="button-row">
          <button class="button" type="submit">Log in</button>
        </div>
        <div class="status-box" data-workspace-status>This site uses your username and password to reopen the same account.</div>
      </form>
    </section>
  `;
}

function renderActivePane() {
  switch (workspaceState.activeTab) {
    case "dashboard":
      return renderDashboardPane();
    case "users":
      return renderUsersPane();
    case "submissions":
      return renderSubmissionsPane();
    case "entities":
      return renderEntitiesPane();
    case "review":
      return renderReviewPane();
    case "log":
      return renderLogPane();
    case "comments":
      return renderCommentsPane();
    case "profile":
    default:
      return renderProfilePane();
  }
}

function renderDashboardPane() {
  const metrics = workspaceState.publicState?.metrics || {};
  const locationCount = new Set(
    (workspaceState.publicState?.approvedEntities || []).map((entity) => entity.location).filter(Boolean)
  ).size;
  const snapshot = workspaceState.publicState?.snapshotInfo || null;
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
        ${renderSnapshotSummary(snapshot)}
      </section>
    </div>
  `;
}

function renderProfilePane() {
  const current = currentUser();
  const socialLinks = Array.isArray(current?.socialLinks) ? current.socialLinks : [];
  const displayName = current?.displayName || current?.username || "Unnamed account";
  const usernameLabel = current?.username ? `@${escapeHtml(current.username)}` : "No username saved yet.";
  const roleLabel = currentUserIsAdmin() ? "Admin access" : "Member access";
  return `
    <div class="workspace-grid">
      <section class="surface-panel">
        <div class="eyebrow">Profile</div>
        <h2>Profile settings</h2>
        <form class="tip-form" data-profile-form>
          <label>
            <span>Display name</span>
            <input name="displayName" type="text" maxlength="80" value="${escapeAttribute(current?.displayName || "")}">
          </label>
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
          </div>
          <div class="status-box" data-workspace-status>Save changes to update your public profile.</div>
        </form>
      </section>
      <section class="surface-panel">
        <div class="eyebrow">Account</div>
        <h2>Current account</h2>
        <div class="roster-list">
          <article class="roster-item">
            <strong>${escapeHtml(displayName)}</strong>
            <span>${usernameLabel}</span>
            <span>${escapeHtml(roleLabel)}</span>
            <span class="mono">${escapeHtml(workspaceState.viewer?.pubkey || "")}</span>
          </article>
          ${
            socialLinks.length
              ? socialLinks
                  .map(
                    (link) => `
                      <article class="roster-item">
                        <strong>Social link</strong>
                        <a class="text-link" href="${escapeAttribute(link)}" target="_blank" rel="noreferrer">${escapeHtml(link)}</a>
                      </article>
                    `
                  )
                  .join("")
              : `<div class="empty-state">No social links added yet.</div>`
          }
        </div>
        ${currentUserIsAdmin() ? `<p class="muted-text">${renderSiteKeyShareStatus()}</p>` : ""}
      </section>
    </div>
  `;
}

function renderUsersPane() {
  const visibleUsers = visibleWorkspaceUsers();
  return `
    <div class="workspace-grid">
      <section class="surface-panel">
        <div class="eyebrow">Find user</div>
        <h2>Lookup by username or pubkey</h2>
        <p class="muted-text">Use a username when the roster is behind. If you already have the pubkey, you can act on it directly.</p>
        <label class="workspace-search">
          <span class="sr-only">Username or pubkey</span>
          <input class="workspace-search__input" data-quick-user-input type="text" maxlength="80" placeholder="username or 64-character pubkey" value="${escapeAttribute(workspaceState.userLookupQuery || "")}">
        </label>
        <div class="button-row button-row--tight">
          <button class="button-ghost" type="button" data-find-user>Find user</button>
          <button class="button-ghost" type="button" data-quick-user-action="admin" data-mode="grant">Make admin</button>
          ${
            workspaceState.siteKeyShare
              ? `<button class="button-ghost" type="button" data-quick-user-action="share-site-key">Share current key</button>`
              : ""
          }
        </div>
        <div class="status-box">${escapeHtml(workspaceState.userDirectStatus || "Find a user first, or paste a pubkey to act directly.")}</div>
        ${renderLookupCandidate()}
      </section>
      <section class="surface-panel">
        <div class="eyebrow">User Management</div>
        <h2>Shared roster</h2>
        <div class="roster-list">
          ${
            visibleUsers
              .map((user) => renderUserCard(user))
              .join("") || `<div class="empty-state">No users visible yet.</div>`
          }
        </div>
      </section>
    </div>
  `;
}

function renderUserCard(user) {
  const isRootAdmin = user.pubkey === workspaceState.publicState?.rootAdminPubkey;
  const canChangeAdmin = currentUserIsAdmin() && !isRootAdmin && user.pubkey !== workspaceState.viewer?.pubkey;
  return `
    <article class="roster-item" id="user-${escapeAttribute(user.pubkey)}" data-user-card="${escapeAttribute(user.pubkey)}">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(user.displayName)}</strong>
          <span>${user.username ? `@${escapeHtml(user.username)}` : shortKey(user.pubkey)}</span>
        </div>
        <div class="tag-row">
          ${user.isAdmin ? `<span class="tag">admin</span>` : ""}
          ${user.moderation ? `<span class="tag">${escapeHtml(user.moderation.action)}</span>` : ""}
        </div>
      </div>
      <span>${user.submissionCount} submissions • ${user.commentCount} comments</span>
      <span class="mono">${user.pubkey}</span>
      ${
        currentUserIsAdmin()
          ? `
            <div class="button-row button-row--tight">
              ${
                canChangeAdmin
                  ? `<button class="button-ghost" type="button" data-user-action="admin" data-target-pubkey="${user.pubkey}" ${user.isAdmin ? 'data-mode="revoke"' : 'data-mode="grant"'}>${user.isAdmin ? "Remove admin" : "Make admin"}</button>`
                  : isRootAdmin
                    ? `<span class="tag">root admin</span>`
                    : ""
              }
              ${
                user.isAdmin && user.pubkey !== workspaceState.viewer?.pubkey && workspaceState.siteKeyShare
                  ? `<button class="button-ghost" type="button" data-user-action="share-site-key" data-target-pubkey="${user.pubkey}">Share site key</button>`
                  : ""
              }
              <button class="button-ghost" type="button" data-user-action="mod" data-target-pubkey="${user.pubkey}" data-mode="temp-ban">Temp ban</button>
              <button class="button-ghost" type="button" data-user-action="mod" data-target-pubkey="${user.pubkey}" data-mode="full-ban">Full ban</button>
              <button class="button-ghost" type="button" data-user-action="mod" data-target-pubkey="${user.pubkey}" data-mode="clear">Clear</button>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderLookupCandidate() {
  const user = workspaceState.userLookupResult;
  if (!user) return "";
  return `
    <article class="roster-item" data-user-card="${escapeAttribute(user.pubkey)}">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(user.displayName || user.username || shortKey(user.pubkey))}</strong>
          <span>${user.username ? `@${escapeHtml(user.username)}` : shortKey(user.pubkey)}</span>
        </div>
        <div class="tag-row">
          ${user.isAdmin ? `<span class="tag">admin</span>` : `<span class="tag">member</span>`}
        </div>
      </div>
      <span class="mono">${escapeHtml(user.pubkey)}</span>
    </article>
  `;
}

function renderLogEvent(event) {
  const target = logTarget(event);
  return `
    <article class="roster-item">
      <strong>${escapeHtml(logLabel(event))}</strong>
      <span>${escapeHtml(target.description)}</span>
      <div class="button-row button-row--tight">
        <a class="text-link" href="${target.href}">Open</a>
      </div>
    </article>
  `;
}

function renderSubmissionsPane() {
  if (currentUserHasInboxAccess()) {
    return `
      <section class="surface-panel">
        <div class="eyebrow">Encrypted submissions</div>
        <h2>Shared inbox</h2>
        <div class="roster-list">
          ${
            workspaceState.inboxLoading
              ? renderLoadingState("Looking up submissions...")
              : workspaceState.inboxSubmissions.length
              ? workspaceState.inboxSubmissions.map((item) => renderSubmissionCard(item)).join("")
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
        currentUserPendingKeyRequest() || workspaceState.keyRequestState === "pending"
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
                  <strong>${escapeHtml(user.displayName)}</strong>
                  <span>${user.submissionCount} submission threads</span>
                  <span class="mono">${user.pubkey}</span>
                </article>
              `
            )
            .join("") || `<div class="empty-state">No submission metadata visible yet.</div>`
        }
      </div>
    </section>
  `;
}

function renderLogPane() {
  const logEvents = (workspaceState.publicState?.rawEvents || [])
    .filter((event) =>
      [
        SITE.nostr.kinds.snapshot,
        SITE.nostr.kinds.adminClaim,
        SITE.nostr.kinds.adminRole,
        SITE.nostr.kinds.userMod,
        SITE.nostr.kinds.snapshotRequest,
        SITE.nostr.kinds.entity,
        SITE.nostr.kinds.draft,
        SITE.nostr.kinds.commentMod,
        SITE.nostr.kinds.submissionStatus,
        SITE.nostr.kinds.adminKeyShare,
        SITE.nostr.kinds.siteKey
      ].includes(Number(event.kind))
    )
    .slice(0, 40);
  return `
    <section class="surface-panel">
      <div class="eyebrow">Log</div>
      <h2>Audit events</h2>
      <div class="roster-list">
        ${
          logEvents.length
            ? logEvents.map((event) => renderLogEvent(event)).join("")
            : `<div class="empty-state">No audit events visible yet.</div>`
        }
      </div>
    </section>
  `;
}

function renderSubmissionCard(item) {
  const latest = item.latest?.payload || {};
  const status = workspaceState.publicState?.submissionStatuses.get(item.id)?.status || "received";
  const entityRefs = Array.isArray(latest.entity_refs) ? latest.entity_refs : [];
  return `
    <article class="roster-item">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(latest.subject || "Untitled submission")}</strong>
          <span>${escapeHtml(latest.location || "No location supplied")}</span>
        </div>
        <div class="tag-row">
          <span class="tag">${escapeHtml(status)}</span>
        </div>
      </div>
      <span>${escapeHtml(trimmed(latest.details || "", 180))}</span>
      ${
        entityRefs.length
          ? `<span class="muted-text">Entities: ${escapeHtml(entityRefs.map(resolveEntityDisplayValue).join(", "))}</span>`
          : ""
      }
      ${
        latest.suggested_entity?.name
          ? `<span class="muted-text">Suggested entity: ${escapeHtml(latest.suggested_entity.name)}${latest.suggested_entity.location ? ` • ${escapeHtml(latest.suggested_entity.location)}` : ""}</span>`
          : ""
      }
      <span class="mono">${item.author}</span>
      <div class="button-row button-row--tight">
        <button class="button-ghost" type="button" data-submission-action="status" data-submission-id="${item.id}" data-author-pubkey="${item.author}" data-status="approved">Approve</button>
        <button class="button-ghost" type="button" data-submission-action="status" data-submission-id="${item.id}" data-author-pubkey="${item.author}" data-status="rejected">Reject</button>
        ${latest.attachment?.url ? `<button class="button-ghost" type="button" data-download-attachment="${item.id}">Attachment</button>` : ""}
        <button class="button-ghost" type="button" data-open-chat="${item.id}" data-chat-target="${item.author}">Chat</button>
      </div>
    </article>
  `;
}

function renderEntitiesPane() {
  return `
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
          (workspaceState.publicState?.entities || [])
            .map(
              (entity) => `
                <article class="roster-item">
                  <div class="workspace-list__row">
                    <div>
                      <strong>${escapeHtml(entity.name)}</strong>
                      <span>${escapeHtml(entity.location)} • ${escapeHtml(entity.type)}</span>
                    </div>
                    <div class="tag-row">
                      <span class="tag">${escapeHtml(entity.status)}</span>
                    </div>
                  </div>
                  <span>${escapeHtml(entity.notes || "No public note yet.")}</span>
                  ${
                    currentUserIsAdmin()
                      ? `
                        <div class="button-row button-row--tight">
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
            .join("") || `<div class="empty-state">No entities published yet.</div>`
        }
      </div>
    </section>
  `;
}

function renderReviewPane() {
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
        <p class="muted-text">Writers use the editor to save working drafts and send finished versions here for review. Approving keeps the post in the next bakedown queue.</p>
        <div class="roster-list">
          ${
            pending.length
              ? pending.map((draft) => renderReviewCard(draft)).join("")
              : `<div class="empty-state">No posts are waiting for review.</div>`
          }
        </div>
      </section>
      <section class="surface-panel">
        <div class="eyebrow">Recent decisions</div>
        <h2>Reviewed posts</h2>
        <div class="roster-list">
          ${
            recentlyDecided.length
              ? recentlyDecided.map((draft) => renderReviewedCard(draft)).join("")
              : `<div class="empty-state">Approved, denied, and revision requests will appear here.</div>`
          }
        </div>
      </section>
    </div>
  `;
}

function renderReviewCard(draft) {
  const authorPubkey = draftOwnerPubkey(draft);
  const author = (workspaceState.publicState?.users || []).find((user) => user.pubkey === authorPubkey);
  const authorLabel = author?.displayName || author?.username || shortKey(authorPubkey);
  const revisionLabel = draft.revisionCount > 1 ? `${draft.revisionCount} saved versions` : "1 saved version";
  return `
    <article class="review-card">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(draft.title)}</strong>
          <span>${escapeHtml(draft.date)} • ${escapeHtml(revisionLabel)}</span>
        </div>
        <div class="tag-row">
          <span class="tag">Ready for review</span>
        </div>
      </div>
      <p class="review-card__summary">${escapeHtml(draft.summary || "No summary added yet.")}</p>
      <span class="muted-text">By ${escapeHtml(authorLabel)}${draft.entity_refs?.length ? ` • ${escapeHtml(draft.entity_refs.map(resolveEntityDisplayValue).join(", "))}` : ""}</span>
      <div class="button-row button-row--tight">
        <a class="text-link" href="./investigation.html?draft=${encodeURIComponent(draft.slug)}">Open preview</a>
        <button class="button-ghost" type="button" data-review-action="approve" data-draft-slug="${escapeAttribute(draft.slug)}">Approve for publish</button>
        <button class="button-ghost" type="button" data-review-action="revise" data-draft-slug="${escapeAttribute(draft.slug)}">Request revision</button>
        <button class="button-ghost" type="button" data-review-action="deny" data-draft-slug="${escapeAttribute(draft.slug)}">Deny</button>
      </div>
    </article>
  `;
}

function renderReviewedCard(draft) {
  const reviewAction = draftReviewAction(draft);
  return `
    <article class="review-card review-card--history">
      <strong>${escapeHtml(draft.title)}</strong>
      <span>${escapeHtml(reviewStatusLabel(draft.status, reviewAction))} • ${escapeHtml(draft.date)}</span>
      <p class="review-card__summary">${escapeHtml(trimmed(draft.summary || draft.markdown || "", 180))}</p>
      <div class="button-row button-row--tight">
        <a class="text-link" href="${escapeAttribute(reviewedDraftHref(draft))}">${escapeHtml(reviewedDraftAction(draft))}</a>
      </div>
    </article>
  `;
}

function draftOwnerPubkey(draft) {
  const revisions = Array.isArray(draft?.revisions) ? draft.revisions : [];
  const oldest = revisions.length ? revisions[revisions.length - 1] : null;
  return String(oldest?.author || draft?.author || "").trim().toLowerCase();
}

function draftReviewAction(draft) {
  const tag = Array.isArray(draft?._event?.tags)
    ? draft._event.tags.find((item) => Array.isArray(item) && item[0] === "review")
    : null;
  return String(tag?.[1] || "").trim().toLowerCase();
}

function reviewStatusLabel(status, reviewAction = "") {
  const cleanStatus = String(status || "").trim().toLowerCase();
  const cleanAction = String(reviewAction || "").trim().toLowerCase();
  if (cleanStatus === "approved" || cleanAction === "approve") return "Approved";
  if (cleanStatus === "denied" || cleanAction === "deny") return "Denied";
  if (cleanStatus === "revision" || cleanAction === "revise") return "Revision requested";
  if (["candidate", "submitted", "review"].includes(cleanStatus)) return "Submitted";
  return "Draft";
}

function reviewedDraftHref(draft) {
  const status = String(draft?.status || "").trim().toLowerCase();
  return status === "revision"
    ? `./editor.html?slug=${encodeURIComponent(draft.slug)}`
    : `./investigation.html?draft=${encodeURIComponent(draft.slug)}`;
}

function reviewedDraftAction(draft) {
  return String(draft?.status || "").trim().toLowerCase() === "revision"
    ? "Open draft"
    : "Open preview";
}

function renderCommentsPane() {
  const ownComments = workspaceState.publicState?.commentsByAuthor.get(workspaceState.viewer?.pubkey || "") || [];
  if (currentUserIsAdmin()) {
    const allComments = (workspaceState.publicState?.allComments || []).slice().reverse();
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
        <div class="roster-list">
          ${
            allComments.length
              ? allComments.map((comment) => renderModerationComment(comment)).join("")
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
                .map(
                  (comment) => `
                    <article class="roster-item">
                      <strong>${escapeHtml(comment.post_slug)}</strong>
                      <span>${escapeHtml(trimmed(comment.markdown, 220))}</span>
                    </article>
                  `
                )
                .join("")
            : `<div class="empty-state">No comments yet.</div>`
        }
      </div>
    </section>
  `;
}

function renderModerationComment(comment) {
  const author = (workspaceState.publicState?.users || []).find((user) => user.pubkey === comment.author);
  const authorLabel = author?.displayName || author?.username || shortKey(comment.author);
  const moderation = comment.moderation || null;
  const action = comment.visibility === "hidden" ? "restore" : "hide";
  const actionLabel = action === "restore" ? "Restore" : "Hide";
  return `
    <article class="roster-item">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(authorLabel)}</strong>
          <span>${escapeHtml(comment.post_slug)} • ${escapeHtml(new Date(comment.created_at * 1000).toLocaleString())}</span>
        </div>
        <div class="tag-row">
          <span class="tag">${escapeHtml(comment.visibility)}</span>
        </div>
      </div>
      <span>${escapeHtml(trimmed(comment.markdown, 260))}</span>
      ${
        moderation?.note
          ? `<span class="muted-text">Moderation note: ${escapeHtml(moderation.note)}</span>`
          : ""
      }
      <label class="comment-note-field">
        <span>Moderation note</span>
        <textarea data-comment-note="${escapeAttribute(comment.id)}" placeholder="Optional note for hide or restore">${escapeHtml(moderation?.note || "")}</textarea>
      </label>
      <div class="button-row button-row--tight">
        <a class="text-link" href="./investigation.html?slug=${encodeURIComponent(comment.post_slug)}">Open post</a>
        <button class="button-ghost" type="button" data-comment-action="${action}" data-comment-id="${escapeAttribute(comment.id)}">${actionLabel}</button>
      </div>
    </article>
  `;
}

function renderEntityModal() {
  if (!workspaceState.entityModal) return "";
  const draft = workspaceState.entityModal;
  return `
    <div class="modal-backdrop">
      <section class="modal-card">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Entity</div>
            <h2>Add entity</h2>
          </div>
          <button class="button-ghost" type="button" data-modal-close>Close</button>
        </div>
        <form class="tip-form" data-entity-form>
          <label>
            <span>Name</span>
            <input name="name" type="text" maxlength="140" value="${escapeAttribute(draft.seedName || "")}" required>
          </label>
          <div class="tip-form__split">
            <label>
              <span>Location</span>
              <input name="location" type="text" maxlength="160" placeholder="City, state" value="${escapeAttribute(draft.seedLocation || "")}" data-location-input required>
              <div class="picker-results" data-location-results></div>
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
            <button class="button" type="submit">Publish entity</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderChatModal() {
  if (!workspaceState.chatModal) return "";
  const submission = workspaceState.inboxSubmissions.find((item) => item.id === workspaceState.chatModal.submissionId);
  const messages = workspaceState.chatModal.messages || [];
  const loading = workspaceState.chatModal.loading;
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
              ? renderLoadingState("Looking up chat...")
              : messages.length
              ? messages
                  .map(
                    (message) => `
                      <article class="chat-message ${message.author === workspaceState.viewer?.pubkey ? "is-self" : ""}">
                        <strong>${message.author === workspaceState.viewer?.pubkey ? "You" : shortKey(message.author)}</strong>
                        <p>${escapeHtml(message.payload.body || "")}</p>
                      </article>
                    `
                  )
                  .join("")
              : `<div class="empty-state">No messages yet.</div>`
          }
        </div>
        <form class="tip-form" data-chat-form>
          <input name="submissionId" type="hidden" value="${escapeAttribute(workspaceState.chatModal.submissionId)}">
          <input name="targetPubkey" type="hidden" value="${escapeAttribute(workspaceState.chatModal.targetPubkey)}">
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

async function handleLogin(form) {
  const status = form.querySelector("[data-workspace-status]");
  try {
    const formData = new FormData(form);
    const session = await signInWithCredentials(formData.get("username"), formData.get("password"));
    await rebroadcastAccount(session);
    if (status) {
      status.textContent = `Signed in as @${session.username}.`;
      status.dataset.state = "success";
    }
    window.dispatchEvent(new CustomEvent("truecost:session-changed"));
    await refreshWorkspace(true);
  } catch (error) {
    if (status) {
      status.textContent = String(error?.message || error || "Login failed.");
      status.dataset.state = "error";
    }
  }
}

async function handleProfileSave(form) {
  const status = form.querySelector("[data-workspace-status]");
  try {
    const formData = new FormData(form);
    const current = currentUser();
    let avatarUrl = String(current?.avatarUrl || "").trim();
    let avatarBlob = current?.avatarBlob || null;
    const avatarFile = formData.get("avatarFile");
    if (avatarFile instanceof File && avatarFile.size > 0) {
      const upload = await uploadPublicBlob(
        workspaceState.session.secretKeyHex,
        avatarFile,
        { purpose: "avatar" }
      );
      avatarUrl = upload.url;
      avatarBlob = upload;
    }
    await rebroadcastAccount(workspaceState.session, {
      displayName: formData.get("displayName"),
      avatarUrl,
      avatarBlob,
      bio: formData.get("bio"),
      socialLinks: String(formData.get("socialLinks") || "")
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    });
    window.dispatchEvent(new CustomEvent("truecost:session-changed"));
    if (status) {
      status.textContent = "Profile updated.";
      status.dataset.state = "success";
    }
    await refreshWorkspace(true);
  } catch (error) {
    if (status) {
      status.textContent = String(error?.message || error || "Profile save failed.");
      status.dataset.state = "error";
    }
  }
}

async function handleAttachmentDownload(button) {
  if (!currentUserHasInboxAccess()) return;
  const submission = workspaceState.inboxSubmissions.find((item) => item.id === (button.getAttribute("data-download-attachment") || ""));
  const attachment = submission?.latest?.payload?.attachment;
  if (!attachment?.url) return;
  const siteKeyShare = findSiteKeyShare(attachment.recipient_pubkey || submission?.latest?.recipient_pubkey || "");
  if (!siteKeyShare) {
    window.alert("No matching site key share is loaded for this attachment.");
    return;
  }
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Decrypting";
  try {
    const file = await decryptUploadedBlob(
      siteKeyShare.siteSecretKeyHex,
      attachment.author_pubkey || submission.author,
      attachment
    );
    triggerBrowserDownload(file);
    button.textContent = "Downloaded";
  } catch (error) {
    button.textContent = "Retry";
    window.alert(String(error?.message || error || "Attachment download failed."));
  } finally {
    window.setTimeout(() => {
      button.disabled = false;
      button.textContent = original;
    }, 900);
  }
}

async function handleUserAction(button) {
  if (!currentUserIsAdmin()) return;
  const targetPubkey = button.getAttribute("data-target-pubkey") || "";
  const action = button.getAttribute("data-user-action") || "";
  const mode = button.getAttribute("data-mode") || "";
  await performUserAction(targetPubkey, action, mode);
  await refreshWorkspace(true);
}

async function handleDirectUserAction(button) {
  if (!currentUserIsAdmin()) return;
  const targetPubkey = resolveDirectUserPubkey();
  if (!targetPubkey) {
    workspaceState.userDirectStatus = "Find a user first, or paste a valid 64-character pubkey.";
    renderWorkspace();
    return;
  }
  const action = button.getAttribute("data-quick-user-action") || "";
  const mode = button.getAttribute("data-mode") || "";
  await performUserAction(targetPubkey, action, mode);
  workspaceState.userDirectStatus =
    action === "share-site-key"
      ? `Shared the current inbox key with ${shortKey(targetPubkey)}.`
      : `${mode === "grant" ? "Granted" : "Updated"} access for ${shortKey(targetPubkey)}.`;
  await refreshWorkspace(true);
}

async function handleDirectUserLookup() {
  const input = document.querySelector("[data-quick-user-input]");
  const rawValue = String(input instanceof HTMLInputElement ? input.value : workspaceState.userLookupQuery || "").trim();
  await resolveUserLookupQuery(rawValue);
}

async function resolveUserLookupQuery(rawValue, options = {}) {
  const shouldRender = options.render !== false;
  workspaceState.userLookupQuery = rawValue;
  workspaceState.userLookupResult = null;
  if (!rawValue) {
    workspaceState.userDirectStatus = "Enter a username or pubkey.";
    if (shouldRender) renderWorkspace();
    return;
  }

  const localMatch = findLocalUserCandidate(rawValue);
  if (localMatch) {
    workspaceState.userLookupQuery = localMatch.pubkey;
    workspaceState.userLookupResult = localMatch;
    workspaceState.userDirectStatus = `Found ${localMatch.username ? `@${localMatch.username}` : shortKey(localMatch.pubkey)} in the current roster.`;
    if (shouldRender) renderWorkspace();
    return;
  }

  const remoteMatches = await lookupUsers(rawValue).catch(() => []);
  if (remoteMatches.length) {
    const match = hydrateLookupCandidate(remoteMatches[0]);
    workspaceState.userLookupQuery = match.pubkey;
    workspaceState.userLookupResult = match;
    workspaceState.userDirectStatus = `Found ${match.username ? `@${match.username}` : shortKey(match.pubkey)} from shared site data.`;
    if (shouldRender) renderWorkspace();
    return;
  }

  const directPubkey = normalizeDirectPubkey(rawValue);
  if (directPubkey) {
    workspaceState.userLookupQuery = directPubkey;
    workspaceState.userLookupResult = hydrateLookupCandidate({
      pubkey: directPubkey,
      username: "",
      displayName: "Direct pubkey",
      isAdmin: workspaceState.publicState?.admins?.includes(directPubkey)
    });
    workspaceState.userDirectStatus = "No profile is visible yet, but you can still act on this pubkey.";
    if (shouldRender) renderWorkspace();
    return;
  }

  workspaceState.userDirectStatus = "No matching user found yet.";
  if (shouldRender) renderWorkspace();
}

async function performUserAction(targetPubkey, action, mode = "") {
  if (!currentUserIsAdmin() || !targetPubkey) return;
  if (action === "share-site-key" && workspaceState.siteKeyShare) {
    await publishAdminKeyShare(
      workspaceState.session.secretKeyHex,
      targetPubkey,
      workspaceState.siteKeyShare.siteSecretKeyHex
    );
  }

  if (action === "admin") {
    await publishTaggedJson({
      kind: SITE.nostr.kinds.adminRole,
      secretKeyHex: workspaceState.session.secretKeyHex,
      tags: [["d", `admin-role:${targetPubkey}`], ["p", targetPubkey], ["op", mode]],
      content: {
        action: mode,
        target_pubkey: targetPubkey
      }
    });
    if (mode === "grant" && workspaceState.siteKeyShare && targetPubkey !== workspaceState.viewer?.pubkey) {
      await publishAdminKeyShare(
        workspaceState.session.secretKeyHex,
        targetPubkey,
        workspaceState.siteKeyShare.siteSecretKeyHex
      );
    }
    if (mode === "revoke") {
      try {
        await rotateSiteInboxKey([targetPubkey], "admin-revoke");
      } catch (error) {
        window.alert(`Admin revoked, but site inbox key rotation failed: ${String(error?.message || error || "Unknown error.")}`);
      }
    }
  }

  if (action === "mod") {
    await publishTaggedJson({
      kind: SITE.nostr.kinds.userMod,
      secretKeyHex: workspaceState.session.secretKeyHex,
      tags: [["d", `user-mod:${targetPubkey}`], ["p", targetPubkey], ["op", mode]],
      content: {
        action: mode,
        target_pubkey: targetPubkey
      }
    });
  }
}

async function handleEntitySave(form) {
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  const taken = (workspaceState.publicState?.entities || []).map((entity) => entity.slug);
  const slug = createUniqueSlug(name, taken);
  await publishTaggedJson({
    kind: SITE.nostr.kinds.entity,
    secretKeyHex: workspaceState.session.secretKeyHex,
    tags: [["d", slug]],
    content: {
      slug,
      name,
      location: String(formData.get("location") || "").trim(),
      type: String(formData.get("type") || "").trim() || "entity",
      lat: parseMaybeNumber(formData.get("lat")),
      lng: parseMaybeNumber(formData.get("lng")),
      notes: String(formData.get("notes") || "").trim(),
      status: currentUserIsAdmin() ? "approved" : "pending"
    }
  });
  workspaceState.entityModal = null;
  await refreshWorkspace(true);
}

async function handleEntityAction(button) {
  if (!currentUserIsAdmin()) return;
  const slug = button.getAttribute("data-entity-slug") || "";
  const action = button.getAttribute("data-entity-action") || "";
  const entity = (workspaceState.publicState?.entities || []).find((item) => item.slug === slug);
  if (!entity) return;
  await publishTaggedJson({
    kind: SITE.nostr.kinds.entity,
    secretKeyHex: workspaceState.session.secretKeyHex,
    tags: [["d", entity.slug]],
    content: {
      slug: entity.slug,
      name: entity.name,
      location: entity.location,
      type: entity.type,
      lat: entity.lat,
      lng: entity.lng,
      notes: entity.notes,
      aliases: entity.aliases || [],
      status: action === "approve" ? "approved" : action === "deny" ? "denied" : "deleted"
    }
  });
  await refreshWorkspace(true);
}

async function handleCommentAction(button) {
  if (!currentUserIsAdmin()) return;
  const action = button.getAttribute("data-comment-action") || "";
  const commentId = button.getAttribute("data-comment-id") || "";
  if (!commentId || !action) return;
  const noteField = document.querySelector(`[data-comment-note="${commentId}"]`);
  const note = noteField instanceof HTMLTextAreaElement ? noteField.value.trim() : "";
  await publishTaggedJson({
    kind: SITE.nostr.kinds.commentMod,
    secretKeyHex: workspaceState.session.secretKeyHex,
    tags: [["e", commentId], ["op", action]],
    content: {
      target_id: commentId,
      action,
      note
    }
  });
  applyLocalCommentModeration(commentId, action, note);
  renderWorkspace();
  window.setTimeout(() => {
    void refreshWorkspace(true);
  }, 1800);
}

async function handleReviewAction(button) {
  if (!currentUserIsAdmin() || !workspaceState.session) return;
  const action = button.getAttribute("data-review-action") || "";
  const slug = cleanSlug(button.getAttribute("data-draft-slug") || "");
  const draft = (workspaceState.publicState?.drafts || []).find((item) => item.slug === slug);
  if (!draft || !["approve", "revise", "deny"].includes(action)) return;
  const nextStatus = action === "approve" ? "approved" : action === "deny" ? "denied" : "revision";
  button.setAttribute("disabled", "disabled");
  try {
    await publishTaggedJson({
      kind: SITE.nostr.kinds.draft,
      secretKeyHex: workspaceState.session.secretKeyHex,
      tags: [["d", draft.slug], ["status", nextStatus], ["review", action]],
      content: {
        ...draft,
        author_pubkey: draftOwnerPubkey(draft),
        status: nextStatus,
        reviewed_at: new Date().toISOString(),
        reviewed_by: workspaceState.viewer?.pubkey || "",
        review_action: action
      }
    });
    await refreshWorkspace(true);
  } finally {
    button.removeAttribute("disabled");
  }
}

async function handleDraftSave(form) {
  if (!currentUserIsAdmin()) return;
  const formData = new FormData(form);
  const title = String(formData.get("title") || "").trim();
  if (!title) return;
  const primaryEntityInput = String(formData.get("primaryEntity") || "").trim();
  const primaryEntity = resolveEntityByNameOrSlug(primaryEntityInput);
  const additionalEntityRefs = splitTags(formData.get("entityRefs"));
  const entityRefs = dedupe([
    primaryEntity?.slug || "",
    ...additionalEntityRefs.map((value) => resolveEntityByNameOrSlug(value)?.slug || cleanSlug(value))
  ]);
  const taken = [...workspaceState.staticSlugs, ...(workspaceState.publicState?.drafts || []).map((draft) => draft.slug)];
  const slug = createUniqueSlug(title, taken);
  const draft = {
    slug,
    title,
    date: String(formData.get("date") || "").trim() || new Date().toISOString().slice(0, 10),
    location: primaryEntity?.name || primaryEntity?.location || "Undisclosed location",
    status: String(formData.get("status") || "draft").trim(),
    summary: String(formData.get("summary") || "").trim(),
    tags: splitTags(formData.get("tags")),
    entity_refs: entityRefs,
    featured: false,
    markdown: String(formData.get("markdown") || "").trim(),
    records: []
  };
  await publishTaggedJson({
    kind: SITE.nostr.kinds.draft,
    secretKeyHex: workspaceState.session.secretKeyHex,
    tags: [["d", draft.slug], ["status", draft.status]],
    content: draft
  });
  workspaceState.exportValue = buildDraftMarkdown(draft);
  await refreshWorkspace(true);
  workspaceState.exportValue = buildDraftMarkdown(draft);
  renderWorkspace();
}

async function handleSubmissionAction(button) {
  if (!currentUserIsAdmin()) return;
  const submissionId = button.getAttribute("data-submission-id") || "";
  const authorPubkey = button.getAttribute("data-author-pubkey") || "";
  const status = button.getAttribute("data-status") || "received";
  await publishTaggedJson({
    kind: SITE.nostr.kinds.submissionStatus,
    secretKeyHex: workspaceState.session.secretKeyHex,
    tags: [["d", submissionId], ["p", authorPubkey]],
    content: {
      submission_id: submissionId,
      author_pubkey: authorPubkey,
      status
    }
  });
  await refreshWorkspace(true);
}

async function handleSnapshotRequest(button) {
  if (!currentUserIsAdmin() || !workspaceState.session) return;
  button.setAttribute("disabled", "disabled");
  try {
    const requestId = `snapshot:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await publishTaggedJson({
      kind: SITE.nostr.kinds.snapshotRequest,
      secretKeyHex: workspaceState.session.secretKeyHex,
      tags: [
        ["d", requestId],
        ["req", requestId],
        ["op", "bake"]
      ],
      content: {
        protocol: `${SITE.nostr.protocolPrefix}-snapshot-request/v1`,
        request_id: requestId,
        op: "bake",
        requested_at: new Date().toISOString()
      }
    });
    workspaceState.dashboardStatus = "Snapshot request sent. The pinner can now build the latest approved content and update the review branch.";
    await refreshWorkspace(true);
  } catch (error) {
    workspaceState.dashboardStatus = String(error?.message || error || "Snapshot request failed.");
    renderWorkspace();
  } finally {
    button.removeAttribute("disabled");
  }
}

async function hydrateChatModal() {
  if (!workspaceState.chatModal || !currentUserHasInboxAccess()) return;
  workspaceState.chatModal.loading = true;
  renderWorkspace();
  workspaceState.chatModal.messages = await loadSubmissionThread(
    workspaceState.siteKeyShares,
    workspaceState.chatModal.submissionId,
    workspaceState.chatModal.targetPubkey
  ).catch(() => []);
  workspaceState.chatModal.loading = false;
  renderWorkspace();
}

async function hydrateInboxSubmissions() {
  if (!currentUserHasInboxAccess()) return;
  workspaceState.inboxLoading = true;
  renderWorkspace({ soft: true });
  workspaceState.inboxSubmissions = await loadInboxSubmissions(workspaceState.siteKeyShares).catch(() => []);
  workspaceState.inboxLoading = false;
  renderWorkspace({ soft: true });
  await maybeOpenAdminChatFromUrl();
}

async function maybeOpenAdminChatFromUrl() {
  if (!currentUserHasInboxAccess()) return;
  const params = new URLSearchParams(window.location.search);
  const submissionId = cleanSlug(params.get("chat") || "");
  const targetPubkey = String(params.get("with") || "").trim().toLowerCase();
  if (!submissionId) return;
  const submission = workspaceState.inboxSubmissions.find((item) => item.id === submissionId);
  if (!submission) return;
  const nextTargetPubkey = targetPubkey || submission.author;
  if (
    workspaceState.chatModal?.submissionId === submissionId &&
    workspaceState.chatModal?.targetPubkey === nextTargetPubkey
  ) {
    return;
  }
  workspaceState.chatModal = {
    submissionId,
    targetPubkey: nextTargetPubkey,
    loading: true,
    messages: []
  };
  renderWorkspace();
  await hydrateChatModal();
}

async function maybeResolveUserDeepLink() {
  const params = new URLSearchParams(window.location.search);
  const query = String(params.get("user") || "").trim();
  if (!query || workspaceState.activeTab !== "users") return;
  if (workspaceState.userLookupQuery !== query || !workspaceState.userLookupResult) {
    await resolveUserLookupQuery(query, { render: false });
    renderWorkspace({ soft: true });
  }
  const targetPubkey = workspaceState.userLookupResult?.pubkey || normalizeDirectPubkey(query);
  if (!targetPubkey) return;
  const card = document.querySelector(`[data-user-card="${targetPubkey}"]`);
  if (card instanceof HTMLElement) {
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.add("roster-item--focus");
    window.setTimeout(() => card.classList.remove("roster-item--focus"), 1800);
  }
}

async function handleChatSend(form) {
  if (!currentUserHasInboxAccess()) return;
  const formData = new FormData(form);
  const body = String(formData.get("body") || "").trim();
  if (!body) return;
  if (!workspaceState.siteKeyShare) {
    window.alert("This admin account does not have the current inbox key yet.");
    return;
  }
  await publishSubmissionChat(workspaceState.siteKeyShare.siteSecretKeyHex, {
    targetPubkey: String(formData.get("targetPubkey") || ""),
    submissionId: String(formData.get("submissionId") || ""),
    body,
    role: "admin"
  });
  await hydrateChatModal();
}

async function copyExport() {
  const area = document.querySelector("[data-draft-export]");
  if (!(area instanceof HTMLTextAreaElement) || !area.value.trim()) return;
  try {
    await navigator.clipboard.writeText(area.value);
  } catch {
    return;
  }
}

function loadDraft(slug) {
  const draft = (workspaceState.publicState?.drafts || []).find((item) => item.slug === slug);
  if (!draft) return;
  workspaceState.exportValue = buildDraftMarkdown(draft);
  renderWorkspace();
  const form = document.querySelector("[data-draft-form]");
  if (!(form instanceof HTMLFormElement)) return;
  form.elements.namedItem("title").value = draft.title;
  form.elements.namedItem("date").value = draft.date;
  form.elements.namedItem("status").value = draft.status;
  form.elements.namedItem("summary").value = draft.summary;
  form.elements.namedItem("tags").value = (draft.tags || []).join(", ");
  form.elements.namedItem("primaryEntity").value = resolveEntityDisplayValue((draft.entity_refs || [])[0]);
  form.elements.namedItem("entityRefs").value = (draft.entity_refs || []).join(", ");
  form.elements.namedItem("markdown").value = draft.markdown;
  hydrateWorkspaceEnhancements();
}

function hydrateWorkspaceEnhancements() {
  renderEntityPickerResults("primaryEntity");
  renderEntityPickerResults("entityRefs");
  renderLocationResults();
}

function createEntityModalState(trigger) {
  const fieldName = trigger?.getAttribute?.("data-entity-seed-from") || "";
  const sourceField = fieldName ? document.querySelector(`[name="${fieldName}"]`) : null;
  const sourceValue = sourceField instanceof HTMLInputElement ? sourceField.value.trim() : "";
  const locationField = document.querySelector('[name="location"]');
  const locationValue = locationField instanceof HTMLInputElement ? locationField.value.trim() : "";
  const seedName = fieldName === "entityRefs" ? lastCommaValue(sourceValue) : sourceValue;
  return {
    mode: "create",
    seedName,
    seedLocation: locationValue
  };
}

function renderEntityPickerResults(fieldName) {
  const host = document.querySelector(`[data-entity-picker-results="${fieldName}"]`);
  const input = document.querySelector(`[name="${fieldName}"]`);
  if (!(host instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
  const query = fieldName === "entityRefs" ? lastCommaValue(input.value) : input.value.trim();
  const matches = matchEntities(query).slice(0, 6);
  if (!query) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = matches.length
    ? matches
        .map(
          (entity) => `
            <button class="picker-chip" type="button" data-entity-pick="${escapeAttribute(entity.slug)}" data-target-field="${fieldName}">
              <strong>${escapeHtml(entity.name)}</strong>
              <span>${escapeHtml(entity.location)}</span>
            </button>
          `
        )
        .join("")
    : `<div class="picker-hint">No match yet. Use the create button to add a new entity.</div>`;
}

function renderLocationResults() {
  const host = document.querySelector("[data-location-results]");
  const input = document.querySelector("[data-location-input]");
  if (!(host instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
  const query = input.value.trim().toLowerCase();
  const matches = uniqueLocations()
    .filter((location) => !query || location.toLowerCase().includes(query))
    .slice(0, 6);
  if (!query && !matches.length) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = matches.length
    ? matches
        .map(
          (location) => `
            <button class="picker-chip" type="button" data-location-pick="${escapeAttribute(location)}">
              <strong>${escapeHtml(location)}</strong>
            </button>
          `
        )
        .join("")
    : `<div class="picker-hint">No saved location matches. Keep the typed value to create a new one.</div>`;
}

function applyEntityPick(button) {
  const slug = button.getAttribute("data-entity-pick") || "";
  const fieldName = button.getAttribute("data-target-field") || "";
  const entity = (workspaceState.publicState?.approvedEntities || []).find((item) => item.slug === slug);
  const input = document.querySelector(`[name="${fieldName}"]`);
  if (!entity || !(input instanceof HTMLInputElement)) return;
  if (fieldName === "entityRefs") {
    const existing = splitTags(input.value)
      .map((value) => resolveEntityByNameOrSlug(value)?.slug || cleanSlug(value))
      .filter(Boolean);
    input.value = dedupe([...existing, entity.slug]).join(", ");
  } else {
    input.value = entity.name;
  }
  hydrateWorkspaceEnhancements();
}

function applyLocationPick(button) {
  const value = button.getAttribute("data-location-pick") || "";
  const input = document.querySelector("[data-location-input]");
  if (!(input instanceof HTMLInputElement)) return;
  input.value = value;
  hydrateWorkspaceEnhancements();
}

function matchEntities(query) {
  const clean = String(query || "").trim().toLowerCase();
  if (!clean) return [];
  return (workspaceState.publicState?.approvedEntities || []).filter((entity) => {
    const haystacks = [
      entity.name,
      entity.slug,
      entity.location,
      ...(Array.isArray(entity.aliases) ? entity.aliases : [])
    ]
      .map((value) => String(value || "").toLowerCase())
      .filter(Boolean);
    return haystacks.some((value) => value.includes(clean));
  });
}

function uniqueLocations() {
  return dedupe((workspaceState.publicState?.entities || []).map((entity) => entity.location));
}

function resolveEntityDisplayValue(value) {
  const entity = resolveEntityByNameOrSlug(value);
  return entity?.name || String(value || "");
}

function lastCommaValue(value) {
  return String(value || "").split(",").pop().trim();
}

function chooseInitialTab(current) {
  const requested = cleanSlug(new URLSearchParams(window.location.search).get("tab") || "");
  return normalizeWorkspaceTab(requested || current);
}

function setActiveTab(tab) {
  workspaceState.activeTab = normalizeWorkspaceTab(tab);
  const url = new URL(window.location.href);
  url.searchParams.set("tab", workspaceState.activeTab);
  history.replaceState({}, "", url);
}

function normalizeWorkspaceTab(value) {
  if (cleanSlug(value) === "drafts") return "review";
  const valid = new Set(tabButtons().map((tab) => tab.id));
  const requested = cleanSlug(value);
  if (requested && valid.has(requested)) return requested;
  return currentUserIsAdmin() ? "dashboard" : "profile";
}

function tabButtons() {
  if (!workspaceState.session) return [{ id: "login", label: "Log in" }];
  const base = [{ id: "profile", label: "Profile" }, { id: "comments", label: "Comments" }];
  if (!currentUserIsAdmin()) return base;
  return [
    { id: "dashboard", label: "Dashboard" },
    ...base,
    { id: "users", label: "User Management" },
    { id: "submissions", label: "Submissions" },
    { id: "entities", label: "Entities" },
    { id: "review", label: "Post Review" },
    { id: "log", label: "Log" }
  ];
}

function renderTabButton(tab) {
  return `<button class="workspace-tab ${workspaceState.activeTab === tab.id ? "is-current" : ""}" type="button" data-workspace-tab="${tab.id}">${escapeHtml(tab.label)}</button>`;
}

function currentUser() {
  return (workspaceState.publicState?.users || []).find((user) => user.pubkey === workspaceState.viewer?.pubkey) || null;
}

function currentUserIsAdmin() {
  return Boolean(workspaceState.viewer && workspaceState.publicState?.admins?.includes(workspaceState.viewer.pubkey));
}

function currentUserHasInboxAccess() {
  return Boolean(
    currentUserIsAdmin() &&
      workspaceState.siteKeyShare &&
      workspaceState.siteKeyShare.sitePubkey === activeSitePubkey()
  );
}

function currentUserPendingKeyRequest() {
  if (!workspaceState.viewer) return null;
  return (workspaceState.publicState?.pendingAdminKeyRequests || []).find(
    (request) =>
      request.requester_pubkey === workspaceState.viewer.pubkey &&
      request.site_pubkey === activeSitePubkey()
  ) || null;
}

function renderSnapshotSummary(snapshot) {
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

function resolveEntityByNameOrSlug(value) {
  const clean = String(value || "").trim().toLowerCase();
  return (workspaceState.publicState?.approvedEntities || []).find(
    (entity) => entity.slug === cleanSlug(clean) || entity.name.toLowerCase() === clean
  );
}

function logLabel(event) {
  switch (Number(event.kind)) {
    case SITE.nostr.kinds.snapshot:
      return "Snapshot";
    case SITE.nostr.kinds.adminClaim:
      return "Root admin claim";
    case SITE.nostr.kinds.adminRole:
      return "Admin role change";
    case SITE.nostr.kinds.userMod:
      return "User moderation";
    case SITE.nostr.kinds.snapshotRequest:
      return "Snapshot request";
    case SITE.nostr.kinds.entity:
      return "Entity update";
    case SITE.nostr.kinds.draft:
      return "Post update";
    case SITE.nostr.kinds.commentMod:
      return "Comment moderation";
    case SITE.nostr.kinds.submissionStatus:
      return "Submission status";
    case SITE.nostr.kinds.adminKeyShare:
      return "Site key share";
    case SITE.nostr.kinds.siteKey:
      return "Site key rotation";
    default:
      return `Event ${event.kind}`;
  }
}

function logTarget(event) {
  const slug = firstTag(event, "d");
  const targetPubkey = firstTag(event, "p") || event.pubkey;
  switch (Number(event.kind)) {
    case SITE.nostr.kinds.snapshot:
    case SITE.nostr.kinds.snapshotRequest:
      return { href: "./admin.html?tab=dashboard", description: slug || shortKey(event.pubkey) };
    case SITE.nostr.kinds.adminClaim:
    case SITE.nostr.kinds.adminRole:
    case SITE.nostr.kinds.userMod:
    case SITE.nostr.kinds.adminKeyShare:
    case SITE.nostr.kinds.siteKey:
      return {
        href: `./admin.html?tab=users&user=${encodeURIComponent(targetPubkey)}`,
        description: shortKey(targetPubkey)
      };
    case SITE.nostr.kinds.entity:
      return { href: "./admin.html?tab=entities", description: slug || shortKey(event.pubkey) };
    case SITE.nostr.kinds.draft:
      return { href: "./admin.html?tab=review", description: slug || shortKey(event.pubkey) };
    case SITE.nostr.kinds.commentMod:
      return { href: "./admin.html?tab=comments", description: firstTag(event, "e") || shortKey(event.pubkey) };
    case SITE.nostr.kinds.submissionStatus:
      return { href: "./admin.html?tab=submissions", description: slug || shortKey(event.pubkey) };
    default:
      return { href: "./admin.html?tab=dashboard", description: shortKey(event.pubkey) };
  }
}

function firstTag(event, key) {
  const hit = (event.tags || []).find((tag) => Array.isArray(tag) && tag[0] === key);
  return hit ? String(hit[1] || "") : "";
}

function activeSitePubkey() {
  return resolveSitePubkey(workspaceState.publicState);
}

function findSiteKeyShare(sitePubkey = "") {
  const targetPubkey = String(sitePubkey || "").trim().toLowerCase() || activeSitePubkey();
  return workspaceState.siteKeyShares.find((share) => share.sitePubkey === targetPubkey) || null;
}

function renderSiteKeyShareStatus() {
  if (workspaceState.siteKeyShare) {
    const olderCount = Math.max(0, workspaceState.siteKeyShares.length - 1);
    return olderCount
      ? `This account can read new private submissions and ${olderCount} older encrypted record${olderCount === 1 ? "" : "s"}.`
      : "This account can read new private submissions.";
  }
  if (currentUserPendingKeyRequest() || workspaceState.keyRequestState === "pending") {
    return "This account is waiting for the current shared inbox key.";
  }
  if (workspaceState.siteKeyShares.length) {
    return "This account has older inbox keys, but not the current one yet.";
  }
  return "Waiting for shared inbox access.";
}

function applyLocalCommentModeration(commentId, action, note) {
  const publicState = workspaceState.publicState;
  if (!publicState || !Array.isArray(publicState.allComments)) return;
  const moderation = {
    action: action === "restore" ? "restore" : "hide",
    note: String(note || "").trim(),
    updated_at: Math.floor(Date.now() / 1000),
    by: workspaceState.viewer?.pubkey || ""
  };
  publicState.allComments = publicState.allComments.map((comment) =>
    comment.id === commentId
      ? {
          ...comment,
          visibility: moderation.action === "hide" ? "hidden" : "visible",
          moderation
        }
      : comment
  );
  publicState.comments = publicState.allComments.filter((comment) => comment.visibility !== "hidden");
  publicState.hiddenComments = publicState.allComments.filter((comment) => comment.visibility === "hidden");
  publicState.commentsByPost = regroupComments(publicState.comments, "post_slug");
  publicState.commentsByAuthor = regroupComments(publicState.comments, "author");
  if (publicState.metrics) {
    publicState.metrics.commentCount = publicState.comments.length;
    publicState.metrics.hiddenCommentCount = publicState.hiddenComments.length;
  }
  for (const user of publicState.users || []) {
    user.commentCount = (publicState.commentsByAuthor.get(user.pubkey) || []).length;
  }
}

function regroupComments(comments, key) {
  const buckets = new Map();
  for (const comment of Array.isArray(comments) ? comments : []) {
    const bucketKey = String(comment?.[key] || "").trim();
    if (!bucketKey) continue;
    const bucket = buckets.get(bucketKey) || [];
    bucket.push(comment);
    buckets.set(bucketKey, bucket);
  }
  return buckets;
}

async function rotateSiteInboxKey(excludedPubkeys = [], reason = "rotation") {
  if (!workspaceState.session || !currentUserIsAdmin()) {
    throw new Error("Only an active admin can rotate the shared inbox key.");
  }
  const nextSiteSecretKeyHex = await generateSecretKeyHex();
  const previousSitePubkey = activeSitePubkey();
  const sharedAt = new Date().toISOString();
  const recipients = dedupe(
    (workspaceState.publicState?.admins || []).filter(
      (pubkey) => !excludedPubkeys.includes(pubkey)
    )
  );
  await publishSiteKeyEvent(workspaceState.session.secretKeyHex, nextSiteSecretKeyHex, {
    previousSitePubkey,
    reason
  });
  for (const pubkey of recipients) {
    await publishAdminKeyShare(
      workspaceState.session.secretKeyHex,
      pubkey,
      nextSiteSecretKeyHex
    );
  }
  const currentShare = buildCachedSiteKeyShare(nextSiteSecretKeyHex, {
    senderPubkey: workspaceState.viewer?.pubkey || "",
    sharedAt
  });
  workspaceState.siteKeyShares = mergeSiteKeyShares([currentShare, ...workspaceState.siteKeyShares], []);
  workspaceState.siteKeyShare = currentShare;
  persistCachedSiteKeyShares(workspaceState.siteKeyShares);
  workspaceState.keyRequestState = "";
  if (workspaceState.publicState?.siteInfo) {
    workspaceState.publicState.siteInfo = {
      ...workspaceState.publicState.siteInfo,
      activePubkey: currentShare.sitePubkey
    };
  }
}

async function maybeAutoRespondToKeyRequests() {
  if (!currentUserHasInboxAccess() || !workspaceState.session || !workspaceState.siteKeyShare) return;
  for (const request of workspaceState.publicState?.pendingAdminKeyRequests || []) {
    if (!request || request.requester_pubkey === workspaceState.viewer?.pubkey) continue;
    if (workspaceState.respondedKeyRequests.has(request.id)) continue;
    try {
      await publishAdminKeyShare(
        workspaceState.session.secretKeyHex,
        request.requester_pubkey,
        workspaceState.siteKeyShare.siteSecretKeyHex
      );
      workspaceState.respondedKeyRequests.add(request.id);
    } catch {
      continue;
    }
  }
}

async function maybeEnsureCurrentKeyRequest() {
  if (!workspaceState.session || !currentUserIsAdmin() || currentUserHasInboxAccess()) return;
  const sitePubkey = activeSitePubkey();
  if (!sitePubkey) return;

  const pendingRequest = currentUserPendingKeyRequest();
  if (!pendingRequest) {
    const recentlyRequested =
      workspaceState.keyRequestCache &&
      workspaceState.keyRequestCache.sitePubkey === sitePubkey &&
      Date.now() - workspaceState.keyRequestCache.requestedAt < 20000;
    if (!recentlyRequested) {
      await publishAdminKeyRequest(workspaceState.session.secretKeyHex, sitePubkey);
      workspaceState.keyRequestCache = {
        sitePubkey,
        requestedAt: Date.now()
      };
    }
  }

  workspaceState.keyRequestState = "pending";
  workspaceState.keyRequestTimer = window.setTimeout(() => {
    void syncWorkspaceState(true);
  }, 3200);
}

function shouldSoftRefreshWorkspace() {
  if (workspaceState.entityModal || workspaceState.chatModal) return false;
  const active = document.activeElement;
  return !(
    active instanceof HTMLElement &&
    active.closest("[data-workspace-shell]") &&
    active.matches("input, textarea, select, [contenteditable='true']")
  );
}

async function loadStaticSlugs() {
  const response = await fetch("./content/investigations/index.json");
  if (!response.ok) return [];
  const data = await response.json();
  return (Array.isArray(data.files) ? data.files : []).map((file) => cleanSlug(String(file).replace(/\.md$/i, "")));
}

function dedupe(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function siteKeyShareCacheKey(pubkey = workspaceState.viewer?.pubkey || "") {
  return `${SITE.nostr.storageNamespace}.admin-site-shares.${pubkey}`;
}

function loadCachedSiteKeyShares() {
  if (!workspaceState.viewer?.pubkey) return [];
  try {
    const raw = window.localStorage.getItem(siteKeyShareCacheKey());
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => buildCachedSiteKeyShare(entry?.siteSecretKeyHex || entry?.site_secret_key_hex || "", entry || {}))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function persistCachedSiteKeyShares(shares) {
  if (!workspaceState.viewer?.pubkey) return;
  const serialized = mergeSiteKeyShares(shares, []).map((share) => ({
    siteSecretKeyHex: share.siteSecretKeyHex,
    sitePubkey: share.sitePubkey,
    senderPubkey: share.senderPubkey || "",
    sharedAt: share.sharedAt || ""
  }));
  window.localStorage.setItem(siteKeyShareCacheKey(), JSON.stringify(serialized));
}

function mergeSiteKeyShares(primary, secondary) {
  const merged = new Map();
  for (const share of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]) {
    const normalized = normalizeCachedSiteKeyShare(share);
    if (!normalized || merged.has(normalized.sitePubkey)) continue;
    merged.set(normalized.sitePubkey, normalized);
  }
  return [...merged.values()];
}

function normalizeCachedSiteKeyShare(share) {
  if (!share) return null;
  if (typeof share === "string") return buildCachedSiteKeyShare(share);
  return buildCachedSiteKeyShare(share.siteSecretKeyHex || share.site_secret_key_hex || "", share);
}

function buildCachedSiteKeyShare(siteSecretKeyHex, meta = {}) {
  const clean = String(siteSecretKeyHex || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(clean)) return null;
  let identity;
  try {
    identity = deriveIdentity(clean);
  } catch {
    return null;
  }
  return {
    siteSecretKeyHex: clean,
    sitePubkey: identity.pubkey,
    senderPubkey: String(meta.senderPubkey || meta.sender_pubkey || meta.shared_by || "").trim().toLowerCase(),
    sharedAt: String(meta.sharedAt || meta.shared_at || "").trim(),
    event: meta.event || null
  };
}

function findSiteKeyShareInList(shares, sitePubkey = "") {
  const targetSitePubkey = String(sitePubkey || "").trim().toLowerCase();
  if (!targetSitePubkey) return (Array.isArray(shares) ? shares : [])[0] || null;
  return (Array.isArray(shares) ? shares : []).find((share) => share.sitePubkey === targetSitePubkey) || null;
}

function resolveDirectUserPubkey() {
  return workspaceState.userLookupResult?.pubkey || normalizeDirectPubkey(workspaceState.userLookupQuery);
}

function normalizeDirectPubkey(value) {
  const clean = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(clean) ? clean : "";
}

function findLocalUserCandidate(value) {
  const raw = String(value || "").trim();
  const username = normalizeUsername(raw);
  const pubkey = normalizeDirectPubkey(raw);
  const lowered = raw.toLowerCase();
  const match = (workspaceState.publicState?.users || []).find((user) =>
    (pubkey && user.pubkey === pubkey) ||
    (username && normalizeUsername(user.username) === username) ||
    lowered === String(user.displayName || "").trim().toLowerCase()
  );
  return match ? hydrateLookupCandidate(match) : null;
}

function visibleWorkspaceUsers() {
  const query = String(workspaceState.userLookupQuery || "").trim().toLowerCase();
  return (workspaceState.publicState?.users || []).filter((user) => {
    const visible =
      user.isAdmin ||
      user.submissionCount > 0 ||
      user.commentCount > 0 ||
      user.moderation ||
      user.username ||
      String(user.bio || "").trim() ||
      (Array.isArray(user.socialLinks) && user.socialLinks.length) ||
      user.avatarUrl ||
      user.avatarBlob;
    if (!visible) return false;
    if (!query) return true;
    const haystacks = [
      user.pubkey,
      user.username,
      user.displayName,
      user.bio,
      ...(Array.isArray(user.socialLinks) ? user.socialLinks : [])
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    return haystacks.some((value) => value.includes(query));
  });
}

function hydrateLookupCandidate(user) {
  const current = (workspaceState.publicState?.users || []).find((item) => item.pubkey === user.pubkey) || {};
  return {
    ...current,
    ...user,
    displayName: user.displayName || current.displayName || user.username || shortKey(user.pubkey),
    username: user.username || current.username || "",
    isAdmin: workspaceState.publicState?.admins?.includes(user.pubkey) || current.isAdmin || false
  };
}

function renderLoadingState(message) {
  const reloadHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `
    <div class="loading-state loading-state--panel" role="status" aria-live="polite">
      <div class="loading-state__message">
        <span class="loading-spinner" aria-hidden="true"></span>
        <span>${escapeHtml(message)}</span>
      </div>
      <div class="loading-state__slow">
        <span>This is taking longer than expected.</span>
        <a class="button-ghost loading-state__reload" href="${escapeAttribute(reloadHref)}">Reload</a>
      </div>
    </div>
  `;
}

function trimmed(value, length) {
  const text = String(value || "").trim();
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function parseMaybeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function triggerBrowserDownload(file) {
  const url = URL.createObjectURL(file.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name || "download.bin";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "");
}
