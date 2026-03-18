import SITE from "./core/site-config.js";
import {
  collectEntityRefsFromText,
  enrichEntityReferences,
  parseContentDocument,
  slugify
} from "./core/content-utils.js";
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
  sanitizeUrl,
  stopPublicStateRepairPeer
} from "./core/nostr.js";
import {
  createPublicStateStore
} from "./core/public-state-store.js";
import { normalizeAdminPubkeys, publicStateHasAdminPubkey } from "./core/public-state.js";
import {
  draftOwnerPubkey,
  draftReviewAction,
  draftStatusLabel,
  investigationDrafts,
  isPageDraft,
  normalizeDraftStatus,
  pageDraftHref,
  reviewActionMessage,
  reviewStatusForAction
} from "./core/page-drafts.js";
import {
  clampNotificationsPanel,
  closeProfileMenu,
  createNavigationUiState,
  keepProfileMenuOpen,
  toggleNotificationsPanel,
  toggleProfileMenu
} from "./core/navigation-state.js";
import {
  countNotificationItems,
  createNotificationState
} from "./core/notification-state.js";
import { createSiteNotificationBuilder } from "./core/notification-builders.js";
import {
  applyCommentVoteToPublicState,
  commentAffectsThreadRanking,
  rankVisibleCommentThreads,
  resolveCommentVoteSummary,
  resolveCurrentVoteForComment
} from "./core/comment-ranking.js";
import {
  collectRecordBranchIds as collectCommentBranchIds,
  dedupeRecordsById as dedupeCommentList
} from "./core/comment-utils.js";
import { applyDerivedCommentState } from "./core/public-state.js";
import { cycleHighlightIndex } from "./core/search-controls.js";
import {
  dedupeStrings as dedupe,
  escapeAttribute,
  escapeHtml
} from "./core/text-utils.js";
import { clearSession, getOrCreateGuestSession, getStoredGuestSession, getStoredSession } from "./core/session.js";
import {
  buildToc,
  renderError,
  renderLoadingState,
  renderMarkedHtml,
  renderMiniMarkdown,
  renderTagList
} from "./core/rendering.js";
import {
  animateRootCommentReorder,
  captureRootCommentPositions,
  renderComment,
  renderCommentCountLabel,
  updateRenderedCommentVoteState
} from "./surfaces/comments.js";
import {
  renderNavigationMarkup,
  profileInitials
} from "./surfaces/navigation.js";
import { renderPublicUserProfileModal } from "./surfaces/profile-overlays.js";
import {
  archiveEntitiesForEntries,
  archiveEntryEntityOptions,
  archiveFilterSuggestions,
  archiveHasActiveFilters,
  archiveStatusLabel,
  destroyLeafletPreview,
  filterArchiveEntries,
  getCurrentArchiveFilters,
  renderArchiveFiltersPanel,
  renderArchiveMapPanel,
  renderArchiveSuggestionPanel,
  renderAuthoringLeadCard,
  renderLeafletPreviewMap
} from "./surfaces/archive.js";
import { createInvestigationDetailSurface } from "./surfaces/investigation-detail.js";
import {
  bindMapEntityCards as bindMapSurfaceEntityCards,
  destroyLeafletMap as destroySurfaceLeafletMap,
  focusEntityOnRenderedMap,
  queueLeafletBoundsFit,
  renderLeafletMapSurface,
  renderMapPageSurface,
  requestedMapEntity,
  scheduleMapEntityFocus as scheduleSurfaceMapEntityFocus
} from "./surfaces/map.js";
import { createStaticPageEditSurface } from "./surfaces/static-page-edit.js";

const NAV_KEYS = {
  home: ["home"],
  investigations: ["investigations", "investigation", "editor"],
  guide: ["guide"],
  submit: ["submit"],
  "get-involved": ["get-involved"],
  about: ["about"],
  merch: ["merch"],
  map: ["map"],
  workspace: ["workspace"]
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric"
});

const publicStateStore = createPublicStateStore({
  getSessionSecretKey: getRequestSignerSecretKey,
  page: () => document.body.dataset.page || "site",
  refreshDelayMs: publicStateRefreshDelayMs,
  shouldRefresh: shouldRefreshPublicState
});
const initialPublicState = publicStateStore.value;
const initialPosts = loadCachedPosts();
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

const investigationDetailSurface = createInvestigationDetailSurface({
  site: SITE,
  state,
  deps: {
    cleanSlug,
    archiveEntitiesForEntries,
    buildArticleMetaLine,
    connectStructuredUnitOverlay,
    destroyLeafletPreview,
    editorEntryAllowed,
    enrichArticleEntities,
    formatDate,
    getPublicState,
    getRequestSignerSecretKey,
    loadDraftBySlug,
    publishReviewDecision,
    queueLeafletBoundsFit,
    refreshPosts,
    renderComments,
    renderError,
    renderInvestigationCard,
    renderLeafletPreviewMap,
    renderLoadingState,
    renderMarkdown,
    renderRecordList,
    renderTagList,
    setText,
    trustedAdminPubkeys
  }
});

const staticPageEditSurface = createStaticPageEditSurface({
  site: SITE,
  state,
  deps: {
    afterSnapshotReview: async () => {
      state.publicState = (await publicStateStore.hydrate({ force: true, reason: "page-snapshot-review" })).value;
      notificationState.reset();
      void hydrateNotifications(true);
    },
    connectStaticPageOverlay,
    editorEntryAllowed,
    formatDate,
    formatLocalTimestamp,
    getPublicState,
    getRequestSignerSecretKey,
    loadDraftBySlug,
    publishReviewDecision,
    publishTaggedJson,
    sanitizeTrustedHtml,
    trustedAdminPubkeys
  }
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
  onChange: () => renderNavigation(),
  getSession: () => state.session,
  getViewerPubkey: () => state.viewer?.pubkey || "",
  getPublicState: (force) => getPublicState(force),
  buildNotifications: ({ publicState }) => buildSiteNotifications({
    publicState,
    viewer: state.viewer,
    sessionSecretKeyHex: state.session?.secretKeyHex || ""
  })
});

publicStateStore.subscribe((snapshot) => {
  state.publicState = snapshot.value;
  state.publicStateDigest = snapshot.digest;
});

document.addEventListener("DOMContentLoaded", () => {
  initExternalLinks();
  initNavigation();
  initLinkPrefetch();
  bindGlobalSiteInteractions();
  initInvestigationCards();
  void investigationDetailSurface.init();
  void initMarkdownArticles();
  void initMapPage();
  void initAuthoringEntry();
  void staticPageEditSurface.init();
  startBackgroundPrefetch();
  window.addEventListener("truecost:session-changed", handleSessionChanged);
  document.addEventListener("visibilitychange", handlePublicVisibilityChange);
  window.addEventListener("focus", handlePublicWindowFocus);
  window.addEventListener("pagehide", handlePublicPageHide);
});

function bindGlobalSiteInteractions() {
  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const userTrigger = target.closest("[data-open-user]");
    if (userTrigger instanceof HTMLElement) {
      event.preventDefault();
      openUserProfileModal(userTrigger.getAttribute("data-open-user") || "");
      return;
    }

    if (target.matches("[data-user-modal]") || target.closest("[data-close-user-modal]")) {
      event.preventDefault();
      closeUserProfileModal();
    }
  });
}

function initNavigation() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-site-nav]");
  if (!nav) return;

  const setNavigationOpen = (open) => {
    nav.classList.toggle("is-open", open);
    document.body.classList.toggle("is-nav-open", open);
    if (toggle) {
      toggle.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
      toggle.setAttribute("title", open ? "Close navigation" : "Open navigation");
    }
  };

  renderNavigation();

  if (toggle) {
    toggle.innerHTML = `
      <span class="nav-toggle__bars" aria-hidden="true">
        <span></span>
        <span></span>
        <span></span>
      </span>
      <span class="sr-only">Open navigation</span>
    `;
    toggle.addEventListener("click", () => {
      setNavigationOpen(!nav.classList.contains("is-open"));
    });
  }

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980) setNavigationOpen(false);
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const submenuToggle = target.closest("[data-submenu-toggle]");
    if (submenuToggle) {
      const group = submenuToggle.closest("[data-nav-group]");
      if (group) {
        const next = !group.classList.contains("is-open");
        for (const openGroup of document.querySelectorAll("[data-nav-group].is-open")) {
          if (openGroup !== group) openGroup.classList.remove("is-open");
        }
        group.classList.toggle("is-open", next);
      }
      return;
    }

    const profileToggle = target.closest("[data-profile-toggle]");
    if (profileToggle) {
      toggleProfileMenu(state.navigationUi);
      renderNavigation();
      return;
    }

    if (target.closest("[data-notification-toggle]")) {
      event.preventDefault();
      toggleNotificationsPanel(state.navigationUi, {
        count: countNotificationItems(notificationState.items),
        loading: notificationState.loading
      });
      renderNavigation();
      return;
    }

    if (target.closest("[data-clear-notifications]")) {
      event.preventDefault();
      notificationState.clear();
      keepProfileMenuOpen(state.navigationUi);
      clampNotificationsPanel(state.navigationUi, { count: 0, loading: false });
      renderNavigation();
      return;
    }

    const notificationLink = target.closest("[data-notification-link]");
    if (notificationLink) {
      notificationState.dismiss(notificationLink.getAttribute("data-notification-link") || "");
      clampNotificationsPanel(state.navigationUi, {
        count: countNotificationItems(notificationState.items),
        loading: notificationState.loading
      });
      return;
    }

    if (target.closest("[data-signout]")) {
      event.preventDefault();
      clearSession();
      state.session = null;
      state.viewer = null;
      setNavigationOpen(false);
      renderNavigation();
      window.location.reload();
      return;
    }

    for (const menu of document.querySelectorAll("[data-profile-menu].is-open")) {
      if (!menu.contains(target)) {
        closeProfileMenu(state.navigationUi);
        renderNavigation();
      }
    }
    for (const group of document.querySelectorAll("[data-nav-group].is-open")) {
      if (!group.contains(target)) group.classList.remove("is-open");
    }
  });

  document.addEventListener("error", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !target.matches("[data-avatar-sha]")) return;
    if (target.dataset.refreshing === "yes") return;
    target.dataset.refreshing = "yes";
    void refreshAvatarFromCache(target);
  }, true);

  void bootstrapRelayState();
}

