import test from "node:test";
import assert from "node:assert/strict";

import { createSiteRuntime } from "../scripts/features/site-runtime.js";

function installDom() {
  const documentListeners = new Map();
  const windowListeners = new Map();
  globalThis.document = {
    body: { dataset: { page: "site" } },
    visibilityState: "visible",
    querySelector: () => null,
    addEventListener: (type, handler) => documentListeners.set(type, handler)
  };
  globalThis.window = {
    addEventListener: (type, handler) => windowListeners.set(type, handler),
    requestIdleCallback: null,
    setTimeout: () => 1,
    location: {
      href: "https://example.com/index.html",
      pathname: "/index.html",
      search: "",
      hash: ""
    },
    dispatchEvent: () => {}
  };
  globalThis.fetch = async () => ({ ok: true });
  return { documentListeners, windowListeners };
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
