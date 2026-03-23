import test from "node:test";
import assert from "node:assert/strict";

import { createSiteRuntime } from "../scripts/features/site-runtime.js";

function installDom() {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timers = [];
  const fetches = [];
  globalThis.document = {
    body: { dataset: { page: "site" } },
    visibilityState: "visible",
    querySelector: () => null,
    addEventListener: (type, handler) => documentListeners.set(type, handler)
  };
  globalThis.window = {
    addEventListener: (type, handler) => windowListeners.set(type, handler),
    requestIdleCallback: null,
    setTimeout: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    location: {
      href: "https://example.com/index.html",
      pathname: "/index.html",
      search: "",
      hash: ""
    },
    dispatchEvent: () => {}
  };
  globalThis.fetch = async (url) => {
    fetches.push(String(url));
    return { ok: true };
  };
  return { documentListeners, windowListeners, timers, fetches };
}

function createStore() {
  return {
    value: null,
    digest: "",
    subscribe(handler) {
      this.listener = handler;
    },
    hydrate: async () => ({
      value: { admins: ["pub"], users: [], approvedEntities: [], commentsByPost: new Map(), commentIndex: new Map(), commentThreadsByPost: new Map() },
      digest: "digest-1"
    }),
    remember(value) {
      this.value = value;
      this.digest = "digest-remembered";
      return value;
    },
    schedule() {},
    clearRefresh() {},
    sync: async () => ({ changed: false, value: this.value, digest: this.digest })
  };
}

test("site runtime hydrates public state through the shared store and remembers optimistic state", async () => {
  installDom();
  const state = {
    session: { secretKeyHex: "sekret" },
    guestSession: null,
    viewer: null,
    publicState: null,
    publicStateDigest: "",
    staticEdit: null,
    userProfileModalPubkey: ""
  };
  const publicStateStore = createStore();
  let navigationRenders = 0;
  let notificationHydrates = 0;
  const runtime = createSiteRuntime({
    site: { nostr: { storageNamespace: "tc", kinds: {}, appTag: "tc" } },
    state,
    publicStateStore,
    viewerController: {
      primeFromSession: () => ({ pubkey: "pub" }),
      canEdit: () => false
    },
    notificationState: {
      reset() {},
      hydrate: async () => {
        notificationHydrates += 1;
      }
    },
    postsStore: { refresh: async () => [] },
    ensureEventToolsLoaded: async () => {},
    hasNostrTools: () => true,
    stopPublicStateRepairPeer: () => {},
    ensureBlobAvailable: async () => {},
    publishTaggedJson: async () => {},
    loadUserSubmissions: async () => [],
    loadAdminKeyShare: async () => null
  });
  runtime.connectFeatures({
    siteShellFeature: {
      renderNavigation: () => {
        navigationRenders += 1;
      }
    }
  });

  const publicState = await runtime.getPublicState(true);
  assert.deepEqual(publicState.admins, ["pub"]);
  assert.equal(state.publicStateDigest, "digest-1");
  assert.equal(navigationRenders, 1);
  assert.equal(notificationHydrates, 1);

  const optimistic = runtime.commitLocalPublicState({ admins: ["pub", "aux"] });
  assert.deepEqual(optimistic.admins, ["pub", "aux"]);
  assert.equal(publicStateStore.digest, "digest-remembered");
});

test("site runtime no longer drives projection-backed graph refreshes on session change", async () => {
  const { windowListeners } = installDom();
  globalThis.document.querySelector = (selector) => {
    if (selector === "[data-graph-page]") return {};
    return null;
  };

  const state = {
    session: { username: "aux", secretKeyHex: "sekret", pubkey: "pub" },
    guestSession: null,
    viewer: null,
    publicState: null,
    publicStateDigest: "",
    staticEdit: null,
    userProfileModalPubkey: ""
  };

  const runtime = createSiteRuntime({
    site: { nostr: { storageNamespace: "tc", kinds: {}, appTag: "tc" } },
    state,
    publicStateStore: createStore(),
    viewerController: {
      primeFromSession: () => ({ pubkey: "pub" }),
      canEdit: () => true
    },
    notificationState: {
      reset() {},
      hydrate: async () => {}
    },
    postsStore: { refresh: async () => [] },
    ensureEventToolsLoaded: async () => {},
    hasNostrTools: () => true,
    stopPublicStateRepairPeer: () => {},
    ensureBlobAvailable: async () => {},
    publishTaggedJson: async () => {},
    loadUserSubmissions: async () => [],
    loadAdminKeyShare: async () => null
  });

  runtime.connectFeatures({
    siteShellFeature: {
      closeProfileMenus() {},
      renderNavigation() {},
      renderGlobalOverlays() {}
    },
    staticPageEditSurface: {
      destroyOverlay() {},
      init: async () => {}
    },
    investigationDetailSurface: {
      destroy() {}
    }
  });

  runtime.start();
  const handler = windowListeners.get("truecost:session-changed");
  assert.equal(typeof handler, "function");
  await handler();
  assert.equal(typeof windowListeners.get("truecost:session-changed"), "function");
});