async function bootstrapRelayState() {
  try {
    await ensureEventToolsLoaded();
    if (!state.guestSession) {
      state.guestSession = await getOrCreateGuestSession().catch(() => null);
    }
    const result = await publicStateStore.hydrate({ force: false, reason: "bootstrap" });
    state.publicState = result.value;
    state.publicStateDigest = result.digest;
    primeViewerFromSession(true);
  } catch {
    state.publicState = state.publicState || publicStateStore.value;
  }
  void publishVisitPulse();
  void hydrateNotifications();
  renderNavigation();
  schedulePublicStateRefresh();
}

function handlePublicVisibilityChange() {
  if (document.visibilityState === "visible") {
    void syncPublicState(true);
  } else {
    publicStateStore.clearRefresh();
  }
}

function handlePublicWindowFocus() {
  void syncPublicState(true);
}

function handlePublicPageHide() {
  publicStateStore.clearRefresh();
  staticPageEditSurface.destroyOverlay();
  investigationDetailSurface.destroy();
  stopPublicStateRepairPeer();
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
    void refreshPosts().catch(() => []);
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

function handleSessionChanged() {
  state.session = getStoredSession();
  state.viewer = null;
  state.userProfileModalPubkey = "";
  notificationState.reset();
  closeProfileMenu(state.navigationUi);
  primeViewerFromSession(hasNostrTools());
  renderNavigation();
  renderGlobalOverlays();
  staticPageEditSurface.destroyOverlay();
  investigationDetailSurface.destroy();
  state.staticEdit = null;
  if (state.session) {
    void hydrateNotifications(true);
  }
  void staticPageEditSurface.init();
}

function renderNavigation() {
  const nav = document.querySelector("[data-site-nav]");
  if (!nav) return;

  const page = document.body.dataset.page || "";
  const isLoggedIn = Boolean(state.session);
  const viewerPubkey = sessionViewerPubkey();
  const currentUser = isLoggedIn && viewerPubkey
    ? state.publicState?.users?.find((user) => user.pubkey === viewerPubkey) || null
    : null;
  const isAdmin = Boolean(
    isLoggedIn &&
      viewerPubkey &&
      trustedAdminPubkeys(state.publicState).includes(viewerPubkey)
  );
  const notifications = isLoggedIn ? notificationState.items.slice(0, 8) : [];
  const unreadCount = isLoggedIn ? countNotificationItems(notifications) : 0;
  const notificationsExpanded = clampNotificationsPanel(state.navigationUi, {
    count: unreadCount,
    loading: notificationState.loading
  });
  const mapEnabled = Boolean(state.publicState?.connected);
  nav.innerHTML = renderNavigationMarkup({
    page,
    navKeys: NAV_KEYS,
    isLoggedIn,
    isAdmin,
    currentUser,
    sessionUsername: state.session?.username || "",
    notifications,
    notificationsLoading: notificationState.loading,
    profileMenuOpen: state.navigationUi.profileMenuOpen,
    notificationsExpanded,
    mapEnabled,
    deps: {
      countUnreadNotifications: countNotificationItems,
      escapeAttribute,
      escapeHtml,
      safeAvatarUrl
    }
  });
  renderGlobalOverlays();

  for (const disabled of nav.querySelectorAll('[aria-disabled="true"]')) {
    disabled.addEventListener("click", (event) => event.preventDefault(), { once: false });
  }
}

function initExternalLinks() {
  setHrefFor("[data-donate-link]", SITE.donateUrl);
  setHrefFor("[data-merch-link]", SITE.merchUrl);
  setHrefFor("[data-youtube-link]", SITE.youtubeUrl);
  for (const link of document.querySelectorAll("[data-contact-email]")) {
    link.href = `mailto:${SITE.contactEmail}`;
    if (!link.textContent.trim()) link.textContent = SITE.contactEmail;
  }
}

async function initInvestigationCards() {
  const homeGrid = document.querySelector("[data-home-investigations]");
  const listGrid = document.querySelector("[data-investigation-list]");
  const rail = document.querySelector("[data-investigation-rail]");
  const archiveSummaryHosts = document.querySelectorAll("[data-archive-summary]");
  if (!homeGrid && !listGrid && !archiveSummaryHosts.length) return;

  const cachedPosts = clonePosts(state.posts);
  const cachedPublicState = state.publicState;
  const renderedCachedCards = Boolean(cachedPosts.length);
  if (cachedPosts.length) {
    const cachedState = cachedPublicState || { drafts: [], approvedEntities: [], users: [] };
    const canEditCached = editorEntryAllowed(cachedState);
    if (archiveSummaryHosts.length) hydrateArchiveSummaryLinks(cachedPosts, cachedState);
    if (homeGrid) {
      const count = Number(homeGrid.getAttribute("data-count") || "2");
      homeGrid.innerHTML = cachedPosts
        .filter((post) => post.featured)
        .slice(0, count)
        .map((post) => renderInvestigationCard(post, true))
        .join("");
    }
    if (listGrid) {
      const entries = canEditCached
        ? buildInvestigationArchiveEntries(cachedPosts, investigationDrafts(cachedState.drafts || []))
        : cachedPosts.map((post) => ({
            ...post,
            archiveStatus: "posted",
            statusLabel: "Posted",
            href: `./investigation.html?slug=${encodeURIComponent(post.slug)}`,
            actionLabel: "Open investigation"
          }));
      initializeArchiveView(entries, cachedState, canEditCached);
    }
  } else {
    if (homeGrid) homeGrid.innerHTML = renderLoadingState("Looking up featured investigations...");
    if (listGrid) listGrid.innerHTML = renderLoadingState("Looking up investigations...");
    if (rail) rail.innerHTML = renderLoadingState("Looking up filters and map data...");
  }

  try {
    const posts = await refreshPosts();
    const publicState = await getPublicState();
    const canEdit = editorEntryAllowed(publicState);
    if (archiveSummaryHosts.length) {
      hydrateArchiveSummaryLinks(posts, publicState);
    }
    if (homeGrid) {
      const count = Number(homeGrid.getAttribute("data-count") || "2");
      homeGrid.innerHTML = posts
        .filter((post) => post.featured)
        .slice(0, count)
        .map((post) => renderInvestigationCard(post, true))
        .join("");
    }
    if (listGrid) {
      const entries = canEdit
        ? buildInvestigationArchiveEntries(posts, investigationDrafts(publicState.drafts || []))
        : posts.map((post) => ({
            ...post,
            archiveStatus: "posted",
            statusLabel: "Posted",
            href: `./investigation.html?slug=${encodeURIComponent(post.slug)}`,
            actionLabel: "Open investigation"
          }));
      initializeArchiveView(entries, publicState, canEdit);
    }
  } catch {
    if (!renderedCachedCards) {
      renderError(homeGrid || listGrid, "Investigation feed unavailable.");
      if (rail) renderError(rail, "Archive tools unavailable.");
    }
  }
}

async function initAuthoringEntry() {
  const host = document.querySelector("[data-authoring-entry]");
  if (!host) return;
  const publicState = await getPublicState();
  if (!editorEntryAllowed(publicState)) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = `<a class="button" href="./editor.html">Create investigation</a>`;
}

function hydrateArchiveSummaryLinks(posts, publicState) {
  const hosts = [...document.querySelectorAll("[data-archive-summary]")];
  if (!hosts.length) return;
  const publishedCount = Array.isArray(posts) ? posts.length : 0;
  const activeCount = investigationDrafts(publicState?.drafts || []).length;
  const investigationCount = publishedCount > 0 ? publishedCount : activeCount;
  const investigationLabel = publishedCount > 0 ? "Published investigations" : "Active investigations";
  const entities = Array.isArray(publicState?.approvedEntities) ? publicState.approvedEntities : [];
  const mappedCount = entities.filter((entity) => Number.isFinite(entity.lat) && Number.isFinite(entity.lng)).length;
  const locationCount = dedupe(entities.map((entity) => String(entity.location || "").trim()).filter(Boolean)).length;
  const tagCount = dedupe(
    (Array.isArray(posts) ? posts : []).flatMap((post) => (Array.isArray(post?.tags) ? post.tags : []))
  ).length;
  const markup = `
    <a class="hero-summary__item" href="./investigations.html">
      <strong>${investigationCount}</strong>
      <span>${investigationLabel}</span>
    </a>
    <a class="hero-summary__item" href="./map.html#entity-index">
      <strong>${entities.length}</strong>
      <span>Tracked entities</span>
    </a>
    <a class="hero-summary__item" href="./map.html#map-board">
      <strong>${Math.max(mappedCount, locationCount)}</strong>
      <span>Locations</span>
    </a>
    <a class="hero-summary__item" href="./investigations.html">
      <strong>${tagCount}</strong>
      <span>Archive tags</span>
    </a>
  `;
  for (const host of hosts) {
    if (host instanceof HTMLElement) host.innerHTML = markup;
  }
}

async function initMarkdownArticles() {
  const article = document.querySelector("[data-markdown-article]");
  if (!article) return;
  article.innerHTML = renderLoadingState("Looking up article...");

  try {
    const source = article.getAttribute("data-markdown-src");
    if (!source) throw new Error("Markdown source missing.");
    const markdown = await fetchText(source);
    renderMarkdown(article, markdown);
    buildToc(article, document.querySelector("[data-article-toc]"));
    const publicState = await getPublicState();
    enrichArticleEntities(article, publicState);
  } catch {
    renderError(article, "This article could not be loaded.");
  }
}

async function initMapPage() {
  const list = document.querySelector("[data-map-list]");
  const canvas = document.querySelector("[data-map-canvas]");
  if (!list || !canvas) return;
  const mapReady = Boolean(state.map && state.mapCanvas === canvas);
  const cachedEntities = visibleMapEntities(state.publicState);
  const renderedCachedMap = Boolean(cachedEntities.length);
  if (cachedEntities.length) {
    renderMapPageSurface(list, canvas, cachedEntities, null, mapSurfaceDeps());
  } else {
    const hasStableMapData = Array.isArray(state.lastGoodMapEntities) && state.lastGoodMapEntities.length;
    if (!hasStableMapData) {
      list.innerHTML = renderLoadingState("Looking up map entries...");
    }
    if (!mapReady) {
      canvas.innerHTML = renderLoadingState("Looking up map data...");
    }
  }

  try {
    const publicState = await getPublicState();
    const entities = visibleMapEntities(publicState);
    if (!entities.length) {
      list.innerHTML = `<div class="empty-state">Published entities will appear here once approved entries are available.</div>`;
      destroyLeafletMap();
      state.mapViewDigest = createMapDataDigest(publicState);
      canvas.innerHTML = `<div class="map-empty">Map data unavailable.</div>`;
      return;
    }
    state.lastGoodMapEntities = entities.map((entity) => ({ ...entity }));

    const posts = await loadPosts().catch(() => []);
    const entityUsage = buildEntityUsage(posts, entities);
    renderMapPageSurface(list, canvas, entities, entityUsage, mapSurfaceDeps());
    state.mapViewDigest = createMapDataDigest({
      approvedEntities: entities
    });
  } catch {
    if (!renderedCachedMap) {
      renderError(list, "Map entries unavailable.");
      canvas.innerHTML = `<div class="map-empty">Map data unavailable.</div>`;
    }
  }
}

function visibleMapEntities(publicState) {
  const approvedEntities = Array.isArray(publicState?.approvedEntities) ? publicState.approvedEntities : [];
  if (approvedEntities.length) return approvedEntities;
  if (Array.isArray(state.lastGoodMapEntities) && state.lastGoodMapEntities.length) {
    return state.lastGoodMapEntities.map((entity) => ({ ...entity }));
  }
  return [];
}

async function renderComments(postSlug, publicState) {
  const panel = document.querySelector("[data-comment-panel]");
  if (!panel) return;

  const isLoggedIn = Boolean(state.session);
  const isAdmin = Boolean(state.viewer && trustedAdminPubkeys(publicState).includes(state.viewer.pubkey));
  const viewerPubkey = sessionViewerPubkey();
  const threadedComments = rankVisibleCommentThreads(publicState.commentThreadsByPost?.get(postSlug) || [], publicState, viewerPubkey);
  const renderedCount = countRenderedCommentNodes(threadedComments);
  const currentUser = isLoggedIn && viewerPubkey
    ? publicState.users.find((user) => user.pubkey === viewerPubkey) || null
    : null;
  const replyTargetId = state.commentReply?.postSlug === postSlug
    ? state.commentReply.commentId
    : "";
  if (replyTargetId && !publicState.commentIndex?.get(replyTargetId)) {
    state.commentReply = null;
  }

  panel.innerHTML = `
    <div class="comment-panel__head">
      <div>
        <div class="eyebrow">Discussion</div>
        <h2>Comments</h2>
      </div>
      <p>${renderCommentCountLabel(renderedCount)}</p>
    </div>
    ${
      isLoggedIn
        ? `
          <section class="comment-composer">
            ${renderAvatarBadge(currentUser, state.session?.username || "You", "comment-composer__avatar")}
            <form class="comment-composer__form" data-comment-form="root">
              <div class="comment-composer__head">
                <strong>Add a comment</strong>
                <span>Markdown works here. Keep it specific and tied to the post.</span>
              </div>
              <label class="sr-only" for="commentComposerInput">Comment</label>
              <textarea id="commentComposerInput" class="comment-composer__input" name="markdown" placeholder="Write a comment..." required></textarea>
              <div class="comment-composer__footer">
                <span class="muted-text">Comments show up with your profile.</span>
                <button class="button" type="submit">Post comment</button>
              </div>
              <div class="status-box" data-comment-status aria-live="polite"></div>
            </form>
          </section>
        `
        : `<div class="empty-state">Log in to comment or reply.</div>`
    }
    ${
      threadedComments.length
        ? `<div class="comment-list">${threadedComments
            .map((comment) =>
              renderComment(
                comment,
                publicState,
                { isAdmin, canReply: isLoggedIn, canVote: isLoggedIn, replyTargetId, viewerPubkey },
                {
                  formatDateTime,
                  renderAvatarBadge,
                  renderInlineReplyForm,
                  renderMiniMarkdown: (markdown) => renderMiniMarkdown(markdown, sanitizeTrustedHtml)
                }
              )
            )
            .join("")}</div>`
        : isLoggedIn
          ? `<div class="comment-list"><div class="empty-state">No comments yet. Start the discussion.</div></div>`
          : ""
    }
  `;

  const rootForm = panel.querySelector('[data-comment-form="root"]');
  if (rootForm) {
    rootForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = panel.querySelector("[data-comment-status]");
      const textarea = rootForm.elements.namedItem("markdown");
      const submitButton = rootForm.querySelector('button[type="submit"]');
      const markdown = String(textarea?.value || "").trim();
      if (!markdown) return;

      try {
        const viewer = await getViewer();
        if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true;
        if (status) {
          status.textContent = "Posting comment...";
          status.dataset.state = "pending";
        }
        const result = await publishTaggedJson({
          kind: SITE.nostr.kinds.comment,
          secretKeyHex: state.session.secretKeyHex,
          tags: [["a", postSlug]],
          content: {
            post_slug: postSlug,
            markdown,
            parent_id: "",
            root_id: ""
          }
        });
        rootForm.reset();
        appendLocalComment({
          id: result.event.id,
          post_slug: postSlug,
          markdown,
          author: viewer.pubkey,
          parent_id: "",
          root_id: "",
          created_at: Number(result.event.created_at || Math.floor(Date.now() / 1000))
        });
        state.viewer = viewer;
        await renderComments(postSlug, state.publicState);
      } catch (error) {
        if (status) {
          status.textContent = String(error?.message || error || "Comment failed.");
          status.dataset.state = "error";
        }
      } finally {
        if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false;
      }
    });
  }

  for (const replyButton of panel.querySelectorAll("[data-reply-comment]")) {
    replyButton.addEventListener("click", async () => {
      state.commentReply = {
        postSlug,
        commentId: replyButton.getAttribute("data-reply-comment") || ""
      };
      await renderComments(postSlug, publicState);
      const input = panel.querySelector('[data-comment-form="reply"] textarea');
      if (input instanceof HTMLTextAreaElement) input.focus();
    });
  }

  for (const cancelReply of panel.querySelectorAll("[data-cancel-reply]")) {
    cancelReply.addEventListener("click", async () => {
      state.commentReply = null;
      await renderComments(postSlug, publicState);
    });
  }

  for (const replyForm of panel.querySelectorAll('[data-comment-form="reply"]')) {
    replyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!(form instanceof HTMLFormElement)) return;
      const parentId = form.getAttribute("data-parent-id") || "";
      const replyTarget = publicState.commentIndex?.get(parentId) || null;
      const textarea = form.elements.namedItem("markdown");
      const submitButton = form.querySelector('button[type="submit"]');
      const status = form.querySelector("[data-comment-status]");
      const markdown = String(textarea?.value || "").trim();
      if (!markdown || !replyTarget) return;
      const rootId = String(replyTarget.root_id || replyTarget.parent_id || replyTarget.id || "").trim();
      try {
        const viewer = await getViewer();
        if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true;
        if (status instanceof HTMLElement) {
          status.textContent = "Posting reply...";
          status.dataset.state = "pending";
        }
        const result = await publishTaggedJson({
          kind: SITE.nostr.kinds.comment,
          secretKeyHex: state.session.secretKeyHex,
          tags: [
            ["a", postSlug],
            ["e", parentId],
            ["parent", parentId],
            ...(rootId ? [["root", rootId]] : [])
          ],
          content: {
            post_slug: postSlug,
            markdown,
            parent_id: parentId,
            root_id: rootId
          }
        });
        appendLocalComment({
          id: result.event.id,
          post_slug: postSlug,
          markdown,
          author: viewer.pubkey,
          parent_id: parentId,
          root_id: rootId,
          created_at: Number(result.event.created_at || Math.floor(Date.now() / 1000))
        });
        state.viewer = viewer;
        state.commentReply = null;
        await renderComments(postSlug, state.publicState);
      } catch (error) {
        if (status instanceof HTMLElement) {
          status.textContent = String(error?.message || error || "Reply failed.");
          status.dataset.state = "error";
        }
      } finally {
        if (submitButton instanceof HTMLButtonElement) submitButton.disabled = false;
      }
    });
  }

  for (const button of panel.querySelectorAll("[data-hide-comment]")) {
    button.addEventListener("click", async () => {
      try {
        await publishTaggedJson({
          kind: SITE.nostr.kinds.commentMod,
          secretKeyHex: state.session.secretKeyHex,
          tags: [["e", button.getAttribute("data-hide-comment") || ""], ["op", "hide"]],
          content: {
            target_id: button.getAttribute("data-hide-comment") || "",
            action: "hide"
          }
        });
        state.publicState = (await publicStateStore.hydrate({ force: true, reason: "comment-hide" })).value;
        await renderComments(postSlug, state.publicState);
      } catch {
        return;
      }
    });
  }

  for (const button of panel.querySelectorAll("[data-delete-comment]")) {
    button.addEventListener("click", async () => {
      if (!state.session?.secretKeyHex || !viewerPubkey) return;
      const commentId = String(button.getAttribute("data-delete-comment") || "").trim();
      const targetComment = publicState.commentIndex?.get(commentId) || null;
      if (!targetComment || targetComment.author !== viewerPubkey) return;
      if (!window.confirm("Delete this comment and its replies?")) return;
      try {
        button.disabled = true;
        applyLocalCommentDeletion(commentId, "Deleted by author");
        await renderComments(postSlug, state.publicState);
        await publishTaggedJson({
          kind: SITE.nostr.kinds.commentMod,
          secretKeyHex: state.session.secretKeyHex,
          tags: [["e", commentId], ["op", "hide"]],
          content: {
            target_id: commentId,
            action: "hide",
            note: "Deleted by author"
          }
        });
      } catch {
        state.publicState = await publicStateStore
          .hydrate({ force: true, reason: "comment-delete-recover" })
          .then((result) => result.value)
          .catch(() => state.publicState);
        await renderComments(postSlug, state.publicState);
      }
    });
  }

  for (const button of panel.querySelectorAll("[data-comment-vote]")) {
    button.addEventListener("click", async () => {
      if (!state.session?.secretKeyHex || !viewerPubkey) return;
      const commentId = String(button.getAttribute("data-comment-vote") || "").trim();
      const requestedValue = Number(button.getAttribute("data-comment-vote-value") || 0);
      if (!commentId || !Number.isFinite(requestedValue) || ![1, -1].includes(requestedValue)) return;
      const currentValue = resolveCurrentVoteForComment(publicState, commentId, viewerPubkey);
      const nextValue = currentValue === requestedValue ? 0 : requestedValue;
      const reranksRoots = commentAffectsThreadRanking(state.publicState, commentId);
      const rootPositions = reranksRoots ? captureRootCommentPositions(panel) : null;
      try {
        button.disabled = true;
        commitLocalPublicState(applyCommentVoteToPublicState(state.publicState, commentId, viewerPubkey, nextValue));
        if (reranksRoots) {
          await renderComments(postSlug, state.publicState);
          animateRootCommentReorder(panel, rootPositions, commentId);
        } else {
          updateRenderedCommentVoteState(panel, commentId, state.publicState, viewerPubkey);
        }
        await publishTaggedJson({
          kind: SITE.nostr.kinds.commentVote,
          secretKeyHex: state.session.secretKeyHex,
          tags: [
            ["d", `comment-vote:${commentId}`],
            ["e", commentId],
            ["v", String(nextValue)],
            ["op", nextValue > 0 ? "upvote" : nextValue < 0 ? "downvote" : "clear"]
          ],
          content: {
            target_id: commentId,
            value: nextValue
          }
        });
      } catch {
        commitLocalPublicState(applyCommentVoteToPublicState(state.publicState, commentId, viewerPubkey, currentValue));
        if (reranksRoots) {
          await renderComments(postSlug, state.publicState);
          animateRootCommentReorder(panel, rootPositions, commentId);
        } else {
          updateRenderedCommentVoteState(panel, commentId, state.publicState, viewerPubkey);
        }
      } finally {
        button.disabled = false;
      }
    });
  }

  focusRequestedComment(postSlug);
}

function countRenderedCommentNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : []).reduce(
    (total, node) => total + 1 + countRenderedCommentNodes(node?.replies || []),
    0
  );
}

function focusRequestedComment(postSlug, attempt = 0) {
  const requestedId = cleanSlug(new URLSearchParams(window.location.search).get("comment") || "") || String(new URLSearchParams(window.location.search).get("comment") || "").trim();
  if (!requestedId || state.highlightedCommentId === requestedId) return;
  const target = document.querySelector(`[data-comment-id="${CSS.escape(requestedId)}"]`);
  if (!(target instanceof HTMLElement)) {
    if (attempt < 20) {
      window.setTimeout(() => focusRequestedComment(postSlug, attempt + 1), Math.min(600 + attempt * 120, 1800));
    }
    return;
  }
  const container = target.closest(".comment-card");
  (container instanceof HTMLElement ? container : target).scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("comment-card--focus");
  state.highlightedCommentId = requestedId;
  window.setTimeout(() => target.classList.remove("comment-card--focus"), 1800);
}

function openUserProfileModal(pubkey) {
  const cleanPubkey = String(pubkey || "").trim().toLowerCase();
  if (!cleanPubkey) return;
  state.userProfileModalPubkey = cleanPubkey;
  renderGlobalOverlays();
  if (!(state.publicState?.users || []).some((item) => item.pubkey === cleanPubkey)) {
    void getPublicState().then(() => renderGlobalOverlays()).catch(() => null);
  }
}

