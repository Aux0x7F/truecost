import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseInitialWorkspaceTab,
  createWorkspaceAccessController,
  workspaceHasInboxAccess,
  workspaceUserIsAdmin
} from "../scripts/core/workspace-access.js";

test("workspace access controller uses cached session pubkey to expose admin tabs before relay sync", () => {
  const state = {
    session: { pubkey: "admin-pubkey" },
    publicState: {
      admins: [{ pubkey: "admin-pubkey" }],
      siteInfo: { activePubkey: "site-pubkey" },
      pendingAdminKeyRequests: []
    },
    siteKeyShare: { sitePubkey: "site-pubkey" },
    activeTab: ""
  };
  const viewerController = {
    sessionPubkey: () => "admin-pubkey"
  };
  const access = createWorkspaceAccessController({
    state,
    viewerController,
    resolveSitePubkey: (publicState) => publicState?.siteInfo?.activePubkey || ""
  });

  assert.equal(access.isAdmin(), true);
  assert.equal(access.hasInboxAccess(), true);
  assert.deepEqual(
    access.tabButtons().map((tab) => tab.id),
    ["dashboard", "profile", "comments", "users", "submissions", "entities", "review", "log"]
  );
  assert.equal(access.chooseInitialTab(""), "dashboard");
});

test("workspace access helpers keep inbox access scoped to trusted admins and active site key", () => {
  const publicState = {
    admins: ["admin-pubkey"],
    pendingAdminKeyRequests: []
  };

  assert.equal(workspaceUserIsAdmin(publicState, "admin-pubkey"), true);
  assert.equal(
    workspaceHasInboxAccess({
      publicState,
      viewerPubkey: "admin-pubkey",
      siteKeyShare: { sitePubkey: "site-pubkey" },
      activeSitePubkey: "site-pubkey"
    }),
    true
  );
  assert.equal(
    workspaceHasInboxAccess({
      publicState,
      viewerPubkey: "viewer-pubkey",
      siteKeyShare: { sitePubkey: "site-pubkey" },
      activeSitePubkey: "site-pubkey"
    }),
    false
  );
  assert.equal(chooseInitialWorkspaceTab("", { hasSession: true, isAdmin: false }), "profile");
  assert.equal(chooseInitialWorkspaceTab("", { hasSession: false, isAdmin: false }), "login");
});
