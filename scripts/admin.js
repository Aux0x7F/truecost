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
  lookupUsers,
  loadSubmissionThread,
  normalizeUsername,
  publishAdminKeyShare,
  publishAdminKeyRequest,
  publishSiteKeyEvent,
  publishSubmissionChat,
  publishTaggedJson,
  resolveSitePubkey,
  sanitizeUrl,
  shortKey,
  uploadPublicBlob
} from "./core/nostr.js";
import { createPublicStateStore } from "./core/public-state-store.js";
import { publicStateHasAdminPubkey } from "./core/public-state.js";
import {
  collectRecordBranchIds as collectWorkspaceCommentBranchIds,
  regroupRecordsByKey as regroupComments
} from "./core/comment-utils.js";
import {
  cycleHighlightIndex
} from "./core/search-controls.js";
import { createWorkspaceSurfaceDeps } from "./surfaces/workspace-deps.js";
import {
  renderCommentActionModal as renderWorkspaceCommentActionModal,
  renderEntityModal as renderWorkspaceEntityModal,
  renderLookupCandidate as renderWorkspaceLookupCandidate,
  renderModerationComment as renderWorkspaceModerationComment,
  renderOwnCommentRow as renderWorkspaceOwnCommentRow,
  renderSubmissionCard as renderWorkspaceSubmissionCard,
  renderSubmissionModal as renderWorkspaceSubmissionModal,
  renderUserActionModal as renderWorkspaceUserActionModal,
  renderUserCard as renderWorkspaceUserCard,
  renderUserProfileModal as renderWorkspaceUserProfileModal,
  renderUserStatsCard as renderWorkspaceUserStatsCard
} from "./surfaces/workspace-actions.js";
import {
  renderEntityLocationFilterSuggestions as renderWorkspaceEntityLocationFilterSuggestions,
  renderEntityManagementRail as renderWorkspaceEntityManagementRail,
  renderEntityPickerResultsMarkup,
  renderLocationResultsMarkup,
  renderSubmissionFilterSuggestions as renderWorkspaceSubmissionFilterSuggestions
} from "./surfaces/workspace-filters.js";
import { renderWorkspaceView } from "./surfaces/workspace.js";
import {
  dedupeStrings as dedupe,
  escapeAttribute,
  escapeHtml,
  lastCommaValue,
  safeJson
} from "./core/text-utils.js";
import { getStoredSession, rebroadcastAccount, signInWithCredentials } from "./core/session.js";

let workspacePublicStateStore = null;

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
  entityLocationFilterHighlight: -1,
  entityLocationFilterOpen: false,
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
  inboxLoading: false,
  respondedKeyRequests: new Set(),
  keyRequestCache: null
};