function closeUserProfileModal() {
  state.userProfileModalPubkey = "";
  renderGlobalOverlays();
}

function ensureGlobalOverlayRoot() {
  let root = document.querySelector("[data-global-overlay-root]");
  if (root instanceof HTMLElement) return root;
  root = document.createElement("div");
  root.setAttribute("data-global-overlay-root", "");
  document.body.append(root);
  return root;
}

function renderGlobalOverlays() {
  const root = ensureGlobalOverlayRoot();
  const user = state.userProfileModalPubkey
    ? (state.publicState?.users || []).find((item) => item.pubkey === state.userProfileModalPubkey) || null
    : null;
  root.innerHTML = renderPublicUserProfileModal(user, {
    escapeAttribute,
    escapeHtml,
    profileInitials,
    safeAvatarUrl,
    safeSocialLinks: safeUserSocialLinks,
    shortKey: (value) => String(value || "").trim().slice(0, 12)
  });
}

function commentAuthorLabel(comment, publicState) {
  const author = publicState.users.find((user) => user.pubkey === comment.author);
  return author?.displayName || author?.username || "User";
}

function resolveUserKarma(publicState, pubkey) {
  const cleanPubkey = String(pubkey || "").trim().toLowerCase();
  if (!cleanPubkey) return 0;
  const comments = publicState?.commentsByAuthor instanceof Map
    ? publicState.commentsByAuthor.get(cleanPubkey) || []
    : [];
  return comments.reduce((total, comment) => total + resolveCommentVoteSummary(publicState, comment.id).score, 0);
}

function formatKarma(value) {
  const score = Number(value || 0) || 0;
  return score > 0 ? `+${score}` : String(score);
}

function commitLocalPublicState(nextPublicState) {
  state.publicState = publicStateStore.remember(nextPublicState);
  state.publicStateDigest = publicStateStore.digest;
  return state.publicState;
}

function safeAvatarUrl(value) {
  return sanitizeUrl(value, "src");
}

function safeUserSocialLinks(user) {
  return (Array.isArray(user?.socialLinks) ? user.socialLinks : [])
    .map((link) => sanitizeUrl(link, "href"))
    .filter(Boolean);
}

function renderAvatarBadge(user, fallbackLabel, className) {
  const label = user?.displayName || user?.username || fallbackLabel || "Profile";
  const avatarUrl = safeAvatarUrl(user?.avatarUrl || "");
  if (avatarUrl) {
    const blob = user.avatarBlob;
    const blobAttrs = blob?.sha256
      ? ` data-avatar-sha="${escapeAttribute(blob.sha256)}" data-avatar-url="${escapeAttribute(blob.url || avatarUrl)}" data-avatar-type="${escapeAttribute(blob.type || "")}" data-avatar-name="${escapeAttribute(blob.name || "")}"`
      : "";
    return `<span class="${className} ${className}--image"><img src="${escapeAttribute(avatarUrl)}" alt="${escapeAttribute(label)}"${blobAttrs}></span>`;
  }
  return `<span class="${className}">${escapeHtml(profileInitials(label))}</span>`;
}

function renderInvestigationCard(post, compact) {
  const href = post.href || `./investigation.html?slug=${encodeURIComponent(post.slug)}`;
  const eyebrow = post.eyebrow || "Case file";
  const actionLabel = post.actionLabel || "Open investigation";
  const statusPill = post.statusLabel
    ? `<span class="status-pill status-pill--${escapeAttribute(post.archiveStatus || "posted")}">${escapeHtml(post.statusLabel)}</span>`
    : "";
  if (!compact) {
    return `
      <article class="investigation-card investigation-card--list ${post.cardClass || ""}">
        <div class="investigation-card__body">
          <div class="investigation-card__head">
            <div class="eyebrow">${escapeHtml(eyebrow)}</div>
            ${statusPill}
          </div>
          <h3><a href="${href}">${escapeHtml(post.title)}</a></h3>
          <p class="card-meta">${escapeHtml(post.location)} <span>${escapeHtml(formatDate(post.date))}</span></p>
          <p class="card-summary">${escapeHtml(post.summary)}</p>
          <div class="tag-row">${renderTagList((post.tags || []).slice(0, 4))}</div>
        </div>
        <div class="investigation-card__rail">
          <a class="text-link" href="${href}">${escapeHtml(actionLabel)}</a>
        </div>
      </article>
    `;
  }
  return `
    <article class="investigation-card ${compact ? "investigation-card--compact" : ""}">
      <div class="investigation-card__head">
        <div class="eyebrow">${escapeHtml(eyebrow)}</div>
        ${statusPill}
      </div>
      <h3><a href="${href}">${escapeHtml(post.title)}</a></h3>
      <p class="card-meta">${escapeHtml(post.location)} <span>${escapeHtml(formatDate(post.date))}</span></p>
      <p>${escapeHtml(post.summary)}</p>
      <div class="tag-row">${renderTagList((post.tags || []).slice(0, compact ? 2 : 4))}</div>
      <a class="text-link" href="${href}">${escapeHtml(actionLabel)}</a>
    </article>
  `;
}

