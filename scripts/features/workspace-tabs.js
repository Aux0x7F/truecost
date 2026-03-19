export function createWorkspaceTabsController({
  state,
  accessController,
  deps = {}
} = {}) {
  const runtime = {
    cleanSlug: (value) => String(value || "").trim().toLowerCase(),
    escapeHtml: (value) => String(value || ""),
    ...deps
  };

  function tabButtons() {
    return accessController.tabButtons();
  }

  function normalizeTab(value) {
    if (runtime.cleanSlug(value) === "drafts") return "review";
    const valid = new Set(tabButtons().map((tab) => tab.id));
    const requested = runtime.cleanSlug(value);
    if (requested && valid.has(requested)) return requested;
    return accessController.chooseInitialTab(requested);
  }

  function chooseInitialTab(current) {
    const requested = runtime.cleanSlug(new URLSearchParams(window.location.search).get("tab") || "");
    return normalizeTab(requested || current || accessController.chooseInitialTab(current));
  }

  function setActiveTab(tab) {
    state.activeTab = normalizeTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", state.activeTab);
    if (!["users", "comments"].includes(state.activeTab)) {
      url.searchParams.delete("user");
    }
    history.replaceState({}, "", url);
  }

  function renderTabButton(tab) {
    return `<button class="workspace-tab ${state.activeTab === tab.id ? "is-current" : ""}" type="button" data-workspace-tab="${tab.id}">${runtime.escapeHtml(tab.label)}</button>`;
  }

  return {
    chooseInitialTab,
    currentUser: () => accessController.currentUser(),
    currentUserHasInboxAccess: () => accessController.hasInboxAccess(),
    currentUserIsAdmin: () => accessController.isAdmin(),
    currentUserPendingKeyRequest: () => accessController.pendingKeyRequest(),
    normalizeWorkspaceTab: normalizeTab,
    renderTabButton,
    setActiveTab,
    tabButtons
  };
}
