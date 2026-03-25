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

  function groupButtons() {
    return accessController.groupButtons ? accessController.groupButtons() : [];
  }

  function currentGroup() {
    return accessController.groupIdForTab ? accessController.groupIdForTab(state.activeTab) : "profile";
  }

  function normalizeTab(value) {
    const requested = runtime.cleanSlug(value);
    const params = new URLSearchParams(window.location.search);
    if (requested === "drafts" || requested === "review") return "posts";
    if (requested === "entities") return "posts";
    if (requested === "comments" && accessController.isAdmin?.() && params.get("user")) return "moderation";
    const valid = new Set(tabButtons().map((tab) => tab.id));
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
    if (!["users", "moderation"].includes(state.activeTab)) {
      url.searchParams.delete("user");
    }
    history.replaceState({}, "", url);
  }

  function setActiveGroup(groupId) {
    const cleanGroupId = runtime.cleanSlug(groupId);
    const nextTab =
      tabButtons().find((tab) => {
        if (!accessController.groupIdForTab) return cleanGroupId === "profile";
        return accessController.groupIdForTab(tab.id) === cleanGroupId;
      })?.id || accessController.chooseInitialTab(state.activeTab);
    setActiveTab(nextTab);
  }

  function renderTabButton(tab) {
    return `<button class="workspace-tab ${state.activeTab === tab.id ? "is-current" : ""}" type="button" data-workspace-tab="${tab.id}">${runtime.escapeHtml(tab.label)}</button>`;
  }

  function renderGroupButton(group) {
    return `<button class="workspace-switcher__button ${currentGroup() === group.id ? "is-current" : ""}" type="button" data-workspace-group="${group.id}">${runtime.escapeHtml(group.label)}</button>`;
  }

  return {
    chooseInitialTab,
    currentUser: () => accessController.currentUser(),
    currentUserHasInboxAccess: () => accessController.hasInboxAccess(),
    currentUserIsAdmin: () => accessController.isAdmin(),
    currentUserPendingKeyRequest: () => accessController.pendingKeyRequest(),
    currentWorkspaceGroup: currentGroup,
    groupButtons,
    normalizeWorkspaceTab: normalizeTab,
    renderGroupButton,
    renderTabButton,
    setActiveGroup,
    setActiveTab,
    tabButtons: () => {
      const groupId = currentGroup();
      return tabButtons().filter((tab) =>
        accessController.groupIdForTab ? accessController.groupIdForTab(tab.id) === groupId : true
      );
    }
  };
}
