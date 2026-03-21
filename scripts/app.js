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
import { createPublicStateStore } from "./core/public-state-store.js";
import { publicStateHasAdminPubkey } from "./core/public-state.js";
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
import { createSiteNotificationBuilder } from "./core/notification-builders.js";
import { getStoredGuestSession, getStoredSession, saveSession } from "./core/session.js";
import { createQueryState } from "./core/query-state.js";
import {
  buildToc,
  renderError,
  renderLoadingState,
  renderMarkedHtml,
  renderMiniMarkdown,
  renderRecordList,
  renderTagList
} from "./core/rendering.js";
import { createContentPostStore } from "./core/posts-store.js";
import { createViewerController } from "./core/viewer-controller.js";
import { graphEntityHref } from "./core/graph-wiki.js";
import { createSiteShellFeature } from "./features/site-shell.js";
import { createSiteRuntime } from "./features/site-runtime.js";

let appRuntime = null;
let siteShellFeature = null;
const queryState = createQueryState();
const navigationUi = createNavigationUiState();

const publicStateStore = createPublicStateStore({
  getSessionSecretKey: async () => (appRuntime ? appRuntime.getRequestSignerSecretKey() : ""),
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
  viewer: null,
  publicState: publicStateStore.value,
  publicStateDigest: publicStateStore.digest,
  posts: postsStore.hydrateCache(),
  postsPromise: null,
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

const viewerController = createViewerController({
  state,
  site: SITE,
  deriveIdentity,
  hasNostrTools,
  persistSession: saveSession
});

const buildSiteNotifications = createSiteNotificationBuilder({
  deps: {
    loadAdminKeyShare,
    loadInboxSubmissions,
    loadSubmissionThread,
    loadUserSubmissions,
    publicStateHasAdminPubkey
  }
});

const notificationState = createNotificationState({
  storageNamespace: SITE.nostr.storageNamespace,
  onChange: () => siteShellFeature?.renderNavigation(),
  getSession: () => state.session,
  getViewerPubkey: () => state.viewer?.pubkey || "",
  getPublicState: (force) => appRuntime?.getPublicState(force),
  buildNotifications: ({ publicState }) => buildSiteNotifications({
    publicState,
    viewer: state.viewer,
    sessionSecretKeyHex: state.session?.secretKeyHex || ""
  })
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
  loadAdminKeyShare
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
      getRequestSignerSecretKey: () => appRuntime.getRequestSignerSecretKey(),
      commitLocalPublicState: (nextPublicState) => appRuntime.commitLocalPublicState(nextPublicState),
      publishTaggedJson,
      sanitizeTrustedHtml,
      buildToc,
      renderError,
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
        connectStaticPageOverlay,
        editorEntryAllowed: (publicState) => viewerController.canEdit(publicState),
        formatDate,
        formatLocalTimestamp,
        getPublicState: (force) => appRuntime.getPublicState(force),
        getRequestSignerSecretKey: () => appRuntime.getRequestSignerSecretKey(),
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
        connectStructuredUnitOverlay,
        destroyLeafletPreview: archiveSurface.destroyLeafletPreview,
        editorEntryAllowed: (publicState) => viewerController.canEdit(publicState),
        enrichArticleEntities: (scope, publicState) => markdownBundle.markdownPageFeature.enrichArticleEntities(scope, publicState),
        formatDate,
        getPublicState: (force) => appRuntime.getPublicState(force),
        getRequestSignerSecretKey: () => appRuntime.getRequestSignerSecretKey(),
        loadDraftBySlug: reviewBundle.reviewWorkflow.loadDraftBySlug,
        publishReviewDecision: reviewBundle.reviewWorkflow.publishReviewDecision,
        queueLeafletBoundsFit: mapSurface.queueLeafletBoundsFit,
        refreshPosts: () => postsStore.refresh(),
        renderComments: (slug, publicState) => markdownBundle.markdownPageFeature.renderComments(slug, publicState),
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
    home: ["archivePage", "markdownPage", "mapPage", "graphPage", "wikiPage"],
    investigations: ["archivePage", "markdownPage"],
    guide: ["markdownPage", "staticPageEditSurface"],
    investigation: ["archivePage", "markdownPage", "investigationDetailSurface", "staticPageEditSurface"],
    map: ["mapPage", "archivePage", "graphPage"],
    graph: ["graphPage", "wikiPage", "mapPage"],
    wiki: ["wikiPage", "graphPage"],
    about: ["staticPageEditSurface"],
    "get-involved": ["staticPageEditSurface"],
    merch: ["staticPageEditSurface"]
  };
  featureManifest.preload(pagePreloads[page] || ["archivePage"]);
  featureManifest.preload(["staticPageEditSurface"]);
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page || "";
  window.__truecostImmediateShell?.destroy?.();
  siteShellFeature.mount();
  appRuntime.connectFeatures({ siteShellFeature });
  appRuntime.start();

  createPageRouter({ page })
    .when(["home", "investigations"], async () => {
      const { archivePageFeature } = await featureManifest.load("archivePage");
      await archivePageFeature.mount();
    })
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
      const { staticPageEditSurface } = await featureManifest.load("staticPageEditSurface");
      await staticPageEditSurface.init();
    })
    .mount();

  preloadFeatureGroups(page);
});
