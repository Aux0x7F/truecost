export async function refreshPublicSiteFeatures({
  document,
  window,
  state,
  features,
  hydrateNotifications
} = {}) {
  features?.siteShellFeature?.renderNavigation?.();
  if (state?.session) {
    void hydrateNotifications?.(true);
  }

  if (document?.querySelector?.("[data-home-investigations], [data-investigation-list], [data-archive-summary]")) {
    if (!features?.archivePageFeature?.isInteractionActive?.()) {
      await features?.archivePageFeature?.mount?.();
    }
  }

  if (document?.querySelector?.("[data-investigation-article]")) {
    await features?.markdownPageFeature?.refreshVisibleCommentThread?.();
  }

  window?.dispatchEvent?.(new CustomEvent("truecost:public-state-updated", {
    detail: {
      publicState: state?.publicState
    }
  }));
}

export async function refreshSessionSensitiveSiteFeatures({
  document,
  features
} = {}) {
  if (document?.querySelector?.("[data-home-investigations], [data-investigation-list], [data-archive-summary]")) {
    if (!features?.archivePageFeature?.isInteractionActive?.()) {
      await features?.archivePageFeature?.mount?.();
    }
  }

  if (document?.querySelector?.("[data-investigation-article]")) {
    await features?.markdownPageFeature?.refreshVisibleCommentThread?.();
  }
}

export function handlePublicSitePageHide({
  publicStateStore,
  features,
  stopPublicStateRepairPeer
} = {}) {
  publicStateStore?.clearRefresh?.();
  features?.staticPageEditSurface?.destroyOverlay?.();
  features?.investigationDetailSurface?.destroy?.();
  stopPublicStateRepairPeer?.();
}

export function startPublicSiteBackgroundPrefetch({
  scheduleBackgroundTasks,
  postsStore,
  state,
  loadUserSubmissions,
  loadAdminKeyShare
} = {}) {
  const tasks = [
    () => postsStore?.hydrateCache?.().catch(() => []),
    () => {
      if (state?.session?.secretKeyHex) {
        void loadUserSubmissions?.(state.session.secretKeyHex).catch(() => []);
        void loadAdminKeyShare?.(state.session.secretKeyHex).catch(() => null);
      }
    }
  ];
  scheduleBackgroundTasks?.(tasks, { initialDelayMs: 900, gapMs: 120 });
}

export function initPublicSiteLinkPrefetch({
  document,
  window
} = {}) {
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
  document?.addEventListener?.("pointerover", (event) => primeTarget(event.target), { passive: true });
  document?.addEventListener?.("focusin", (event) => primeTarget(event.target));
}
