import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceRuntime } from "../scripts/features/workspace-runtime.js";

function installWorkspaceDom() {
  globalThis.document = {
    visibilityState: "visible",
    querySelector: () => ({})
  };
  globalThis.window = {
    clearTimeout() {},
    setTimeout() { return 1; }
  };
}

test("workspace runtime renders cached admin state before full sync and restores cached inbox data", async () => {
  installWorkspaceDom();
  const state = {
    session: { pubkey: "admin-pubkey", secretKeyHex: "sekret" },
    viewer: null,
    publicState: {
      admins: ["admin-pubkey"],
      siteInfo: { activePubkey: "site-pubkey" },
      pendingAdminKeyRequests: [],
      users: [{ pubkey: "admin-pubkey", username: "aux" }]
    },
    siteKeyShares: [],
    siteKeyShare: null,
    inboxSubmissions: [],
    inboxLoading: false,
    activeTab: "",
    staticSlugs: [],
    keyRequestTimer: 0,
    backgroundSyncTimer: 0,
    backgroundSyncInFlight: false,
    keyRequestState: ""
  };
  const renderCalls = [];
  let releaseEventTools;
  const ensureEventToolsLoaded = new Promise((resolve) => {
    releaseEventTools = resolve;
  });
  const runtime = createWorkspaceRuntime({
    site: { nostr: { storageNamespace: "truecost.test" } },
    state,
    viewerController: {
      primeFromSession: () => ({ pubkey: "admin-pubkey" })
    },
    accessController: {
      viewerPubkey: () => "admin-pubkey",
      activeSitePubkey: () => "site-pubkey",
      hasInboxAccess: () => Boolean(state.siteKeyShare),
      isAdmin: () => true,
      chooseInitialTab: () => "dashboard",
      captureAccessState: () => JSON.stringify({
        viewer: "admin-pubkey",
        site: "site-pubkey",
        inbox: Boolean(state.siteKeyShare)
      })
    },
    publicStateStore: {
      hydrate: async () => ({
        value: {
          admins: ["admin-pubkey"],
          siteInfo: { activePubkey: "site-pubkey" },
          pendingAdminKeyRequests: [],
          users: [{ pubkey: "admin-pubkey", username: "aux" }]
        }
      })
    },
    deps: {
      ensureEventToolsLoaded: async () => ensureEventToolsLoaded,
      getStoredSession: () => ({ pubkey: "admin-pubkey", secretKeyHex: "sekret" }),
      loadCachedSiteKeyShares: () => [{ sitePubkey: "site-pubkey", siteSecretKeyHex: "a".repeat(64) }],
      loadCachedInboxSubmissions: () => [{ id: "sub-1", latest: { payload: { subject: "Cached" } } }],
      mergeSiteKeyShares: (primary, secondary) => [...(primary || []), ...(secondary || [])],
      findSiteKeyShare: (shares, sitePubkey) => (shares || []).find((share) => share.sitePubkey === sitePubkey) || null,
      loadAdminKeyShares: async () => [],
      loadAdminKeyShare: async () => null,
      loadInboxSubmissions: async () => [{ id: "sub-2", latest: { payload: { subject: "Fresh" } } }],
      loadStaticSlugs: async () => ["example"],
      persistCachedSiteKeyShares: () => {},
      persistCachedInboxSubmissions: () => {}
    },
    callbacks: {
      captureDataState: () => JSON.stringify({
        tab: state.activeTab,
        submissions: state.inboxSubmissions.map((item) => item.id)
      }),
      maybeAutoRespondToKeyRequests: async () => {},
      maybeEnsureCurrentKeyRequest: async () => {},
      maybeOpenAdminChatFromUrl: async () => {},
      maybeResolveCommentDeepLink: () => {},
      maybeResolveUserDeepLink: async () => {},
      renderWorkspace: (options = {}) => {
        renderCalls.push({
          soft: Boolean(options.soft),
          activeTab: state.activeTab,
          inboxIds: state.inboxSubmissions.map((item) => item.id),
          hasSiteShare: Boolean(state.siteKeyShare)
        });
      },
      renderWorkspaceLoading: () => {
        renderCalls.push({ loading: true });
      },
      shouldSoftRefreshWorkspace: () => true
    }
  });

  const refreshPromise = runtime.refresh(false);
  await Promise.resolve();

  assert.equal(state.activeTab, "dashboard");
  assert.equal(Boolean(state.siteKeyShare), true);
  assert.deepEqual(state.inboxSubmissions.map((item) => item.id), ["sub-1"]);
  assert.deepEqual(renderCalls[0], {
    soft: true,
    activeTab: "dashboard",
    inboxIds: ["sub-1"],
    hasSiteShare: true
  });

  releaseEventTools();
  await refreshPromise;

  assert.deepEqual(state.inboxSubmissions.map((item) => item.id), ["sub-2"]);
  assert.ok(renderCalls.some((entry) => entry.soft === false && entry.activeTab === "dashboard"));
});
