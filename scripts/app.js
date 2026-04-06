import SITE from "./core/site-config.js";
import {
  collectEntityRefsFromText,
  enrichEntityReferences,
  parseContentDocument,
  slugify
} from "./core/content-utils.js";
import { setText } from "./core/dom.js";
import { formatDate, formatLocalTimestamp, buildArticleMetaLine } from "./core/formatting.js";
import { createFeatureManifest } from "./core/feature-manifest.js";
import { fetchJson, fetchText } from "./core/http.js";
import { createSiteOverlayConnector } from "./core/overlay-connector.js";
import { installLocalDevelopmentHelpers } from "./core/dev-local-admin.js";
import {
  cleanSlug,
  deriveIdentity,
  ensureEventToolsLoaded,
  ensureBlobAvailable,
  hasNostrTools,
  connectStaticPageOverlay,
  connectStructuredUnitOverlay,
  loadAdminKeyShare,
  loadInboxSubmissions,
  loadSubmissionThread,
  loadUserSubmissions,
  publicStateNeedsRepair,
  publishTaggedJson,
  sanitizeTrustedHtml,
  stopPublicStateRepairPeer
} from "./core/nostr.js";
import { getSiteRuntimeClient } from "./core/runtime-client.js";
import { createPublicStateProjectionStore } from "./core/public-state-projection.js";
import {
  draftOwnerPubkey,
  isPageDraft,
  pageDraftHref,
  reviewActionMessage,
  reviewStatusForAction
} from "./core/page-drafts.js";
import { createNavigationUiState } from "./core/navigation-state.js";
import NAV_KEYS from "./core/nav-keys.js";
import { createNotificationState } from "./core/notification-state.js";
import { createPageRouter } from "./core/page-router.js";
import { getOrCreateGuestSession, getStoredGuestSession, getStoredSession, saveSession } from "./core/session.js";
import { createQueryState } from "./core/query-state.js";
import {
  buildToc,
  renderError,
  renderInvestigationArticleHtml,
  renderLoadingState,
  renderMarkedHtml,
  renderMiniMarkdown,
  renderRecordList,
  renderTagList
} from "./core/rendering.js";
import { createSiteSignerClient } from "./core/site-signer.js";
import { createContentPostStore } from "./core/posts-store.js";
import { createViewerController } from "./core/viewer-controller.js";
import { graphEntityHref } from "./core/graph-wiki.js";
import { createSiteShellFeature } from "./features/site-shell.js";
import { createSiteRuntime } from "./features/site-runtime.js";

let appRuntime = null;
let siteShellFeature = null;
let signerClient = null;
let overlayConnector = null;
const queryState = createQueryState();
const navigationUi = createNavigationUiState();

installLocalDevelopmentHelpers();

const publicStateStore = createPublicStateProjectionStore({
  getSessionSecretKey: async () => (signerClient ? signerClient.resolveSecretKey() : ""),
  page: () => document.body.dataset.page || "site",
  refreshDelayMs: () => {
    const configured = Number(SITE.nostr.publicRefreshMs || 15000);
    return Number.isFinite(configured) && configured > 0 ? configured : 15000;
  },
  shouldRefresh: () =>
    document.visibilityState !== "hidden" &&
    !document.querySelector("[data-workspace-page]") &&
    Boolean(
      state.session ||
        document.querySelector("[data-home-investigations], [data-investigation-list], [data-archive-summary], [data-investigation-article], [data-map-list], [data-map-canvas], [data-graph-page], [data-wiki-page]")
    )
});

const postsStore = createContentPostStore({
  indexPath: "./content/investigations/index.json",
  contentDir: "./content/investigations",
  cacheKey: `${SITE.nostr.storageNamespace}.investigations-cache`,
  initialPosts: [],
  fetchJson,
  fetchText,
  parseContentDocument,
  slugify
});

