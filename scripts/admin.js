import SITE from "./core/site-config.js";
import { buildDraftMarkdown, createUniqueSlug, splitTags } from "./core/content-utils.js";
import {
  cleanSlug,
  decryptUploadedBlob,
  deriveIdentity,
  ensureEventToolsLoaded,
  generateSecretKeyHex,
  getCachedPublicState,
  loadAdminKeyShare,
  loadAdminKeyShares,
  loadInboxSubmissions,
  loadPublicState,
  publicStateNeedsRepair,
  lookupUsers,
  loadSubmissionThread,
  normalizeUsername,
  publishAdminKeyShare,
  publishAdminKeyRequest,
  publishSiteKeyEvent,
  publishSubmissionChat,
  publishTaggedJson,
  requestPublicStateRepair,
  resolveSitePubkey,
  sanitizeUrl,
  startPublicStateRepairPeer,
  shortKey,
  uploadPublicBlob
} from "./core/nostr.js";
import { getStoredSession, rebroadcastAccount, signInWithCredentials } from "./core/session.js";

const workspaceState = {
  session: getStoredSession(),
  viewer: null,
  publicState: getCachedPublicState(),
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
  userLookupLoading: false,
  userLookupRequestId: 0,
  userLookupDebounce: 0,
  userModalPubkey: "",
  userActionModal: null,
  commentActionModal: null,
  submissionModal: null,
  commentMenuId: "",
  ownCommentMenuId: "",
  submissionFilterHighlight: -1,
  submissionFilterOpen: false,
  userFilters: {
    karma: ""
  },
  commentFilters: {
    query: "",
    role: "",
    karma: ""
  },
  submissionFilters: {
    query: ""
  },
  entityFilters: {
    query: "",
    status: "",
    location: "",
    author: ""
  },
  keyRequestState: "",
  keyRequestTimer: 0,
  backgroundSyncTimer: 0,
  backgroundSyncInFlight: false,
  publicStateRepairPeerStarted: false,
  publicStateRepairInFlight: false,
  publicStateRepairRequestedAt: 0,
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

    const editEntityModal = target.closest("[data-edit-entity]");
    if (editEntityModal) {
      workspaceState.entityModal = createEntityModalState(editEntityModal);
      renderWorkspace();
      return;
    }

    const userModalTrigger = target.closest("[data-open-user-modal]");
    if (userModalTrigger) {
      workspaceState.userModalPubkey = userModalTrigger.getAttribute("data-open-user-modal") || "";
      renderWorkspace();
      return;
    }

    const userActionTrigger = target.closest("[data-open-user-action]");
    if (userActionTrigger) {
      workspaceState.userActionModal = {
        pubkey: userActionTrigger.getAttribute("data-open-user-action") || ""
      };
      renderWorkspace();
      return;
    }

    const commentMenuTrigger = target.closest("[data-comment-menu-toggle]");
    if (commentMenuTrigger) {
      const commentId = commentMenuTrigger.getAttribute("data-comment-menu-toggle") || "";
      workspaceState.commentMenuId = workspaceState.commentMenuId === commentId ? "" : commentId;
      renderWorkspace({ soft: true });
      return;
    }

    const ownCommentMenuTrigger = target.closest("[data-own-comment-menu-toggle]");
    if (ownCommentMenuTrigger) {
      const commentId = ownCommentMenuTrigger.getAttribute("data-own-comment-menu-toggle") || "";
      workspaceState.ownCommentMenuId = workspaceState.ownCommentMenuId === commentId ? "" : commentId;
      renderWorkspace({ soft: true });
      return;
    }

    const commentActionTrigger = target.closest("[data-open-comment-action]");
    if (commentActionTrigger) {
      workspaceState.commentActionModal = {
        commentId: commentActionTrigger.getAttribute("data-open-comment-action") || "",
        mode: commentActionTrigger.getAttribute("data-comment-mode") || "moderate"
      };
      renderWorkspace();
      return;
    }

    const openSubmission = target.closest("[data-open-submission]");
    if (openSubmission) {
      const submissionId = openSubmission.getAttribute("data-open-submission") || "";
      workspaceState.submissionModal = { submissionId };
      if (workspaceState.chatModal?.submissionId && workspaceState.chatModal.submissionId !== submissionId) {
        workspaceState.chatModal = null;
      }
      renderWorkspace();
      void markSubmissionViewed(submissionId);
      return;
    }

    const submissionSuggestion = target.closest("[data-submission-filter-suggestion]");
    if (submissionSuggestion) {
      workspaceState.submissionFilters.query = applySubmissionFilterSuggestion(
        submissionSuggestion.getAttribute("data-submission-filter-suggestion") || ""
      );
      workspaceState.submissionFilterOpen = false;
      workspaceState.submissionFilterHighlight = -1;
      renderWorkspace({ soft: true });
      focusWorkspaceSearchField("[data-submission-filter-input]");
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

    const clearUserLookup = target.closest("[data-clear-user-lookup]");
    if (clearUserLookup) {
      clearWorkspaceUserLookup();
      renderWorkspace({ soft: true });
      focusWorkspaceSearchField("[data-quick-user-input]");
      return;
    }

    const clearCommentFilter = target.closest("[data-clear-comment-filter]");
    if (clearCommentFilter) {
      workspaceState.commentFilters.query = "";
      clearWorkspaceLinkedUser();
      renderWorkspace({ soft: true });
      focusWorkspaceSearchField("[data-comment-filter-query]");
      return;
    }

    const clearSubmissionFilter = target.closest("[data-clear-submission-filter]");
    if (clearSubmissionFilter) {
      workspaceState.submissionFilters.query = "";
      workspaceState.submissionFilterHighlight = -1;
      workspaceState.submissionFilterOpen = false;
      renderWorkspace({ soft: true });
      focusWorkspaceSearchField("[data-submission-filter-input]");
      return;
    }

    const clearEntityFilter = target.closest("[data-clear-entity-filter]");
    if (clearEntityFilter) {
      const field = clearEntityFilter.getAttribute("data-clear-entity-filter") || "";
      if (field && Object.prototype.hasOwnProperty.call(workspaceState.entityFilters, field)) {
        workspaceState.entityFilters[field] = "";
        renderWorkspace({ soft: true });
        focusWorkspaceSearchField(`[data-entity-filter-${field}]`);
      }
      return;
    }

    const userStatsFilter = target.closest("[data-user-stats-filter]");
    if (userStatsFilter) {
      workspaceState.userFilters.karma = String(userStatsFilter.getAttribute("data-user-stats-filter") || "").trim().toLowerCase();
      renderWorkspace({ soft: true });
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
      const submissionId = openChat.getAttribute("data-open-chat") || "";
      const targetPubkey = openChat.getAttribute("data-chat-target") || "";
      if (workspaceState.chatModal?.submissionId === submissionId) {
        workspaceState.chatModal = null;
        renderWorkspace({ soft: true });
        return;
      }
      workspaceState.submissionModal = { submissionId };
      workspaceState.chatModal = {
        submissionId,
        targetPubkey,
        loading: true,
        messages: []
      };
      renderWorkspace({ soft: true });
      await hydrateChatModal();
      return;
    }

    if (target.closest("[data-modal-close]")) {
      workspaceState.entityModal = null;
      workspaceState.chatModal = null;
      workspaceState.userModalPubkey = "";
      workspaceState.userActionModal = null;
      workspaceState.commentActionModal = null;
      workspaceState.submissionModal = null;
      renderWorkspace();
    }
  });

  shell.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches("[data-submission-filter-input]")) {
      const nextOpen = Boolean(String(target.value || "").trim() && submissionFilterSuggestions().length);
      if (workspaceState.submissionFilterOpen !== nextOpen) {
        workspaceState.submissionFilterOpen = nextOpen;
        renderWorkspace({ soft: true });
      }
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const activeSearch = document.querySelector("[data-submission-filter-input]")?.closest(".workspace-search");
    if (activeSearch instanceof HTMLElement && activeSearch.contains(target)) return;
    if (workspaceState.submissionFilterOpen) {
      workspaceState.submissionFilterOpen = false;
      workspaceState.submissionFilterHighlight = -1;
      renderWorkspace({ soft: true });
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
      return;
    }
    if (form.matches("[data-comment-action-form]")) {
      await handleCommentActionForm(form);
    }
  });

  shell.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches("[data-entity-picker-input], [data-location-input]")) {
      hydrateWorkspaceEnhancements();
      return;
    }
    if (target.matches("[data-comment-filter-query]")) {
      workspaceState.commentFilters.query = String(target.value || "");
      clearWorkspaceLinkedUser();
      renderWorkspace({ soft: true });
      return;
    }
    if (target.matches("[data-comment-filter-role]")) {
      workspaceState.commentFilters.role = String(target.value || "").trim().toLowerCase();
      renderWorkspace({ soft: true });
      return;
    }
    if (target.matches("[data-comment-filter-karma]")) {
      workspaceState.commentFilters.karma = String(target.value || "").trim().toLowerCase();
      renderWorkspace({ soft: true });
      return;
    }
    if (target.matches("[data-submission-filter-input]")) {
      workspaceState.submissionFilters.query = String(target.value || "");
      const suggestions = submissionFilterSuggestions();
      workspaceState.submissionFilterOpen = Boolean(String(target.value || "").trim() && suggestions.length);
      workspaceState.submissionFilterHighlight = suggestions.length ? 0 : -1;
      renderWorkspace({ soft: true });
      return;
    }
    if (target.matches("[data-user-filter-karma]")) {
      workspaceState.userFilters.karma = String(target.value || "").trim().toLowerCase();
      renderWorkspace({ soft: true });
      return;
    }
    if (target.matches("[data-entity-filter-query]")) {
      workspaceState.entityFilters.query = String(target.value || "");
      renderWorkspace({ soft: true });
      return;
    }
    if (target.matches("[data-entity-filter-status]")) {
      workspaceState.entityFilters.status = String(target.value || "").trim().toLowerCase();
      renderWorkspace({ soft: true });
      return;
    }
    if (target.matches("[data-entity-filter-location]")) {
      workspaceState.entityFilters.location = String(target.value || "");
      renderWorkspace({ soft: true });
      return;
    }
    if (target.matches("[data-entity-filter-author]")) {
      workspaceState.entityFilters.author = String(target.value || "");
      renderWorkspace({ soft: true });
      return;
    }
    if (target.matches("[data-quick-user-input]")) {
      workspaceState.userLookupRequestId += 1;
      workspaceState.userLookupQuery = String(target.value || "");
      workspaceState.userLookupResult = null;
      workspaceState.userDirectStatus = "";
      workspaceState.userLookupLoading = Boolean(workspaceState.userLookupQuery.trim());
      clearWorkspaceLinkedUser();
      scheduleUserLookup();
      renderWorkspace({ soft: true });
    }
  });

  shell.addEventListener("keydown", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches("[data-quick-user-input]") && event.key === "Enter") {
      event.preventDefault();
      await handleDirectUserLookup();
      return;
    }
    if (!target.matches("[data-submission-filter-input]")) return;
    const suggestions = submissionFilterSuggestions();
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      workspaceState.submissionFilterHighlight = workspaceState.submissionFilterHighlight >= 0
        ? (workspaceState.submissionFilterHighlight + 1) % suggestions.length
        : 0;
      renderWorkspace({ soft: true });
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      workspaceState.submissionFilterHighlight = workspaceState.submissionFilterHighlight > 0
        ? workspaceState.submissionFilterHighlight - 1
        : suggestions.length - 1;
      renderWorkspace({ soft: true });
      return;
    }
    if (event.key === "Escape") {
      workspaceState.submissionFilterOpen = false;
      workspaceState.submissionFilterHighlight = -1;
      renderWorkspace({ soft: true });
      return;
    }
    if (event.key === "Enter" && suggestions.length) {
      event.preventDefault();
      const selected = suggestions[Math.max(0, workspaceState.submissionFilterHighlight)];
      workspaceState.submissionFilters.query = applySubmissionFilterSuggestion(selected);
      workspaceState.submissionFilterOpen = false;
      workspaceState.submissionFilterHighlight = -1;
      renderWorkspace({ soft: true });
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

  if (workspaceState.publicState) {
    workspaceState.activeTab = chooseInitialTab(workspaceState.activeTab);
    renderWorkspace({ soft: true });
  } else {
    renderWorkspaceLoading("Looking up workspace...");
  }
  await ensureEventToolsLoaded();
  await ensureWorkspaceRepairPeer();
  await hydrateWorkspaceState(force);
  workspaceState.staticSlugs = await loadStaticSlugs().catch(() => []);
  workspaceState.activeTab = chooseInitialTab(workspaceState.activeTab);
  renderWorkspace();
  await maybeResolveUserDeepLink();
  maybeResolveCommentDeepLink();
  workspaceState.keyRequestState = "";
  void maybeRequestWorkspaceStateRepair(workspaceState.publicState, "workspace-load");
  await maybeAutoRespondToKeyRequests().catch(() => {});
  await maybeEnsureCurrentKeyRequest().catch(() => {
    workspaceState.keyRequestState = "error";
  });
  if (currentUserHasInboxAccess()) {
    await hydrateInboxSubmissions({ background: false });
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
    await ensureWorkspaceRepairPeer();
    await hydrateWorkspaceState(force);
    void maybeRequestWorkspaceStateRepair(workspaceState.publicState, "workspace-sync");
    workspaceState.keyRequestState = "";
    await maybeAutoRespondToKeyRequests().catch(() => {});
    await maybeEnsureCurrentKeyRequest().catch(() => {
      workspaceState.keyRequestState = "error";
    });
    if (currentUserHasInboxAccess()) {
      void hydrateInboxSubmissions({ background: true });
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

async function ensureWorkspaceRepairPeer() {
  if (workspaceState.publicStateRepairPeerStarted) return;
  try {
    await startPublicStateRepairPeer();
    workspaceState.publicStateRepairPeerStarted = true;
  } catch {
    return;
  }
}

async function maybeRequestWorkspaceStateRepair(publicState, reason = "") {
  if (!workspaceState.session || !publicStateNeedsRepair(publicState) || workspaceState.publicStateRepairInFlight) return;
  const now = Date.now();
  if (now - workspaceState.publicStateRepairRequestedAt < 45000) return;
  workspaceState.publicStateRepairInFlight = true;
  workspaceState.publicStateRepairRequestedAt = now;
  try {
    await requestPublicStateRepair(workspaceState.session.secretKeyHex, {
      reason,
      page: "workspace",
      knownEventCount: Array.isArray(publicState?.rawEvents) ? publicState.rawEvents.length : 0
    });
    window.setTimeout(() => {
      void syncWorkspaceState(true);
    }, 2800);
  } catch {
    return;
  } finally {
    workspaceState.publicStateRepairInFlight = false;
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
  const overlayMarkup = `${renderEntityModal()}${renderUserProfileModal()}${renderUserActionModal()}${renderCommentActionModal()}${renderSubmissionModal()}`;
  const tabs = shell.querySelector("[data-workspace-tabs]");
  const pane = shell.querySelector("[data-workspace-pane]");
  const overlays = shell.querySelector("[data-workspace-overlays]");
  const focusState = soft ? captureWorkspaceFocusState() : null;

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
  if (focusState) restoreWorkspaceFocusState(focusState);
}

function captureWorkspaceFocusState() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  const selector =
    active.matches("[data-comment-filter-query]")
      ? "[data-comment-filter-query]"
      : active.matches("[data-comment-filter-role]")
        ? "[data-comment-filter-role]"
        : active.matches("[data-comment-filter-karma]")
          ? "[data-comment-filter-karma]"
        : active.matches("[data-user-filter-karma]")
          ? "[data-user-filter-karma]"
          : active.matches("[data-entity-filter-query]")
            ? "[data-entity-filter-query]"
            : active.matches("[data-entity-filter-status]")
              ? "[data-entity-filter-status]"
              : active.matches("[data-entity-filter-location]")
                ? "[data-entity-filter-location]"
                : active.matches("[data-entity-filter-author]")
                  ? "[data-entity-filter-author]"
        : active.matches("[data-submission-filter-input]")
          ? "[data-submission-filter-input]"
          : active.matches("[data-quick-user-input]")
            ? "[data-quick-user-input]"
            : "";
  if (!selector) return null;
  const supportsSelection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
  return {
    selector,
    start: supportsSelection ? active.selectionStart : null,
    end: supportsSelection ? active.selectionEnd : null
  };
}

function restoreWorkspaceFocusState(focusState) {
  if (!focusState?.selector) return;
  const next = document.querySelector(focusState.selector);
  if (!(next instanceof HTMLElement)) return;
  next.focus({ preventScroll: true });
  if (
    (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) &&
    Number.isInteger(focusState.start) &&
    Number.isInteger(focusState.end)
  ) {
    next.setSelectionRange(focusState.start, focusState.end);
  }
}

function renderLoginPane() {
  return `
    <section class="surface-panel workspace-auth">
      <form class="tip-form" data-login-form>
        <label>
          <span>Username</span>
          <input name="username" type="text" maxlength="40" placeholder="username" required>
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" maxlength="120" placeholder="••••••••" required>
        </label>
        <div class="button-row">
          <button class="button" type="submit" data-login-submit>Create/Login</button>
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
  const karma = resolveWorkspaceUserKarma(workspaceState.viewer?.pubkey || "");
  return `
    <section class="surface-panel">
      <div class="eyebrow">Profile</div>
      <h2>Profile settings</h2>
      <div class="tag-row">
        <span class="tag">Karma ${formatWorkspaceKarma(karma)}</span>
      </div>
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
        <div class="status-box" data-workspace-status>${currentUserIsAdmin() ? escapeHtml(renderSiteKeyShareStatus()) : "Save changes to update your public profile."}</div>
      </form>
    </section>
  `;
}

function renderUsersPane() {
  const visibleUsers = visibleWorkspaceUsers();
  return `
    <div class="workspace-grid workspace-grid--rail">
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
      <aside class="workspace-rail-stack">
        <section class="surface-panel workspace-rail-panel">
          <label class="workspace-select">
            <span class="sr-only">Filter users by karma</span>
            <select data-user-filter-karma>
              ${renderKarmaSelectOptions(workspaceState.userFilters.karma)}
            </select>
          </label>
        </section>
        <section class="surface-panel workspace-rail-panel">
          ${renderUserStatsCard()}
        </section>
        <section class="surface-panel workspace-rail-panel">
        <label class="workspace-search">
          <span class="sr-only">Username</span>
          <input class="workspace-search__input" data-quick-user-input type="text" maxlength="80" placeholder="username" value="${escapeAttribute(workspaceState.userLookupQuery || "")}" autocomplete="off">
          ${
            workspaceState.userLookupQuery && !workspaceState.userLookupLoading
              ? `<button class="workspace-search__clear" type="button" data-clear-user-lookup aria-label="Clear lookup">×</button>`
              : ""
          }
          ${
            workspaceState.userLookupLoading
              ? `<span class="workspace-search__spinner" aria-hidden="true"><span class="loading-spinner"></span></span>`
              : ""
          }
        </label>
        ${
            workspaceState.userDirectStatus
              ? `<div class="status-box">${escapeHtml(workspaceState.userDirectStatus)}</div>`
              : ""
        }
        ${renderLookupCandidate()}
        </section>
      </aside>
    </div>
  `;
}

function renderUserStatsCard() {
  const stats = workspaceUserStats();
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

function renderUserCard(user) {
  const isRootAdmin = user.pubkey === workspaceState.publicState?.rootAdminPubkey;
  const canManage = currentUserIsAdmin() && !isRootAdmin && user.pubkey !== workspaceState.viewer?.pubkey;
  const submissionHref = `./investigations.html?author=${encodeURIComponent(user.username || user.pubkey)}`;
  const commentHref = `./admin.html?tab=comments&user=${encodeURIComponent(user.username || user.pubkey)}`;
  const karma = resolveWorkspaceUserKarma(user.pubkey);
  return `
    <article class="roster-item" id="user-${escapeAttribute(user.pubkey)}" data-user-card="${escapeAttribute(user.pubkey)}">
      <div class="workspace-list__row">
        <div>
          ${renderUserIdentityButton(user)}
          <span>${user.username ? `@${escapeHtml(user.username)}` : "Shared account"}</span>
        </div>
        <div class="tag-row">
          <span class="tag">Karma ${formatWorkspaceKarma(karma)}</span>
          ${user.isAdmin ? `<span class="tag">admin</span>` : ""}
          ${user.moderation ? `<span class="tag">${escapeHtml(user.moderation.action)}</span>` : ""}
        </div>
      </div>
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
                user.isAdmin && userNeedsCurrentSiteKey(user)
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

function renderLookupCandidate() {
  const user = workspaceState.userLookupResult;
  if (!user) return "";
  const karma = resolveWorkspaceUserKarma(user.pubkey);
  return `
    <article class="roster-item" data-user-card="${escapeAttribute(user.pubkey)}">
      <div class="workspace-list__row">
        <div>
          ${renderUserIdentityButton(user)}
          <span>${user.username ? `@${escapeHtml(user.username)}` : "Shared account"}</span>
        </div>
        <div class="tag-row">
          <span class="tag">Karma ${formatWorkspaceKarma(karma)}</span>
          ${user.isAdmin ? `<span class="tag">admin</span>` : `<span class="tag">member</span>`}
        </div>
      </div>
      ${
        currentUserIsAdmin() && user.pubkey !== workspaceState.viewer?.pubkey && user.pubkey !== workspaceState.publicState?.rootAdminPubkey
          ? `<div class="button-row button-row--tight"><button class="button" type="button" data-open-user-action="${user.pubkey}">Take action</button></div>`
          : ""
      }
    </article>
  `;
}

function renderUserIdentityButton(user, fallbackPubkey = user?.pubkey || "") {
  const cleanPubkey = String(fallbackPubkey || user?.pubkey || "").trim().toLowerCase();
  const displayName = user?.displayName || user?.username || shortKey(cleanPubkey);
  const avatarUrl = safeWorkspaceAvatarUrl(user?.avatarUrl || "");
  const avatar = avatarUrl
    ? `<span class="workspace-user__avatar workspace-user__avatar--image"><img src="${escapeAttribute(avatarUrl)}" alt="${escapeAttribute(displayName)}"></span>`
    : `<span class="workspace-user__avatar">${escapeHtml(profileInitials(displayName))}</span>`;
  return `
    <button class="user-link workspace-user-link" type="button" data-open-user-modal="${escapeAttribute(cleanPubkey)}">
      ${avatar}
      <strong>${escapeHtml(displayName)}</strong>
    </button>
  `;
}

function filterWorkspaceComments(comments) {
  const query = String(workspaceState.commentFilters.query || "").trim().toLowerCase();
  const role = String(workspaceState.commentFilters.role || "").trim().toLowerCase();
  const karmaBucket = String(workspaceState.commentFilters.karma || "").trim().toLowerCase();
  return (Array.isArray(comments) ? comments : []).filter((comment) => {
    const author = resolveWorkspaceUser(comment.author);
    if (role === "admin" && !author?.isAdmin) return false;
    if (role === "user" && author?.isAdmin) return false;
    if (!karmaBucketMatches(resolveWorkspaceCommentKarma(comment), karmaBucket)) return false;
    if (!query) return true;
    const haystacks = [
      comment.markdown,
      comment.post_slug,
      author?.displayName,
      author?.username
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    return haystacks.some((value) => value.includes(query));
  });
}

function resolveWorkspaceUser(pubkey) {
  const cleanPubkey = String(pubkey || "").trim().toLowerCase();
  return (workspaceState.publicState?.users || []).find((user) => user.pubkey === cleanPubkey) || null;
}

function resolveWorkspaceCommentKarma(commentOrId) {
  const commentId =
    typeof commentOrId === "string"
      ? String(commentOrId || "").trim()
      : String(commentOrId?.id || "").trim();
  if (!commentId) return 0;
  const summary = workspaceState.publicState?.commentVotes instanceof Map
    ? workspaceState.publicState.commentVotes.get(commentId)
    : null;
  return Number(summary?.score || commentOrId?.score || 0) || 0;
}

function resolveWorkspaceUserKarma(pubkey) {
  const cleanPubkey = String(pubkey || "").trim().toLowerCase();
  if (!cleanPubkey) return 0;
  const comments = workspaceState.publicState?.commentsByAuthor instanceof Map
    ? workspaceState.publicState.commentsByAuthor.get(cleanPubkey) || []
    : [];
  return comments.reduce((total, comment) => total + resolveWorkspaceCommentKarma(comment), 0);
}

function formatWorkspaceKarma(value) {
  const score = Number(value || 0) || 0;
  return score > 0 ? `+${score}` : String(score);
}

function karmaBucketMatches(score, bucket) {
  const cleanBucket = String(bucket || "").trim().toLowerCase();
  const numeric = Number(score || 0) || 0;
  if (!cleanBucket) return true;
  if (cleanBucket === "lt0") return numeric < 0;
  if (cleanBucket === "0-5") return numeric >= 0 && numeric <= 5;
  if (cleanBucket === "6-50") return numeric >= 6 && numeric <= 50;
  if (cleanBucket === "51-500") return numeric >= 51 && numeric <= 500;
  if (cleanBucket === "gt500") return numeric > 500;
  return true;
}

function karmaBucketForScore(score) {
  const numeric = Number(score || 0) || 0;
  if (numeric < 0) return "lt0";
  if (numeric <= 5) return "0-5";
  if (numeric <= 50) return "6-50";
  if (numeric <= 500) return "51-500";
  return "gt500";
}

function renderKarmaSelectOptions(selectedValue) {
  const value = String(selectedValue || "").trim().toLowerCase();
  const options = [
    ["", "All karma"],
    ["lt0", "Karma < 0"],
    ["0-5", "Karma 0-5"],
    ["6-50", "Karma 6-50"],
    ["51-500", "Karma 51-500"],
    ["gt500", "Karma > 500"]
  ];
  return options
    .map(([optionValue, label]) => `<option value="${optionValue}" ${value === optionValue ? "selected" : ""}>${label}</option>`)
    .join("");
}

function commentToneState(score) {
  const value = Number(score || 0) || 0;
  if (value >= 0) {
    return {
      tone: "",
      amount: "0"
    };
  }
  return {
    tone: value <= -3 ? "negative" : "warning",
    amount: Math.min(Math.abs(value) / 5, 1).toFixed(2)
  };
}

function userNeedsCurrentSiteKey(user) {
  const targetPubkey = String(user?.pubkey || "").trim().toLowerCase();
  const sitePubkey = activeSitePubkey();
  if (!targetPubkey || !sitePubkey || !user?.isAdmin || !workspaceState.siteKeyShare) return false;
  return !(workspaceState.publicState?.adminKeyShareMetadata || []).some(
    (share) => share.recipient_pubkey === targetPubkey && share.site_pubkey === sitePubkey
  );
}

function renderUserProfileModal() {
  const user = resolveWorkspaceUser(workspaceState.userModalPubkey);
  if (!user) return "";
  const displayName = user.displayName || user.username || shortKey(user.pubkey);
  const avatarUrl = safeWorkspaceAvatarUrl(user.avatarUrl || "");
  const socialLinks = safeWorkspaceSocialLinks(user);
  const karma = resolveWorkspaceUserKarma(user.pubkey);
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
                : `<span class="user-profile-modal__avatar">${escapeHtml(profileInitials(displayName))}</span>`
            }
          </div>
        <div class="user-profile-modal__copy">
          ${user.username ? `<strong>@${escapeHtml(user.username)}</strong>` : ""}
          <span class="muted-text">Karma ${formatWorkspaceKarma(karma)}</span>
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

function safeWorkspaceAvatarUrl(value) {
  return sanitizeUrl(value, "src");
}

function safeWorkspaceSocialLinks(user) {
  return (Array.isArray(user?.socialLinks) ? user.socialLinks : [])
    .map((link) => sanitizeUrl(link, "href"))
    .filter(Boolean);
}

function renderUserActionModal() {
  const user = resolveWorkspaceUser(workspaceState.userActionModal?.pubkey || "");
  if (!user || !currentUserIsAdmin()) return "";
  const isRootAdmin = user.pubkey === workspaceState.publicState?.rootAdminPubkey;
  const canManage = !isRootAdmin && user.pubkey !== workspaceState.viewer?.pubkey;
  if (!canManage) return "";
  return `
    <div class="modal-backdrop">
      <section class="modal-card">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">User action</div>
            <h2>${escapeHtml(user.displayName || user.username || shortKey(user.pubkey))}</h2>
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
            user.isAdmin && userNeedsCurrentSiteKey(user)
              ? `<button class="button-ghost" type="button" data-user-action="share-site-key" data-target-pubkey="${user.pubkey}">Share site key</button>`
              : ""
          }
        </div>
      </section>
    </div>
  `;
}

function renderCommentActionModal() {
  const modal = workspaceState.commentActionModal;
  if (!modal) return "";
  const comment = (workspaceState.publicState?.allComments || []).find((item) => item.id === modal.commentId);
  if (!comment) return "";
  const threadHref = `./investigation.html?slug=${encodeURIComponent(comment.post_slug)}&comment=${encodeURIComponent(comment.id)}`;
  const author = resolveWorkspaceUser(comment.author);
  const action = comment.visibility === "hidden" ? "restore" : "hide";
  if (modal.mode === "moderate" && !currentUserIsAdmin()) return "";
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
              <strong>${escapeHtml(author?.displayName || author?.username || shortKey(comment.author))}</strong>
              <span>${escapeHtml(trimmed(comment.markdown, 280))}</span>
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

function renderSubmissionModal() {
  const modal = workspaceState.submissionModal;
  if (!modal || !currentUserHasInboxAccess()) return "";
  const item = workspaceState.inboxSubmissions.find((entry) => entry.id === modal.submissionId);
  if (!item) return "";
  const latest = item.latest?.payload || {};
  const reviewState = deriveSubmissionReviewState(item);
  const author = resolveWorkspaceUser(item.author);
  const attachment = latest.attachment || null;
  const chatState = workspaceState.chatModal?.submissionId === item.id ? workspaceState.chatModal : null;
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
            <div>${renderUserIdentityButton(author || { pubkey: item.author, displayName: author?.displayName || author?.username || "Member" }, item.author)}</div>
          </article>
          <article class="roster-item">
            <strong>Location</strong>
            <span>${escapeHtml(latest.location || "No location supplied")}</span>
          </article>
          ${
            Array.isArray(latest.entity_refs) && latest.entity_refs.length
              ? `
                <article class="roster-item">
                  <strong>Entities</strong>
                  <span>${escapeHtml(latest.entity_refs.map(resolveEntityDisplayValue).join(", "))}</span>
                </article>
              `
              : ""
          }
          ${
            latest.suggested_entity?.name
              ? `
                <article class="roster-item">
                  <strong>Suggested entity</strong>
                  <span>${escapeHtml(latest.suggested_entity.name)}${latest.suggested_entity.location ? ` • ${escapeHtml(latest.suggested_entity.location)}` : ""}</span>
                </article>
              `
              : ""
          }
          <article class="roster-item">
            <strong>Details</strong>
            <span>${escapeHtml(latest.details || "No written details supplied.")}</span>
          </article>
          ${
            attachment?.url
              ? `
                <article class="roster-item">
                  <strong>Attachment</strong>
                  <span>${escapeHtml(describeSubmissionAttachment(attachment))}</span>
                  <div class="button-row button-row--tight">
                    <button class="button-ghost" type="button" data-download-attachment="${item.id}">Download</button>
                  </div>
                </article>
              `
              : ""
          }
        </div>
        ${renderSubmissionChatPanel(item, chatState)}
        <div class="button-row">
          <button class="button-ghost" type="button" data-open-chat="${item.id}" data-chat-target="${item.author}">${chatState ? "Hide chat" : "Open chat"}</button>
          <button
            class="button"
            type="button"
            data-submission-action="status"
            data-submission-id="${item.id}"
            data-author-pubkey="${item.author}"
            data-status="${reviewState.viewerConfirmed ? "unconfirmed" : "confirmed"}"
          >
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

function renderSubmissionChatPanel(item, chatState) {
  if (!chatState) return "";
  const messages = Array.isArray(chatState.messages) ? chatState.messages : [];
  const loading = Boolean(chatState.loading);
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
    const filteredSubmissions = filterInboxSubmissions(workspaceState.inboxSubmissions);
    const filterSuggestions = renderSubmissionFilterSuggestions();
    return `
      <section class="surface-panel">
        <div class="eyebrow">Encrypted submissions</div>
        <h2>Shared inbox</h2>
        <div class="workspace-filter-bar">
          <label class="workspace-search">
            <span class="sr-only">Filter submissions</span>
            <input
              class="workspace-search__input"
              data-submission-filter-input
              type="text"
              maxlength="240"
              placeholder="Filter by status, user, type, location, or entity"
              value="${escapeAttribute(workspaceState.submissionFilters.query || "")}"
              autocomplete="off"
            >
            ${
              workspaceState.submissionFilters.query
                ? `<button class="workspace-search__clear" type="button" data-clear-submission-filter aria-label="Clear submission filters">×</button>`
                : ""
            }
            ${filterSuggestions}
          </label>
        </div>
        <div class="roster-list">
          ${
            workspaceState.inboxLoading
              ? renderLoadingState("Looking up submissions...")
              : filteredSubmissions.length
              ? filteredSubmissions.map((item) => renderSubmissionCard(item)).join("")
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
                  ${renderUserIdentityButton(user)}
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
  const reviewState = deriveSubmissionReviewState(item);
  const entityRefs = Array.isArray(latest.entity_refs) ? latest.entity_refs : [];
  const author = resolveWorkspaceUser(item.author);
  return `
    <article class="roster-item">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(latest.subject || "Untitled submission")}</strong>
          <span>${escapeHtml(latest.location || "No location supplied")}</span>
        </div>
        <div class="tag-row">
          ${renderSubmissionStatusTags(reviewState)}
        </div>
      </div>
      <span>${escapeHtml(trimmed(latest.details || "", 180))}</span>
      <div>${renderUserIdentityButton(author || { pubkey: item.author, displayName: author?.displayName || author?.username || "Member" }, item.author)}</div>
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
      <div class="button-row button-row--tight">
        <button class="button-ghost" type="button" data-open-submission="${item.id}">View</button>
        <button
          class="button"
          type="button"
          data-submission-action="status"
          data-submission-id="${item.id}"
          data-author-pubkey="${item.author}"
          data-status="${reviewState.viewerConfirmed ? "unconfirmed" : "confirmed"}"
        >
          ${reviewState.viewerConfirmed ? "Unconfirm" : "Confirm"}
        </button>
        ${!reviewState.confirmCount ? `<button class="button-ghost" type="button" data-submission-action="status" data-submission-id="${item.id}" data-author-pubkey="${item.author}" data-status="deleted">Delete</button>` : ""}
        ${latest.attachment?.url ? `<button class="button-ghost" type="button" data-download-attachment="${item.id}">Download</button>` : ""}
        <button class="button-ghost" type="button" data-open-chat="${item.id}" data-chat-target="${item.author}">Chat</button>
      </div>
    </article>
  `;
}

function renderEntitiesPane() {
  const visibleEntities = visibleWorkspaceEntities();
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
            visibleEntities
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
              .join("") || `<div class="empty-state">No entities match these filters yet.</div>`
          }
        </div>
      </section>
      <aside class="workspace-rail-stack">
        <section class="surface-panel workspace-rail-panel">
          ${renderEntityManagementRail()}
        </section>
      </aside>
    </div>
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
        <p class="muted-text">Investigations and page updates land here once they are submitted for review. Approving keeps the latest cleartext version in the next bakedown queue.</p>
        <div class="roster-list">
          ${
            pending.length
              ? pending.map((draft) => renderReviewCard(draft)).join("")
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
      <span class="muted-text">By ${escapeHtml(authorLabel)}${!pageDraft && draft.entity_refs?.length ? ` • ${escapeHtml(draft.entity_refs.map(resolveEntityDisplayValue).join(", "))}` : ""}</span>
      <div class="button-row button-row--tight">
        <a class="text-link" href="${escapeAttribute(reviewedDraftHref(draft, "candidate"))}">Open preview</a>
        <button class="button-ghost" type="button" data-review-action="approve" data-draft-slug="${escapeAttribute(draft.slug)}">Approve for publish</button>
        <button class="button-ghost" type="button" data-review-action="revise" data-draft-slug="${escapeAttribute(draft.slug)}">Request revision</button>
        <button class="button-ghost" type="button" data-review-action="deny" data-draft-slug="${escapeAttribute(draft.slug)}">Deny</button>
      </div>
    </article>
  `;
}

function renderReviewedCard(draft) {
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

function isPageDraft(draft) {
  return String(draft?.content_type || "").trim().toLowerCase() === "page" && cleanSlug(draft?.page_id || "");
}

function pageDraftLabel(draft) {
  const pageId = cleanSlug(draft?.page_id || "");
  if (pageId === "home") return "Home page";
  if (pageId === "about") return "About page";
  return "Page";
}

function pageDraftHref(draft, statusOverride = "") {
  const pageId = cleanSlug(draft?.page_id || "");
  const status = String(statusOverride || draft?.status || "").trim().toLowerCase();
  const path = pageId === "about" ? "./about.html" : "./index.html";
  if (["approved", "revision", "denied"].includes(status)) return path;
  return `${path}?draft=${encodeURIComponent(draft.slug)}`;
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

function reviewedDraftHref(draft, statusOverride = "") {
  const status = String(statusOverride || draft?.status || "").trim().toLowerCase();
  if (isPageDraft(draft)) return pageDraftHref(draft, status);
  return status === "revision"
    ? `./editor.html?slug=${encodeURIComponent(draft.slug)}`
    : `./investigation.html?draft=${encodeURIComponent(draft.slug)}`;
}

function reviewedDraftAction(draft) {
  if (isPageDraft(draft)) {
    return ["revision", "approved", "denied"].includes(String(draft?.status || "").trim().toLowerCase())
      ? "Open page"
      : "Open preview";
  }
  return String(draft?.status || "").trim().toLowerCase() === "revision"
    ? "Open draft"
    : "Open preview";
}

function renderCommentsPane() {
  const ownComments = workspaceState.publicState?.commentsByAuthor.get(workspaceState.viewer?.pubkey || "") || [];
  if (currentUserIsAdmin()) {
    const allComments = filterWorkspaceComments((workspaceState.publicState?.allComments || []).slice().reverse());
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
          <label class="workspace-search">
            <span class="sr-only">Search comments</span>
            <input class="workspace-search__input" data-comment-filter-query type="text" maxlength="120" placeholder="Search comments or users" value="${escapeAttribute(workspaceState.commentFilters.query || "")}" autocomplete="off">
            ${
              workspaceState.commentFilters.query
                ? `<button class="workspace-search__clear" type="button" data-clear-comment-filter aria-label="Clear comment search">×</button>`
                : ""
            }
          </label>
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
              ${renderKarmaSelectOptions(workspaceState.commentFilters.karma)}
            </select>
          </label>
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
                .map((comment) => renderOwnCommentRow(comment))
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
  const menuOpen = workspaceState.commentMenuId === comment.id;
  const preview = trimmed(comment.markdown, 220);
  const threadHref = `./investigation.html?slug=${encodeURIComponent(comment.post_slug)}&comment=${encodeURIComponent(comment.id)}`;
  const karma = resolveWorkspaceCommentKarma(comment);
  const tone = commentToneState(karma);
  return `
    <article class="roster-item" data-comment-tone="${escapeAttribute(tone.tone)}" style="--comment-review-tone:${escapeAttribute(tone.amount)};">
      <div class="workspace-list__row">
        <div>
          ${renderUserIdentityButton(author || { pubkey: comment.author, displayName: authorLabel, username: author?.username || "" }, comment.author)}
          <span>${escapeHtml(comment.post_slug)} • ${escapeHtml(new Date(comment.created_at * 1000).toLocaleString())}</span>
        </div>
        <div class="tag-row">
          <span class="tag">Karma ${formatWorkspaceKarma(karma)}</span>
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
          ? `
            <div class="inline-action-menu">
              <a class="text-link" href="${escapeAttribute(threadHref)}">View thread</a>
              <button class="button" type="button" data-open-comment-action="${escapeAttribute(comment.id)}" data-comment-mode="moderate">Take action</button>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderOwnCommentRow(comment) {
  const menuOpen = workspaceState.ownCommentMenuId === comment.id;
  const karma = resolveWorkspaceCommentKarma(comment);
  return `
    <article class="roster-item">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(comment.post_slug)}</strong>
          <span>${escapeHtml(new Date(comment.created_at * 1000).toLocaleString())}</span>
        </div>
        <div class="tag-row">
          <span class="tag">Karma ${formatWorkspaceKarma(karma)}</span>
          <button class="button-ghost button-ghost--icon" type="button" data-own-comment-menu-toggle="${escapeAttribute(comment.id)}" aria-label="Comment options">...</button>
        </div>
      </div>
      <span>${escapeHtml(trimmed(comment.markdown, 220))}</span>
      ${
        menuOpen
          ? `
            <div class="inline-action-menu">
              <button class="button-ghost" type="button" data-open-comment-action="${escapeAttribute(comment.id)}" data-comment-mode="edit">Edit</button>
              <button class="button-ghost" type="button" data-open-comment-action="${escapeAttribute(comment.id)}" data-comment-mode="delete">Delete</button>
            </div>
          `
          : ""
      }
    </article>
  `;
}

function renderEntityModal() {
  if (!workspaceState.entityModal) return "";
  const draft = workspaceState.entityModal;
  const title = draft.mode === "edit" ? "Edit entity" : "Add entity";
  const actionLabel = draft.mode === "edit" ? "Save entity" : "Publish entity";
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
  const submitButton = form.querySelector("[data-login-submit]");
  try {
    setLoginPending(submitButton, true);
    if (status) {
      status.textContent = "Opening account...";
      status.dataset.state = "pending";
    }
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
  } finally {
    setLoginPending(submitButton, false);
  }
}

function setLoginPending(button, pending) {
  if (!(button instanceof HTMLButtonElement)) return;
  button.disabled = pending;
  button.dataset.busy = pending ? "yes" : "no";
  button.innerHTML = pending
    ? `<span class="loading-spinner" aria-hidden="true"></span><span>Opening account...</span>`
    : "Create/Login";
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
  workspaceState.userActionModal = null;
  await refreshWorkspace(true);
}

async function handleDirectUserAction(button) {
  if (!currentUserIsAdmin()) return;
  const targetPubkey = resolveDirectUserPubkey();
  if (!targetPubkey) {
    workspaceState.userDirectStatus = "Find a user first.";
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
  if (workspaceState.userLookupDebounce) {
    window.clearTimeout(workspaceState.userLookupDebounce);
    workspaceState.userLookupDebounce = 0;
  }
  const input = document.querySelector("[data-quick-user-input]");
  const rawValue = String(input instanceof HTMLInputElement ? input.value : workspaceState.userLookupQuery || "").trim();
  await resolveUserLookupQuery(rawValue);
}

async function resolveUserLookupQuery(rawValue, options = {}) {
  const shouldRender = options.render !== false;
  const cleanValue = String(rawValue || "").trim();
  const requestId = workspaceState.userLookupRequestId + 1;
  workspaceState.userLookupRequestId = requestId;
  workspaceState.userLookupQuery = cleanValue;
  workspaceState.userLookupResult = null;
  workspaceState.userLookupLoading = false;
  if (!cleanValue) {
    workspaceState.userDirectStatus = "";
    if (shouldRender) renderWorkspace({ soft: true });
    return;
  }

  const localMatch = findLocalUserCandidate(cleanValue);
  if (localMatch) {
    workspaceState.userLookupResult = localMatch;
    workspaceState.userDirectStatus = `Found ${localMatch.username ? `@${localMatch.username}` : localMatch.displayName || "this user"} in the current roster.`;
    if (shouldRender) renderWorkspace({ soft: true });
    return;
  }

  workspaceState.userLookupLoading = true;
  if (shouldRender) renderWorkspace({ soft: true });
  const remoteMatches = await lookupUsers(cleanValue).catch(() => []);
  if (requestId !== workspaceState.userLookupRequestId) return;
  workspaceState.userLookupLoading = false;
  if (remoteMatches.length) {
    const match = hydrateLookupCandidate(remoteMatches[0]);
    workspaceState.userLookupResult = match;
    workspaceState.userDirectStatus = `Found ${match.username ? `@${match.username}` : match.displayName || "this user"} from shared site data.`;
    if (shouldRender) renderWorkspace({ soft: true });
    return;
  }

  const directPubkey = normalizeDirectPubkey(cleanValue);
  if (directPubkey) {
    workspaceState.userLookupResult = hydrateLookupCandidate({
      pubkey: directPubkey,
      username: "",
      displayName: "Direct match",
      isAdmin: workspaceState.publicState?.admins?.includes(directPubkey)
    });
    workspaceState.userDirectStatus = "No profile is visible yet, but this account can still be managed directly.";
    if (shouldRender) renderWorkspace({ soft: true });
    return;
  }

  workspaceState.userDirectStatus = "No matching user found yet.";
  if (shouldRender) renderWorkspace({ soft: true });
}

function scheduleUserLookup() {
  if (workspaceState.userLookupDebounce) {
    window.clearTimeout(workspaceState.userLookupDebounce);
    workspaceState.userLookupDebounce = 0;
  }
  const query = String(workspaceState.userLookupQuery || "").trim();
  if (!query) {
    workspaceState.userLookupLoading = false;
    return;
  }
  workspaceState.userLookupDebounce = window.setTimeout(() => {
    workspaceState.userLookupDebounce = 0;
    void resolveUserLookupQuery(query);
  }, 260);
}

function clearWorkspaceUserLookup() {
  if (workspaceState.userLookupDebounce) {
    window.clearTimeout(workspaceState.userLookupDebounce);
    workspaceState.userLookupDebounce = 0;
  }
  workspaceState.userLookupRequestId += 1;
  workspaceState.userLookupQuery = "";
  workspaceState.userLookupResult = null;
  workspaceState.userLookupLoading = false;
  workspaceState.userDirectStatus = "";
  clearWorkspaceLinkedUser();
}

function focusWorkspaceSearchField(selector) {
  window.setTimeout(() => {
    const field = document.querySelector(selector);
    if (field instanceof HTMLElement) {
      field.focus({ preventScroll: true });
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        const length = field.value.length;
        field.setSelectionRange(length, length);
      }
    }
  }, 0);
}

async function performUserAction(targetPubkey, action, mode = "") {
  if (!currentUserIsAdmin() || !targetPubkey) return;
  const user = resolveWorkspaceUser(targetPubkey);
  const isRootAdmin = targetPubkey === workspaceState.publicState?.rootAdminPubkey;
  if (isRootAdmin) return;
  if (action === "share-site-key" && workspaceState.siteKeyShare) {
    if (user && !userNeedsCurrentSiteKey(user)) return;
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
    if (user?.isAdmin) return;
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
  const existingSlug = cleanSlug(formData.get("slug") || "");
  const taken = (workspaceState.publicState?.entities || [])
    .map((entity) => entity.slug)
    .filter((slug) => slug !== existingSlug);
  const slug = existingSlug || createUniqueSlug(name, taken);
  const nextStatus = String(formData.get("status") || "").trim() || (currentUserIsAdmin() ? "approved" : "pending");
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
      status: nextStatus
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

async function handleCommentActionForm(form) {
  const formData = new FormData(form);
  const commentId = String(formData.get("commentId") || "").trim();
  const mode = String(formData.get("mode") || "").trim().toLowerCase();
  const comment = (workspaceState.publicState?.allComments || []).find((item) => item.id === commentId);
  if (!comment || !workspaceState.session) return;

  if (mode === "moderate" && currentUserIsAdmin()) {
    await publishTaggedJson({
      kind: SITE.nostr.kinds.commentMod,
      secretKeyHex: workspaceState.session.secretKeyHex,
      tags: [["e", commentId], ["op", comment.visibility === "hidden" ? "restore" : "hide"]],
      content: {
        target_id: commentId,
        action: comment.visibility === "hidden" ? "restore" : "hide",
        note: String(formData.get("note") || "").trim()
      }
    });
    workspaceState.commentActionModal = null;
    applyLocalCommentModeration(commentId, comment.visibility === "hidden" ? "restore" : "hide", String(formData.get("note") || "").trim());
    renderWorkspace({ soft: true });
    window.setTimeout(() => void refreshWorkspace(true), 900);
    return;
  }

  if (comment.author !== workspaceState.viewer?.pubkey) return;
  if (mode === "edit") {
    const markdown = String(formData.get("markdown") || "").trim();
    if (!markdown) return;
    await publishTaggedJson({
      kind: SITE.nostr.kinds.comment,
      secretKeyHex: workspaceState.session.secretKeyHex,
      tags: [
        ["d", comment.id],
        ["a", comment.post_slug],
        ...(comment.parent_id ? [["e", comment.parent_id], ["parent", comment.parent_id]] : []),
        ...(comment.root_id ? [["root", comment.root_id]] : [])
      ],
      content: {
        post_slug: comment.post_slug,
        markdown,
        parent_id: comment.parent_id || "",
        root_id: comment.root_id || ""
      }
    });
  }
  if (mode === "delete") {
    await publishTaggedJson({
      kind: SITE.nostr.kinds.commentMod,
      secretKeyHex: workspaceState.session.secretKeyHex,
      tags: [["e", commentId], ["op", "hide"]],
      content: {
        target_id: commentId,
        action: "hide",
        note: "Deleted by author"
      }
    });
  }
  workspaceState.commentActionModal = null;
  await refreshWorkspace(true);
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
      tags: [
        ["d", draft.slug],
        ["status", nextStatus],
        ["review", action],
        ...(isPageDraft(draft) ? [["content", "page"], ["page", cleanSlug(draft.page_id || "")]] : [])
      ],
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
  const status = button.getAttribute("data-status") || "viewed";
  const reviewState = deriveSubmissionReviewState(
    workspaceState.inboxSubmissions.find((item) => item.id === submissionId)
  );
  if (status === "deleted" && reviewState.confirmCount) return;
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

async function hydrateInboxSubmissions(options = {}) {
  if (!currentUserHasInboxAccess()) return;
  const background = Boolean(options.background);
  if (!background) {
    workspaceState.inboxLoading = true;
    renderWorkspace({ soft: true });
  }
  const nextSubmissions = await loadInboxSubmissions(workspaceState.siteKeyShares).catch(() => workspaceState.inboxSubmissions);
  workspaceState.inboxSubmissions = Array.isArray(nextSubmissions) ? nextSubmissions : workspaceState.inboxSubmissions;
  workspaceState.inboxLoading = false;
  if (!background) {
    renderWorkspace({ soft: true });
  }
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
  workspaceState.submissionModal = { submissionId };
  workspaceState.chatModal = {
    submissionId,
    targetPubkey: nextTargetPubkey,
    loading: true,
    messages: []
  };
  renderWorkspace();
  await hydrateChatModal();
}

async function markSubmissionViewed(submissionId) {
  if (!currentUserIsAdmin() || !workspaceState.session) return;
  const item = workspaceState.inboxSubmissions.find((entry) => entry.id === submissionId);
  if (!item) return;
  const reviewState = deriveSubmissionReviewState(item);
  if (reviewState.viewerViewed) return;
  await publishTaggedJson({
    kind: SITE.nostr.kinds.submissionStatus,
    secretKeyHex: workspaceState.session.secretKeyHex,
    tags: [["d", submissionId], ["p", item.author]],
    content: {
      submission_id: submissionId,
      author_pubkey: item.author,
      status: "viewed"
    }
  }).catch(() => {});
  window.setTimeout(() => void refreshWorkspace(true), 600);
}

async function maybeResolveUserDeepLink() {
  const query = readWorkspaceLinkedUser();
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

function maybeResolveCommentDeepLink() {
  const query = readWorkspaceLinkedUser();
  if (!query || workspaceState.activeTab !== "comments" || workspaceState.commentFilters.query) return;
  workspaceState.commentFilters.query = query;
  renderWorkspace({ soft: true });
}

function readWorkspaceLinkedUser() {
  return String(new URLSearchParams(window.location.search).get("user") || "").trim();
}

function clearWorkspaceLinkedUser() {
  const url = new URL(window.location.href);
  url.searchParams.delete("user");
  history.replaceState({}, "", url);
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
}

function createEntityModalState(trigger) {
  const editSlug = trigger?.getAttribute?.("data-edit-entity") || "";
  if (editSlug) {
    const entity = (workspaceState.publicState?.entities || []).find((item) => item.slug === editSlug);
    if (entity) {
      return {
        mode: "edit",
        slug: entity.slug,
        status: entity.status,
        seedName: entity.name,
        seedLocation: entity.location,
        seedType: entity.type,
        seedLat: entity.lat ?? "",
        seedLng: entity.lng ?? "",
        seedNotes: entity.notes || ""
      };
    }
  }
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
  if (!["users", "comments"].includes(workspaceState.activeTab)) {
    url.searchParams.delete("user");
  }
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
  const targetUser = resolveWorkspaceUser(targetPubkey);
  const targetLabel = targetUser?.displayName || targetUser?.username || shortKey(targetPubkey);
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
        description: targetLabel
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

function deriveSubmissionReviewState(item) {
  const submissionId = String(item?.id || "").trim();
  const statusEvents = (workspaceState.publicState?.rawEvents || [])
    .filter((event) => Number(event?.kind) === Number(SITE.nostr.kinds.submissionStatus))
    .filter((event) => firstTag(event, "d") === submissionId)
    .sort((left, right) => {
      const leftTime = Number(left?.created_at || 0);
      const rightTime = Number(right?.created_at || 0);
      if (leftTime !== rightTime) return leftTime - rightTime;
      return String(left?.id || "").localeCompare(String(right?.id || ""));
    });
  const confirmedBy = new Set();
  const viewedBy = new Set();
  let deleted = false;
  for (const event of statusEvents) {
    const payload = safeJson(event.content);
    const status = String(payload?.status || "").trim().toLowerCase();
    const author = String(event?.pubkey || "").trim().toLowerCase();
    if (!status || !author) continue;
    if (status === "confirmed") confirmedBy.add(author);
    if (status === "unconfirmed") confirmedBy.delete(author);
    if (status === "viewed") viewedBy.add(author);
    if (status === "unviewed") viewedBy.delete(author);
    if (status === "deleted") deleted = true;
  }
  const viewerPubkey = String(workspaceState.viewer?.pubkey || "").trim().toLowerCase();
  return {
    confirmedBy,
    viewedBy,
    deleted,
    confirmCount: confirmedBy.size,
    viewedCount: viewedBy.size,
    viewerConfirmed: viewerPubkey ? confirmedBy.has(viewerPubkey) : false,
    viewerViewed: viewerPubkey ? viewedBy.has(viewerPubkey) : false
  };
}

function renderSubmissionStatusTags(reviewState) {
  const tags = [];
  if (reviewState.confirmCount) tags.push(`<span class="tag">Confirmed${reviewState.confirmCount > 1 ? ` (${reviewState.confirmCount})` : ""}</span>`);
  else tags.push(`<span class="tag">Unconfirmed</span>`);
  if (reviewState.viewedCount) tags.push(`<span class="tag">${reviewState.viewedCount > 1 ? `${reviewState.viewedCount} viewed` : "Viewed"}</span>`);
  else tags.push(`<span class="tag">Unviewed</span>`);
  return tags.join("");
}

function describeSubmissionAttachment(attachment) {
  const type = String(attachment?.type || "").trim();
  const name = String(attachment?.name || "").trim();
  if (name && type) return `${name} • ${type}`;
  return name || type || "Encrypted file";
}

function parseSubmissionFilterTokens(value) {
  return String(value || "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function filterInboxSubmissions(items) {
  const tokens = parseSubmissionFilterTokens(workspaceState.submissionFilters.query || "");
  const base = (Array.isArray(items) ? items : []).filter((item) => !deriveSubmissionReviewState(item).deleted);
  if (!tokens.length) return base;
  return base.filter((item) => {
    const latest = item.latest?.payload || {};
    const reviewState = deriveSubmissionReviewState(item);
    const author = resolveWorkspaceUser(item.author);
    const entityValues = [
      ...(Array.isArray(latest.entity_refs) ? latest.entity_refs.map(resolveEntityDisplayValue) : []),
      latest.suggested_entity?.name,
      latest.suggested_entity?.location
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    const attachmentType = [
      String(latest.attachment?.type || "").trim().toLowerCase(),
      String(latest.attachment?.name || "").trim().toLowerCase().split(".").pop()
    ].filter(Boolean);
    const authorValues = [author?.displayName, author?.username]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    const textHaystack = [
      latest.subject,
      latest.details,
      latest.location,
      ...entityValues,
      ...authorValues,
      ...attachmentType
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    return tokens.every((token) => submissionTokenMatches(token, reviewState, textHaystack, attachmentType, authorValues, entityValues, latest));
  });
}

function renderSubmissionFilterSuggestions() {
  const suggestions = submissionFilterSuggestions();
  if (!suggestions.length || !workspaceState.submissionFilterOpen) return "";
  return `
    <div class="picker-results picker-results--dropdown workspace-search__results" data-open="yes">
      ${suggestions
        .map(
          (token, index) => `
            <button
              class="picker-chip${workspaceState.submissionFilterHighlight === index ? " is-highlighted" : ""}"
              type="button"
              data-submission-filter-suggestion="${escapeAttribute(token)}"
              data-submission-filter-index="${index}"
              aria-selected="${workspaceState.submissionFilterHighlight === index ? "true" : "false"}"
            >
              <strong>${escapeHtml(token)}</strong>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function submissionFilterSuggestions() {
  const raw = String(workspaceState.submissionFilters.query || "");
  const segment = raw.split(",").pop()?.trim().toLowerCase() || "";
  if (!segment) return [];
  const suggestionPool = [
    "status:confirmed",
    "status:unconfirmed",
    "status:viewed",
    "status:unviewed",
    ...buildSubmissionFilterValues("user", workspaceState.inboxSubmissions, (item) => {
      const author = resolveWorkspaceUser(item.author);
      return [author?.username, author?.displayName];
    }),
    ...buildSubmissionFilterValues("type", workspaceState.inboxSubmissions, (item) => {
      const attachment = item.latest?.payload?.attachment || {};
      return [attachment.type, String(attachment.name || "").split(".").pop()];
    }),
    ...buildSubmissionFilterValues("location", workspaceState.inboxSubmissions, (item) => [item.latest?.payload?.location]),
    ...buildSubmissionFilterValues("entity", workspaceState.inboxSubmissions, (item) => [
      ...(Array.isArray(item.latest?.payload?.entity_refs) ? item.latest.payload.entity_refs.map(resolveEntityDisplayValue) : []),
      item.latest?.payload?.suggested_entity?.name
    ])
  ];
  const deduped = [...new Set(suggestionPool.map((value) => String(value || "").trim()).filter(Boolean))];
  return deduped.filter((value) => !segment || value.toLowerCase().includes(segment)).slice(0, 8);
}

function buildSubmissionFilterValues(prefix, items, project) {
  return (Array.isArray(items) ? items : []).flatMap((item) =>
    (Array.isArray(project(item)) ? project(item) : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => `${prefix}:${value}`)
  );
}

function applySubmissionFilterSuggestion(token) {
  const raw = String(workspaceState.submissionFilters.query || "");
  const parts = raw.split(",");
  if (!parts.length) return `${token}, `;
  parts[parts.length - 1] = ` ${token}`;
  return `${parts.map((part) => part.trim()).filter(Boolean).join(", ")}, `;
}

function submissionTokenMatches(token, reviewState, textHaystack, attachmentType, authorValues, entityValues, latest) {
  const [rawKey, ...rawValueParts] = token.split(":");
  const key = rawValueParts.length ? rawKey.trim() : "";
  const value = rawValueParts.join(":").trim();
  if (key === "status") {
    if (value === "confirmed") return reviewState.confirmCount > 0;
    if (value === "unconfirmed") return reviewState.confirmCount === 0;
    if (value === "viewed") return reviewState.viewedCount > 0;
    if (value === "unviewed") return reviewState.viewedCount === 0;
  }
  if (key === "type") return attachmentType.some((entry) => entry.includes(value));
  if (key === "user") return authorValues.some((entry) => entry.includes(value));
  if (key === "location") return String(latest.location || "").trim().toLowerCase().includes(value);
  if (key === "entity") return entityValues.some((entry) => entry.includes(value));
  return textHaystack.some((entry) => entry.includes(token));
}

function firstTag(event, key) {
  const hit = (event.tags || []).find((tag) => Array.isArray(tag) && tag[0] === key);
  return hit ? String(hit[1] || "") : "";
}

function safeJson(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
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
  const cleanCommentId = String(commentId || "").trim();
  const hiddenIds = action === "hide"
    ? collectWorkspaceCommentBranchIds(cleanCommentId, publicState.allComments)
    : [cleanCommentId];
  const moderation = {
    action: action === "restore" ? "restore" : "hide",
    note: String(note || "").trim(),
    updated_at: Math.floor(Date.now() / 1000),
    by: workspaceState.viewer?.pubkey || ""
  };
  publicState.allComments = publicState.allComments.map((comment) =>
    hiddenIds.includes(String(comment.id || "").trim())
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

function collectWorkspaceCommentBranchIds(commentId, comments) {
  const cleanCommentId = String(commentId || "").trim();
  if (!cleanCommentId) return [];
  const byParent = new Map();
  for (const comment of Array.isArray(comments) ? comments : []) {
    const parentId = String(comment?.parent_id || "").trim();
    if (!parentId) continue;
    const bucket = byParent.get(parentId) || [];
    bucket.push(String(comment.id || "").trim());
    byParent.set(parentId, bucket);
  }
  const seen = new Set();
  const stack = [cleanCommentId];
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const children = byParent.get(current) || [];
    for (const childId of children) stack.push(childId);
  }
  return [...seen];
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
  if (workspaceState.activeTab === "submissions" || workspaceState.submissionModal) return false;
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
  const karmaBucket = String(workspaceState.userFilters.karma || "").trim().toLowerCase();
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
    return visible && karmaBucketMatches(resolveWorkspaceUserKarma(user.pubkey), karmaBucket);
  });
}

function workspaceUserStats() {
  const users = visibleWorkspaceUsers();
  const activePubkeys = new Set();
  for (const comment of workspaceState.publicState?.allComments || []) {
    if (comment?.author) activePubkeys.add(String(comment.author).trim().toLowerCase());
  }
  for (const event of workspaceState.publicState?.rawEvents || []) {
    if (Number(event?.kind) === Number(SITE.nostr.kinds.commentVote) && event?.pubkey) {
      activePubkeys.add(String(event.pubkey).trim().toLowerCase());
    }
  }
  const karmaBuckets = {
    lt0: 0,
    "0-5": 0,
    "6-50": 0,
    "51-500": 0,
    gt500: 0
  };
  for (const user of users) {
    const bucket = karmaBucketForScore(resolveWorkspaceUserKarma(user.pubkey));
    if (bucket) karmaBuckets[bucket] += 1;
  }
  return {
    total: users.length,
    active: users.filter((user) => activePubkeys.has(String(user.pubkey || "").trim().toLowerCase())).length,
    karmaBuckets
  };
}

function visibleWorkspaceEntities() {
  const filters = workspaceState.entityFilters || {};
  const query = String(filters.query || "").trim().toLowerCase();
  const status = String(filters.status || "").trim().toLowerCase();
  const location = String(filters.location || "").trim().toLowerCase();
  const authorQuery = String(filters.author || "").trim().toLowerCase();
  return (workspaceState.publicState?.entities || []).filter((entity) => {
    if (status && String(entity?.status || "").trim().toLowerCase() !== status) return false;
    if (query) {
      const haystack = [
        entity?.name,
        entity?.slug,
        entity?.type,
        ...(Array.isArray(entity?.aliases) ? entity.aliases : [])
      ]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean);
      if (!haystack.some((value) => value.includes(query))) return false;
    }
    if (location) {
      const locationValue = String(entity?.location || "").trim().toLowerCase();
      if (!locationValue.includes(location)) return false;
    }
    if (authorQuery) {
      const author = resolveWorkspaceUser(entity?.author || "");
      const authorValues = [
        author?.displayName,
        author?.username,
        entity?.author
      ]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean);
      if (!authorValues.some((value) => value.includes(authorQuery))) return false;
    }
    return true;
  });
}

function renderEntityManagementRail() {
  return `
    <div class="workspace-rail-copy">
      <div class="eyebrow">Filter entities</div>
      <p>Search by name or alias, then narrow by status, place, or submitting user.</p>
    </div>
    <label class="workspace-search">
      <span class="sr-only">Search entities</span>
      <input class="workspace-search__input" data-entity-filter-query type="text" maxlength="120" placeholder="Search entities" value="${escapeAttribute(workspaceState.entityFilters.query || "")}" autocomplete="off">
      ${
        workspaceState.entityFilters.query
          ? `<button class="workspace-search__clear" type="button" data-clear-entity-filter="query" aria-label="Clear entity search">×</button>`
          : ""
      }
    </label>
    <label class="workspace-select">
      <span class="sr-only">Filter by entity status</span>
      <select data-entity-filter-status>
        <option value="">All statuses</option>
        <option value="approved" ${workspaceState.entityFilters.status === "approved" ? "selected" : ""}>Approved</option>
        <option value="pending" ${workspaceState.entityFilters.status === "pending" ? "selected" : ""}>Pending</option>
        <option value="denied" ${workspaceState.entityFilters.status === "denied" ? "selected" : ""}>Denied</option>
        <option value="deleted" ${workspaceState.entityFilters.status === "deleted" ? "selected" : ""}>Deleted</option>
      </select>
    </label>
    <label class="workspace-search">
      <span class="sr-only">Filter by state or country</span>
      <input class="workspace-search__input" data-entity-filter-location type="text" maxlength="120" placeholder="State or country" value="${escapeAttribute(workspaceState.entityFilters.location || "")}" autocomplete="off">
      ${
        workspaceState.entityFilters.location
          ? `<button class="workspace-search__clear" type="button" data-clear-entity-filter="location" aria-label="Clear location filter">×</button>`
          : ""
      }
    </label>
    <label class="workspace-search">
      <span class="sr-only">Filter by submitting user</span>
      <input class="workspace-search__input" data-entity-filter-author type="text" maxlength="120" placeholder="Submitted by" value="${escapeAttribute(workspaceState.entityFilters.author || "")}" autocomplete="off">
      ${
        workspaceState.entityFilters.author
          ? `<button class="workspace-search__clear" type="button" data-clear-entity-filter="author" aria-label="Clear submitter filter">×</button>`
          : ""
      }
    </label>
  `;
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

function profileInitials(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Me";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
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
