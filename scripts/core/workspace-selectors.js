export function createWorkspaceSelectorController({
  state,
  deps = {}
} = {}) {
  const runtime = {
    buildEntityLocationFilterValues: () => [],
    buildWorkspaceUserStats: () => ({ total: 0, active: 0, karmaBuckets: {} }),
    dedupe: (values) => values,
    filterVisibleWorkspaceEntities: () => [],
    filterVisibleWorkspaceUsers: () => [],
    findLocalUserCandidate: () => null,
    karmaBucketForScore: () => "",
    karmaBucketMatches: () => true,
    normalizeUsername: (value) => String(value || "").trim(),
    publicStateHasAdminPubkey: () => false,
    resolveWorkspaceSitePubkey: () => "",
    shortKey: (value) => value,
    ...deps
  };

  function hydrateLookupCandidate(user) {
    const current = (state.publicState?.users || []).find((item) => item.pubkey === user.pubkey) || {};
    return {
      ...current,
      ...user,
      displayName:
        user.displayName ||
        current.displayName ||
        user.username ||
        user.claimedUsername ||
        current.claimedUsername ||
        runtime.shortKey(user.pubkey),
      username: user.username || current.username || "",
      claimedUsername: user.claimedUsername || current.claimedUsername || "",
      usernameConflict: Boolean(user.usernameConflict || current.usernameConflict),
      usernameOwnerPubkey: user.usernameOwnerPubkey || current.usernameOwnerPubkey || "",
      isAdmin: runtime.publicStateHasAdminPubkey(state.publicState, user.pubkey) || current.isAdmin || false
    };
  }

  function findLocalUserCandidate(value) {
    const match = runtime.findLocalUserCandidate(value, {
      users: state.publicState?.users || [],
      normalizeUsername: runtime.normalizeUsername
    });
    return match ? hydrateLookupCandidate(match) : null;
  }

  function visibleWorkspaceUsers() {
    return runtime.filterVisibleWorkspaceUsers({
      publicState: state.publicState,
      query: state.userLookupQuery,
      karmaBucket: state.userFilters.karma,
      resolveWorkspaceUserKarma: runtime.resolveWorkspaceUserKarma,
      karmaBucketMatches: runtime.karmaBucketMatches
    });
  }

  function workspaceUserStats() {
    return runtime.buildWorkspaceUserStats({
      users: visibleWorkspaceUsers(),
      allComments: state.publicState?.allComments || [],
      rawEvents: state.publicState?.rawEvents || [],
      commentVoteKind: runtime.commentVoteKind,
      resolveWorkspaceUserKarma: runtime.resolveWorkspaceUserKarma,
      karmaBucketForScore: runtime.karmaBucketForScore
    });
  }

  function visibleWorkspaceEntities() {
    return runtime.filterVisibleWorkspaceEntities({
      publicState: state.publicState,
      filters: state.entityFilters,
      resolveWorkspaceUser: runtime.resolveWorkspaceUser
    });
  }

  function entityLocationSuggestions() {
    const query = String(state.entityFilters.location || "").trim().toLowerCase();
    if (!query) return [];
    return runtime.buildEntityLocationFilterValues(state.publicState?.entities || [], runtime.dedupe)
      .filter((value) => value.toLowerCase().includes(query))
      .slice(0, 8);
  }

  function applyEntityLocationSuggestion(value) {
    state.entityFilters.location = String(value || "").trim();
    state.entityLocationFilterOpen = false;
    state.entityLocationFilterHighlight = -1;
  }

  return {
    applyEntityLocationSuggestion,
    entityLocationSuggestions,
    findLocalUserCandidate,
    hydrateLookupCandidate,
    resolveWorkspaceSitePubkey: (publicState = state.publicState) => runtime.resolveWorkspaceSitePubkey(publicState),
    visibleWorkspaceEntities,
    visibleWorkspaceUsers,
    workspaceUserStats
  };
}