const state = {
  session: getStoredSession(),
  guestSession: getStoredGuestSession(),
  isSigningOut: false,
  viewer: null,
  publicState: publicStateStore.value,
  publicStateDigest: publicStateStore.digest,
  commentReply: null,
  navigationUi,
  userProfileModalPubkey: "",
  archiveFilters: null,
  archiveFilterOpenField: "",
  archiveFilterHighlight: -1,
  archiveStatusMenuOpen: false,
  archiveFilterTimer: null,
  pageOverlay: null,
  investigationOverlay: null,
  staticEdit: null,
  staticEditListenersBound: false,
  map: null,
  mapCanvas: null,
  markers: null,
  markerIndex: null,
  pendingMapEntitySlug: "",
  lastGoodMapEntities: [],
  lastGoodArchiveMapEntities: [],
  mapViewDigest: "",
  highlightedCommentId: ""
};

signerClient = createSiteSignerClient({
  state,
  ensureEventToolsLoaded,
  getOrCreateGuestSession
});

overlayConnector = createSiteOverlayConnector({
  resolveSecretKey: () => signerClient.resolveSecretKey(),
  connectStaticPageOverlay,
  connectStructuredUnitOverlay
});

const viewerController = createViewerController({
  state,
  site: SITE,
  deriveIdentity,
  hasNostrTools,
  persistSession: saveSession
});

const notificationState = createNotificationState({
  storageNamespace: SITE.nostr.storageNamespace,
  onChange: () => siteShellFeature?.renderNavigation?.(),
  getSession: () => state.session,
  getViewerPubkey: () =>
    state.viewer?.pubkey ||
    viewerController.resolvedSessionPubkey?.({ deriveWhenAvailable: true }) ||
    ""
});

appRuntime = createSiteRuntime({
  site: SITE,
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
  resolveSignerSecretKey: () => signerClient.resolveSecretKey()
});

siteShellFeature = createSiteShellFeature({
  site: SITE,
  state,
  navKeys: NAV_KEYS,
  notificationState,
  viewerController,
  refreshAvatarFromCache: (target) => appRuntime.refreshAvatarFromCache(target),
  onSignedOut: () => {
    state.userProfileModalPubkey = "";
    notificationState.reset();
  }
});

