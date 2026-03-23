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
      resolveStoredSession: async () => ({ pubkey: "admin-pubkey", secretKeyHex: "sekret" }),
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
  for (let index = 0; index < 6 && !state.siteKeyShare; index += 1) {
    await Promise.resolve();
  }
  for (let index = 0; index < 6 && !state.inboxSubmissions.length; index += 1) {
    await Promise.resolve();
  }

  assert.equal(state.activeTab, "dashboard");
  assert.equal(Boolean(state.siteKeyShare), true);
  assert.deepEqual(state.inboxSubmissions.map((item) => item.id), ["sub-1"]);
  assert.deepEqual(renderCalls[0], {
    soft: true,
    activeTab: "dashboard",
    inboxIds: [],
    hasSiteShare: false
  });
  assert.ok(renderCalls.some((entry) => JSON.stringify(entry) === JSON.stringify({
    soft: true,
    activeTab: "dashboard",
    inboxIds: ["sub-1"],
    hasSiteShare: true
  })));

  releaseEventTools();
  await refreshPromise;

  assert.deepEqual(state.inboxSubmissions.map((item) => item.id), ["sub-2"]);
  assert.ok(renderCalls.some((entry) => entry.soft === false && entry.activeTab === "dashboard"));
});

test("workspace runtime renders the root admin shell immediately while full hydrate is still pending", async () => {
  installWorkspaceDom();
  const state = {
    session: { pubkey: "root-admin-pubkey", secretKeyHex: "sekret" },
    viewer: null,
    publicState: null,
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
  let releaseHydrate;
  const hydrateGate = new Promise((resolve) => {
    releaseHydrate = resolve;
  });
  const runtime = createWorkspaceRuntime({
    site: { nostr: { storageNamespace: "truecost.test" } },
    state,
    viewerController: {
      primeFromSession: () => ({ pubkey: "root-admin-pubkey" })
    },
    accessController: {
      viewerPubkey: () => "root-admin-pubkey",
      activeSitePubkey: () => "",
      hasInboxAccess: () => false,
      isAdmin: () => true,
      chooseInitialTab: () => "dashboard",
      captureAccessState: () => JSON.stringify({
        viewer: "root-admin-pubkey",
        admin: true
      })
    },
    publicStateStore: {
      hydrate: async () => {
        await hydrateGate;
        return {
          value: {
            admins: ["root-admin-pubkey"],
            siteInfo: { activePubkey: "" },
            pendingAdminKeyRequests: [],
            users: [{ pubkey: "root-admin-pubkey", username: "aux" }]
          }
        };
      }
    },
    deps: {
      ensureEventToolsLoaded: async () => {},
      resolveStoredSession: async () => ({ pubkey: "root-admin-pubkey", secretKeyHex: "sekret" }),
      getStoredSession: () => ({ pubkey: "root-admin-pubkey", secretKeyHex: "sekret" }),
      loadCachedSiteKeyShares: () => [],
      loadCachedInboxSubmissions: () => [],
      loadAdminKeyShares: async () => [],
      loadAdminKeyShare: async () => null,
      loadInboxSubmissions: async () => [],
      loadStaticSlugs: async () => [],
      mergeSiteKeyShares: (primary, secondary) => [...(primary || []), ...(secondary || [])],
      findSiteKeyShare: () => null,
      persistCachedSiteKeyShares: () => {},
      persistCachedInboxSubmissions: () => {}
    },
    callbacks: {
      captureDataState: () => JSON.stringify({ tab: state.activeTab }),
      maybeAutoRespondToKeyRequests: async () => {},
      maybeEnsureCurrentKeyRequest: async () => {},
      maybeOpenAdminChatFromUrl: async () => {},
      maybeResolveCommentDeepLink: () => {},
      maybeResolveUserDeepLink: async () => {},
      renderWorkspace: (options = {}) => {
        renderCalls.push({
          loading: false,
          soft: Boolean(options.soft),
          activeTab: state.activeTab
        });
      },
      renderWorkspaceLoading: () => {
        renderCalls.push({ loading: true });
      },
      shouldSoftRefreshWorkspace: () => true
    }
  });

  const refreshPromise = runtime.refresh(false);
  for (let index = 0; index < 6 && !renderCalls.length; index += 1) {
    await Promise.resolve();
  }

  assert.deepEqual(renderCalls[0], {
    loading: false,
    soft: true,
    activeTab: "dashboard"
  });

  releaseHydrate();
  await refreshPromise;

  assert.ok(renderCalls.some((entry) => entry.loading === false && entry.soft === false && entry.activeTab === "dashboard"));
});
