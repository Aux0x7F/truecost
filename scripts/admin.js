import SITE from "./core/site-config.js";
import { buildDraftMarkdown, createUniqueSlug, splitTags } from "./core/content-utils.js";
import {
  assertNetworkSessionUsernameIntegrity,
  buildRemovedAccountMessage,
  buildStaleSessionMessage,
  buildUsernameConflictMessage,
  buildUsernameLoginMismatchMessage,
  resolveRemovedSessionAccount,
  resolveNextAvailableUsername,
  resolveStaleSessionAccount,
  resolveSessionUsernameConflict,
  userHasUsernameConflict
} from "./core/account-integrity.js";
import { rememberAccountRotation, rememberCurrentAccountSession } from "./core/account-management.js";
import {
  cleanSlug,
  decryptUploadedBlob,
  deriveIdentity,
  ensureEventToolsLoaded,
  generateSecretKeyHex,
  hasNostrTools,
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
  shortKey,
  uploadPublicBlob
} from "./core/nostr.js";
import { createPublicStateStore } from "./core/public-state-store.js";
import { applyOptimisticIdentityRotation, publicStateHasAdminPubkey } from "./core/public-state.js";
import { createViewerController } from "./core/viewer-controller.js";
import {
  applySubmissionFilterSuggestion as applyWorkspaceSubmissionFilterSuggestion,
  buildEntityLocationFilterValues as buildWorkspaceEntityLocationFilterValues,
  buildWorkspaceUserStats,
  buildSubmissionFilterSuggestions,
  deriveSubmissionReviewState as deriveWorkspaceSubmissionReviewState,
  filterInboxSubmissions as filterWorkspaceInboxSubmissions,
  filterVisibleWorkspaceEntities,
  filterVisibleWorkspaceUsers,
  findLocalUserCandidate as findWorkspaceLocalUserCandidate,
  firstEventTag,
  normalizeDirectPubkey
} from "./core/workspace-data.js";
import {
  applyEntityPickValue,
  createEntityModalDraft,
  matchWorkspaceEntities,
  uniqueWorkspaceLocations
} from "./core/workspace-entity-form.js";
import {
  describeSubmissionAttachment as describeWorkspaceSubmissionAttachment,
  renderSiteKeyShareStatus as describeSiteKeyShareStatus,
  renderSubmissionStatusTags as renderWorkspaceSubmissionStatusTags,
  resolveEntityByNameOrSlug as resolveWorkspaceEntityByNameOrSlug,
  resolveEntityDisplayValue as resolveWorkspaceEntityDisplayValue,
  resolveWorkspaceCommentKarma as projectWorkspaceCommentKarma,
  resolveWorkspaceUser as selectWorkspaceUser,
  resolveWorkspaceUserKarma as projectWorkspaceUserKarma,
  userNeedsCurrentSiteKey as workspaceUserNeedsCurrentSiteKey
} from "./core/workspace-projections.js";
import { draftOwnerPubkey, isPageDraft } from "./core/page-drafts.js";
import {
  collectRecordBranchIds as collectWorkspaceCommentBranchIds,
  regroupRecordsByKey as regroupComments
} from "./core/comment-utils.js";
import { safeAvatarUrl as safeWorkspaceAvatarUrl, safeUserSocialLinks as safeWorkspaceSocialLinks, profileInitials } from "./core/profile-markup.js";
import { renderLoadingState, trimmed } from "./core/rendering.js";
import {
  cycleHighlightIndex
} from "./core/search-controls.js";
import { createWorkspaceAccessController } from "./core/workspace-access.js";
import {
  buildWorkspaceSiteKeyShare,
  clearCachedWorkspaceInboxSubmissions,
  findWorkspaceSiteKeyShare,
  loadCachedWorkspaceInboxSubmissions,
  loadCachedWorkspaceSiteKeyShares,
  mergeWorkspaceSiteKeyShares,
  persistCachedWorkspaceInboxSubmissions,
  persistCachedWorkspaceSiteKeyShares
} from "./core/workspace-cache.js";
import {
  commentToneState,
  formatWorkspaceKarma,
  karmaBucketForScore,
  karmaBucketMatches,
  parseMaybeNumber,
  renderKarmaSelectOptions,
  renderRoleSelectOptions
} from "./core/workspace-formatting.js";
import { createWorkspaceSelectorController } from "./core/workspace-selectors.js";
import { createWorkspaceSiteKeyController } from "./core/workspace-site-key.js";
import { applyOptimisticWorkspaceProfileUpdate } from "./core/workspace-profile.js";
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
import {
  renderLogPane as renderWorkspaceLogPane,
  renderReviewedCard as renderWorkspaceReviewedCard,
  renderReviewCard as renderWorkspaceReviewCard,
  renderSnapshotSummary as renderWorkspaceSnapshotSummary
} from "./surfaces/workspace-review-log.js";
import { renderWorkspaceView } from "./surfaces/workspace.js";
import {
  dedupeStrings as dedupe,
  escapeAttribute,
  escapeHtml,
  lastCommaValue,
  safeJson
} from "./core/text-utils.js";
import { createWorkspaceRuntime } from "./features/workspace-runtime.js";
import { createWorkspaceDeepLinkController } from "./features/workspace-deep-links.js";
import { createWorkspaceInboxController } from "./features/workspace-inbox.js";
import { createWorkspaceMutationController } from "./features/workspace-mutations.js";
import { createWorkspaceAccountController } from "./features/workspace-account.js";
import { createWorkspaceShellController } from "./features/workspace-shell.js";
import { createWorkspaceTabsController } from "./features/workspace-tabs.js";
import { createWorkspaceUserLookupController } from "./features/workspace-user-lookup.js";
import { buildPasswordLengthMessage, openAccountSession, PASSWORD_MIN_LENGTH, rotateAccountPassword } from "./core/account-actions.js";
import { getStoredSession, rebroadcastAccount, rotateAccountCredentials, saveSession, signInWithCredentials, deriveSecretKeyHex } from "./core/session.js";

