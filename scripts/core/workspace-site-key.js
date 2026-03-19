export function createWorkspaceSiteKeyController({
  site,
  state,
  accessController,
  deps = {}
} = {}) {
  const runtime = {
    buildSiteKeyShare: () => null,
    clearCachedInboxSubmissions: () => {},
    dedupe: (values) => values,
    deriveIdentity: () => null,
    findSiteKeyShare: () => null,
    generateSecretKeyHex: async () => "",
    mergeSiteKeyShares: (primary) => primary || [],
    persistCachedSiteKeyShares: () => {},
    publishAdminKeyRequest: async () => {},
    publishAdminKeyShare: async () => {},
    publishSiteKeyEvent: async () => {},
    renderSiteKeyShareStatus: () => "",
    resolveSitePubkey: () => "",
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    ...deps
  };

  function activeSitePubkey() {
    return String(runtime.resolveSitePubkey(state.publicState) || "").trim().toLowerCase();
  }

  function findShare(sitePubkey = "") {
    const targetPubkey = String(sitePubkey || "").trim().toLowerCase() || activeSitePubkey();
    return runtime.findSiteKeyShare(state.siteKeyShares, targetPubkey);
  }

  function renderStatus() {
    return runtime.renderSiteKeyShareStatus({
      siteKeyShare: state.siteKeyShare,
      siteKeyShares: state.siteKeyShares,
      pendingKeyRequest: accessController.pendingKeyRequest(),
      keyRequestState: state.keyRequestState
    });
  }

  async function rotate(excludedPubkeys = [], reason = "rotation") {
    if (!state.session || !accessController.isAdmin()) {
      throw new Error("Only an active admin can rotate the shared inbox key.");
    }
    const nextSiteSecretKeyHex = await runtime.generateSecretKeyHex();
    const previousSitePubkey = activeSitePubkey();
    const sharedAt = new Date().toISOString();
    const recipients = runtime.dedupe(
      (state.publicState?.admins || []).filter((pubkey) => !excludedPubkeys.includes(pubkey))
    );
    await runtime.publishSiteKeyEvent(state.session.secretKeyHex, nextSiteSecretKeyHex, {
      previousSitePubkey,
      reason
    });
    for (const pubkey of recipients) {
      await runtime.publishAdminKeyShare(state.session.secretKeyHex, pubkey, nextSiteSecretKeyHex);
    }
    const currentShare = runtime.buildSiteKeyShare(
      nextSiteSecretKeyHex,
      {
        senderPubkey: state.viewer?.pubkey || "",
        sharedAt
      },
      runtime.deriveIdentity
    );
    state.siteKeyShares = runtime.mergeSiteKeyShares([currentShare, ...state.siteKeyShares], []);
    state.siteKeyShare = currentShare;
    runtime.persistCachedSiteKeyShares({
      storageNamespace: site?.nostr?.storageNamespace,
      viewerPubkey: accessController.viewerPubkey(),
      shares: state.siteKeyShares
    });
    state.keyRequestState = "";
    runtime.clearCachedInboxSubmissions({
      storageNamespace: site?.nostr?.storageNamespace,
      viewerPubkey: accessController.viewerPubkey(),
      sitePubkey: previousSitePubkey
    });
    if (state.publicState?.siteInfo) {
      state.publicState.siteInfo = {
        ...state.publicState.siteInfo,
        activePubkey: currentShare.sitePubkey
      };
    }
  }

  async function maybeAutoRespond() {
    if (!accessController.hasInboxAccess() || !state.session || !state.siteKeyShare) return;
    for (const request of state.publicState?.pendingAdminKeyRequests || []) {
      if (!request || request.requester_pubkey === state.viewer?.pubkey) continue;
      if (state.respondedKeyRequests.has(request.id)) continue;
      try {
        await runtime.publishAdminKeyShare(
          state.session.secretKeyHex,
          request.requester_pubkey,
          state.siteKeyShare.siteSecretKeyHex
        );
        state.respondedKeyRequests.add(request.id);
      } catch {
        continue;
      }
    }
  }

  async function maybeEnsureCurrentRequest({ onRefresh }) {
    if (!state.session || !accessController.isAdmin() || accessController.hasInboxAccess()) return;
    const sitePubkey = activeSitePubkey();
    if (!sitePubkey) return;

    const pendingRequest = accessController.pendingKeyRequest();
    if (!pendingRequest) {
      const recentlyRequested =
        state.keyRequestCache &&
        state.keyRequestCache.sitePubkey === sitePubkey &&
        Date.now() - state.keyRequestCache.requestedAt < 20000;
      if (!recentlyRequested) {
        await runtime.publishAdminKeyRequest(state.session.secretKeyHex, sitePubkey);
        state.keyRequestCache = {
          sitePubkey,
          requestedAt: Date.now()
        };
      }
    }

    state.keyRequestState = "pending";
    state.keyRequestTimer = runtime.setTimeout(() => {
      void onRefresh?.();
    }, 3200);
  }

  return {
    activeSitePubkey,
    findSiteKeyShare: findShare,
    maybeAutoRespondToKeyRequests: maybeAutoRespond,
    maybeEnsureCurrentKeyRequest: maybeEnsureCurrentRequest,
    renderSiteKeyShareStatus: renderStatus,
    rotateSiteInboxKey: rotate
  };
}