function buildInvestigationArchiveEntries(posts, drafts) {
  const staticSlugs = new Set((Array.isArray(posts) ? posts : []).map((post) => post.slug));
  const published = (Array.isArray(posts) ? posts : []).map((post) => ({
    ...post,
    archiveStatus: "posted",
    statusLabel: "Posted",
    href: `./investigation.html?slug=${encodeURIComponent(post.slug)}`,
    actionLabel: "Open investigation"
  }));
  const relayEntries = (Array.isArray(drafts) ? drafts : [])
    .filter((draft) => !(staticSlugs.has(draft.slug) && normalizeDraftStatus(draft.status) === "approved"))
    .map((draft) => {
      const status = normalizeDraftStatus(draft.status);
      const reviewAction = draftReviewAction(draft);
      const archived = ["candidate", "review", "submitted"].includes(status)
        ? "submitted"
        : status === "approved"
          ? "approved"
          : status;
      const isEditable = status === "draft" || status === "revision";
      const href = isEditable
        ? `./editor.html?slug=${encodeURIComponent(draft.slug)}`
        : `./investigation.html?draft=${encodeURIComponent(draft.slug)}`;
      return {
        ...draft,
        body: draft.markdown || "",
        archiveStatus: archived,
        statusLabel: draftStatusLabel(status, reviewAction),
        href,
        actionLabel: isEditable ? "Continue writing" : "Open preview",
        location: draft.location || "Draft location pending",
        summary: draft.summary || "This investigation does not have a summary yet.",
        eyebrow: "Investigation"
      };
    });
  return [...relayEntries, ...published]
    .sort((left, right) => {
      const leftStamp = sortDateValue(left);
      const rightStamp = sortDateValue(right);
      if (leftStamp !== rightStamp) return rightStamp - leftStamp;
      return String(left.title || "").localeCompare(String(right.title || ""));
    });
}

function activeArchiveFilters() {
  return state.archiveFilters || { tag: "", entity: "", status: "", author: "" };
}

function renderInlineReplyForm(comment, publicState) {
  return `
    <form class="comment-reply-form" data-comment-form="reply" data-parent-id="${escapeAttribute(comment.id)}">
      <div class="comment-reply-form__head">
        <strong>Reply to ${escapeHtml(commentAuthorLabel(comment, publicState))}</strong>
        <span>Your reply will appear directly in this thread.</span>
      </div>
      <textarea name="markdown" placeholder="Write a reply..." required></textarea>
      <div class="comment-reply-form__actions">
        <button class="button-ghost" type="button" data-cancel-reply>Cancel</button>
        <button class="button" type="submit">Reply</button>
      </div>
      <div class="status-box" data-comment-status aria-live="polite"></div>
    </form>
  `;
}

function appendLocalComment(comment) {
  if (!state.publicState) return;
  const nextAllComments = dedupeCommentList([...(state.publicState.allComments || []), comment]);
  commitLocalPublicState(applyDerivedCommentState(state.publicState, nextAllComments));
}

function applyLocalCommentDeletion(commentId, note = "Deleted by author") {
  if (!state.publicState?.allComments) return;
  const branchIds = collectCommentBranchIds(state.publicState.allComments, commentId);
  if (!branchIds.length) return;
  const branchSet = new Set(branchIds);
  const moderation = {
    action: "hide",
    note: String(note || "").trim(),
    updated_at: Math.floor(Date.now() / 1000),
    by: state.viewer?.pubkey || ""
  };
  const nextComments = (state.publicState.allComments || []).map((comment) => {
    if (!branchSet.has(String(comment.id || "").trim())) return comment;
    return {
      ...comment,
      visibility: "hidden",
      moderation:
        String(comment.id || "").trim() === String(commentId || "").trim()
          ? moderation
          : comment.moderation || moderation
    };
  });
  commitLocalPublicState(applyDerivedCommentState(state.publicState, nextComments));
}

function updateArchiveStatusMenu(shell = document.querySelector("[data-investigation-filters]")) {
  if (!(shell instanceof HTMLElement)) return;
  const current = shell.querySelector("[data-status-current]");
  const toggle = shell.querySelector("[data-status-toggle]");
  const panel = shell.querySelector("[data-status-panel]");
  const activeValue = String(activeArchiveFilters().status || "");
  if (current instanceof HTMLElement) current.textContent = archiveStatusLabel(activeValue);
  if (toggle instanceof HTMLElement) {
    toggle.setAttribute("aria-expanded", state.archiveStatusMenuOpen ? "true" : "false");
  }
  const menu = shell.querySelector("[data-status-menu]");
  if (menu instanceof HTMLElement) menu.classList.toggle("is-open", state.archiveStatusMenuOpen);
  if (panel instanceof HTMLElement) {
    panel.toggleAttribute("hidden", !state.archiveStatusMenuOpen);
  }
  for (const option of shell.querySelectorAll("[data-status-option]")) {
    if (!(option instanceof HTMLElement)) continue;
    const isActive = (option.getAttribute("data-status-option") || "") === activeValue;
    option.classList.toggle("is-active", isActive);
    option.setAttribute("aria-selected", isActive ? "true" : "false");
  }
}

function initializeArchiveView(entries, publicState, canEdit) {
  const listGrid = document.querySelector("[data-investigation-list]");
  const filtersShell = document.querySelector("[data-investigation-filters-shell]");
  const mapShell = document.querySelector("[data-investigation-map-shell]");
  if (!(listGrid instanceof HTMLElement)) return;
  state.archiveFilters = getCurrentArchiveFilters(window.location.search, canEdit);
  state.archiveFilterOpenField = "";
  state.archiveFilterHighlight = -1;
  state.archiveStatusMenuOpen = false;

  listGrid.innerHTML = `
    ${canEdit ? renderAuthoringLeadCard() : ""}
    <div class="story-list__results" data-investigation-results></div>
  `;
  if (filtersShell instanceof HTMLElement) {
    filtersShell.innerHTML = renderArchiveFiltersPanel({
      filters: activeArchiveFilters(),
      canEdit,
      statusMenuOpen: state.archiveStatusMenuOpen
    });
    bindInvestigationFilters(entries, publicState, canEdit);
  }
  if (mapShell instanceof HTMLElement) {
    mapShell.innerHTML = renderArchiveMapPanel();
  }
  renderInvestigationArchiveResults(entries, publicState, canEdit);
}

function bindInvestigationFilters(entries, publicState, canEdit) {
  const shell = document.querySelector("[data-investigation-filters]");
  if (!(shell instanceof HTMLElement) || shell.dataset.bound === "yes") return;
  shell.dataset.bound = "yes";

  shell.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.matches("[data-filter-input]")) return;
    state.archiveFilterOpenField = target.getAttribute("data-filter-input") || "";
    state.archiveFilterHighlight = 0;
    state.archiveStatusMenuOpen = false;
    updateArchiveStatusMenu(shell);
    updateArchiveFilterPanels(entries, publicState);
  });

  shell.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.matches("[data-filter-input]")) return;
    const name = target.getAttribute("data-filter-input") || "";
    state.archiveFilters = {
      ...activeArchiveFilters(),
      [name]: String(target.value || "").trim()
    };
    state.archiveFilterOpenField = name;
    state.archiveFilterHighlight = archiveFilterSuggestions(name, entries, publicState, activeArchiveFilters()).matching.length ? 0 : -1;
    syncArchiveFiltersToUrl(canEdit);
    scheduleArchiveResults(entries, publicState, canEdit);
  });

  shell.addEventListener("keydown", (event) => {
    const target = event.target;
    if (event.key === "Escape") {
      let handled = false;
      if (state.archiveStatusMenuOpen) {
        state.archiveStatusMenuOpen = false;
        updateArchiveStatusMenu(shell);
        handled = true;
      }
      if (state.archiveFilterOpenField) {
        state.archiveFilterOpenField = "";
        state.archiveFilterHighlight = -1;
        updateArchiveFilterPanels(entries, publicState);
        handled = true;
      }
      if (handled) {
        event.preventDefault();
      }
      if (!(target instanceof HTMLInputElement) || !target.matches("[data-filter-input]")) return;
      return;
    }
    if (!(target instanceof HTMLInputElement) || !target.matches("[data-filter-input]")) return;
    const field = target.getAttribute("data-filter-input") || "";
    const descriptor = archiveFilterSuggestions(field, entries, publicState, activeArchiveFilters());
    if (event.key === "ArrowDown" && descriptor.matching.length) {
      event.preventDefault();
      state.archiveFilterHighlight = cycleHighlightIndex(state.archiveFilterHighlight, descriptor.matching.length, 1);
      updateArchiveFilterPanels(entries, publicState);
      return;
    }
    if (event.key === "ArrowUp" && descriptor.matching.length) {
      event.preventDefault();
      state.archiveFilterHighlight = cycleHighlightIndex(state.archiveFilterHighlight, descriptor.matching.length, -1);
      updateArchiveFilterPanels(entries, publicState);
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    const nextValue = descriptor.matching[Math.max(0, state.archiveFilterHighlight)] || String(target.value || "").trim();
    commitArchiveFilterSelection(field, nextValue, shell, entries, publicState, canEdit);
  });

  shell.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const statusToggle = target.closest("[data-status-toggle]");
    if (statusToggle) {
      state.archiveStatusMenuOpen = !state.archiveStatusMenuOpen;
      state.archiveFilterOpenField = "";
      updateArchiveStatusMenu(shell);
      updateArchiveFilterPanels(entries, publicState);
      return;
    }

    const statusOption = target.closest("[data-status-option]");
    if (statusOption instanceof HTMLElement) {
      state.archiveFilters = {
        ...activeArchiveFilters(),
        status: String(statusOption.getAttribute("data-status-option") || "").trim().toLowerCase()
      };
      state.archiveStatusMenuOpen = false;
      updateArchiveStatusMenu(shell);
      syncArchiveFiltersToUrl(canEdit);
      renderInvestigationArchiveResults(entries, publicState, canEdit);
      return;
    }

    const clear = target.closest("[data-clear-investigation-filters]");
    if (clear) {
      state.archiveFilters = { tag: "", entity: "", status: "", author: "" };
      state.archiveFilterOpenField = "";
      state.archiveFilterHighlight = -1;
      state.archiveStatusMenuOpen = false;
      const tagInput = shell.querySelector('[data-filter-input="tag"]');
      const entityInput = shell.querySelector('[data-filter-input="entity"]');
      if (tagInput instanceof HTMLInputElement) tagInput.value = "";
      if (entityInput instanceof HTMLInputElement) entityInput.value = "";
      updateArchiveStatusMenu(shell);
      syncArchiveFiltersToUrl(canEdit);
      renderInvestigationArchiveResults(entries, publicState, canEdit);
      return;
    }

    const clearField = target.closest("[data-clear-archive-field]");
    if (clearField instanceof HTMLElement) {
      const field = clearField.getAttribute("data-clear-archive-field") || "";
      commitArchiveFilterSelection(field, "", shell, entries, publicState, canEdit);
      const input = shell.querySelector(`[data-filter-input="${CSS.escape(field)}"]`);
      if (input instanceof HTMLInputElement) {
        window.setTimeout(() => input.focus({ preventScroll: true }), 0);
      }
      return;
    }

    const suggestion = target.closest("[data-filter-suggestion]");
    if (suggestion instanceof HTMLElement) {
      const field = suggestion.getAttribute("data-filter-suggestion") || "";
      const value = suggestion.getAttribute("data-filter-value") || "";
      commitArchiveFilterSelection(field, value, shell, entries, publicState, canEdit);
    }
  });

  if (!shell.dataset.outsideBound) {
    shell.dataset.outsideBound = "yes";
    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (shell.contains(target)) return;
      let changed = false;
      if (state.archiveFilterOpenField) {
        state.archiveFilterOpenField = "";
        state.archiveFilterHighlight = -1;
        changed = true;
      }
      if (state.archiveStatusMenuOpen) {
        state.archiveStatusMenuOpen = false;
        updateArchiveStatusMenu(shell);
        changed = true;
      }
      if (changed) renderInvestigationArchiveResults(entries, publicState, canEdit);
    });
  }
}

