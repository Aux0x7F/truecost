export function createWorkspaceRuntime({
  site,
  state,
  viewerController,
  accessController,
  publicStateStore,
  deps = {},
  callbacks = {}
} = {}) {
  const runtime = {
    clearTimeout: (timerId) => window.clearTimeout(timerId),
    ensureEventToolsLoaded: async () => {},
    getStoredSession: () => null,
    loadAdminKeyShare: async () => null,
    loadAdminKeyShares: async () => [],
    loadCachedInboxSubmissions: () => [],
    loadCachedSiteKeyShares: () => [],
    loadInboxSubmissions: async () => [],
    loadStaticSlugs: async () => [],
    mergeSiteKeyShares: (primary, secondary) => [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])],
    findSiteKeyShare: (shares, sitePubkey) => (Array.isArray(shares) ? shares : []).find((share) => share?.sitePubkey === sitePubkey) || null,
    persistCachedInboxSubmissions: () => {},
    persistCachedSiteKeyShares: () => {},
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    ...deps
  };
  const hooks = {
    captureDataState: () => "",
    maybeAutoRespondToKeyRequests: async () => {},
    maybeEnsureCurrentKeyRequest: async () => {},
    maybeOpenAdminChatFromUrl: async () => {},
    maybeResolveCommentDeepLink: () => {},
    maybeResolveUserDeepLink: async () => {},
    renderWorkspace: () => {},
    renderWorkspaceLoading: () => {},
    shouldSoftRefreshWorkspace: () => true,
    ...callbacks
  };

  function clearTimers() {
    if (state.keyRequestTimer) {
      runtime.clearTimeout(state.keyRequestTimer);
      state.keyRequestTimer = 0;
    }
    if (state.backgroundSyncTimer) {
      runtime.clearTimeout(state.backgroundSyncTimer);
      state.backgroundSyncTimer = 0;
    }
  }

  function primeSession(deriveWhenAvailable = false) {
    state.session = runtime.getStoredSession();
    state.viewer = viewerController.primeFromSession(deriveWhenAvailable);
    return state.viewer;
  }

  function restoreCachedAdminState() {
    const viewerPubkey = accessController.viewerPubkey();
    const activeSitePubkey = accessController.activeSitePubkey();
    state.siteKeyShares = runtime.mergeSiteKeyShares(
      runtime.loadCachedSiteKeyShares({
        storageNamespace: site?.nostr?.storageNamespace || "",
        viewerPubkey
      }),
      state.siteKeyShares
    );
    state.siteKeyShare = runtime.findSiteKeyShare(state.siteKeyShares, activeSitePubkey);
    if (accessController.hasInboxAccess()) {
      const cachedSubmissions = runtime.loadCachedInboxSubmissions({
        storageNamespace: site?.nostr?.storageNamespace || "",
        viewerPubkey,
        sitePubkey: activeSitePubkey
      });
      if (Array.isArray(cachedSubmissions) && cachedSubmissions.length) {
        state.inboxSubmissions = cachedSubmissions;
      }
      return;
    }
    state.inboxSubmissions = [];
    state.inboxLoading = false;
  }

  async function hydrate(force = false) {
    primeSession(true);
    const viewerPubkey = accessController.viewerPubkey();
    const cachedShares = runtime.loadCachedSiteKeyShares({
      storageNamespace: site?.nostr?.storageNamespace || "",
      viewerPubkey
    });
    const [publicStateResult, remoteShares] = await Promise.all([
      publicStateStore.hydrate({ force, reason: force ? "workspace-force" : "workspace-hydrate" }),
      state.session
        ? runtime.loadAdminKeyShares(state.session.secretKeyHex).catch(() => [])
        : Promise.resolve([])
    ]);
    state.publicState = publicStateResult.value;
    const activeSitePubkey = accessController.activeSitePubkey();
    let mergedShares = runtime.mergeSiteKeyShares(remoteShares, cachedShares);
    if (state.session && activeSitePubkey && !runtime.findSiteKeyShare(mergedShares, activeSitePubkey)) {
      const currentShare = await runtime.loadAdminKeyShare(state.session.secretKeyHex, activeSitePubkey).catch(() => null);
      mergedShares = runtime.mergeSiteKeyShares(currentShare ? [currentShare, ...mergedShares] : mergedShares, []);
    }
    state.siteKeyShares = mergedShares;
    runtime.persistCachedSiteKeyShares({
      storageNamespace: site?.nostr?.storageNamespace || "",
      viewerPubkey,
      shares: state.siteKeyShares
    });
    state.siteKeyShare = runtime.findSiteKeyShare(state.siteKeyShares, activeSitePubkey);
    return state.publicState;
  }

  async function hydrateInboxSubmissions({ background = false } = {}) {
    if (!accessController.hasInboxAccess()) return;
    if (!background) {
      state.inboxLoading = true;
      hooks.renderWorkspace({ soft: true });
    }
    const nextSubmissions = await runtime.loadInboxSubmissions(state.siteKeyShares).catch(() => state.inboxSubmissions);
    if (Array.isArray(nextSubmissions)) {
      state.inboxSubmissions = nextSubmissions;
      runtime.persistCachedInboxSubmissions({
        storageNamespace: site?.nostr?.storageNamespace || "",
        viewerPubkey: accessController.viewerPubkey(),
        sitePubkey: accessController.activeSitePubkey(),
        submissions: nextSubmissions
      });
    }
    state.inboxLoading = false;
    if (!background) {
      hooks.renderWorkspace({ soft: true });
    }
    await hooks.maybeOpenAdminChatFromUrl();
  }

  function syncDelayMs() {
    if (!state.session) return 0;
    if (accessController.isAdmin() && !accessController.hasInboxAccess()) return 2600;
    if (accessController.isAdmin()) return 6000;
    return 15000;
  }

  function scheduleSync(delay = syncDelayMs()) {
    if (state.backgroundSyncTimer) {
      runtime.clearTimeout(state.backgroundSyncTimer);
      state.backgroundSyncTimer = 0;
    }
    if (!delay || document.visibilityState === "hidden") return;
    state.backgroundSyncTimer = runtime.setTimeout(() => {
      void sync(true);
    }, delay);
  }

  async function refresh(force = false) {
    clearTimers();
    primeSession(false);
    if (!state.session) {
      state.siteKeyShares = [];
      state.siteKeyShare = null;
      state.inboxSubmissions = [];
      state.inboxLoading = false;
      state.activeTab = accessController.chooseInitialTab("login");
      hooks.renderWorkspace();
      return;
    }

    restoreCachedAdminState();
    state.activeTab = accessController.chooseInitialTab(state.activeTab);

    if (state.publicState || accessController.isAdmin()) {
      hooks.renderWorkspace({ soft: true });
    } else {
      hooks.renderWorkspaceLoading("Looking up workspace...");
    }

    await runtime.ensureEventToolsLoaded();
    await hydrate(force);
    state.staticSlugs = await runtime.loadStaticSlugs().catch(() => state.staticSlugs || []);
    state.activeTab = accessController.chooseInitialTab(state.activeTab);
    hooks.renderWorkspace();
    await hooks.maybeResolveUserDeepLink();
    hooks.maybeResolveCommentDeepLink();
    state.keyRequestState = "";
    await hooks.maybeAutoRespondToKeyRequests().catch(() => {});
    await hooks.maybeEnsureCurrentKeyRequest().catch(() => {
      state.keyRequestState = "error";
    });
    if (accessController.hasInboxAccess()) {
      await hydrateInboxSubmissions({ background: false });
    } else {
      state.inboxLoading = false;
      state.inboxSubmissions = [];
    }
    scheduleSync();
  }

  async function sync(force = true) {
    if (state.backgroundSyncInFlight) return;
    if (!document.querySelector("[data-workspace-page]")) return;
    if (document.visibilityState === "hidden") {
      scheduleSync();
      return;
    }
    if (!runtime.getStoredSession()) return;

    const beforeAccess = accessController.captureAccessState();
    const beforeData = hooks.captureDataState();
    state.backgroundSyncInFlight = true;
    let didRefresh = false;
    try {
      await runtime.ensureEventToolsLoaded();
      await hydrate(force);
      state.keyRequestState = "";
      await hooks.maybeAutoRespondToKeyRequests().catch(() => {});
      await hooks.maybeEnsureCurrentKeyRequest().catch(() => {
        state.keyRequestState = "error";
      });
      if (accessController.hasInboxAccess()) {
        await hydrateInboxSubmissions({ background: true });
      } else {
        state.inboxLoading = false;
        state.inboxSubmissions = [];
      }
      state.staticSlugs = await runtime.loadStaticSlugs().catch(() => state.staticSlugs || []);
      state.activeTab = accessController.chooseInitialTab(state.activeTab);
      const afterAccess = accessController.captureAccessState();
      const afterData = hooks.captureDataState();
      if (beforeAccess !== afterAccess) {
        didRefresh = true;
        hooks.renderWorkspace({ soft: true });
      } else if (beforeData !== afterData && hooks.shouldSoftRefreshWorkspace()) {
        didRefresh = true;
        hooks.renderWorkspace({ soft: true });
      }
      await hooks.maybeOpenAdminChatFromUrl();
      await hooks.maybeResolveUserDeepLink();
    } finally {
      state.backgroundSyncInFlight = false;
      if (!didRefresh) scheduleSync();
    }
  }

  return {
    clearTimers,
    hydrate,
    hydrateInboxSubmissions,
    refresh,
    restoreCachedAdminState,
    scheduleSync,
    sync,
    syncDelayMs
  };
}
