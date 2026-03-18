import { createRequestSigner } from "../core/request-signer.js";
import { getStoredSession, getOrCreateGuestSession } from "../core/session.js";

export function createSiteRuntime({
  site,
  state,
  publicStateStore,
  viewerController,
  notificationState,
  postsStore,
  ensureEventToolsLoaded,
  hasNostrTools,
  stopPublicStateRepairPeer,
  ensureBlobAvailable,
  publishTaggedJson,
  loadUserSubmissions,
  loadAdminKeyShare
} = {}) {
  let features = {};

  const requestSigner = createRequestSigner({
    state,
    site,
    ensureEventToolsLoaded,
    getOrCreateGuestSession,
    ensureBlobAvailable,
    publishTaggedJson
  });

  publicStateStore.subscribe((snapshot) => {
    state.publicState = snapshot.value;
    state.publicStateDigest = snapshot.digest;
  });

  function connectFeatures(nextFeatures) {
    features = { ...features, ...nextFeatures };
  }

  function start() {
    void bootstrap();
    initLinkPrefetch();
    startBackgroundPrefetch();
    window.addEventListener("truecost:session-changed", handleSessionChanged);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pagehide", handlePageHide);
  }

  async function bootstrap() {
    try {
      await ensureEventToolsLoaded();
      if (!state.guestSession) {
        state.guestSession = await getOrCreateGuestSession().catch(() => null);
      }
      const result = await publicStateStore.hydrate({ force: false, reason: "bootstrap" });
      state.publicState = result.value;
      state.publicStateDigest = result.digest;
      viewerController.primeFromSession(true);
    } catch {
      state.publicState = state.publicState || publicStateStore.value;
    }
    void requestSigner.publishVisitPulse();
    void hydrateNotifications();
    features.siteShellFeature?.renderNavigation?.();
    publicStateStore.schedule();
  }

  async function getPublicState(force = false) {
    if (!force && state.publicState) return state.publicState;
    try {
      await ensureEventToolsLoaded();
      if (!state.guestSession) {
        state.guestSession = await getOrCreateGuestSession().catch(() => null);
      }
      const result = await publicStateStore.hydrate({
        force: Boolean(force),
        reason: force ? "forced-get-public-state" : "get-public-state"
      });
      state.publicState = result.value;
      state.publicStateDigest = result.digest;
      viewerController.primeFromSession(force || hasNostrTools());
      if (state.session) {
        void hydrateNotifications(force);
      }
      features.siteShellFeature?.renderNavigation?.();
      return state.publicState;
    } catch {
      state.publicState = {
        connected: false,
        approvedEntities: [],
        commentsByPost: new Map(),
        commentIndex: new Map(),
        commentThreadsByPost: new Map(),
        admins: []
      };
      return state.publicState;
    }
  }

  function commitLocalPublicState(nextPublicState) {
    state.publicState = publicStateStore.remember(nextPublicState);
    state.publicStateDigest = publicStateStore.digest;
    return state.publicState;
  }

  async function hydrateNotifications(force = false) {
    const publicState = await getPublicState();
    viewerController.primeFromSession(false);
    await notificationState.hydrate({ publicState, force });
  }

  async function syncPublicState(force = true) {
    try {
      await ensureEventToolsLoaded();
      if (!state.guestSession) {
        state.guestSession = await getOrCreateGuestSession().catch(() => null);
      }
      const result = await publicStateStore.sync({ force, reason: "background-sync" });
      if (result.changed) {
        state.publicState = result.value;
        state.publicStateDigest = result.digest;
        await applyPublicStateRefresh();
      }
    } catch {
      return;
    }
  }

  async function applyPublicStateRefresh() {
    features.siteShellFeature?.renderNavigation?.();
    if (state.session) {
      void hydrateNotifications(true);
    }

    if (document.querySelector("[data-home-investigations], [data-investigation-list], [data-archive-summary]")) {
      if (!features.archivePageFeature?.isInteractionActive?.()) {
        await features.archivePageFeature?.mount?.();
      }
    }

    if (document.querySelector("[data-map-list]") && document.querySelector("[data-map-canvas]")) {
      const nextMapDigest = features.mapPageFeature?.dataDigest?.(state.publicState) || "";
      if (!features.mapPageFeature?.isInteractionActive?.() && (!state.map || nextMapDigest !== state.mapViewDigest)) {
        await features.mapPageFeature?.mount?.();
      }
    }

    if (document.querySelector("[data-investigation-article]")) {
      await features.markdownPageFeature?.refreshVisibleCommentThread?.();
    }

    window.dispatchEvent(new CustomEvent("truecost:public-state-updated", {
      detail: {
        publicState: state.publicState
      }
    }));
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible") {
      void syncPublicState(true);
    } else {
      publicStateStore.clearRefresh();
    }
  }

  function handleWindowFocus() {
    void syncPublicState(true);
  }

  function handlePageHide() {
    publicStateStore.clearRefresh();
    features.staticPageEditSurface?.destroyOverlay?.();
    features.investigationDetailSurface?.destroy?.();
    stopPublicStateRepairPeer();
  }

  function handleSessionChanged() {
    state.session = getStoredSession();
    state.viewer = null;
    state.userProfileModalPubkey = "";
    notificationState.reset();
    features.siteShellFeature?.closeProfileMenus?.();
    viewerController.primeFromSession(hasNostrTools());
    features.siteShellFeature?.renderNavigation?.();
    features.siteShellFeature?.renderGlobalOverlays?.();
    features.staticPageEditSurface?.destroyOverlay?.();
    features.investigationDetailSurface?.destroy?.();
    state.staticEdit = null;
    if (state.session) {
      void hydrateNotifications(true);
    }
    void features.staticPageEditSurface?.init?.();
  }

  function startBackgroundPrefetch() {
    const task = () => {
      const routes = [
        "./index.html",
        "./investigations.html",
        "./map.html",
        "./about.html",
        "./guide.html",
        "./submit.html",
        "./get-involved.html",
        "./merch.html",
        "./investigation.html",
        "./editor.html",
        "./admin.html?tab=login"
      ];
      for (const route of routes) {
        fetch(route, { cache: "force-cache" }).catch(() => null);
      }
      fetch("./content/investigations/index.json", { cache: "force-cache" }).catch(() => null);
      fetch("./content/pages/guide.md", { cache: "force-cache" }).catch(() => null);
      fetch("./vendor/leaflet.js", { cache: "force-cache" }).catch(() => null);
      fetch("./vendor/leaflet.css", { cache: "force-cache" }).catch(() => null);
      void postsStore.refresh().catch(() => []);
      void publicStateStore.hydrate({ force: false, reason: "prefetch", requestRepair: false }).catch(() => null);
      if (state.session?.secretKeyHex) {
        void loadUserSubmissions(state.session.secretKeyHex).catch(() => []);
        void loadAdminKeyShare(state.session.secretKeyHex).catch(() => null);
      }
    };
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(task, { timeout: 1800 });
      return;
    }
    window.setTimeout(task, 900);
  }

  function initLinkPrefetch() {
    const prefetched = new Set();
    const maybePrefetch = (value) => {
      try {
        const url = new URL(value, window.location.href);
        if (url.origin !== window.location.origin || prefetched.has(url.href)) return;
        prefetched.add(url.href);
        fetch(url.href, { cache: "force-cache" }).catch(() => null);
      } catch {
        return;
      }
    };
    const primeTarget = (target) => {
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      maybePrefetch(link.href);
    };
    document.addEventListener("pointerover", (event) => primeTarget(event.target), { passive: true });
    document.addEventListener("focusin", (event) => primeTarget(event.target));
  }

  return {
    applyPublicStateRefresh,
    commitLocalPublicState,
    connectFeatures,
    getPublicState,
    getRequestSignerSecretKey: requestSigner.getSecretKey,
    hydrateNotifications,
    refreshAvatarFromCache: requestSigner.refreshAvatarFromCache,
    start,
    syncPublicState
  };
}
