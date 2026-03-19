export function createWorkspaceUserLookupController({
  state,
  lookupUsers,
  normalizeDirectPubkey,
  publicStateHasAdminPubkey,
  renderWorkspace,
  clearLinkedUser,
  findLocalUserCandidate,
  hydrateLookupCandidate
} = {}) {
  async function resolve(rawValue, options = {}) {
    const shouldRender = options.render !== false;
    const cleanValue = String(rawValue || "").trim();
    const requestId = state.userLookupRequestId + 1;
    state.userLookupRequestId = requestId;
    state.userLookupQuery = cleanValue;
    state.userLookupResult = null;
    state.userLookupLoading = false;
    if (!cleanValue) {
      state.userDirectStatus = "";
      if (shouldRender) renderWorkspace({ soft: true });
      return;
    }

    const localMatch = findLocalUserCandidate(cleanValue);
    if (localMatch) {
      state.userLookupResult = localMatch;
      state.userDirectStatus = `Found ${localMatch.username ? `@${localMatch.username}` : localMatch.displayName || "this user"} in the current roster.`;
      if (shouldRender) renderWorkspace({ soft: true });
      return;
    }

    state.userLookupLoading = true;
    if (shouldRender) renderWorkspace({ soft: true });
    const remoteMatches = await lookupUsers(cleanValue).catch(() => []);
    if (requestId !== state.userLookupRequestId) return;
    state.userLookupLoading = false;
    if (remoteMatches.length) {
      const match = hydrateLookupCandidate(remoteMatches[0]);
      state.userLookupResult = match;
      state.userDirectStatus = `Found ${match.username ? `@${match.username}` : match.displayName || "this user"} from shared site data.`;
      if (shouldRender) renderWorkspace({ soft: true });
      return;
    }

    const directPubkey = normalizeDirectPubkey(cleanValue);
    if (directPubkey) {
      state.userLookupResult = hydrateLookupCandidate({
        pubkey: directPubkey,
        username: "",
        displayName: "Direct match",
        isAdmin: publicStateHasAdminPubkey(state.publicState, directPubkey)
      });
      state.userDirectStatus = "No profile is visible yet, but this account can still be managed directly.";
      if (shouldRender) renderWorkspace({ soft: true });
      return;
    }

    state.userDirectStatus = "No matching user found yet.";
    if (shouldRender) renderWorkspace({ soft: true });
  }

  function schedule() {
    if (state.userLookupDebounce) {
      window.clearTimeout(state.userLookupDebounce);
      state.userLookupDebounce = 0;
    }
    const query = String(state.userLookupQuery || "").trim();
    if (!query) {
      state.userLookupLoading = false;
      return;
    }
    state.userLookupDebounce = window.setTimeout(() => {
      state.userLookupDebounce = 0;
      void resolve(query);
    }, 260);
  }

  function clear() {
    if (state.userLookupDebounce) {
      window.clearTimeout(state.userLookupDebounce);
      state.userLookupDebounce = 0;
    }
    state.userLookupRequestId += 1;
    state.userLookupQuery = "";
    state.userLookupResult = null;
    state.userLookupLoading = false;
    state.userDirectStatus = "";
    clearLinkedUser();
  }

  function resolveDirectPubkey() {
    return state.userLookupResult?.pubkey || normalizeDirectPubkey(state.userLookupQuery);
  }

  function focus(selector) {
    window.setTimeout(() => {
      const field = document.querySelector(selector);
      if (field instanceof HTMLElement) {
        field.focus({ preventScroll: true });
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
          const length = field.value.length;
          field.setSelectionRange(length, length);
        }
      }
    }, 0);
  }

  return {
    clear,
    focus,
    resolve,
    resolveDirectPubkey,
    schedule
  };
}