let workspacePublicStateStore = null;
let workspaceRuntime = null;
let workspaceUserLookup = null;
let workspaceSelectors = null;
let workspaceSiteKeys = null;
let workspaceInbox = null;
let workspaceDeepLinks = null;
let workspaceMutations = null;
let workspaceAccount = null;
let workspaceShell = null;
let workspaceTabs = null;

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
  passwordRotationModal: null,
  commentMenuId: "",
  ownCommentMenuId: "",
  submissionFilterHighlight: -1,
  submissionFilterOpen: false,
  entityLocationFilterHighlight: -1,
  entityLocationFilterOpen: false,
  userFilters: {
    karma: "",
    role: "active"
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

const viewerController = createViewerController({
  state: workspaceState,
  site: SITE,
  deriveIdentity,
  hasNostrTools,
  persistSession: saveSession
});

workspaceSelectors = createWorkspaceSelectorController({
  state: workspaceState,
  deps: {
    buildEntityLocationFilterValues: buildWorkspaceEntityLocationFilterValues,
    buildWorkspaceUserStats,
    dedupe,
    filterVisibleWorkspaceEntities,
    filterVisibleWorkspaceUsers,
    findLocalUserCandidate: findWorkspaceLocalUserCandidate,
    karmaBucketForScore,
    karmaBucketMatches,
    normalizeUsername,
    publicStateHasAdminPubkey,
    resolveWorkspaceSitePubkey: (publicState) => String(resolveSitePubkey(publicState) || "").trim().toLowerCase(),
    resolveWorkspaceUser,
    resolveWorkspaceUserKarma,
    shortKey
  }
});

const workspaceAccess = createWorkspaceAccessController({
  state: workspaceState,
  viewerController,
  resolveSitePubkey: (publicState) => workspaceSelectors.resolveWorkspaceSitePubkey(publicState),
  fallbackAdminPubkeys: [SITE.nostr.rootAdminPubkey]
});

workspaceTabs = createWorkspaceTabsController({
  state: workspaceState,
  accessController: workspaceAccess,
  deps: {
    cleanSlug,
    escapeHtml
  }
});

workspaceSiteKeys = createWorkspaceSiteKeyController({
  site: SITE,
  state: workspaceState,
  accessController: workspaceAccess,
  deps: {
    buildSiteKeyShare: buildWorkspaceSiteKeyShare,
    clearCachedInboxSubmissions: clearCachedWorkspaceInboxSubmissions,
    dedupe,
    deriveIdentity,
    findSiteKeyShare: findWorkspaceSiteKeyShare,
    generateSecretKeyHex,
    mergeSiteKeyShares: mergeWorkspaceSiteKeyShares,
    persistCachedSiteKeyShares: persistCachedWorkspaceSiteKeyShares,
    publishAdminKeyRequest,
    publishAdminKeyShare,
    publishSiteKeyEvent,
    renderSiteKeyShareStatus: describeSiteKeyShareStatus,
    resolveSitePubkey
  }
});

workspaceRuntime = createWorkspaceRuntime({
  site: SITE,
  state: workspaceState,
  viewerController,
  accessController: workspaceAccess,
  publicStateStore: workspacePublicStateStore,
  deps: {
    ensureEventToolsLoaded,
    getStoredSession,
    loadAdminKeyShare,
    loadAdminKeyShares,
    loadCachedInboxSubmissions: ({ storageNamespace, viewerPubkey, sitePubkey }) =>
      loadCachedWorkspaceInboxSubmissions({ storageNamespace, viewerPubkey, sitePubkey }),
    loadCachedSiteKeyShares: ({ storageNamespace, viewerPubkey }) =>
      loadCachedWorkspaceSiteKeyShares({ storageNamespace, viewerPubkey, deriveIdentity }),
    loadInboxSubmissions,
    loadStaticSlugs,
    mergeSiteKeyShares: mergeWorkspaceSiteKeyShares,
    findSiteKeyShare: findWorkspaceSiteKeyShare,
    persistCachedInboxSubmissions: ({ storageNamespace, viewerPubkey, sitePubkey, submissions }) =>
      persistCachedWorkspaceInboxSubmissions({ storageNamespace, viewerPubkey, sitePubkey, submissions }),
    persistCachedSiteKeyShares: ({ storageNamespace, viewerPubkey, shares }) =>
      persistCachedWorkspaceSiteKeyShares({ storageNamespace, viewerPubkey, shares })
  },
  callbacks: {
    captureDataState: () => workspaceShell.captureDataState(),
    maybeAutoRespondToKeyRequests: () => workspaceSiteKeys.maybeAutoRespondToKeyRequests(),
    maybeEnsureCurrentKeyRequest: () =>
      workspaceSiteKeys.maybeEnsureCurrentKeyRequest({ onRefresh: () => workspaceRuntime.sync(true) }),
    maybeOpenAdminChatFromUrl: () => workspaceInbox.maybeOpenAdminChatFromUrl(),
    maybeResolveCommentDeepLink: () => workspaceDeepLinks.maybeResolveCommentDeepLink(),
    maybeResolveUserDeepLink: () => workspaceDeepLinks.maybeResolveUserDeepLink(),
    renderWorkspace: (options) => workspaceShell.render(options),
    renderWorkspaceLoading: (message) => workspaceShell.renderLoading(message),
    shouldSoftRefreshWorkspace
  }
});

workspaceUserLookup = createWorkspaceUserLookupController({
  state: workspaceState,
  lookupUsers,
  normalizeDirectPubkey,
  publicStateHasAdminPubkey,
  renderWorkspace,
  clearLinkedUser: () => workspaceDeepLinks.clearWorkspaceLinkedUser(),
  findLocalUserCandidate: (value) => workspaceSelectors.findLocalUserCandidate(value),
  hydrateLookupCandidate: (user) => workspaceSelectors.hydrateLookupCandidate(user)
});

workspaceDeepLinks = createWorkspaceDeepLinkController({
  state: workspaceState,
  deps: {
    normalizeDirectPubkey
  },
  callbacks: {
    renderWorkspace,
    resolveUserLookupQuery
  }
});

workspaceInbox = createWorkspaceInboxController({
  state: workspaceState,
  accessController: workspaceAccess,
  deps: {
    loadSubmissionThread,
    publishSubmissionChat,
    publishTaggedJson
  },
  callbacks: {
    deriveSubmissionReviewState,
    hydrateInboxSubmissions,
    refreshWorkspace,
    renderWorkspace
  }
});

workspaceMutations = createWorkspaceMutationController({
  site: SITE,
  state: workspaceState,
  accessController: workspaceAccess,
  deps: {
    buildDraftMarkdown,
    createUniqueSlug,
    dedupe,
    draftOwnerPubkey,
    isPageDraft,
    parseMaybeNumber,
    publishAdminKeyShare,
    publishTaggedJson,
    splitTags
  },
  callbacks: {
    applyLocalCommentModeration,
    deriveSubmissionReviewState,
    refreshWorkspace,
    renderWorkspace,
    resolveEntityByNameOrSlug,
    resolveWorkspaceUser,
    rotateSiteInboxKey,
    userNeedsCurrentSiteKey
  }
});

workspaceShell = createWorkspaceShellController({
  state: workspaceState,
  deps: {
    renderLoadingState,
    renderWorkspaceView
  },
  callbacks: {
    createSurfaceDeps: workspaceSurfaceDeps,
    hydrateWorkspaceEnhancements
  }
});

workspaceAccount = createWorkspaceAccountController({
  site: SITE,
  state: workspaceState,
  publicStateStore: workspacePublicStateStore,
  deps: {
    applyOptimisticIdentityRotation,
    applyOptimisticWorkspaceProfileUpdate,
    assertNetworkSessionUsernameIntegrity,
    buildPasswordLengthMessage,
    buildSiteKeyShare: buildWorkspaceSiteKeyShare,
    buildUsernameLoginMismatchMessage,
    deriveIdentity,
    deriveSecretKeyHex,
    escapeAttribute,
    escapeHtml,
    findSiteKeyShare: findWorkspaceSiteKeyShare,
    lookupUsers,
    mergeSiteKeyShares: mergeWorkspaceSiteKeyShares,
    normalizeUsername,
    openAccountSession,
    PASSWORD_MIN_LENGTH,
    persistCachedSiteKeyShares: persistCachedWorkspaceSiteKeyShares,
    publishAdminKeyShare,
    rebroadcastAccount,
    rememberAccountRotation,
    rememberCurrentAccountSession,
    resolveNextAvailableUsername,
    rotateAccountCredentials,
    rotateAccountPassword,
    saveSession,
    signInWithCredentials,
    uploadPublicBlob
  },
  callbacks: {
    currentUser,
    currentUserIsAdmin,
    notifySessionChanged: () => window.dispatchEvent(new CustomEvent("truecost:session-changed")),
    refreshWorkspace,
    renderWorkspace,
    resolveWorkspaceSitePubkey: (publicState) => workspaceSelectors.resolveWorkspaceSitePubkey(publicState),
    syncWorkspace: (force = true) => workspaceRuntime.sync(force)
  }
});

document.addEventListener("DOMContentLoaded", () => {
  if (!document.querySelector("[data-workspace-page]")) return;
  bindWorkspace();
  window.addEventListener("truecost:session-changed", handleWorkspaceSessionChanged);
  document.addEventListener("visibilitychange", handleWorkspaceVisibilityChange);
  window.addEventListener("focus", handleWorkspaceWindowFocus);
  void refreshWorkspace();
});

async function handleWorkspaceSessionChanged() {
  workspaceState.session = getStoredSession();
  workspaceState.viewer = null;
  workspaceState.passwordRotationModal = null;
  await refreshWorkspace(true);
}

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
      void workspaceInbox.markSubmissionViewed(submissionId, SITE.nostr.kinds);
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
      workspaceDeepLinks.clearWorkspaceLinkedUser();
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
      workspaceSelectors.applyEntityLocationSuggestion(
        entityLocationSuggestion.getAttribute("data-entity-location-suggestion") || ""
      );
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

    const passwordRotationTrigger = target.closest("[data-open-password-rotation]");
    if (passwordRotationTrigger) {
      workspaceState.passwordRotationModal = {
        status: "",
        state: "",
        pending: false
      };
      renderWorkspace();
      return;
    }

    const appendUsernameAction = target.closest("[data-append-next-available-username]");
    if (appendUsernameAction) {
      await workspaceAccount.handleAppendNextAvailableUsername(appendUsernameAction);
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
      await workspaceInbox.hydrateChatModal();
      return;
    }

    if (target.closest("[data-modal-close]")) {
      workspaceState.entityModal = null;
      workspaceState.chatModal = null;
      workspaceState.userModalPubkey = "";
      workspaceState.userActionModal = null;
      workspaceState.commentActionModal = null;
      workspaceState.submissionModal = null;
      workspaceState.passwordRotationModal = null;
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
      const nextOpen = Boolean(
        String(target.value || "").trim() && workspaceSelectors.entityLocationSuggestions().length
      );
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
      await workspaceAccount.handleLogin(form);
      return;
    }
    if (form.matches("[data-profile-form]")) {
      await workspaceAccount.handleProfileSave(form);
      return;
    }
    if (form.matches("[data-password-rotation-form]")) {
      await workspaceAccount.handlePasswordRotation(form);
      return;
    }
    if (form.matches("[data-entity-form]")) {
      await handleEntitySave(form);
      return;
    }
    if (form.matches("[data-chat-form]")) {
      await workspaceInbox.handleChatSend(form);
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
    if (target.matches('[data-login-form] [name="username"], [data-login-form] [name="password"]')) {
      workspaceAccount.renderLoginStatusPreview(target.closest("form"));
      return;
    }
    if (target.matches("[data-comment-filter-query]")) {
      workspaceState.commentFilters.query = String(target.value || "");
      workspaceDeepLinks.clearWorkspaceLinkedUser();
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
    if (target.matches("[data-user-filter-role]")) {
      workspaceState.userFilters.role = String(target.value || "").trim().toLowerCase();
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
      const suggestions = workspaceSelectors.entityLocationSuggestions();
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
      workspaceDeepLinks.clearWorkspaceLinkedUser();
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
      const suggestions = workspaceSelectors.entityLocationSuggestions();
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
        workspaceSelectors.applyEntityLocationSuggestion(selected);
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
  await workspaceRuntime.refresh(force);
}

function renderWorkspaceLoading(message) {
  return workspaceShell.renderLoading(message);
}

function handleWorkspaceVisibilityChange() {
  if (document.visibilityState === "visible") {
    void workspaceRuntime.sync(true);
  }
}

function handleWorkspaceWindowFocus() {
  void workspaceRuntime.sync(true);
}

function captureWorkspaceDataState() {
  return workspaceShell.captureDataState();
}

function renderWorkspace(options = {}) {
  return workspaceShell.render(options);
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
    currentRemovedSessionAccount,
    currentRemovedSessionAccountMessage,
    currentStaleSessionAccount,
    currentStaleSessionMessage,
    currentSessionUsernameConflict,
    currentSessionUsernameConflictMessage,
    visibleWorkspaceUsers: () => workspaceSelectors.visibleWorkspaceUsers(),
    renderKarmaSelectOptions,
    renderRoleSelectOptions,
    renderLookupCandidate: () => renderWorkspaceLookupCandidate(workspaceState, actionDeps),
    renderUserStatsCard: () => renderWorkspaceUserStatsCard(workspaceState, actionDeps),
    escapeHtml,
    escapeAttribute,
    filterInboxSubmissions,
    renderSubmissionFilterSuggestions,
    renderLoadingState,
    renderSubmissionCard: (item) => renderWorkspaceSubmissionCard(item, workspaceState, actionDeps),
    visibleWorkspaceEntities: () => workspaceSelectors.visibleWorkspaceEntities(),
    renderEntityManagementRail: () => renderEntityManagementRail(),
    renderReviewCard: (draft) => renderWorkspaceReviewCard(draft, actionDeps),
    renderReviewedCard: (draft) => renderWorkspaceReviewedCard(draft),
    filterWorkspaceComments,
    renderModerationComment: (comment) => renderWorkspaceModerationComment(comment, workspaceState, actionDeps),
    renderOwnCommentRow: (comment) => renderWorkspaceOwnCommentRow(comment, workspaceState, actionDeps),
    formatWorkspaceKarma,
    resolveWorkspaceUserKarma,
    renderSiteKeyShareStatus,
    renderSnapshotSummary: renderWorkspaceSnapshotSummary,
    renderEntityModal: () => renderWorkspaceEntityModal(workspaceState, actionDeps),
    renderUserProfileModal: () => renderWorkspaceUserProfileModal(workspaceState, actionDeps),
    renderUserActionModal: () => renderWorkspaceUserActionModal(workspaceState, actionDeps),
    renderCommentActionModal: () => renderWorkspaceCommentActionModal(workspaceState, actionDeps),
    renderSubmissionModal: () => renderWorkspaceSubmissionModal(workspaceState, actionDeps),
    renderPasswordRotationModal: () => workspaceAccount.renderPasswordRotationModal(),
    renderLogPane: () => renderWorkspaceLogPane(workspaceState, actionDeps),
    renderUserCard: (user) => renderWorkspaceUserCard(user, workspaceState, actionDeps),
    renderUserIdentityButton,
    passwordMinLength: workspaceAccount.passwordMinLength
  });
}

function workspaceActionSurfaceDeps() {
  return {
    currentUserIsAdmin,
    currentUserHasInboxAccess,
    userNeedsCurrentSiteKey,
    userHasUsernameConflict,
    resolveWorkspaceUserKarma,
    formatWorkspaceKarma,
    renderUserIdentityButton,
    escapeHtml,
    escapeAttribute,
    workspaceUserStats: () => workspaceSelectors.workspaceUserStats(),
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
    renderLoadingState,
    logKinds: [
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
    ],
    logLabels: {
      [SITE.nostr.kinds.snapshot]: "Snapshot",
      [SITE.nostr.kinds.adminClaim]: "Root admin claim",
      [SITE.nostr.kinds.adminRole]: "Admin role change",
      [SITE.nostr.kinds.userMod]: "User moderation",
      [SITE.nostr.kinds.snapshotRequest]: "Snapshot request",
      [SITE.nostr.kinds.entity]: "Entity update",
      [SITE.nostr.kinds.draft]: "Post update",
      [SITE.nostr.kinds.commentMod]: "Comment moderation",
      [SITE.nostr.kinds.submissionStatus]: "Submission status",
      [SITE.nostr.kinds.adminKeyShare]: "Site key share",
      [SITE.nostr.kinds.siteKey]: "Site key rotation"
    },
    siteKinds: SITE.nostr.kinds,
    firstTag
  };
}

function captureWorkspaceFocusState() {
  return workspaceShell.captureFocusState();
}

function restoreWorkspaceFocusState(focusState) {
  return workspaceShell.restoreFocusState(focusState);
}

function renderUserIdentityButton(user, fallbackPubkey = user?.pubkey || "") {
  const cleanPubkey = String(fallbackPubkey || user?.pubkey || "").trim().toLowerCase();
  const displayName = user?.displayName || user?.username || user?.claimedUsername || shortKey(cleanPubkey);
  const avatarUrl = safeWorkspaceAvatarUrl(user?.avatarUrl || "");
  const isViewer = cleanPubkey && cleanPubkey === String(workspaceState.viewer?.pubkey || "").trim().toLowerCase();
  const avatar = avatarUrl
    ? `<span class="workspace-user__avatar workspace-user__avatar--image"><img src="${escapeAttribute(avatarUrl)}" alt="${escapeAttribute(displayName)}"></span>`
    : `<span class="workspace-user__avatar">${escapeHtml(profileInitials(displayName))}</span>`;
  return `
    <button class="user-link workspace-user-link${isViewer ? " is-self" : ""}" type="button" data-open-user-modal="${escapeAttribute(cleanPubkey)}" data-user-pubkey="${escapeAttribute(cleanPubkey)}">
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
      author?.username,
      author?.claimedUsername
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    return haystacks.some((value) => value.includes(query));
  });
}

function resolveWorkspaceUser(pubkey) {
  return selectWorkspaceUser(workspaceState.publicState, pubkey);
}

function resolveWorkspaceCommentKarma(commentOrId) {
  return projectWorkspaceCommentKarma(workspaceState.publicState, commentOrId);
}

function resolveWorkspaceUserKarma(pubkey) {
  return projectWorkspaceUserKarma(workspaceState.publicState, pubkey);
}

function userNeedsCurrentSiteKey(user) {
  return workspaceUserNeedsCurrentSiteKey({
    user,
    publicState: workspaceState.publicState,
    siteKeyShare: workspaceState.siteKeyShare,
    activeSitePubkey: activeSitePubkey()
  });
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
  await workspaceUserLookup.resolve(rawValue);
}

async function resolveUserLookupQuery(rawValue, options = {}) {
  await workspaceUserLookup.resolve(rawValue, options);
}

function scheduleUserLookup() {
  workspaceUserLookup.schedule();
}

function clearWorkspaceUserLookup() {
  workspaceUserLookup.clear();
}

function focusWorkspaceSearchField(selector) {
  workspaceUserLookup.focus(selector);
}

async function performUserAction(targetPubkey, action, mode = "") {
  return workspaceMutations.performUserAction(targetPubkey, action, mode);
}

async function handleEntitySave(form) {
  return workspaceMutations.handleEntitySave(form);
}

async function handleEntityAction(button) {
  return workspaceMutations.handleEntityAction(button);
}

async function handleCommentAction(button) {
  return workspaceMutations.handleCommentAction(button);
}

async function handleCommentActionForm(form) {
  return workspaceMutations.handleCommentActionForm(form);
}

async function handleReviewAction(button) {
  return workspaceMutations.handleReviewAction(button);
}

async function handleDraftSave(form) {
  return workspaceMutations.handleDraftSave(form);
}

async function handleSubmissionAction(button) {
  return workspaceMutations.handleSubmissionAction(button);
}

async function handleSnapshotRequest(button) {
  return workspaceMutations.handleSnapshotRequest(button);
}

async function hydrateChatModal() {
  return workspaceInbox.hydrateChatModal();
}

async function hydrateInboxSubmissions(options = {}) {
  await workspaceRuntime.hydrateInboxSubmissions(options);
}

async function maybeOpenAdminChatFromUrl() {
  return workspaceInbox.maybeOpenAdminChatFromUrl();
}

async function markSubmissionViewed(submissionId) {
  return workspaceInbox.markSubmissionViewed(submissionId, SITE.nostr.kinds);
}

async function maybeResolveUserDeepLink() {
  return workspaceDeepLinks.maybeResolveUserDeepLink();
}

function maybeResolveCommentDeepLink() {
  return workspaceDeepLinks.maybeResolveCommentDeepLink();
}

function readWorkspaceLinkedUser() {
  return workspaceDeepLinks.readWorkspaceLinkedUser();
}

function clearWorkspaceLinkedUser() {
  return workspaceDeepLinks.clearWorkspaceLinkedUser();
}

async function handleChatSend(form) {
  return workspaceInbox.handleChatSend(form);
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
  workspaceAccount.renderLoginStatusPreview(document.querySelector("[data-login-form]"));
}

function createEntityModalState(trigger) {
  const fieldName = trigger?.getAttribute?.("data-entity-seed-from") || "";
  const sourceField = fieldName ? document.querySelector(`[name="${fieldName}"]`) : null;
  const sourceValue = sourceField instanceof HTMLInputElement ? sourceField.value.trim() : "";
  const locationField = document.querySelector('[name="location"]');
  const locationValue = locationField instanceof HTMLInputElement ? locationField.value.trim() : "";
  return createEntityModalDraft({
    trigger,
    entities: workspaceState.publicState?.entities || [],
    sourceValue,
    locationValue
  });
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
  input.value = applyEntityPickValue({
    fieldName,
    currentValue: input.value,
    entity,
    splitTags,
    resolveEntityByNameOrSlug
  });
  hydrateWorkspaceEnhancements();
}

function matchEntities(query) {
  return matchWorkspaceEntities(workspaceState.publicState?.approvedEntities || [], query);
}

function uniqueLocations() {
  return uniqueWorkspaceLocations(workspaceState.publicState?.entities || [], dedupe);
}

function resolveEntityDisplayValue(value) {
  return resolveWorkspaceEntityDisplayValue(workspaceState.publicState, value);
}

function chooseInitialTab(current) {
  return workspaceTabs.chooseInitialTab(current);
}

function setActiveTab(tab) {
  return workspaceTabs.setActiveTab(tab);
}

function normalizeWorkspaceTab(value) {
  return workspaceTabs.normalizeWorkspaceTab(value);
}

function tabButtons() {
  return workspaceTabs.tabButtons();
}

function renderTabButton(tab) {
  return workspaceTabs.renderTabButton(tab);
}

function currentUser() {
  return workspaceTabs.currentUser();
}

function currentSessionUsernameConflict() {
  return resolveSessionUsernameConflict(workspaceState.publicState, workspaceState.session);
}

function currentRemovedSessionAccount() {
  return resolveRemovedSessionAccount(workspaceState.publicState, workspaceState.session);
}

function currentRemovedSessionAccountMessage() {
  const removedAccount = currentRemovedSessionAccount();
  if (!removedAccount) return "";
  return buildRemovedAccountMessage({
    claimedUsername: removedAccount.claimedUsername || removedAccount.username || workspaceState.session?.username
  });
}

function currentStaleSessionAccount() {
  return resolveStaleSessionAccount(workspaceState.publicState, workspaceState.session);
}

function currentStaleSessionMessage(action = "use this account") {
  const staleSession = currentStaleSessionAccount();
  if (!staleSession) return "";
  return buildStaleSessionMessage({
    claimedUsername: staleSession.claimedUsername || workspaceState.session?.username,
    currentContext: action
  });
}

function currentSessionUsernameConflictMessage(action = "use this account") {
  const integrity = currentSessionUsernameConflict();
  if (!integrity.conflict) return "";
  return buildUsernameConflictMessage({
    claimedUsername: integrity.claimedUsername,
    action
  });
}

function currentUserIsAdmin() {
  return workspaceTabs.currentUserIsAdmin();
}

function currentUserHasInboxAccess() {
  return workspaceTabs.currentUserHasInboxAccess();
}

function currentUserPendingKeyRequest() {
  return workspaceTabs.currentUserPendingKeyRequest();
}

function resolveEntityByNameOrSlug(value) {
  return resolveWorkspaceEntityByNameOrSlug(workspaceState.publicState, value);
}

function deriveSubmissionReviewState(item) {
  return deriveWorkspaceSubmissionReviewState({
    item,
    rawEvents: workspaceState.publicState?.rawEvents || [],
    viewerPubkey: workspaceAccess.viewerPubkey(),
    submissionStatusKind: SITE.nostr.kinds.submissionStatus,
    safeJson
  });
}

function renderSubmissionStatusTags(reviewState) {
  return renderWorkspaceSubmissionStatusTags(reviewState);
}

function describeSubmissionAttachment(attachment) {
  return describeWorkspaceSubmissionAttachment(attachment);
}

function filterInboxSubmissions(items) {
  return filterWorkspaceInboxSubmissions({
    items,
    query: workspaceState.submissionFilters.query,
    rawEvents: workspaceState.publicState?.rawEvents || [],
    viewerPubkey: workspaceAccess.viewerPubkey(),
    submissionStatusKind: SITE.nostr.kinds.submissionStatus,
    safeJson,
    resolveWorkspaceUser,
    resolveEntityDisplayValue
  });
}

function renderSubmissionFilterSuggestions() {
  return renderWorkspaceSubmissionFilterSuggestions(workspaceState, {
    escapeHtml,
    submissionFilterSuggestions
  });
}

function submissionFilterSuggestions() {
  return buildSubmissionFilterSuggestions({
    query: workspaceState.submissionFilters.query,
    items: workspaceState.inboxSubmissions,
    resolveWorkspaceUser,
    resolveEntityDisplayValue
  });
}

function applySubmissionFilterSuggestion(token) {
  return applyWorkspaceSubmissionFilterSuggestion(workspaceState.submissionFilters.query, token);
}

function firstTag(event, key) {
  return firstEventTag(event, key);
}

function activeSitePubkey() {
  return workspaceSiteKeys.activeSitePubkey();
}

function findSiteKeyShare(sitePubkey = "") {
  return workspaceSiteKeys.findSiteKeyShare(sitePubkey);
}

function renderSiteKeyShareStatus() {
  return workspaceSiteKeys.renderSiteKeyShareStatus();
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
  return workspaceSiteKeys.rotateSiteInboxKey(excludedPubkeys, reason);
}

async function maybeAutoRespondToKeyRequests() {
  return workspaceSiteKeys.maybeAutoRespondToKeyRequests();
}

async function maybeEnsureCurrentKeyRequest() {
  return workspaceSiteKeys.maybeEnsureCurrentKeyRequest({ onRefresh: () => workspaceRuntime.sync(true) });
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

function resolveWorkspaceSitePubkey(publicState = workspaceState.publicState) {
  return workspaceSelectors.resolveWorkspaceSitePubkey(publicState);
}

function resolveDirectUserPubkey() {
  return workspaceUserLookup.resolveDirectPubkey();
}

function findLocalUserCandidate(value) {
  return workspaceSelectors.findLocalUserCandidate(value);
}

function visibleWorkspaceUsers() {
  return workspaceSelectors.visibleWorkspaceUsers();
}

function workspaceUserStats() {
  return workspaceSelectors.workspaceUserStats();
}

function visibleWorkspaceEntities() {
  return workspaceSelectors.visibleWorkspaceEntities();
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
    entityLocationSuggestions: () => workspaceSelectors.entityLocationSuggestions()
  });
}

function entityLocationFilterSuggestions() {
  return workspaceSelectors.entityLocationSuggestions();
}

function applyEntityLocationSuggestion(value) {
  return workspaceSelectors.applyEntityLocationSuggestion(value);
}

function hydrateLookupCandidate(user) {
  return workspaceSelectors.hydrateLookupCandidate(user);
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
