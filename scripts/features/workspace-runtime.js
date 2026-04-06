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
    resolveStoredSession: async () => null,
    getStoredSession: () => null,
    loadAdminKeyShare: async () => null,
    loadAdminKeyShares: async () => [],
    loadCachedInboxSubmissions: async () => [],
    loadCachedSiteKeyShares: async () => [],
    loadInboxSubmissions: async () => [],
    loadPublishedPosts: async () => [],
    loadStaticSlugs: async () => [],
    isMockAdminEnabled: () => false,
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

  async function primeSession(deriveWhenAvailable = false, { resolve = false } = {}) {
    state.session = resolve
      ? await Promise.resolve(runtime.resolveStoredSession()).catch(() => runtime.getStoredSession())
      : runtime.getStoredSession();
    state.viewer = viewerController.primeFromSession(deriveWhenAvailable);
    return state.viewer;
  }

  function sameJson(left, right) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  }

  async function restoreCachedAdminState({ render = false } = {}) {
    const viewerPubkey = accessController.viewerPubkey();
    const activeSitePubkey = accessController.activeSitePubkey();
    const nextSiteKeyShares = runtime.mergeSiteKeyShares(
      await Promise.resolve(
        runtime.loadCachedSiteKeyShares({
          storageNamespace: site?.nostr?.storageNamespace || "",
          viewerPubkey
        })
      ).catch(() => []),
      state.siteKeyShares
    );
    const nextSiteKeyShare = runtime.findSiteKeyShare(nextSiteKeyShares, activeSitePubkey);
    const hadSiteKeyState = !sameJson(state.siteKeyShares, nextSiteKeyShares) || !sameJson(state.siteKeyShare, nextSiteKeyShare);
    state.siteKeyShares = nextSiteKeyShares;
    state.siteKeyShare = nextSiteKeyShare;

    let didChange = hadSiteKeyState;
    if (accessController.isAdmin() && activeSitePubkey) {
      const cachedSubmissions = await Promise.resolve(
        runtime.loadCachedInboxSubmissions({
          storageNamespace: site?.nostr?.storageNamespace || "",
          viewerPubkey,
          sitePubkey: activeSitePubkey
        })
      ).catch(() => []);
      if (Array.isArray(cachedSubmissions) && !sameJson(state.inboxSubmissions, cachedSubmissions)) {
        state.inboxSubmissions = cachedSubmissions;
        didChange = true;
      }
      if (state.inboxLoading) {
        state.inboxLoading = false;
        didChange = true;
      }
    } else {
      if (state.inboxSubmissions.length) {
        state.inboxSubmissions = [];
        didChange = true;
      }
      if (state.inboxLoading) {
        state.inboxLoading = false;
        didChange = true;
      }
    }

    if (render && didChange) {
      hooks.renderWorkspace({ soft: true });
    }
    return didChange;
  }

  async function hydrate(force = false) {
    await primeSession(true);
    const viewerPubkey = accessController.viewerPubkey();
    const cachedShares = await Promise.resolve(
      runtime.loadCachedSiteKeyShares({
        storageNamespace: site?.nostr?.storageNamespace || "",
        viewerPubkey
      })
    ).catch(() => []);
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
    if (!background && hooks.shouldSoftRefreshWorkspace()) {
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
    if (!background && hooks.shouldSoftRefreshWorkspace()) {
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
    if (runtime.isMockAdminEnabled()) {
      clearTimers();
      return;
    }
    clearTimers();
    await primeSession(false, { resolve: true });
    if (!state.session) {
      state.siteKeyShares = [];
      state.siteKeyShare = null;
      state.inboxSubmissions = [];
      state.inboxLoading = false;
      state.publishedPosts = [];
      state.activeTab = accessController.chooseInitialTab("login");
      hooks.renderWorkspace();
      return;
    }

    state.activeTab = accessController.chooseInitialTab(state.activeTab);
    const canRenderImmediately = Boolean(state.publicState || accessController.isAdmin());
    const cachedAdminStatePromise = restoreCachedAdminState({
      render: canRenderImmediately
    });

    if (canRenderImmediately) {
      hooks.renderWorkspace({ soft: true });
    } else {
      hooks.renderWorkspaceLoading("Looking up workspace...");
    }

    await runtime.ensureEventToolsLoaded();
    await cachedAdminStatePromise;
    await hydrate(force);
    const [nextStaticSlugs, nextPublishedPosts] = await Promise.all([
      runtime.loadStaticSlugs().catch(() => state.staticSlugs || []),
      runtime.loadPublishedPosts({ force }).catch(() => state.publishedPosts || [])
    ]);
    state.staticSlugs = nextStaticSlugs;
    state.publishedPosts = Array.isArray(nextPublishedPosts) ? nextPublishedPosts : [];
    state.activeTab = accessController.chooseInitialTab(state.activeTab);
    if (hooks.shouldSoftRefreshWorkspace()) {
      hooks.renderWorkspace({ soft: true });
    }
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
    hooks.renderWorkspace();
    scheduleSync();
  }

  async function sync(force = true) {
    if (runtime.isMockAdminEnabled()) {
      clearTimers();
      return;
    }
    if (state.backgroundSyncInFlight) return;
    if (!document.querySelector("[data-workspace-page]")) return;
    if (document.visibilityState === "hidden") {
      scheduleSync();
      return;
    }
    const resolvedSession = await Promise.resolve(runtime.resolveStoredSession()).catch(() => runtime.getStoredSession());
    if (!resolvedSession) return;
    state.session = resolvedSession;
    state.viewer = viewerController.primeFromSession(false);

    const beforeAccess = accessController.captureAccessState();
    const beforeData = hooks.captureDataState();
    state.backgroundSyncInFlight = true;
    let didRefresh = false;
    try {
      await restoreCachedAdminState({ render: false });
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
      const [nextStaticSlugs, nextPublishedPosts] = await Promise.all([
        runtime.loadStaticSlugs().catch(() => state.staticSlugs || []),
        runtime.loadPublishedPosts({ force }).catch(() => state.publishedPosts || [])
      ]);
      state.staticSlugs = nextStaticSlugs;
      state.publishedPosts = Array.isArray(nextPublishedPosts) ? nextPublishedPosts : [];
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