const featureManifest = createFeatureManifest({
  archivePage: async () => {
    const [
      { createArchivePageFeature },
      { queueLeafletBoundsFit }
    ] = await Promise.all([
      import("./features/archive-page.js"),
      import("./surfaces/map.js")
    ]);
    const archivePageFeature = createArchivePageFeature({
      state,
      viewerController,
      postsStore,
      getPublicState: (force) => appRuntime.getPublicState(force),
      getProjection: (channel, params = {}, options = {}) =>
        getSiteRuntimeClient().then((runtimeClient) =>
          runtimeClient.getProjection(channel, params, options)
        ),
      publicStateNeedsRepair,
      queueLeafletBoundsFit,
      renderError,
      renderLoadingState
    });
    appRuntime.connectFeatures({ archivePageFeature });
    return { archivePageFeature };
  },
  markdownPage: async () => {
    const { createMarkdownPageFeature } = await import("./features/markdown-page.js");
    const markdownPageFeature = createMarkdownPageFeature({
      site: SITE,
      state,
      viewerController,
      getPublicState: (force) => appRuntime.getPublicState(force),
      getSessionIdentity: (force = false) =>
        getSiteRuntimeClient().then((runtimeClient) =>
          force
            ? runtimeClient.refreshProjection("sessionIdentity", {}, {
                reason: "markdown-session-identity"
              }).then((projection) => projection?.value || null)
            : runtimeClient.getProjection("sessionIdentity", {}, {
                preferFresh: false,
                reason: "markdown-session-identity"
              }).then((projection) => projection?.value || null)
        ),
      commitLocalPublicState: (nextPublicState) => appRuntime.commitLocalPublicState(nextPublicState),
      publishTaggedJson,
      sanitizeTrustedHtml,
      buildToc,
      renderError,
      renderInvestigationArticleHtml,
      renderLoadingState,
      renderMiniMarkdown,
      renderMarkedHtml,
      fetchText,
      slugify,
      enrichEntityReferences,
      entityHrefBuilder: (slug) => graphEntityHref(slug)
    });
    appRuntime.connectFeatures({ markdownPageFeature });
    return { markdownPageFeature };
  },
  mapPage: async () => {
    const [
      { createMapPageFeature },
      {
        bindMapEntityCards,
        renderLeafletMapSurface,
        renderMapPageSurface,
        scheduleMapEntityFocus
      }
    ] = await Promise.all([
      import("./features/map-page.js"),
      import("./surfaces/map.js")
    ]);
    const mapPageFeature = createMapPageFeature({
      state,
      postsStore,
      getPublicState: (force) => appRuntime.getPublicState(force),
      getProjection: (channel, params = {}, options = {}) =>
        getSiteRuntimeClient().then((runtimeClient) =>
          runtimeClient.getProjection(channel, params, options)
        ),
      subscribeProjection: (channel, params = {}, listener = () => {}, options = {}) =>
        getSiteRuntimeClient().then((runtimeClient) =>
          runtimeClient.subscribeProjection(channel, params, listener, options)
        ),
      queryState,
      cleanSlug,
      collectEntityRefsFromText,
      renderLeafletMapSurface,
      bindMapEntityCards,
      scheduleLeafletFocus: scheduleMapEntityFocus,
      renderMapPageSurface,
      renderError,
      renderLoadingState
    });
    appRuntime.connectFeatures({ mapPageFeature });
    return { mapPageFeature };
  },
  graphPage: async () => {
    const { createGraphPageFeature } = await import("./features/graph-page.js");
    const graphPageFeature = createGraphPageFeature({
      state,
      fetchJson,
      postsStore,
      getPublicState: (force) => appRuntime.getPublicState(force),
      getProjection: (channel, params = {}, options = {}) =>
        getSiteRuntimeClient().then((runtimeClient) =>
          runtimeClient.getProjection(channel, params, options)
        ),
      refreshProjection: (channel, params = {}, options = {}) =>
        getSiteRuntimeClient().then((runtimeClient) =>
          runtimeClient.refreshProjection(channel, params, options)
        ),
      subscribeProjection: (channel, params = {}, listener = () => {}, options = {}) =>
        getSiteRuntimeClient().then((runtimeClient) =>
          runtimeClient.subscribeProjection(channel, params, listener, options)
        ),
      rememberProjection: (channel, params = {}, value = null, meta = {}) =>
        getSiteRuntimeClient().then((runtimeClient) =>
          runtimeClient.rememberProjection(channel, params, value, meta)
        ),
      viewerController,
      queryState
    });
    appRuntime.connectFeatures({ graphPageFeature });
    return { graphPageFeature };
  },
  wikiPage: async () => {
    const { createWikiPageFeature } = await import("./features/wiki-page.js");
    const wikiPageFeature = createWikiPageFeature({
      state,
      fetchJson,
      postsStore,
      getPublicState: (force) => appRuntime.getPublicState(force),
      getProjection: (channel, params = {}, options = {}) =>
        getSiteRuntimeClient().then((runtimeClient) =>
          runtimeClient.getProjection(channel, params, options)
        ),
      refreshProjection: (channel, params = {}, options = {}) =>
        getSiteRuntimeClient().then((runtimeClient) =>
          runtimeClient.refreshProjection(channel, params, options)
        ),
      subscribeProjection: (channel, params = {}, listener = () => {}, options = {}) =>
        getSiteRuntimeClient().then((runtimeClient) =>
          runtimeClient.subscribeProjection(channel, params, listener, options)
        ),
      rememberProjection: (channel, params = {}, value = null, meta = {}) =>
        getSiteRuntimeClient().then((runtimeClient) =>
          runtimeClient.rememberProjection(channel, params, value, meta)
        ),
      viewerController,
      queryState
    });
    appRuntime.connectFeatures({ wikiPageFeature });
    return { wikiPageFeature };
  },
  reviewWorkflow: async () => {
    const { createReviewWorkflow } = await import("./features/review-workflow.js");
    const reviewWorkflow = createReviewWorkflow({
      site: SITE,
      state,
      viewerController,
      publicStateStore,
      notificationState,
      cleanSlug,
      ensureEventToolsLoaded,
      publishTaggedJson,
      getPublicState: (force) => appRuntime.getPublicState(force),
      hydrateNotifications: (force) => appRuntime.hydrateNotifications(force),
      pageDrafts: {
        draftOwnerPubkey,
        isPageDraft,
        pageDraftHref,
        reviewActionMessage,
        reviewStatusForAction
      }
    });
    return { reviewWorkflow };
  },
  staticPageEditSurface: async () => {
    const [{ createStaticPageEditSurface }, { reviewWorkflow }] = await Promise.all([
      import("./surfaces/static-page-edit.js"),
      featureManifest.load("reviewWorkflow")
    ]);
    const staticPageEditSurface = createStaticPageEditSurface({
      site: SITE,
      state,
      deps: {
        afterSnapshotReview: async () => {
          state.publicState = (await publicStateStore.hydrate({ force: true, reason: "page-snapshot-review" })).value;
          notificationState.reset();
          void appRuntime.hydrateNotifications(true);
        },
        connectStaticPageOverlay: (options) => overlayConnector.connectStaticPageOverlay(options),
        editorEntryAllowed: (publicState) => viewerController.canEdit(publicState),
        formatDate,
        formatLocalTimestamp,
        getPublicState: (force) => appRuntime.getPublicState(force),
        loadDraftBySlug: reviewWorkflow.loadDraftBySlug,
        publishReviewDecision: reviewWorkflow.publishReviewDecision,
        publishTaggedJson,
        sanitizeTrustedHtml,
        trustedAdminPubkeys: (publicState) => viewerController.trustedPubkeys(publicState)
      }
    });
    appRuntime.connectFeatures({ staticPageEditSurface });
    return { staticPageEditSurface };
  },
  investigationDetailSurface: async () => {
    const [
      { createInvestigationDetailSurface },
      archiveBundle,
      markdownBundle,
      reviewBundle,
      archiveSurface,
      mapSurface
    ] = await Promise.all([
      import("./surfaces/investigation-detail.js"),
      featureManifest.load("archivePage"),
      featureManifest.load("markdownPage"),
      featureManifest.load("reviewWorkflow"),
      import("./surfaces/archive.js"),
      import("./surfaces/map.js")
    ]);
    const investigationDetailSurface = createInvestigationDetailSurface({
      site: SITE,
      state,
      deps: {
        cleanSlug,
        archiveEntitiesForEntries: archiveSurface.archiveEntitiesForEntries,
        buildArticleMetaLine,
        connectStructuredUnitOverlay: (options) => overlayConnector.connectStructuredUnitOverlay(options),
        destroyLeafletPreview: archiveSurface.destroyLeafletPreview,
        editorEntryAllowed: (publicState) => viewerController.canEdit(publicState),
        enrichArticleEntities: (scope, publicState) => markdownBundle.markdownPageFeature.enrichArticleEntities(scope, publicState),
        formatDate,
        getPublicState: (force) => appRuntime.getPublicState(force),
        loadDraftBySlug: reviewBundle.reviewWorkflow.loadDraftBySlug,
        publishReviewDecision: reviewBundle.reviewWorkflow.publishReviewDecision,
        queueLeafletBoundsFit: mapSurface.queueLeafletBoundsFit,
        getCachedPosts: () => postsStore.current(),
        refreshPosts: () => postsStore.refresh(),
        renderComments: (slug, publicState) => markdownBundle.markdownPageFeature.renderComments(slug, publicState),
        renderArticleBody: (node, post) => markdownBundle.markdownPageFeature.renderArticleBody(node, post),
        renderError,
        renderInvestigationCard: archiveBundle.archivePageFeature.renderInvestigationCard,
        renderLeafletPreviewMap: archiveSurface.renderLeafletPreviewMap,
        renderLoadingState,
        renderMarkdown: (node, markdown) => markdownBundle.markdownPageFeature.renderMarkdown(node, markdown),
        renderRecordList,
        renderTagList,
        setText,
        trustedAdminPubkeys: (publicState) => viewerController.trustedPubkeys(publicState)
      }
    });
    appRuntime.connectFeatures({ investigationDetailSurface });
    return { investigationDetailSurface };
  }
});