function commitArchiveFilterSelection(field, value, shell, entries, publicState, canEdit) {
  const cleanField = String(field || "").trim();
  if (!cleanField) return;
  const input = shell?.querySelector?.(`[data-filter-input="${CSS.escape(cleanField)}"]`);
  if (input instanceof HTMLInputElement) input.value = String(value || "");
  state.archiveFilters = {
    ...activeArchiveFilters(),
    [cleanField]: String(value || "").trim()
  };
  state.archiveFilterOpenField = "";
  state.archiveFilterHighlight = -1;
  syncArchiveFiltersToUrl(canEdit);
  renderInvestigationArchiveResults(entries, publicState, canEdit);
}

function scheduleArchiveResults(entries, publicState, canEdit) {
  if (state.archiveFilterTimer) window.clearTimeout(state.archiveFilterTimer);
  state.archiveFilterTimer = window.setTimeout(() => {
    renderInvestigationArchiveResults(entries, publicState, canEdit);
  }, 120);
}

function renderInvestigationArchiveResults(entries, publicState, canEdit) {
  const host = document.querySelector("[data-investigation-results]");
  if (!(host instanceof HTMLElement)) return;
  const filters = activeArchiveFilters();
  const filteredEntries = filterArchiveEntries(entries, publicState, filters);
  host.innerHTML = filteredEntries.length
    ? filteredEntries.map((post) => renderInvestigationCard(post, false)).join("")
    : `<div class="empty-state">No investigations match these filters yet.</div>`;
  updateArchiveFilterPanels(entries, publicState);
  updateArchiveSummary(filteredEntries, entries);
  if (!state.archiveFilterOpenField) {
    updateArchiveMapPreview(filteredEntries, entries, publicState);
  }
}

function updateArchiveSummary(filteredEntries, entries) {
  const clearButton = document.querySelector("[data-clear-investigation-filters]");
  if (clearButton instanceof HTMLElement) {
    clearButton.hidden = !archiveHasActiveFilters();
  }
}

function updateArchiveFilterPanels(entries, publicState) {
  syncArchiveFilterFieldControls();
  const tagHost = document.querySelector('[data-filter-results="tag"]');
  if (tagHost instanceof HTMLElement) {
    tagHost.innerHTML = renderArchiveSuggestionPanel(
      "tag",
      archiveFilterSuggestions("tag", entries, publicState, activeArchiveFilters()),
      state.archiveFilterOpenField,
      state.archiveFilterHighlight
    );
  }
  const entityHost = document.querySelector('[data-filter-results="entity"]');
  if (entityHost instanceof HTMLElement) {
    entityHost.innerHTML = renderArchiveSuggestionPanel(
      "entity",
      archiveFilterSuggestions("entity", entries, publicState, activeArchiveFilters()),
      state.archiveFilterOpenField,
      state.archiveFilterHighlight
    );
  }
}

function syncArchiveFilterFieldControls() {
  const shell = document.querySelector("[data-investigation-filters]");
  if (!(shell instanceof HTMLElement)) return;
  const filters = activeArchiveFilters();
  for (const field of ["tag", "entity"]) {
    const value = String(filters?.[field] || "");
    const input = shell.querySelector(`[data-filter-input="${CSS.escape(field)}"]`);
    if (input instanceof HTMLInputElement && input.value !== value) {
      input.value = value;
    }
    const existing = shell.querySelector(`[data-clear-archive-field="${CSS.escape(field)}"]`);
    if (value && !(existing instanceof HTMLElement)) {
      const button = document.createElement("button");
      button.className = "workspace-search__clear archive-filters__clear-button";
      button.type = "button";
      button.dataset.clearArchiveField = field;
      button.setAttribute("aria-label", `Clear ${field} filter`);
      button.textContent = "×";
      input?.after(button);
    } else if (!value && existing instanceof HTMLElement) {
      existing.remove();
    }
  }
}

function syncArchiveFiltersToUrl(canEdit) {
  const url = new URL(window.location.href);
  const filters = activeArchiveFilters();
  if (filters.tag) url.searchParams.set("tag", filters.tag);
  else url.searchParams.delete("tag");
  if (filters.entity) url.searchParams.set("entity", filters.entity);
  else url.searchParams.delete("entity");
  if (canEdit && filters.status) url.searchParams.set("status", filters.status);
  else url.searchParams.delete("status");
  if (filters.author) url.searchParams.set("author", filters.author);
  else url.searchParams.delete("author");
  history.replaceState({}, "", url);
}

function updateArchiveMapPreview(filteredEntries, entries, publicState) {
  const tagsHost = document.querySelector("[data-investigation-map-tags]");
  const canvas = document.querySelector("[data-investigation-map-canvas]");
  if (!(tagsHost instanceof HTMLElement) || !(canvas instanceof HTMLElement)) return;
  const activeEntities = archiveEntitiesForEntries(filteredEntries, publicState);
  const defaultEntities = archiveHasActiveFilters() ? [] : archiveEntitiesForEntries(entries, publicState);
  const fallbackEntities =
    !archiveHasActiveFilters() && publicStateNeedsRepair(publicState) && state.lastGoodArchiveMapEntities.length
      ? state.lastGoodArchiveMapEntities
      : [];
  const entities = activeEntities.length ? activeEntities : defaultEntities.length ? defaultEntities : fallbackEntities;
  if (!entities.length) {
    tagsHost.innerHTML = "";
    destroyLeafletPreview(canvas);
    canvas.innerHTML = `<div class="map-empty">${archiveHasActiveFilters() ? "No locations tagged in filtered results." : "No locations tagged in the archive yet."}</div>`;
    return;
  }
  state.lastGoodArchiveMapEntities = entities.map((entity) => ({ ...entity }));

  const mappedEntities = entities.filter((entity) => Number.isFinite(entity.lat) && Number.isFinite(entity.lng));
  tagsHost.innerHTML = entities
    .slice(0, 4)
    .map((entity) => `<a class="tag tag--link" href="./map.html?entity=${encodeURIComponent(entity.slug)}">${escapeHtml(entity.name)}</a>`)
    .join("");
  if (!mappedEntities.length) {
    destroyLeafletPreview(canvas);
    canvas.innerHTML = `<div class="map-empty">No mapped locations in the current results.</div>`;
    return;
  }
  renderLeafletPreviewMap(canvas, mappedEntities, queueLeafletBoundsFit);
}

function destroyLeafletMap() {
  destroySurfaceLeafletMap(state);
}

function renderRecordList(records) {
  if (!Array.isArray(records) || !records.length) {
    return `<div class="empty-state">No structured notes attached to this post.</div>`;
  }
  return records
    .map((record) => {
      const label = escapeHtml(String(record.label || "Untitled note"));
      const note = record.note ? `<small>${escapeHtml(String(record.note))}</small>` : "";
      if (record.href) {
        return `<a class="record-item" href="${escapeAttribute(record.href)}"><strong>${label}</strong>${note}</a>`;
      }
      return `<div class="record-item"><strong>${label}</strong>${note}</div>`;
    })
    .join("");
}

