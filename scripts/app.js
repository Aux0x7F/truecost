import SITE from "./core/site-config.js";
import {
  collectEntityRefsFromText,
  enrichEntityReferences,
  parseContentDocument,
  slugify
} from "./core/content-utils.js";
import { setText } from "./core/dom.js";
import { formatDate, formatLocalTimestamp, buildArticleMetaLine } from "./core/formatting.js";
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
import {
  createPublicStateStore
} from "./core/public-state-store.js";
import { publicStateHasAdminPubkey } from "./core/public-state.js";
import {
  draftOwnerPubkey,
  isPageDraft,
  pageDraftHref,
  reviewActionMessage,
  reviewStatusForAction
} from "./core/page-drafts.js";
import { createNavigationUiState } from "./core/navigation-state.js";
import {
  createNotificationState
} from "./core/notification-state.js";
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
import {
  archiveEntitiesForEntries,
  destroyLeafletPreview,
  renderLeafletPreviewMap
} from "./surfaces/archive.js";
import { createInvestigationDetailSurface } from "./surfaces/investigation-detail.js";
import {
  bindMapEntityCards as bindMapSurfaceEntityCards,
  queueLeafletBoundsFit,
  renderLeafletMapSurface,
  renderMapPageSurface,
  scheduleMapEntityFocus as scheduleSurfaceMapEntityFocus
} from "./surfaces/map.js";
import { createStaticPageEditSurface } from "./surfaces/static-page-edit.js";
import { createArchivePageFeature } from "./features/archive-page.js";
import { createGraphPageFeature } from "./features/graph-page.js";
import { createMapPageFeature } from "./features/map-page.js";
import { createMarkdownPageFeature } from "./features/markdown-page.js";
import { createReviewWorkflow } from "./features/review-workflow.js";
import { createSiteShellFeature } from "./features/site-shell.js";
import { createSiteRuntime } from "./features/site-runtime.js";
import { createWikiPageFeature } from "./features/wiki-page.js";
const NAV_KEYS = {
  home: ["home"],
  explore: ["investigations", "investigation", "editor", "map", "graph", "wiki"],
  investigations: ["investigations", "investigation", "editor"],
  graph: ["graph"],
  wiki: ["wiki"],
  guide: ["guide"],
  submit: ["submit"],
  "get-involved": ["get-involved"],
  about: ["about"],
  merch: ["merch"],
  map: ["map"],
  workspace: ["workspace"]
};

let appRuntime = null;
const queryState = createQueryState();

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
        document.querySelector("[data-home-investigations], [data-investigation-list], [data-archive-summary], [data-investigation-article], [data-map-list], [data-map-canvas]")
    )
});
const initialPublicState = publicStateStore.value;
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
const initialPosts = postsStore.hydrateCache();
const navigationUi = createNavigationUiState();

const state = {
  session: getStoredSession(),
  guestSession: getStoredGuestSession(),
  viewer: null,
  publicState: initialPublicState,
  publicStateDigest: publicStateStore.digest,
  posts: initialPosts,
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

let siteShellFeature = null;

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

const mapPageFeature = createMapPageFeature({
  state,
  postsStore,
  getPublicState: (force) => appRuntime.getPublicState(force),
  queryState,
  cleanSlug,
  collectEntityRefsFromText,
  renderLeafletMapSurface,
  bindMapEntityCards: bindMapSurfaceEntityCards,
  scheduleLeafletFocus: scheduleSurfaceMapEntityFocus,
  renderMapPageSurface,
  renderError,
  renderLoadingState
});

const graphPageFeature = createGraphPageFeature({
  state,
  fetchJson,
  postsStore,
  getPublicState: (force) => appRuntime.getPublicState(force),
  viewerController,
  queryState
});

const wikiPageFeature = createWikiPageFeature({
  state,
  fetchJson,
  postsStore,
  getPublicState: (force) => appRuntime.getPublicState(force),
  viewerController,
  queryState
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

const investigationDetailSurface = createInvestigationDetailSurface({
  site: SITE,
  state,
  deps: {
    cleanSlug,
    archiveEntitiesForEntries,
    buildArticleMetaLine,
    connectStructuredUnitOverlay,
    destroyLeafletPreview,
    editorEntryAllowed: (publicState) => viewerController.canEdit(publicState),
    enrichArticleEntities: (scope, publicState) => markdownPageFeature.enrichArticleEntities(scope, publicState),
    formatDate,
    getPublicState: (force) => appRuntime.getPublicState(force),
    getRequestSignerSecretKey: () => appRuntime.getRequestSignerSecretKey(),
    loadDraftBySlug: reviewWorkflow.loadDraftBySlug,
    publishReviewDecision: reviewWorkflow.publishReviewDecision,
    queueLeafletBoundsFit,
    refreshPosts: () => postsStore.refresh(),
    renderComments: (slug, publicState) => markdownPageFeature.renderComments(slug, publicState),
    renderError,
    renderInvestigationCard: archivePageFeature.renderInvestigationCard,
    renderLeafletPreviewMap,
    renderLoadingState,
    renderMarkdown: (node, markdown) => markdownPageFeature.renderMarkdown(node, markdown),
    renderRecordList,
    renderTagList,
    setText,
    trustedAdminPubkeys: (publicState) => viewerController.trustedPubkeys(publicState)
  }
});

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

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page || "";
  siteShellFeature.mount();
  appRuntime.connectFeatures({
    archivePageFeature,
    graphPageFeature,
    investigationDetailSurface,
    markdownPageFeature,
    mapPageFeature,
    siteShellFeature,
    staticPageEditSurface,
    wikiPageFeature
  });
  appRuntime.start();
  schedulePageFeatureMounts(page);
});

function schedulePageFeatureMounts(page) {
  const mount = () => {
    mountPageFeatures(page);
  };
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(mount);
    return;
  }
  window.setTimeout(mount, 0);
}

function mountPageFeatures(page) {
  switch (page) {
    case "home":
    case "investigations":
      archivePageFeature.mount();
      break;
    case "guide":
      markdownPageFeature.mount();
      break;
    case "investigation":
      void investigationDetailSurface.init();
      markdownPageFeature.mount();
      break;
    case "map":
      void mapPageFeature.mount();
      break;
    case "graph":
      void graphPageFeature.mount();
      break;
    case "wiki":
      void wikiPageFeature.mount();
      break;
    default:
      break;
  }
  void staticPageEditSurface.init();
}