function preloadFeatureGroups(page) {
  const pagePreloads = {
    home: ["markdownPage"],
    investigations: ["markdownPage"],
    guide: ["markdownPage"],
    investigation: ["archivePage", "markdownPage"],
    map: ["graphPage", "wikiPage"],
    graph: ["wikiPage", "mapPage"],
    wiki: ["wikiPage", "graphPage"],
    about: ["archivePage"],
    "get-involved": [],
    merch: []
  };
  featureManifest.preload(pagePreloads[page] || ["archivePage"]);
}

function pageNeedsArchiveFeature() {
  return Boolean(
    document.querySelector("[data-home-investigations], [data-investigation-list], [data-archive-summary]")
  );
}

function pageSupportsStaticEdit() {
  return Boolean(document.querySelector("[data-static-edit]"));
}

let staticPageEditInitPromise = null;

function maybeInitStaticPageEdit() {
  if (!pageSupportsStaticEdit()) return Promise.resolve(null);
  const publicState = state.publicState;
  if (!viewerController.canEdit(publicState)) return Promise.resolve(null);
  if (staticPageEditInitPromise) return staticPageEditInitPromise;
  staticPageEditInitPromise = featureManifest.load("staticPageEditSurface")
    .then(async ({ staticPageEditSurface }) => {
      await staticPageEditSurface.init();
      return staticPageEditSurface;
    })
    .catch(() => null)
    .finally(() => {
      staticPageEditInitPromise = null;
    });
  return staticPageEditInitPromise;
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page || "";
  window.__truecostImmediateShell?.destroy?.();
  siteShellFeature.mount();
  appRuntime.connectFeatures({ siteShellFeature });
  void postsStore.hydrateCache().catch(() => []);
  appRuntime.start();

  createPageRouter({ page })
    .when("guide", async () => {
      const { markdownPageFeature } = await featureManifest.load("markdownPage");
      markdownPageFeature.mount();
    })
    .when("investigation", async () => {
      const [{ markdownPageFeature }, { investigationDetailSurface }] = await Promise.all([
        featureManifest.load("markdownPage"),
        featureManifest.load("investigationDetailSurface")
      ]);
      void investigationDetailSurface.init();
      markdownPageFeature.mount();
    })
    .when("map", async () => {
      const { mapPageFeature } = await featureManifest.load("mapPage");
      await mapPageFeature.mount();
    })
    .when("graph", async () => {
      const { graphPageFeature } = await featureManifest.load("graphPage");
      await graphPageFeature.mount();
    })
    .when("wiki", async () => {
      const { wikiPageFeature } = await featureManifest.load("wikiPage");
      await wikiPageFeature.mount();
    })
    .always(async () => {
      if (pageNeedsArchiveFeature()) {
        const { archivePageFeature } = await featureManifest.load("archivePage");
        await archivePageFeature.mount();
      }
      await maybeInitStaticPageEdit();
    })
    .mount();

  window.addEventListener("truecost:public-state-updated", () => {
    void maybeInitStaticPageEdit();
  });
  window.addEventListener("truecost:session-changed", () => {
    void maybeInitStaticPageEdit();
  });

  preloadFeatureGroups(page);
});