function renderMarkdown(node, markdown) {
  node.innerHTML = renderMarkedHtml(markdown, { breaks: false, articleImages: true }, sanitizeTrustedHtml);

  for (const heading of node.querySelectorAll("h2, h3")) {
    heading.id = heading.id || slugify(heading.textContent || "section");
  }

  for (const link of node.querySelectorAll("a[href]")) {
    const href = link.getAttribute("href") || "";
    if (/^https?:\/\//.test(href)) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  }
}

function enrichArticleEntities(scope, publicState) {
  if (!scope || !publicState?.approvedEntities?.length) return;
  enrichEntityReferences(scope, publicState.approvedEntities);
}

async function loadPosts() {
  if (state.postsPromise) return state.postsPromise;
  if (Array.isArray(state.posts) && state.posts.length) {
    return clonePosts(state.posts);
  }
  return refreshPosts();
}

async function refreshPosts() {
  if (state.postsPromise) return state.postsPromise;
  state.postsPromise = fetchJson("./content/investigations/index.json")
    .then((data) => Promise.all((Array.isArray(data.files) ? data.files : []).map((file) => loadPost(file))))
    .then((posts) => {
      const nextPosts = posts
        .filter(Boolean)
        .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
      state.posts = clonePosts(nextPosts);
      persistCachedPosts(state.posts);
      return clonePosts(state.posts);
    })
    .catch((error) => {
      if (Array.isArray(state.posts) && state.posts.length) return clonePosts(state.posts);
      throw error;
    })
    .finally(() => {
      state.postsPromise = null;
    });
  return state.postsPromise;
}

async function loadPost(file) {
  const text = await fetchText(`./content/investigations/${file}`);
  const parsed = parseContentDocument(text, {
    file,
    slug: slugify(file.replace(/\.md$/i, ""))
  });
  return {
    ...parsed.meta,
    file,
    slug: parsed.meta.slug || slugify(file.replace(/\.md$/i, "")),
    body: parsed.body
  };
}

function clonePosts(posts) {
  return JSON.parse(JSON.stringify(Array.isArray(posts) ? posts : []));
}

function loadCachedPosts() {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(postsCacheKey());
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? clonePosts(parsed) : [];
  } catch {
    return [];
  }
}

function persistCachedPosts(posts) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(postsCacheKey(), JSON.stringify(clonePosts(posts)));
  } catch {
    return;
  }
}

function postsCacheKey() {
  return `${SITE.nostr.storageNamespace}.posts-cache`;
}

async function loadDraftBySlug(slug) {
  const clean = cleanSlug(slug || "");
  if (!clean) return null;
  await ensureEventToolsLoaded();
  const tools = window.EventTools || window.NostrTools;
  if (!tools?.SimplePool) return null;
  const relays = dedupe([...(SITE.nostr.authorityRelays || []), ...(SITE.nostr.relays || [])]);
  if (!relays.length) return null;
  const pool = new tools.SimplePool();
  try {
    const events = await Promise.race([
      pool.querySync(relays, {
        kinds: [SITE.nostr.kinds.draft],
        "#d": [clean],
        "#t": [SITE.nostr.appTag],
        limit: 24
      }, {}),
      timeoutAfter(Math.max(Number(SITE.nostr.authorityConnectTimeoutMs || 0), 9000))
    ]);
    const ordered = (Array.isArray(events) ? events : [])
      .map(parseDraftEvent)
      .filter(Boolean)
      .sort(compareDraftEventsDesc);
    if (!ordered.length) return null;
    return {
      ...ordered[0],
      revisions: ordered,
      revisionCount: ordered.length
    };
  } catch {
    return null;
  } finally {
    pool.close(relays);
  }
}

function parseDraftEvent(event) {
  if (!event || Number(event.kind) !== Number(SITE.nostr.kinds.draft)) return null;
  let payload = {};
  try {
    payload = JSON.parse(String(event.content || ""));
  } catch {
    payload = {};
  }
  const slug = cleanSlug(payload?.slug || eventTagValue(event, "d"));
  if (!slug) return null;
  const contentType = String(payload?.content_type || payload?.contentType || "post").trim().toLowerCase() || "post";
  return {
    slug,
    author: String(event.pubkey || "").trim().toLowerCase(),
    title: String(payload?.title || slug).trim(),
    summary: String(payload?.summary || "").trim(),
    location: String(payload?.location || "Undisclosed location").trim(),
    status: String(payload?.status || "draft").trim(),
    tags: Array.isArray(payload?.tags) ? payload.tags : [],
    markdown: String(payload?.markdown || "").trim(),
    featured: Boolean(payload?.featured),
    date: String(payload?.date || new Date(Number(event.created_at || 0) * 1000 || Date.now()).toISOString().slice(0, 10)),
    entity_refs: Array.isArray(payload?.entity_refs) ? payload.entity_refs : [],
    content_type: contentType,
    page_id: cleanSlug(payload?.page_id || payload?.pageId || ""),
    page_path: String(payload?.page_path || payload?.pagePath || "").trim(),
    page_content: payload?.page_content && typeof payload.page_content === "object"
      ? payload.page_content
      : payload?.pageContent && typeof payload.pageContent === "object"
        ? payload.pageContent
        : null,
    created_at: Number(event.created_at || 0) || 0,
    id: event.id,
    _event: event
  };
}

function eventTagValue(event, key) {
  const tag = (event?.tags || []).find((item) => Array.isArray(item) && item[0] === key);
  return String(tag?.[1] || "");
}

function compareDraftEventsDesc(left, right) {
  const leftTime = Number(left?.created_at || left?._event?.created_at || 0);
  const rightTime = Number(right?.created_at || right?._event?.created_at || 0);
  if (leftTime !== rightTime) return rightTime - leftTime;
  return String(right?.id || right?._event?.id || "").localeCompare(String(left?.id || left?._event?.id || ""));
}

function timeoutAfter(ms) {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error("Relay connection timed out.")), Number(ms) || 0);
  });
}

function buildEntityUsage(posts, entities) {
  const usage = new Map();
  for (const post of posts) {
    const refs = new Set([
      ...(Array.isArray(post.entity_refs) ? post.entity_refs : []),
      ...collectEntityRefsFromText(post.body, entities)
    ]);
    for (const slug of refs) {
      const list = usage.get(slug) || [];
      list.push({
        slug: post.slug,
        title: post.title,
        date: post.date
      });
      usage.set(slug, list);
    }
  }
  return usage;
}

async function publishReviewDecision(panel, draft, button) {
  const action = button.getAttribute("data-review-action") || "";
  let statusBox = panel.querySelector("[data-review-status]");
  if (!state.session || !editorEntryAllowed(state.publicState)) return;
  if (!(statusBox instanceof HTMLElement)) {
    statusBox = document.createElement("div");
    statusBox.className = "status-box";
    statusBox.setAttribute("data-review-status", "");
    statusBox.setAttribute("aria-live", "polite");
    panel.append(statusBox);
  }
  button.setAttribute("disabled", "disabled");
  if (statusBox instanceof HTMLElement) {
    statusBox.textContent = "Saving review decision...";
    statusBox.dataset.state = "pending";
  }
  try {
    await publishTaggedJson({
      kind: SITE.nostr.kinds.draft,
      secretKeyHex: state.session.secretKeyHex,
      tags: [
        ["d", draft.slug],
        ["status", reviewStatusForAction(action)],
        ["review", action],
        ...(isPageDraft(draft) ? [["content", "page"], ["page", cleanSlug(draft.page_id || "")]] : [])
      ],
      content: {
        ...draft,
        author_pubkey: draftOwnerPubkey(draft),
        status: reviewStatusForAction(action),
        reviewed_at: new Date().toISOString(),
        reviewed_by: state.viewer?.pubkey || "",
        review_action: action
      }
    });
    state.publicState = (await publicStateStore.hydrate({ force: true, reason: "review-action" })).value;
    notificationState.reset();
    void hydrateNotifications(true);
    if (statusBox instanceof HTMLElement) {
      statusBox.textContent = reviewActionMessage(action, draft);
      statusBox.dataset.state = "success";
    }
    const destination = isPageDraft(draft)
      ? pageDraftHref(draft, reviewStatusForAction(action))
      : "./investigations.html";
    window.setTimeout(() => {
      window.location.href = destination;
    }, 700);
  } catch (error) {
    if (statusBox instanceof HTMLElement) {
      statusBox.textContent = String(error?.message || error || "Review action failed.");
      statusBox.dataset.state = "error";
    }
  } finally {
    button.removeAttribute("disabled");
  }
}

async function hydrateNotifications(force = false) {
  const publicState = await getPublicState();
  primeViewerFromSession(false);
  await notificationState.hydrate({ publicState, force });
}

