import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceTabsController } from "../scripts/features/workspace-tabs.js";

test("workspace tabs controller normalizes tabs and updates the url", () => {
  const state = { activeTab: "login" };
  globalThis.window = {
    location: new URL("https://example.test/admin.html?tab=drafts&user=aux")
  };
  globalThis.history = {
    replaceState: (_state, _title, url) => {
      globalThis.window.location = new URL(String(url));
    }
  };

  const controller = createWorkspaceTabsController({
    state,
    accessController: {
      chooseInitialTab: () => "dashboard",
      currentUser: () => ({ pubkey: "admin-pubkey" }),
      groupButtons: () => [{ id: "profile", label: "Profile" }, { id: "admin", label: "Admin" }],
      groupIdForTab: (tabId) => (["profile", "comments"].includes(tabId) ? "profile" : "admin"),
      hasInboxAccess: () => true,
      isAdmin: () => true,
      pendingKeyRequest: () => null,
      tabButtons: () => [
        { id: "dashboard", label: "Dashboard" },
        { id: "profile", label: "Profile" },
        { id: "comments", label: "Comments" },
        { id: "posts", label: "Posts" }
      ]
    },
    deps: {
      cleanSlug: (value) => String(value || "").trim().toLowerCase(),
      escapeHtml: (value) => String(value || "")
    }
  });

  assert.equal(controller.chooseInitialTab(""), "posts");
  controller.setActiveTab("dashboard");
  assert.equal(state.activeTab, "dashboard");
  assert.equal(globalThis.window.location.search, "?tab=dashboard");
  assert.match(controller.renderTabButton({ id: "dashboard", label: "Dashboard" }), /workspace-tab is-current/);
  controller.setActiveGroup("profile");
  assert.equal(state.activeTab, "profile");
  assert.equal(controller.currentWorkspaceGroup(), "profile");
  assert.match(controller.renderGroupButton({ id: "profile", label: "Profile" }), /workspace-switcher__button is-current/);
});