test("site runtime staggers background warming without forcing heavy refresh work", async () => {
  const { timers, fetches } = installDom();
  let refreshCount = 0;
  let hydrateCacheCount = 0;
  const hydrateReasons = [];
  const runtime = createSiteRuntime({
    site: { nostr: { storageNamespace: "tc", kinds: {}, appTag: "tc" } },
    state: {
      session: null,
      guestSession: null,
      viewer: null,
      publicState: null,
      publicStateDigest: "",
      staticEdit: null,
      userProfileModalPubkey: ""
    },
    publicStateStore: {
      ...createStore(),
      hydrate: async ({ reason } = {}) => {
        hydrateReasons.push(reason || "");
        return {
          value: { admins: [], users: [], approvedEntities: [], commentsByPost: new Map(), commentIndex: new Map(), commentThreadsByPost: new Map() },
          digest: "digest-1"
        };
      }
    },
    viewerController: {
      primeFromSession: () => ({ pubkey: "" }),
      canEdit: () => false
    },
    notificationState: {
      reset() {},
      hydrate: async () => {}
    },
    postsStore: {
      hydrateCache: async () => {
        hydrateCacheCount += 1;
        return [];
      },
      refresh: async () => {
        refreshCount += 1;
        return [];
      }
    },
    ensureEventToolsLoaded: async () => {},
    hasNostrTools: () => true,
    stopPublicStateRepairPeer: () => {},
    ensureBlobAvailable: async () => {},
    publishTaggedJson: async () => {},
    loadUserSubmissions: async () => [],
    loadAdminKeyShare: async () => null
  });

  runtime.start();
  await Promise.resolve();
  for (let index = 0; index < 30 && index < timers.length; index += 1) {
    await timers[index]();
  }

  assert.equal(refreshCount, 0, "background warming should not parse investigation content eagerly");
  assert.equal(hydrateCacheCount, 1, "background warming may hydrate the local cache once");
  assert.ok(hydrateReasons.length <= 1, "background warming should not trigger a second public-state hydrate");
  if (hydrateReasons.length) {
    assert.deepEqual(hydrateReasons, ["bootstrap"], "background warming should leave public-state hydration on the bootstrap path only");
  }
  assert.deepEqual(fetches, [], "background warming should not fetch route HTML or content packs during boot");
});

test("site runtime public-state boot no longer loads event tools on the critical path", async () => {
  const { timers } = installDom();
  let ensureCalls = 0;
  const runtime = createSiteRuntime({
    site: { nostr: { storageNamespace: "tc", kinds: {}, appTag: "tc" } },
    state: {
      session: null,
      guestSession: null,
      viewer: null,
      publicState: null,
      publicStateDigest: "",
      staticEdit: null,
      userProfileModalPubkey: ""
    },
    publicStateStore: createStore(),
    viewerController: {
      primeFromSession: () => ({ pubkey: "" }),
      canEdit: () => false
    },
    notificationState: {
      reset() {},
      hydrate: async () => {}
    },
    postsStore: {
      hydrateCache: async () => [],
      refresh: async () => []
    },
    ensureEventToolsLoaded: async () => {
      ensureCalls += 1;
    },
    hasNostrTools: () => false,
    stopPublicStateRepairPeer: () => {},
    ensureBlobAvailable: async () => {},
    publishTaggedJson: async () => {},
    loadUserSubmissions: async () => [],
    loadAdminKeyShare: async () => null
  });

  runtime.start();
  await runtime.getPublicState(true);
  await runtime.syncPublicState(true);

  assert.equal(ensureCalls, 0, "public-state hydration should not require event tools on the page thread");
  assert.ok(timers.length > 0, "non-critical work should be deferred instead of blocking boot");
});
