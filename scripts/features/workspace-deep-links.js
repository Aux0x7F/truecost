export function createWorkspaceDeepLinkController({
  state,
  deps = {},
  callbacks = {}
} = {}) {
  const runtime = {
    normalizeDirectPubkey: (value) => String(value || "").trim().toLowerCase(),
    ...deps
  };
  const hooks = {
    renderWorkspace: () => {},
    resolveUserLookupQuery: async () => {},
    ...callbacks
  };

  function readLinkedUser() {
    return String(new URLSearchParams(window.location.search).get("user") || "").trim();
  }

  function clearLinkedUser() {
    const url = new URL(window.location.href);
    url.searchParams.delete("user");
    history.replaceState({}, "", url);
  }

  async function maybeResolveUserDeepLink() {
    const query = readLinkedUser();
    if (!query || state.activeTab !== "users") return;
    if (state.userLookupQuery !== query || !state.userLookupResult) {
      await hooks.resolveUserLookupQuery(query, { render: false });
      hooks.renderWorkspace({ soft: true });
    }
    const targetPubkey = state.userLookupResult?.pubkey || runtime.normalizeDirectPubkey(query);
    if (!targetPubkey) return;
    const card = document.querySelector(`[data-user-card="${targetPubkey}"]`);
    if (card instanceof HTMLElement) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.add("roster-item--focus");
      window.setTimeout(() => card.classList.remove("roster-item--focus"), 1800);
    }
  }

  function maybeResolveCommentDeepLink() {
    const query = readLinkedUser();
    if (!query || state.activeTab !== "comments" || state.commentFilters.query) return;
    state.commentFilters.query = query;
    hooks.renderWorkspace({ soft: true });
  }

  return {
    clearWorkspaceLinkedUser: clearLinkedUser,
    maybeResolveCommentDeepLink,
    maybeResolveUserDeepLink,
    readWorkspaceLinkedUser: readLinkedUser
  };
}