workspacePublicStateStore = createPublicStateStore({
  getSessionSecretKey: async () => workspaceState.session?.secretKeyHex || "",
  page: "workspace",
  refreshDelayMs: () => 0,
  shouldRefresh: () => false
});
workspaceState.publicState = workspacePublicStateStore.value;
workspacePublicStateStore.subscribe((snapshot) => {
  workspaceState.publicState = snapshot.value;
});

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
        if (field === "location") {
          workspaceState.entityLocationFilterHighlight = -1;
          workspaceState.entityLocationFilterOpen = false;
        }
        renderWorkspace({ soft: true });
        focusWorkspaceSearchField(`[data-entity-filter-${field}]`);
      }
      return;
    }

    const entityLocationSuggestion = target.closest("[data-entity-location-suggestion]");
    if (entityLocationSuggestion) {
      applyEntityLocationSuggestion(entityLocationSuggestion.getAttribute("data-entity-location-suggestion") || "");
      renderWorkspace({ soft: true });
      focusWorkspaceSearchField("[data-entity-filter-location]");
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
      return;
    }
    if (target.matches("[data-entity-filter-location]")) {
      const nextOpen = Boolean(String(target.value || "").trim() && entityLocationFilterSuggestions().length);
      if (workspaceState.entityLocationFilterOpen !== nextOpen) {
        workspaceState.entityLocationFilterOpen = nextOpen;
        workspaceState.entityLocationFilterHighlight = nextOpen ? 0 : -1;
        renderWorkspace({ soft: true });
      }
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    let didRefresh = false;
    const activeSearch = document.querySelector("[data-submission-filter-input]")?.closest(".workspace-search");
    if (!(activeSearch instanceof HTMLElement && activeSearch.contains(target)) && workspaceState.submissionFilterOpen) {
      workspaceState.submissionFilterOpen = false;
      workspaceState.submissionFilterHighlight = -1;
      didRefresh = true;
    }
    const entityLocationSearch = document.querySelector("[data-entity-filter-location]")?.closest(".workspace-search");
    if (!(entityLocationSearch instanceof HTMLElement && entityLocationSearch.contains(target)) && workspaceState.entityLocationFilterOpen) {
      workspaceState.entityLocationFilterOpen = false;
      workspaceState.entityLocationFilterHighlight = -1;
      didRefresh = true;
    }
    if (didRefresh) {
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
      const suggestions = entityLocationFilterSuggestions();
      workspaceState.entityLocationFilterOpen = Boolean(String(target.value || "").trim() && suggestions.length);
      workspaceState.entityLocationFilterHighlight = suggestions.length ? 0 : -1;
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
    if (target.matches("[data-entity-filter-location]")) {
      const suggestions = entityLocationFilterSuggestions();
      if (event.key === "ArrowDown" && suggestions.length) {
        event.preventDefault();
        workspaceState.entityLocationFilterOpen = true;
        workspaceState.entityLocationFilterHighlight = cycleHighlightIndex(workspaceState.entityLocationFilterHighlight, suggestions.length, 1);
        renderWorkspace({ soft: true });
        return;
      }
      if (event.key === "ArrowUp" && suggestions.length) {
        event.preventDefault();
        workspaceState.entityLocationFilterOpen = true;
        workspaceState.entityLocationFilterHighlight = cycleHighlightIndex(workspaceState.entityLocationFilterHighlight, suggestions.length, -1);
        renderWorkspace({ soft: true });
        return;
      }
      if (event.key === "Escape") {
        workspaceState.entityLocationFilterOpen = false;
        workspaceState.entityLocationFilterHighlight = -1;
        renderWorkspace({ soft: true });
        return;
      }
      if (event.key === "Enter" && suggestions.length) {
        event.preventDefault();
        const selected = suggestions[Math.max(0, workspaceState.entityLocationFilterHighlight)];
        applyEntityLocationSuggestion(selected);
        renderWorkspace({ soft: true });
        return;
      }
    }
    if (!target.matches("[data-submission-filter-input]")) return;
    const suggestions = submissionFilterSuggestions();
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      workspaceState.submissionFilterHighlight = cycleHighlightIndex(workspaceState.submissionFilterHighlight, suggestions.length, 1);
      renderWorkspace({ soft: true });
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      workspaceState.submissionFilterHighlight = cycleHighlightIndex(workspaceState.submissionFilterHighlight, suggestions.length, -1);
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
  await hydrateWorkspaceState(force);
  workspaceState.staticSlugs = await loadStaticSlugs().catch(() => []);
  workspaceState.activeTab = chooseInitialTab(workspaceState.activeTab);
  renderWorkspace();
  await maybeResolveUserDeepLink();
  maybeResolveCommentDeepLink();
  workspaceState.keyRequestState = "";
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
  const [publicStateResult, remoteShares] = await Promise.all([
    workspacePublicStateStore.hydrate({ force, reason: force ? "workspace-force" : "workspace-hydrate" }),
    workspaceState.session
      ? loadAdminKeyShares(workspaceState.session.secretKeyHex).catch(() => [])
      : Promise.resolve([])
  ]);
  const publicState = publicStateResult.value;
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

function renderWorkspace(options = {}) {
  const soft = Boolean(options.soft);
  const shell = document.querySelector("[data-workspace-shell]");
  const title = document.querySelector("[data-workspace-title]");
  const lede = document.querySelector("[data-workspace-lede]");
  if (!shell || !title || !lede) return;
  const surfaceDeps = workspaceSurfaceDeps();

  if (!workspaceState.session) {
    const view = renderWorkspaceView({
      workspaceState,
      deps: surfaceDeps
    });
    title.textContent = view.title;
    lede.textContent = view.lede;
    shell.innerHTML = `
      <div class="workspace-tabs" data-workspace-tabs>
        ${view.tabsMarkup}
      </div>
      <div class="workspace-pane" data-workspace-pane>
        ${view.paneMarkup}
      </div>
      <div data-workspace-overlays>
        ${view.overlayMarkup}
      </div>
    `;
    return;
  }
  const view = renderWorkspaceView({
    workspaceState,
    deps: surfaceDeps
  });
  title.textContent = view.title;
  lede.textContent = view.lede;
  const tabs = shell.querySelector("[data-workspace-tabs]");
  const pane = shell.querySelector("[data-workspace-pane]");
  const overlays = shell.querySelector("[data-workspace-overlays]");
  const focusState = soft ? captureWorkspaceFocusState() : null;

  if (soft && tabs && pane && overlays) {
    tabs.innerHTML = view.tabsMarkup;
    pane.innerHTML = view.paneMarkup;
    overlays.innerHTML = view.overlayMarkup;
  } else {
    shell.innerHTML = `
      <div class="workspace-tabs" data-workspace-tabs>
        ${view.tabsMarkup}
      </div>
      <div class="workspace-pane" data-workspace-pane>
        ${view.paneMarkup}
      </div>
      <div data-workspace-overlays>
        ${view.overlayMarkup}
      </div>
    `;
  }
  hydrateWorkspaceEnhancements();
  if (focusState) restoreWorkspaceFocusState(focusState);
}

function workspaceSurfaceDeps() {
  const actionDeps = workspaceActionSurfaceDeps();
  return createWorkspaceSurfaceDeps({
    tabButtons,
    renderTabButton,
    currentUserIsAdmin,
    currentUserHasInboxAccess,
    currentUserPendingKeyRequest,
    currentUser,
    visibleWorkspaceUsers,
    renderKarmaSelectOptions,
    renderLookupCandidate: () => renderWorkspaceLookupCandidate(workspaceState, actionDeps),
    renderUserStatsCard: () => renderWorkspaceUserStatsCard(workspaceState, actionDeps),
    escapeHtml,
    escapeAttribute,
    filterInboxSubmissions,
    renderSubmissionFilterSuggestions,
    renderLoadingState,
    renderSubmissionCard: (item) => renderWorkspaceSubmissionCard(item, workspaceState, actionDeps),
    visibleWorkspaceEntities,
    renderEntityManagementRail,
    renderReviewCard,
    renderReviewedCard,
    filterWorkspaceComments,
    renderModerationComment: (comment) => renderWorkspaceModerationComment(comment, workspaceState, actionDeps),
    renderOwnCommentRow: (comment) => renderWorkspaceOwnCommentRow(comment, workspaceState, actionDeps),
    formatWorkspaceKarma,
    resolveWorkspaceUserKarma,
    renderSiteKeyShareStatus,
    renderSnapshotSummary,
    renderEntityModal: () => renderWorkspaceEntityModal(workspaceState, actionDeps),
    renderUserProfileModal: () => renderWorkspaceUserProfileModal(workspaceState, actionDeps),
    renderUserActionModal: () => renderWorkspaceUserActionModal(workspaceState, actionDeps),
    renderCommentActionModal: () => renderWorkspaceCommentActionModal(workspaceState, actionDeps),
    renderSubmissionModal: () => renderWorkspaceSubmissionModal(workspaceState, actionDeps),
    renderLogPane,
    renderUserCard: (user) => renderWorkspaceUserCard(user, workspaceState, actionDeps),
    renderUserIdentityButton
  });
}

function workspaceActionSurfaceDeps() {
  return {
    currentUserIsAdmin,
    currentUserHasInboxAccess,
    userNeedsCurrentSiteKey,
    resolveWorkspaceUserKarma,
    formatWorkspaceKarma,
    renderUserIdentityButton,
    escapeHtml,
    escapeAttribute,
    workspaceUserStats,
    resolveWorkspaceUser,
    safeWorkspaceAvatarUrl,
    safeWorkspaceSocialLinks,
    profileInitials,
    shortKey,
    trimmed,
    commentToneState,
    resolveWorkspaceCommentKarma,
    deriveSubmissionReviewState,
    renderSubmissionStatusTags,
    resolveEntityDisplayValue,
    describeSubmissionAttachment,
    renderLoadingState
  };
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

function safeWorkspaceAvatarUrl(value) {
  return sanitizeUrl(value, "src");
}

function safeWorkspaceSocialLinks(user) {
  return (Array.isArray(user?.socialLinks) ? user.socialLinks : [])
    .map((link) => sanitizeUrl(link, "href"))
    .filter(Boolean);
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
      isAdmin: publicStateHasAdminPubkey(workspaceState.publicState, directPubkey)
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
  host.innerHTML = renderEntityPickerResultsMarkup(fieldName, query, matches, {
    escapeAttribute,
    escapeHtml
  });
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
  return publicStateHasAdminPubkey(workspaceState.publicState, workspaceState.viewer?.pubkey);
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
  return renderWorkspaceSubmissionFilterSuggestions(workspaceState, {
    escapeHtml,
    submissionFilterSuggestions
  });
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
    if (!visible || !karmaBucketMatches(resolveWorkspaceUserKarma(user.pubkey), karmaBucket)) return false;
    if (!query) return true;
    const haystacks = [
      user.displayName,
      user.username,
      user.bio,
      user.pubkey
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    return haystacks.some((value) => value.includes(query));
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
  return renderWorkspaceEntityManagementRail(workspaceState, {
    escapeHtml,
    entityLocationSuggestions: entityLocationFilterSuggestions
  });
}

function renderEntityLocationFilterSuggestions() {
  return renderWorkspaceEntityLocationFilterSuggestions(workspaceState, {
    escapeHtml,
    entityLocationSuggestions: entityLocationFilterSuggestions
  });
}

function entityLocationFilterSuggestions() {
  const query = String(workspaceState.entityFilters.location || "").trim().toLowerCase();
  if (!query) return [];
  return buildEntityLocationFilterValues()
    .filter((value) => value.toLowerCase().includes(query))
    .slice(0, 8);
}

function buildEntityLocationFilterValues() {
  return [...new Set(
    (workspaceState.publicState?.entities || []).flatMap((entity) => {
      const raw = String(entity?.location || "").trim();
      if (!raw) return [];
      const parts = raw.split(",").map((value) => value.trim()).filter(Boolean);
      if (!parts.length) return [];
      if (parts.length === 1) return parts;
      return parts.filter((value, index) => index > 0 || /county/i.test(value));
    })
  )]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function applyEntityLocationSuggestion(value) {
  workspaceState.entityFilters.location = String(value || "").trim();
  workspaceState.entityLocationFilterOpen = false;
  workspaceState.entityLocationFilterHighlight = -1;
}

function hydrateLookupCandidate(user) {
  const current = (workspaceState.publicState?.users || []).find((item) => item.pubkey === user.pubkey) || {};
  return {
    ...current,
    ...user,
    displayName: user.displayName || current.displayName || user.username || shortKey(user.pubkey),
    username: user.username || current.username || "",
    isAdmin: publicStateHasAdminPubkey(workspaceState.publicState, user.pubkey) || current.isAdmin || false
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
