import test from "node:test";
import assert from "node:assert/strict";

import { renderWorkspaceView } from "../scripts/surfaces/workspace.js";

test("workspace view replaces the active pane with a username conflict warning", () => {
  const view = renderWorkspaceView({
    workspaceState: {
      session: { username: "aux" },
      activeTab: "profile",
      viewer: { pubkey: "b".repeat(64) },
      publicState: {}
    },
    deps: {
      currentUserIsAdmin: () => false,
      currentSessionUsernameConflict: () => ({ conflict: true, claimedUsername: "aux" }),
      currentSessionUsernameConflictMessage: () =>
        "@aux is already claimed by another identity on the network. This session cannot publish from this account. Sign out and choose a unique username.",
      tabButtons: () => [{ id: "profile", label: "Profile" }],
      renderTabButton: (tab) => `<button>${tab.label}</button>`
    }
  });

  assert.match(view.paneMarkup, /Username conflict/);
  assert.match(view.paneMarkup, /Sign out/);
  assert.doesNotMatch(view.paneMarkup, /Save profile/);
});

test("workspace view replaces the active pane with a stale-password warning", () => {
  const view = renderWorkspaceView({
    workspaceState: {
      session: { username: "aux" },
      activeTab: "profile",
      viewer: { pubkey: "a".repeat(64) },
      publicState: {}
    },
    deps: {
      currentUserIsAdmin: () => false,
      currentRemovedSessionAccount: () => null,
      currentStaleSessionAccount: () => ({
        claimedUsername: "aux",
        sessionPubkey: "a".repeat(64),
        currentPubkey: "b".repeat(64)
      }),
      currentStaleSessionMessage: () =>
        "@aux is using an older password for this account. This session cannot publish from this account. Sign out and log in with the current password.",
      currentSessionUsernameConflict: () => ({ conflict: false }),
      tabButtons: () => [{ id: "profile", label: "Profile" }],
      renderTabButton: (tab) => `<button>${tab.label}</button>`
    }
  });

  assert.match(view.paneMarkup, /Password changed/);
  assert.match(view.paneMarkup, /current password/);
  assert.doesNotMatch(view.paneMarkup, /Save profile/);
});

test("workspace view does not render a fake login tab and keeps the profile handle immutable", () => {
  const loggedOutView = renderWorkspaceView({
    workspaceState: {
      session: null,
      activeTab: "login"
    },
    deps: {
      currentUserIsAdmin: () => false,
      tabButtons: () => [],
      renderTabButton: () => ""
    }
  });
  assert.equal(loggedOutView.tabsMarkup, "");
  assert.match(loggedOutView.paneMarkup, /Create\/Login/);
  assert.match(loggedOutView.paneMarkup, /data-login-form/);
  assert.match(loggedOutView.paneMarkup, /minlength="8"/);

  const profileView = renderWorkspaceView({
    workspaceState: {
      session: { username: "aux" },
      activeTab: "profile",
      viewer: { pubkey: "a".repeat(64) },
      publicState: {}
    },
    deps: {
      currentUserIsAdmin: () => false,
      currentUser: () => ({ username: "aux", claimedUsername: "aux", displayName: "Aux", socialLinks: [] }),
      currentSessionUsernameConflict: () => ({ conflict: false }),
      resolveWorkspaceUserKarma: () => 0,
      formatWorkspaceKarma: () => "0",
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  });

  assert.doesNotMatch(profileView.paneMarkup, /data-profile-username-input/);
  assert.doesNotMatch(profileView.paneMarkup, /name="displayName"/);
  assert.doesNotMatch(profileView.paneMarkup, /Display name/);
  assert.match(profileView.paneMarkup, /@aux/);
  assert.match(profileView.paneMarkup, /Usernames are fixed account handles/);
  assert.match(profileView.paneMarkup, /data-open-password-rotation/);
  assert.match(profileView.paneMarkup, /data-password-min-length="8"/);
});

test("workspace view renders both karma and role filters in the user rail", () => {
  const usersView = renderWorkspaceView({
    workspaceState: {
      session: { username: "aux" },
      activeTab: "users",
      viewer: { pubkey: "a".repeat(64) },
      publicState: {},
      userFilters: { karma: "", role: "active" },
      userLookupQuery: "",
      userLookupLoading: false,
      userDirectStatus: ""
    },
    deps: {
      currentUserIsAdmin: () => true,
      currentSessionUsernameConflict: () => ({ conflict: false }),
      visibleWorkspaceUsers: () => [],
      renderUserCard: () => "",
      renderSearchField: () => '<div data-search-field></div>',
      renderKarmaSelectOptions: () => '<option value="">All karma</option>',
      renderRoleSelectOptions: () => '<option value="active">Active</option><option value="admin">Admin</option><option value="removed">Removed</option>',
      renderLookupCandidate: () => "",
      renderUserStatsCard: () => "",
      escapeHtml: (value) => String(value || "")
    }
  });

  assert.match(usersView.paneMarkup, /data-user-filter-karma/);
  assert.match(usersView.paneMarkup, /data-user-filter-role/);
  assert.match(usersView.paneMarkup, />Karma</);
  assert.match(usersView.paneMarkup, />Role</);
  assert.match(usersView.paneMarkup, /Active/);
  assert.match(usersView.paneMarkup, /Removed/);
});

test("workspace view includes the password rotation modal in workspace overlays when provided", () => {
  const profileView = renderWorkspaceView({
    workspaceState: {
      session: { username: "aux" },
      activeTab: "profile",
      viewer: { pubkey: "a".repeat(64) },
      publicState: {}
    },
    deps: {
      currentUserIsAdmin: () => false,
      currentUser: () => ({ username: "aux", claimedUsername: "aux", displayName: "Aux", socialLinks: [] }),
      currentSessionUsernameConflict: () => ({ conflict: false }),
      resolveWorkspaceUserKarma: () => 0,
      formatWorkspaceKarma: () => "0",
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || ""),
      renderPasswordRotationModal: () => '<section data-password-rotation-modal>Change password</section>'
    }
  });

  assert.match(profileView.overlayMarkup, /data-password-rotation-modal/);
  assert.match(profileView.overlayMarkup, /Change password/);
});

test("workspace view replaces the active pane with a removed-account warning", () => {
  const view = renderWorkspaceView({
    workspaceState: {
      session: { username: "aux" },
      activeTab: "profile",
      viewer: { pubkey: "a".repeat(64) },
      publicState: {}
    },
    deps: {
      currentUserIsAdmin: () => false,
      currentRemovedSessionAccount: () => ({
        pubkey: "a".repeat(64),
        claimedUsername: "aux",
        username: "aux",
        removed: true
      }),
      currentRemovedSessionAccountMessage: () =>
        "@aux has been removed from this site and cannot be used here. Contact an operator if you believe this is a mistake.",
      currentSessionUsernameConflict: () => ({ conflict: false }),
      tabButtons: () => [{ id: "profile", label: "Profile" }],
      renderTabButton: (tab) => `<button>${tab.label}</button>`
    }
  });

  assert.match(view.paneMarkup, /Account removed/);
  assert.match(view.paneMarkup, /Access is disabled/);
  assert.match(view.paneMarkup, /Sign out/);
  assert.doesNotMatch(view.paneMarkup, /Save profile/);
});
