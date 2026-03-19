import { publicStateHasAdminPubkey } from "./public-state.js";

export function currentWorkspaceUser(publicState, viewerPubkey = "") {
  const cleanPubkey = String(viewerPubkey || "").trim().toLowerCase();
  if (!cleanPubkey) return null;
  return (publicState?.users || []).find((user) => user.pubkey === cleanPubkey) || null;
}

export function workspaceUserIsAdmin(publicState, viewerPubkey = "") {
  return publicStateHasAdminPubkey(publicState, viewerPubkey);
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
  if (!hasSession) return [{ id: "login", label: "Log in" }];
  const base = [{ id: "profile", label: "Profile" }, { id: "comments", label: "Comments" }];
  if (!isAdmin) return base;
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
  resolveSitePubkey
} = {}) {
  function viewerPubkey() {
    return String(viewerController?.sessionPubkey?.() || "").trim().toLowerCase();
  }

  function currentUser() {
    return currentWorkspaceUser(state.publicState, viewerPubkey());
  }

  function isAdmin() {
    return workspaceUserIsAdmin(state.publicState, viewerPubkey());
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
    tabButtons,
    chooseInitialTab,
    captureAccessState
  };
}
