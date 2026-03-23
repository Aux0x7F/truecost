import {
  buildStaleSessionMessage,
  buildUsernameConflictMessage
} from "./session-identity.js";

export function createWorkspaceSessionView({
  state,
  tabs,
  selectors
} = {}) {
  function currentSessionIdentity() {
    return state?.sessionIdentity || null;
  }

  return {
    currentUser() {
      return tabs?.currentUser?.() || null;
    },
    currentSessionIdentity,
    currentSessionUsernameConflict() {
      return currentSessionIdentity()?.usernameIntegrity || {
        conflict: false,
        claimedUsername: "",
        ownerPubkey: ""
      };
    },
    currentRemovedSessionAccount() {
      return currentSessionIdentity()?.removedAccount || null;
    },
    currentRemovedSessionAccountMessage() {
      return String(currentSessionIdentity()?.removedMessage || "").trim();
    },
    currentStaleSessionAccount() {
      return currentSessionIdentity()?.staleSession || null;
    },
    currentStaleSessionMessage(action = "use this account") {
      const sessionIdentity = currentSessionIdentity();
      if (!sessionIdentity?.staleKey) return "";
      return buildStaleSessionMessage({
        claimedUsername: sessionIdentity.staleSession?.claimedUsername || state?.session?.username,
        currentContext: action
      });
    },
    currentSessionUsernameConflictMessage(action = "use this account") {
      const sessionIdentity = currentSessionIdentity();
      if (!sessionIdentity?.usernameConflict) return "";
      return buildUsernameConflictMessage({
        claimedUsername: sessionIdentity.usernameIntegrity?.claimedUsername || state?.session?.username,
        action
      });
    },
    currentUserIsAdmin() {
      return Boolean(tabs?.currentUserIsAdmin?.());
    },
    currentUserHasInboxAccess() {
      return Boolean(tabs?.currentUserHasInboxAccess?.());
    },
    currentUserPendingKeyRequest() {
      return tabs?.currentUserPendingKeyRequest?.() || null;
    },
    visibleWorkspaceUsers() {
      return selectors?.visibleWorkspaceUsers?.() || [];
    },
    workspaceUserStats() {
      return selectors?.workspaceUserStats?.() || {
        total: 0,
        visible: 0,
        removed: 0,
        admins: 0
      };
    },
    visibleWorkspaceEntities() {
      return selectors?.visibleWorkspaceEntities?.() || [];
    }
  };
}
