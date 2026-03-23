import { createAvatarCacheRefresher } from "../core/avatar-cache.js";
import { scheduleBackgroundTasks, scheduleNonCriticalTask } from "../core/non-critical-tasks.js";
import {
  handlePublicSitePageHide,
  initPublicSiteLinkPrefetch,
  refreshPublicSiteFeatures,
  refreshSessionSensitiveSiteFeatures,
  startPublicSiteBackgroundPrefetch
} from "../core/site-runtime-browser.js";
import { createSiteActivityClient } from "../core/runtime-activity.js";
import { getStoredSession, resolveStoredSession } from "../core/session.js";

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
  loadAdminKeyShare,
  resolveSignerSecretKey = async () => ""
} = {}) {
  let features = {};
  let started = false;

  const siteActivity = createSiteActivityClient({
    site,
    resolveSecretKey: resolveSignerSecretKey
  });

  const avatarCache = createAvatarCacheRefresher({
    resolveSecretKey: resolveSignerSecretKey,
    ensureBlobAvailable
  });

  publicStateStore.subscribe((snapshot) => {
    state.publicState = snapshot.value;
    state.publicStateDigest = snapshot.digest;
    if (started && snapshot.reason === "source" && snapshot.valueChanged) {
      void applyPublicStateRefresh();
    }
  });

  function connectFeatures(nextFeatures) {
    features = { ...features, ...nextFeatures };
    if (started && state.session) {
      void refreshSessionSensitiveFeatures();
    }
  }

  function start() {
    started = true;
    void bootstrap();
    initPublicSiteLinkPrefetch({ document, window });
    startPublicSiteBackgroundPrefetch({
      scheduleBackgroundTasks,
      postsStore,
      state,
      loadUserSubmissions,
      loadAdminKeyShare
    });
    window.addEventListener("truecost:session-changed", handleSessionChanged);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pagehide", handlePageHide);
  }

  async function bootstrap() {
    try {
      state.session = await resolveStoredSession({
        persistSession: true
      }).catch(() => getStoredSession());
      const result = await publicStateStore.hydrate({ force: false, reason: "bootstrap" });
      state.publicState = result.value;
      state.publicStateDigest = result.digest;
      viewerController.primeFromSession(true);
    } catch {
      state.publicState = state.publicState || publicStateStore.value;
    }
    scheduleNonCriticalTask(() => siteActivity.publishVisitPulse(), { initialDelayMs: 1400 });
    void hydrateNotifications();
    features.siteShellFeature?.renderNavigation?.();
    publicStateStore.schedule();
  }

  async function getPublicState(force = false) {
    if (!force && state.publicState) return state.publicState;
    try {
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
    await refreshPublicSiteFeatures({
      document,
      window,
      state,
      features,
      hydrateNotifications
    });
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
    handlePublicSitePageHide({
      publicStateStore,
      features,
      stopPublicStateRepairPeer
    });
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
    void refreshSessionSensitiveFeatures();
  }

  async function refreshSessionSensitiveFeatures() {
    await refreshSessionSensitiveSiteFeatures({
      document,
      features
    });
  }

  return {
    applyPublicStateRefresh,
    commitLocalPublicState,
    connectFeatures,
    getPublicState,
    hydrateNotifications,
    refreshAvatarFromCache: avatarCache.refreshAvatarFromCache,
    refreshSessionSensitiveFeatures,
    start,
    syncPublicState
  };
}