function renderEntityCard(entity, posts) {
  return `
    <article class="entity-card entity-card--interactive" id="entity-card-${escapeAttribute(entity.slug)}" data-entity-card="${escapeAttribute(entity.slug)}" tabindex="0">
      <div class="eyebrow">${escapeHtml(entity.type || "entity")}</div>
      <h3>${escapeHtml(entity.name)}</h3>
      <p>${escapeHtml(entity.location)}</p>
      <p>${escapeHtml(entity.notes || "Placeholder description for this entity entry.")}</p>
      <div class="tag-row">
        <span class="tag">${escapeHtml(entity.status)}</span>
        ${Number.isFinite(entity.lat) && Number.isFinite(entity.lng) ? `<span class="tag">${escapeHtml(entity.lat.toFixed(2))}, ${escapeHtml(entity.lng.toFixed(2))}</span>` : ""}
      </div>
      <div class="entity-card__links">
        ${
          posts.length
            ? posts
                .map(
                  (post) =>
                    `<a href="./investigation.html?slug=${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a>`
                )
                .join("")
            : `<span class="muted-text">No investigation mentions this entry yet.</span>`
        }
      </div>
    </article>
  `;
}

function mapSurfaceDeps() {
  return {
    mapState: state,
    escapeHtml,
    renderEntityCard,
    renderLeafletMapSurface: (canvas, entities) =>
      renderLeafletMapSurface(canvas, entities, state, {
        escapeHtml,
        scheduleMapEntityFocus,
        queryEntityCard: (slug) => document.querySelector(`[data-entity-card="${slug}"]`)
      }),
    bindMapEntityCards: () => bindMapSurfaceEntityCards((slug) => scheduleMapEntityFocus(slug)),
    focusRequestedEntity,
    queryEntityCard: (slug) => document.querySelector(`[data-entity-card="${slug}"]`)
  };
}

function scheduleMapEntityFocus(slug, options = {}, attempt = 0) {
  scheduleSurfaceMapEntityFocus(
    slug,
    state,
    {
      cleanSlug,
      queryEntityCard: (value) => document.querySelector(`[data-entity-card="${value}"]`)
    },
    options,
    attempt
  );
}

function focusRequestedEntity() {
  const requested = requestedMapEntity(window.location.search, cleanSlug);
  if (!requested) return;
  scheduleMapEntityFocus(requested);
}

async function getPublicState() {
  if (state.publicState) return state.publicState;
  try {
    await ensureEventToolsLoaded();
    if (!state.guestSession) {
      state.guestSession = await getOrCreateGuestSession().catch(() => null);
    }
    const result = await publicStateStore.hydrate({ force: false, reason: "get-public-state" });
    state.publicState = result.value;
    state.publicStateDigest = result.digest;
    primeViewerFromSession(true);
    if (state.session) {
      void hydrateNotifications();
    }
    renderNavigation();
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

function publicStateRefreshDelayMs() {
  const configured = Number(SITE.nostr.publicRefreshMs || 15000);
  return Number.isFinite(configured) && configured > 0 ? configured : 15000;
}

function shouldRefreshPublicState() {
  if (document.visibilityState === "hidden") return false;
  if (document.querySelector("[data-workspace-page]")) return false;
  return Boolean(
    state.session ||
      document.querySelector("[data-home-investigations], [data-investigation-list], [data-archive-summary], [data-investigation-article], [data-map-list], [data-map-canvas]")
  );
}

function schedulePublicStateRefresh(delay = publicStateRefreshDelayMs()) {
  publicStateStore.schedule(delay);
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
  renderNavigation();
  if (state.session) {
    void hydrateNotifications(true);
  }

  if (document.querySelector("[data-home-investigations], [data-investigation-list], [data-archive-summary]")) {
    if (!archiveInteractionActive()) {
      await initInvestigationCards();
    }
  }

  if (document.querySelector("[data-map-list]") && document.querySelector("[data-map-canvas]")) {
    const nextMapDigest = createMapDataDigest(state.publicState);
    if (!mapInteractionActive() && (!state.map || nextMapDigest !== state.mapViewDigest)) {
      await initMapPage();
    }
  }

  if (document.querySelector("[data-investigation-article]")) {
    await refreshVisibleCommentThread();
  }

  window.dispatchEvent(new CustomEvent("truecost:public-state-updated", {
    detail: {
      publicState: state.publicState
    }
  }));
}

function archiveInteractionActive() {
  const active = document.activeElement;
  return active instanceof HTMLElement && Boolean(active.closest("[data-investigation-filters]"));
}

function mapInteractionActive() {
  const active = document.activeElement;
  return active instanceof HTMLElement && Boolean(active.closest("[data-map-shell], [data-map-list]"));
}

async function refreshVisibleCommentThread() {
  const panel = document.querySelector("[data-comment-panel]");
  if (!(panel instanceof HTMLElement) || panel.hidden) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest("[data-comment-panel]")) return;
  const params = new URLSearchParams(window.location.search);
  const draftSlug = cleanSlug(params.get("draft") || "");
  if (draftSlug) return;
  const slug = cleanSlug(params.get("slug") || "");
  if (!slug || !state.publicState) return;
  await renderComments(slug, state.publicState);
}

function createMapDataDigest(publicState) {
  return JSON.stringify(
    (publicState?.approvedEntities || []).map((entity) => [
      entity.slug,
      entity.status || "",
      Number.isFinite(entity.lat) ? Number(entity.lat).toFixed(5) : "",
      Number.isFinite(entity.lng) ? Number(entity.lng).toFixed(5) : "",
      String(entity.updated_at || entity.created_at || "")
    ])
  );
}

async function getViewer() {
  if (state.viewer?.secretKeyHex) return state.viewer;
  if (!state.session) throw new Error("Log in first.");
  await ensureEventToolsLoaded();
  state.viewer = deriveIdentity(state.session.secretKeyHex);
  return state.viewer;
}

function editorEntryAllowed(publicState) {
  if (!state.session || !trustedAdminPubkeys(publicState).length) return false;
  const viewerPubkey = sessionViewerPubkey();
  if (!viewerPubkey) return false;
  return trustedAdminPubkeys(publicState).includes(viewerPubkey);
}

function primeViewerFromSession(deriveWhenAvailable = false) {
  if (!state.session) {
    state.viewer = null;
    return null;
  }
  if (state.viewer?.pubkey) {
    if (!state.viewer.secretKeyHex && deriveWhenAvailable && hasNostrTools()) {
      try {
        state.viewer = deriveIdentity(state.session.secretKeyHex);
      } catch {
        return state.viewer;
      }
    }
    return state.viewer;
  }
  const sessionPubkey = String(state.session.pubkey || "").trim();
  if (sessionPubkey) {
    state.viewer = { pubkey: sessionPubkey };
  }
  if ((!state.viewer || !state.viewer.pubkey) && deriveWhenAvailable && hasNostrTools()) {
    try {
      state.viewer = deriveIdentity(state.session.secretKeyHex);
    } catch {
      state.viewer = state.viewer?.pubkey ? state.viewer : null;
    }
  }
  return state.viewer;
}

function sessionViewerPubkey() {
  return String(primeViewerFromSession(false)?.pubkey || "").trim();
}

function trustedAdminPubkeys(publicState) {
  const admins = new Set(normalizeAdminPubkeys(publicState));
  const rootAdminPubkey = String(publicState?.rootAdminPubkey || SITE.nostr.rootAdminPubkey || "").trim();
  if (rootAdminPubkey) admins.add(rootAdminPubkey);
  return [...admins];
}

async function getRequestSignerSecretKey() {
  if (state.session?.secretKeyHex) return state.session.secretKeyHex;
  if (state.guestSession?.secretKeyHex) return state.guestSession.secretKeyHex;
  await ensureEventToolsLoaded();
  state.guestSession = await getOrCreateGuestSession().catch(() => null);
  return state.guestSession?.secretKeyHex || "";
}

async function publishVisitPulse() {
  try {
    const secretKeyHex = await getRequestSignerSecretKey();
    if (!secretKeyHex || !SITE.nostr.kinds.visitPulse) return;
    const day = new Date().toISOString().slice(0, 10);
    const markerKey = `${SITE.nostr.storageNamespace}.visitPulse.${day}`;
    if (window.localStorage.getItem(markerKey)) return;
    await publishTaggedJson({
      kind: SITE.nostr.kinds.visitPulse,
      secretKeyHex,
      tags: [
        ["t", SITE.nostr.appTag],
        ["k", document.body.dataset.page || "site"]
      ],
      content: {
        day,
        page: document.body.dataset.page || "site"
      }
    });
    window.localStorage.setItem(markerKey, String(Date.now()));
  } catch {
    return;
  }
}

async function refreshAvatarFromCache(target) {
  try {
    const secretKeyHex = await getRequestSignerSecretKey();
    if (!secretKeyHex) throw new Error("No request signer available.");
    const reference = {
      sha256: target.dataset.avatarSha || "",
      url: target.dataset.avatarUrl || target.currentSrc || target.src,
      access: "public",
      cipher: "none",
      type: target.dataset.avatarType || "image/jpeg",
      name: target.dataset.avatarName || "avatar"
    };
    await ensureBlobAvailable(secretKeyHex, reference);
    const src = reference.url;
    target.src = `${src}${src.includes("?") ? "&" : "?"}refresh=${Date.now()}`;
  } catch {
    target.dataset.refreshing = "no";
  }
}

async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.json();
}

async function fetchText(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Failed to load ${path}`);
  return response.text();
}

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.textContent = value;
}

function setHrefFor(selector, href) {
  for (const link of document.querySelectorAll(selector)) {
    link.href = href;
  }
}

function formatDate(value) {
  return value ? dateFormatter.format(new Date(`${value}T00:00:00`)) : "Undated";
}

function formatDateTime(unixSeconds) {
  if (!unixSeconds) return "Undated";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(unixSeconds * 1000));
}

function formatLocalTimestamp(value) {
  if (!value) return "just now";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function buildArticleMetaLine(post) {
  const parts = [formatDate(post.date)];
  if (post.location) parts.push(String(post.location));
  if (post.statusLabel || post.status) parts.push(String(post.statusLabel || post.status));
  return parts.filter(Boolean).join(" · ");
}

function sortDateValue(item) {
  const raw = String(item?.date || "").trim();
  const parsed = raw ? Date.parse(`${raw}T00:00:00`) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  const createdAt = Number(item?.created_at || 0);
  return Number.isFinite(createdAt) ? createdAt * 1000 : 0;
}
