import { identityPubkeysMatch, publicStateHasAdminPubkey } from "./public-state.js";

function normalizePubkey(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function currentWorkspaceUser(publicState, viewerPubkey = "") {
  const cleanPubkey = String(viewerPubkey || "").trim().toLowerCase();
  if (!cleanPubkey) return null;
  return (publicState?.users || []).find((user) => identityPubkeysMatch(publicState, user?.pubkey, cleanPubkey)) || null;
}

export function workspaceUserIsAdmin(publicState, viewerPubkey = "", fallbackAdminPubkeys = []) {
  const cleanViewerPubkey = normalizePubkey(viewerPubkey);
  if (!cleanViewerPubkey) return false;
  if (publicStateHasAdminPubkey(publicState, cleanViewerPubkey)) return true;
  return (Array.isArray(fallbackAdminPubkeys) ? fallbackAdminPubkeys : [])
    .map((pubkey) => normalizePubkey(pubkey))
    .filter(Boolean)
    .includes(cleanViewerPubkey);
}

export function workspaceHasInboxAccess({ publicState, viewerPubkey = "", siteKeyShare = null, activeSitePubkey = "" } = {}) {
  const cleanSitePubkey = String(activeSitePubkey || "").trim().toLowerCase();
  if (!workspaceUserIsAdmin(publicState, viewerPubkey)) return false;
  if (!siteKeyShare?.sitePubkey) return false;
  return String(siteKeyShare.sitePubkey || "").trim().toLowerCase() === cleanSitePubkey;
}

export function workspacePendingKeyRequest(publicState, viewerPubkey = "", activeSitePubkey = "") {
  const cleanViewerPubkey = String(viewerPubkey || "").trim().toLowerCase();
  const cleanSitePubkey = String(activeSitePubkey || "").trim().toLowerCase();
  if (!cleanViewerPubkey || !cleanSitePubkey) return null;
  return (publicState?.pendingAdminKeyRequests || []).find(
    (request) =>
      String(request?.requester_pubkey || "").trim().toLowerCase() === cleanViewerPubkey &&
      String(request?.site_pubkey || "").trim().toLowerCase() === cleanSitePubkey
  ) || null;
}

export function workspaceTabButtons({ hasSession = false, isAdmin = false } = {}) {
  if (!hasSession) return [];
  const base = [{ id: "profile", label: "Profile" }, { id: "comments", label: "Comments" }];
  if (!isAdmin) return base;
  return [
    { id: "dashboard", label: "Dashboard" },
    ...base,
    { id: "users", label: "User Management" },
    { id: "submissions", label: "Submissions" },
    { id: "posts", label: "Posts" },
    { id: "moderation", label: "Comment Review" },
    { id: "log", label: "Log" }
  ];
}

export function workspaceGroupButtons({ hasSession = false, isAdmin = false } = {}) {
  if (!hasSession) return [];
  if (!isAdmin) return [{ id: "profile", label: "Profile" }];
  return [
    { id: "profile", label: "Profile" },
    { id: "admin", label: "Admin" }
  ];
}

export function workspaceTabGroupId(tabId = "", { isAdmin = false } = {}) {
  const cleanTabId = String(tabId || "").trim().toLowerCase();
  if (!isAdmin) return "profile";
  if (["profile", "comments"].includes(cleanTabId)) return "profile";
  return "admin";
}

export function chooseInitialWorkspaceTab(current, { hasSession = false, isAdmin = false } = {}) {
  const requested = String(current || "").trim().toLowerCase();
  const valid = new Set(workspaceTabButtons({ hasSession, isAdmin }).map((tab) => tab.id));
  if (requested && valid.has(requested)) return requested;
  return isAdmin ? "dashboard" : hasSession ? "profile" : "login";
}

export function captureWorkspaceAccessState({
  viewerPubkey = "",
  isAdmin = false,
  hasInboxAccess = false,
  pendingKeyRequestId = "",
  activeTab = "",
  activeSitePubkey = ""
} = {}) {
  return JSON.stringify({
    sessionPubkey: String(viewerPubkey || "").trim().toLowerCase(),
    admin: Boolean(isAdmin),
    inbox: Boolean(hasInboxAccess),
    request: String(pendingKeyRequestId || "").trim(),
    tab: String(activeTab || "").trim(),
    activeSitePubkey: String(activeSitePubkey || "").trim().toLowerCase()
  });
}

export function createWorkspaceAccessController({
  state,
  viewerController,
  resolveSitePubkey,
  fallbackAdminPubkeys = []
} = {}) {
  function viewerPubkey() {
    return String(viewerController?.sessionPubkey?.() || "").trim().toLowerCase();
  }

  function currentUser() {
    return currentWorkspaceUser(state.publicState, viewerPubkey());
  }

  function isAdmin() {
    return workspaceUserIsAdmin(state.publicState, viewerPubkey(), fallbackAdminPubkeys);
  }

  function activeSitePubkey() {
    return resolveSitePubkey(state.publicState);
  }

  function hasInboxAccess() {
    return workspaceHasInboxAccess({
      publicState: state.publicState,
      viewerPubkey: viewerPubkey(),
      siteKeyShare: state.siteKeyShare,
      activeSitePubkey: activeSitePubkey()
    });
  }

  function pendingKeyRequest() {
    return workspacePendingKeyRequest(state.publicState, viewerPubkey(), activeSitePubkey());
  }

  function tabButtons() {
    return workspaceTabButtons({
      hasSession: Boolean(state.session),
      isAdmin: isAdmin()
    });
  }

  function groupButtons() {
    return workspaceGroupButtons({
      hasSession: Boolean(state.session),
      isAdmin: isAdmin()
    });
  }

  function groupIdForTab(tabId = state.activeTab) {
    return workspaceTabGroupId(tabId, {
      isAdmin: isAdmin()
    });
  }

  function chooseInitialTab(current) {
    return chooseInitialWorkspaceTab(current, {
      hasSession: Boolean(state.session),
      isAdmin: isAdmin()
    });
  }

  function captureAccessState() {
    return captureWorkspaceAccessState({
      viewerPubkey: viewerPubkey(),
      isAdmin: isAdmin(),
      hasInboxAccess: hasInboxAccess(),
      pendingKeyRequestId: pendingKeyRequest()?.id || "",
      activeTab: state.activeTab,
      activeSitePubkey: activeSitePubkey()
    });
  }

  return {
    viewerPubkey,
    currentUser,
    isAdmin,
    activeSitePubkey,
    hasInboxAccess,
    pendingKeyRequest,
    groupButtons,
    groupIdForTab,
    tabButtons,
    chooseInitialTab,
    captureAccessState
  };
}
