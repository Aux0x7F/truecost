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
  loadAdminKeyShare,
  loadInboxSubmissions,
  loadPublicState,
  loadSubmissionThread,
  loadUserSubmissions,
  publishTaggedJson
} from "./core/nostr.js";
import { clearSession, getOrCreateGuestSession, getStoredGuestSession, getStoredSession } from "./core/session.js";

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

const ARCHIVE_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "In review" },
  { value: "approved", label: "Approved" },
  { value: "posted", label: "Posted" }
];

const STATIC_PAGE_META = Object.freeze({
  home: { title: "Home page", path: "./index.html" },
  investigations: { title: "Investigations page", path: "./investigations.html" },
  guide: { title: "Guide page", path: "./guide.html" },
  submit: { title: "Submit page", path: "./submit.html" },
  "get-involved": { title: "Get involved page", path: "./get-involved.html" },
  about: { title: "About page", path: "./about.html" },
  merch: { title: "Merch page", path: "./merch.html" },
  map: { title: "Map page", path: "./map.html" }
});
const STATIC_EDITABLE_PAGES = new Set(Object.keys(STATIC_PAGE_META));

const state = {
  session: getStoredSession(),
  guestSession: getStoredGuestSession(),
  viewer: null,
  publicState: null,
  postsPromise: null,
  commentReply: null,
  notifications: [],
  notificationsLoading: false,
  profileMenuOpen: false,
  notificationsExpanded: false,
  archiveFilters: null,
  archiveFilterOpenField: "",
  archiveStatusMenuOpen: false,
  archiveFilterTimer: null,
  pageOverlay: null,
  staticEdit: null,
  staticEditListenersBound: false,
  map: null,
  markers: null,
  markerIndex: null
};

document.addEventListener("DOMContentLoaded", () => {
  initExternalLinks();
  initNavigation();
  initInvestigationCards();
  void initInvestigationDetail();
  void initMarkdownArticles();
  void initMapPage();
  void initAuthoringEntry();
  void initStaticPageEditing();
  window.addEventListener("truecost:session-changed", handleSessionChanged);
});

function initNavigation() {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-site-nav]");
  if (!nav) return;

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
      const isOpen = nav.classList.toggle("is-open");
      toggle.classList.toggle("is-open", isOpen);
      toggle.setAttribute("aria-expanded", String(isOpen));
    });
  }

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
      state.profileMenuOpen = !state.profileMenuOpen;
      if (!state.profileMenuOpen) state.notificationsExpanded = false;
      renderNavigation();
      return;
    }

    if (target.closest("[data-notification-toggle]")) {
      event.preventDefault();
      state.profileMenuOpen = true;
      if (!state.notifications.length && !state.notificationsLoading) {
        state.notificationsExpanded = false;
      } else {
        state.notificationsExpanded = !state.notificationsExpanded;
      }
      renderNavigation();
      return;
    }

    if (target.closest("[data-clear-notifications]")) {
      event.preventDefault();
      clearNotifications();
      state.notificationsExpanded = false;
      state.profileMenuOpen = true;
      renderNavigation();
      return;
    }

    const notificationLink = target.closest("[data-notification-link]");
    if (notificationLink) {
      dismissNotification(notificationLink.getAttribute("data-notification-link") || "");
      if (!state.notifications.length) state.notificationsExpanded = false;
      return;
    }

    if (target.closest("[data-signout]")) {
      event.preventDefault();
      clearSession();
      state.session = null;
      state.viewer = null;
      renderNavigation();
      window.location.reload();
      return;
    }

    for (const menu of document.querySelectorAll("[data-profile-menu].is-open")) {
      if (!menu.contains(target)) {
        state.profileMenuOpen = false;
        state.notificationsExpanded = false;
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
    state.publicState = await loadPublicState();
    if (state.session) {
      state.viewer = deriveIdentity(state.session.secretKeyHex);
    }
  } catch {
    state.publicState = null;
  }
  void publishVisitPulse();
  void hydrateNotifications();
  renderNavigation();
}

function handleSessionChanged() {
  state.session = getStoredSession();
  state.viewer = null;
  state.notifications = [];
  state.notificationsLoading = false;
  state.profileMenuOpen = false;
  state.notificationsExpanded = false;
  if (state.session && hasNostrTools()) {
    try {
      state.viewer = deriveIdentity(state.session.secretKeyHex);
    } catch {
      state.viewer = null;
    }
  }
  renderNavigation();
  destroyStaticPageOverlay();
  state.staticEdit = null;
  if (state.session) {
    void hydrateNotifications(true);
  }
  void initStaticPageEditing();
}

function renderNavigation() {
  const nav = document.querySelector("[data-site-nav]");
  if (!nav) return;

  const page = document.body.dataset.page || "";
  const isLoggedIn = Boolean(state.session);
  const currentUser = isLoggedIn && state.viewer
    ? state.publicState?.users?.find((user) => user.pubkey === state.viewer.pubkey) || null
    : null;
  const isAdmin = Boolean(
    isLoggedIn &&
      state.viewer &&
      trustedAdminPubkeys(state.publicState).includes(state.viewer.pubkey)
  );
  const notifications = isLoggedIn ? state.notifications.slice(0, 8) : [];
  const unreadCount = isLoggedIn ? notifications.length : 0;
  const notificationsExpanded = unreadCount || state.notificationsLoading
    ? state.notificationsExpanded
    : false;
  const mapEnabled = Boolean(state.publicState?.connected);
  const mapCurrent = NAV_KEYS.map.includes(page);

  nav.innerHTML = `
    <a class="${navLinkClass(page, "home")}" href="./index.html">Home</a>
    ${
      isAdmin
        ? `
          <div class="nav-group ${NAV_KEYS.investigations.includes(page) ? "is-current" : ""}" data-nav-group>
            <button class="nav-group__toggle" type="button" data-submenu-toggle>
              Investigations
            </button>
            <div class="nav-group__panel">
              <a class="${navLinkClass(page, "investigations")}" href="./investigations.html">View Investigations</a>
              <a href="./editor.html">Create Investigation</a>
            </div>
          </div>
        `
        : `<a class="${navLinkClass(page, "investigations")}" href="./investigations.html">Investigations</a>`
    }
    <a class="${navLinkClass(page, "map", !mapEnabled && !mapCurrent)}" href="./map.html" ${!mapEnabled && !mapCurrent ? 'aria-disabled="true"' : ""}>Map</a>
    <div class="nav-group ${NAV_KEYS["get-involved"].includes(page) ? "is-current" : ""}" data-nav-group>
      <button class="nav-group__toggle" type="button" data-submenu-toggle>
        Get Involved
      </button>
      <div class="nav-group__panel">
        <a class="${navLinkClass(page, "get-involved")}" href="./get-involved.html">Get Involved</a>
        <a class="${navLinkClass(page, "guide")}" href="./guide.html">Guide</a>
        <a class="${navLinkClass(page, "submit")}" href="./submit.html">Submit</a>
      </div>
    </div>
    <a class="${navLinkClass(page, "about")}" href="./about.html">About</a>
    <a class="${navLinkClass(page, "merch")}" href="./merch.html">Merch</a>
    <div class="profile-menu ${NAV_KEYS.workspace.includes(page) ? "is-current" : ""} ${state.profileMenuOpen ? "is-open" : ""}" data-profile-menu>
      <button class="profile-menu__toggle ${currentUser?.avatarUrl ? "has-avatar" : !isLoggedIn ? "is-wordmark" : ""}" type="button" data-profile-toggle aria-label="${isLoggedIn ? (isAdmin ? "Admin" : "Profile") : "Log in"}">
        <span class="profile-menu__badge ${currentUser?.avatarUrl ? "has-avatar" : !isLoggedIn ? "is-wordmark" : ""}">${profileBadgeMarkup(currentUser)}</span>
        ${unreadCount ? `<span class="profile-menu__notice">${Math.min(unreadCount, 9)}${unreadCount > 9 ? "+" : ""}</span>` : ""}
      </button>
      <div class="profile-menu__panel">
        ${
          isLoggedIn
            ? `
              <div class="profile-menu__section">
                <button class="profile-menu__notification-toggle ${notificationsExpanded ? "is-open" : ""}" type="button" data-notification-toggle>
                  <span class="profile-menu__notification-toggle-copy">
                    <strong>Notifications</strong>
                    <span>${
                      state.notificationsLoading
                        ? "Looking up updates"
                        : unreadCount
                          ? `${unreadCount} item${unreadCount === 1 ? "" : "s"} waiting`
                          : "No new updates"
                    }</span>
                  </span>
                  ${unreadCount ? `<span class="profile-menu__inline-badge">${Math.min(unreadCount, 9)}${unreadCount > 9 ? "+" : ""}</span>` : `<span class="profile-menu__inline-badge is-muted">0</span>`}
                </button>
                ${
                  notificationsExpanded
                    ? `
                      <div class="profile-menu__notification-shell">
                        ${
                          state.notificationsLoading
                            ? `<div class="loading-state" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span>Looking up notifications...</span></div>`
                            : notifications.length
                              ? `
                                <div class="profile-menu__notifications">
                                  ${notifications.map((item) => renderNotificationItem(item)).join("")}
                                </div>
                                <button class="profile-menu__clear" type="button" data-clear-notifications>Clear notifications</button>
                              `
                              : `<div class="profile-menu__notification-empty">No notifications right now.</div>`
                        }
                      </div>
                    `
                    : ""
                }
              </div>
              <a href="./admin.html?tab=${isAdmin ? "dashboard" : "profile"}">${isAdmin ? "Admin" : "Profile"}</a>
              <button type="button" data-signout>Sign out</button>
            `
            : `<a href="./admin.html?tab=login">Log in</a>`
        }
      </div>
    </div>
  `;

  for (const disabled of nav.querySelectorAll('[aria-disabled="true"]')) {
    disabled.addEventListener("click", (event) => event.preventDefault(), { once: false });
  }
}

function profileBadgeMarkup(user) {
  if (user?.avatarUrl) {
    const label = user.displayName || user.username || "Profile";
    const blob = user.avatarBlob;
    const blobAttrs = blob?.sha256
      ? ` data-avatar-sha="${escapeAttribute(blob.sha256)}" data-avatar-url="${escapeAttribute(blob.url || user.avatarUrl)}" data-avatar-type="${escapeAttribute(blob.type || "")}" data-avatar-name="${escapeAttribute(blob.name || "")}"`
      : "";
    return `<img src="${escapeAttribute(user.avatarUrl)}" alt="${escapeAttribute(label)}"${blobAttrs}>`;
  }
  if (!state.session?.username) return "Log in";
  return escapeHtml(profileInitials(user?.displayName || state.session.username));
}

function profileInitials(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Me";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}

function navLinkClass(page, key, disabled = false) {
  const parts = ["nav-link"];
  if (NAV_KEYS[key]?.includes(page)) parts.push("is-current");
  if (disabled) parts.push("is-disabled");
  return parts.join(" ");
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
  if (homeGrid) homeGrid.innerHTML = renderLoadingState("Looking up featured investigations...");
  if (listGrid) listGrid.innerHTML = renderLoadingState("Looking up investigations...");
  if (rail) rail.innerHTML = renderLoadingState("Looking up filters and map data...");

  try {
    const posts = await loadPosts();
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
    renderError(homeGrid || listGrid, "Investigation feed unavailable.");
    if (rail) renderError(rail, "Archive tools unavailable.");
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

async function initStaticPageEditing() {
  const pageId = document.body.dataset.page || "";
  if (!STATIC_EDITABLE_PAGES.has(pageId) || state.pageOverlay) return;
  const editableElements = [...document.querySelectorAll("[data-static-edit]")].filter(
    (node) => node instanceof HTMLElement
  );
  if (!editableElements.length) return;

  const publicState = await getPublicState().catch(() => null);
  if (!publicState) return;

  const committedContent = collectStaticEditContent(editableElements);
  const publishedDraft = latestApprovedPageDraft(publicState, pageId);
  const publishedContent = publishedDraft?.page_content && typeof publishedDraft.page_content === "object"
    ? cloneStaticEditContent(publishedDraft.page_content)
    : cloneStaticEditContent(committedContent);
  applyStaticEditContent(editableElements, publishedContent, committedContent);

  const params = new URLSearchParams(window.location.search);
  const draftSlug = cleanSlug(params.get("draft") || "");
  if (draftSlug && editorEntryAllowed(publicState)) {
    const localPreviewDraft = findPageDraftPreview(publicState, pageId, draftSlug);
    const targetedDraft = localPreviewDraft ? null : await loadDraftBySlug(draftSlug);
    const previewDraft = localPreviewDraft || (
      targetedDraft &&
      isPageDraft(targetedDraft) &&
      cleanSlug(targetedDraft.page_id || "") === pageId
        ? targetedDraft
        : null
    );
    if (previewDraft) {
      applyStaticEditContent(editableElements, previewDraft.page_content || {}, publishedContent);
      renderStaticPageReviewPreview(previewDraft);
      return;
    }
  }

  state.pageOverlay = {
    pageId,
    elements: editableElements,
    committedContent: cloneStaticEditContent(committedContent),
    publishedContent: cloneStaticEditContent(publishedContent),
    currentContent: cloneStaticEditContent(publishedContent),
    liveContent: null,
    controller: null,
    status: "idle",
  };

  void connectLiveStaticPageOverlay();

  if (!editorEntryAllowed(publicState)) return;

  const storedSnapshot = loadStaticEditSnapshot(pageId);
  const savedContent = cloneStaticEditContent(storedSnapshot?.content || state.pageOverlay.currentContent);
  state.staticEdit = {
    pageId,
    elements: editableElements,
    originalContent: cloneStaticEditContent(state.pageOverlay.currentContent),
    savedContent,
    history: [cloneStaticEditContent(savedContent)],
    historyIndex: 0,
    enabled: false,
    status: storedSnapshot?.savedAt
      ? `Local snapshot ready from ${formatLocalTimestamp(storedSnapshot.savedAt)}. Press Ctrl+Shift+E to resume it.`
      : "Press Ctrl+Shift+E to edit this page.",
    savedAt: Number(storedSnapshot?.savedAt || 0),
    saveState: storedSnapshot?.savedAt ? "saved" : "idle",
    pendingLiveContent: null,
    livePublishTimer: 0,
  };

  renderStaticEditBar();
  if (!state.staticEditListenersBound) {
    document.addEventListener("keydown", handleStaticEditShortcut);
    document.addEventListener("input", handleStaticEditInput, true);
    document.addEventListener("paste", handleStaticEditPaste, true);
    document.addEventListener("click", handleStaticEditInteraction, true);
    state.staticEditListenersBound = true;
  }
}

function hydrateArchiveSummaryLinks(posts, publicState) {
  const hosts = [...document.querySelectorAll("[data-archive-summary]")];
  if (!hosts.length) return;
  const publishedCount = Array.isArray(posts) ? posts.length : 0;
  const entities = Array.isArray(publicState?.approvedEntities) ? publicState.approvedEntities : [];
  const mappedCount = entities.filter((entity) => Number.isFinite(entity.lat) && Number.isFinite(entity.lng)).length;
  const locationCount = dedupe(entities.map((entity) => String(entity.location || "").trim()).filter(Boolean)).length;
  const tagCount = dedupe(
    (Array.isArray(posts) ? posts : []).flatMap((post) => (Array.isArray(post?.tags) ? post.tags : []))
  ).length;
  const markup = `
    <a class="hero-summary__item" href="./investigations.html">
      <strong>${publishedCount}</strong>
      <span>Published investigations</span>
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

async function initInvestigationDetail() {
  const article = document.querySelector("[data-investigation-article]");
  if (!article) return;
  article.innerHTML = renderLoadingState("Looking up article...");
  const commentPanel = document.querySelector("[data-comment-panel]");
  const reviewShell = document.querySelector("[data-investigation-review-shell]");
  const tagsShell = document.querySelector("[data-investigation-tags-shell]");
  const tagsHost = document.querySelector("[data-investigation-tags]");
  const recordsShell = document.querySelector("[data-investigation-records-shell]");
  const mapShell = document.querySelector("[data-investigation-map-shell]");
  const mapCanvas = document.querySelector("[data-investigation-map-canvas]");
  if (commentPanel) commentPanel.innerHTML = renderLoadingState("Looking up discussion...");

  try {
    const posts = await loadPosts();
    const publicState = await getPublicState();
    const params = new URLSearchParams(window.location.search);
    const slug = cleanSlug(params.get("slug") || "");
    const draftSlug = cleanSlug(params.get("draft") || "");
    const canReview = editorEntryAllowed(publicState);
    let draft = draftSlug
      ? investigationDrafts(publicState.drafts || []).find((item) => item.slug === draftSlug) || null
      : null;
    if (!draft && draftSlug && canReview) {
      const targetedDraft = await loadDraftBySlug(draftSlug);
      if (targetedDraft && !isPageDraft(targetedDraft)) draft = targetedDraft;
    }
    const isDraftPreview = Boolean(draft && canReview);
    if (draftSlug && !isDraftPreview) {
      throw new Error("Draft preview unavailable.");
    }
    const post = isDraftPreview
      ? draftToInvestigationPreview(draft)
      : posts.find((item) => item.slug === slug) || posts[0];
    if (!post) throw new Error("No investigations found.");

    renderMarkdown(article, post.body);
    setText("[data-investigation-title]", post.title);
    setText("[data-investigation-summary]", post.summary);
    setText("[data-investigation-meta]", buildArticleMetaLine(post));
    const tags = document.querySelector("[data-investigation-kicker]");
    if (tags) tags.innerHTML = renderTagList(post.tags);
    if (tagsHost instanceof HTMLElement && tagsShell instanceof HTMLElement) {
      const hasTags = Array.isArray(post.tags) && post.tags.length;
      tagsHost.innerHTML = hasTags ? renderTagList(post.tags) : "";
      tagsShell.hidden = !hasTags;
    }
    const records = document.querySelector("[data-investigation-records]");
    if (records) {
      const hasRecords = Array.isArray(post.records) && post.records.length;
      records.innerHTML = renderRecordList(post.records);
      if (recordsShell instanceof HTMLElement) recordsShell.hidden = !hasRecords;
    }
    const related = document.querySelector("[data-investigation-related]");
    if (related) {
      related.innerHTML = isDraftPreview
        ? ""
        : posts
            .filter((item) => item.slug !== post.slug)
            .slice(0, 2)
            .map((item) => renderInvestigationCard(item, true))
            .join("");
    }

    enrichArticleEntities(article, publicState);
    if (reviewShell instanceof HTMLElement) {
      if (isDraftPreview) {
        reviewShell.hidden = false;
        reviewShell.innerHTML = renderReviewPreviewPanel(draft);
        bindReviewPreviewPanel(reviewShell, draft);
      } else {
        reviewShell.hidden = true;
        reviewShell.innerHTML = "";
      }
    }
    if (mapShell instanceof HTMLElement && mapCanvas instanceof HTMLElement) {
      const detailEntities = archiveEntitiesForEntries([post], publicState);
      const mappedEntities = detailEntities.filter((entity) => Number.isFinite(entity.lat) && Number.isFinite(entity.lng));
      if (mappedEntities.length) {
        mapShell.hidden = false;
        renderLeafletPreviewMap(mapCanvas, mappedEntities);
      } else {
        mapShell.hidden = true;
        destroyLeafletPreview(mapCanvas);
        mapCanvas.innerHTML = "";
      }
    }
    if (commentPanel instanceof HTMLElement) {
      commentPanel.hidden = isDraftPreview;
      if (!isDraftPreview) {
        await renderComments(post.slug, publicState);
      } else {
        commentPanel.innerHTML = "";
      }
    }
    document.title = `${post.title} | ${SITE.shortName}`;
  } catch {
    renderError(article, "This case file could not be loaded.");
    if (reviewShell instanceof HTMLElement) {
      reviewShell.hidden = true;
      reviewShell.innerHTML = "";
    }
    if (tagsShell instanceof HTMLElement) tagsShell.hidden = true;
    if (recordsShell instanceof HTMLElement) recordsShell.hidden = true;
    if (mapShell instanceof HTMLElement) mapShell.hidden = true;
    if (mapCanvas instanceof HTMLElement) {
      destroyLeafletPreview(mapCanvas);
      mapCanvas.innerHTML = "";
    }
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
  list.innerHTML = renderLoadingState("Looking up map entries...");
  canvas.innerHTML = renderLoadingState("Looking up map data...");

  const publicState = await getPublicState();
  if (!publicState.connected || !publicState.approvedEntities.length) {
    list.innerHTML = `<div class="empty-state">Published entities will appear here once approved entries are available.</div>`;
    canvas.innerHTML = `<div class="map-empty">Map data unavailable.</div>`;
    return;
  }

  const posts = await loadPosts().catch(() => []);
  const entityUsage = buildEntityUsage(posts, publicState.approvedEntities);
  list.innerHTML = publicState.approvedEntities
    .map((entity) => renderEntityCard(entity, entityUsage.get(entity.slug) || []))
    .join("");
  renderLeafletMap(canvas, publicState.approvedEntities);
  bindMapEntityCards();
  focusRequestedEntity();
}

async function renderComments(postSlug, publicState) {
  const panel = document.querySelector("[data-comment-panel]");
  if (!panel) return;

  const comments = publicState.commentsByPost.get(postSlug) || [];
  const threadedComments = buildCommentTree(comments);
  const isLoggedIn = Boolean(state.session);
  const isAdmin = Boolean(state.viewer && trustedAdminPubkeys(publicState).includes(state.viewer.pubkey));
  const currentUser = isLoggedIn && state.viewer
    ? publicState.users.find((user) => user.pubkey === state.viewer.pubkey) || null
    : null;
  const replyTargetId = state.commentReply?.postSlug === postSlug
    ? state.commentReply.commentId
    : "";
  if (replyTargetId && !comments.find((comment) => comment.id === replyTargetId)) {
    state.commentReply = null;
  }

  panel.innerHTML = `
    <div class="comment-panel__head">
      <div>
        <div class="eyebrow">Discussion</div>
        <h2>Comments</h2>
      </div>
      <p>${renderCommentCountLabel(comments.length)}</p>
    </div>
    ${
      isLoggedIn
        ? `
          <section class="comment-composer">
            ${renderAvatarBadge(currentUser, state.session?.username || "You", "comment-composer__avatar")}
            <form class="comment-composer__form" data-comment-form="root">
              <div class="comment-composer__head">
                <strong>Add a comment</strong>
                <span>Keep it specific and tied to the post.</span>
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
        ? `<div class="comment-list">${threadedComments.map((comment) => renderComment(comment, publicState, { isAdmin, canReply: isLoggedIn, replyTargetId })).join("")}</div>`
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
          tags: [["d", `comment-${Date.now()}`], ["a", postSlug]],
          content: {
            post_slug: postSlug,
            markdown,
            parent_id: "",
            root_id: ""
          }
        });
        rootForm.reset();
        appendLocalComment(postSlug, {
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
      const replyTarget = comments.find((comment) => comment.id === parentId) || null;
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
            ["d", `comment-${Date.now()}`],
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
        appendLocalComment(postSlug, {
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
        state.publicState = await loadPublicState(true);
        await renderComments(postSlug, state.publicState);
      } catch {
        return;
      }
    });
  }
}

function renderComment(comment, publicState, options = {}, depth = 0) {
  const author = publicState.users.find((user) => user.pubkey === comment.author);
  const authorLabel = author?.displayName || author?.username || "User";
  const replies = Array.isArray(comment.replies) ? comment.replies : [];
  const replyForm = options.canReply && options.replyTargetId === comment.id
    ? renderInlineReplyForm(comment, publicState)
    : "";
  return `
    <article class="comment-card ${depth ? "comment-card--reply" : ""}" id="comment-${escapeAttribute(comment.id)}" data-comment-id="${escapeAttribute(comment.id)}">
      <div class="comment-card__shell">
        ${renderAvatarBadge(author, authorLabel, "comment-card__avatar")}
        <div class="comment-card__main">
          <div class="comment-card__meta">
            <div>
              <strong>${escapeHtml(authorLabel)}</strong>
              <span>${formatDateTime(comment.created_at)}</span>
            </div>
          </div>
          <div class="comment-card__body">${renderMiniMarkdown(comment.markdown)}</div>
          <div class="comment-card__actions">
            ${options.canReply ? `<button type="button" class="button-ghost" data-reply-comment="${escapeAttribute(comment.id)}">Reply</button>` : ""}
            ${options.isAdmin ? `<button type="button" class="button-ghost" data-hide-comment="${escapeAttribute(comment.id)}">Hide</button>` : ""}
          </div>
          ${replyForm}
          ${
            replies.length
              ? `<div class="comment-card__children">${replies.map((reply) => renderComment(reply, publicState, options, depth + 1)).join("")}</div>`
              : ""
          }
        </div>
      </div>
    </article>
  `;
}

function buildCommentTree(comments) {
  const nodes = new Map(
    (Array.isArray(comments) ? comments : []).map((comment) => [
      comment.id,
      {
        ...comment,
        replies: []
      }
    ])
  );
  const roots = [];
  for (const node of nodes.values()) {
    const parentId = String(node.parent_id || "").trim();
    const parent = parentId ? nodes.get(parentId) : null;
    if (parent && parent.post_slug === node.post_slug) {
      if (!node.root_id) node.root_id = parent.root_id || parent.id;
      parent.replies.push(node);
    } else {
      roots.push(node);
    }
  }
  sortCommentNodes(roots);
  return roots;
}

function sortCommentNodes(nodes) {
  nodes.sort((left, right) => {
    const leftTime = Number(left?.created_at || 0);
    const rightTime = Number(right?.created_at || 0);
    if (leftTime !== rightTime) return leftTime - rightTime;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  });
  for (const node of nodes) {
    if (Array.isArray(node.replies) && node.replies.length) sortCommentNodes(node.replies);
  }
}

function renderCommentCountLabel(count) {
  return `${count} visible comment${count === 1 ? "" : "s"}`;
}

function commentAuthorLabel(comment, publicState) {
  const author = publicState.users.find((user) => user.pubkey === comment.author);
  return author?.displayName || author?.username || "User";
}

function renderAvatarBadge(user, fallbackLabel, className) {
  const label = user?.displayName || user?.username || fallbackLabel || "Profile";
  if (user?.avatarUrl) {
    const blob = user.avatarBlob;
    const blobAttrs = blob?.sha256
      ? ` data-avatar-sha="${escapeAttribute(blob.sha256)}" data-avatar-url="${escapeAttribute(blob.url || user.avatarUrl)}" data-avatar-type="${escapeAttribute(blob.type || "")}" data-avatar-name="${escapeAttribute(blob.name || "")}"`
      : "";
    return `<span class="${className} ${className}--image"><img src="${escapeAttribute(user.avatarUrl)}" alt="${escapeAttribute(label)}"${blobAttrs}></span>`;
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

function renderAuthoringLeadCard() {
  return `
    <article class="surface-panel authoring-card">
      <div class="eyebrow">For editors</div>
      <h3>Write in the full editor</h3>
      <p>Drafts save as you work, submitted investigations open in review preview, and approved posts roll into the next bakedown.</p>
      <div class="button-row"><a class="button" href="./editor.html">Create investigation</a></div>
    </article>
  `;
}

function currentArchiveFilters(canEdit = false) {
  const params = new URLSearchParams(window.location.search);
  return {
    tag: String(params.get("tag") || "").trim(),
    entity: String(params.get("entity") || "").trim(),
    status: canEdit ? String(params.get("status") || "").trim().toLowerCase() : ""
  };
}

function activeArchiveFilters() {
  return state.archiveFilters || { tag: "", entity: "", status: "" };
}

function archiveHasActiveFilters(filters = activeArchiveFilters()) {
  return Boolean(filters.tag || filters.entity || filters.status);
}

function renderArchiveFiltersPanel(entries, publicState, filters, canEdit) {
  return `
    <section class="surface-panel archive-filters">
      <div class="archive-filters__head">
        <button class="text-link archive-filters__clear" type="button" data-clear-investigation-filters ${archiveHasActiveFilters(filters) ? "" : "hidden"}>Clear</button>
      </div>
      <div class="archive-filters__form" data-investigation-filters>
        ${
          canEdit
            ? `
              <div class="archive-status-menu${state.archiveStatusMenuOpen ? " is-open" : ""}" data-status-menu>
                <button
                  class="archive-status-menu__toggle"
                  type="button"
                  data-status-toggle
                  aria-expanded="${state.archiveStatusMenuOpen ? "true" : "false"}"
                  aria-haspopup="listbox"
                >
                  <span data-status-current>${escapeHtml(archiveStatusLabel(filters.status))}</span>
                </button>
                <div class="archive-status-menu__panel" data-status-panel role="listbox" ${state.archiveStatusMenuOpen ? "" : "hidden"}>
                  ${ARCHIVE_STATUS_OPTIONS.map((option) => renderArchiveStatusOption(option, filters.status)).join("")}
                </div>
              </div>
            `
            : ""
        }
        <label class="archive-filters__field" data-filter-field="tag">
          <input name="tag" type="text" placeholder="Search tags" value="${escapeAttribute(filters.tag)}" autocomplete="off" data-filter-input="tag">
          <div class="picker-results picker-results--dropdown archive-filters__results" data-filter-results="tag"></div>
        </label>
        <label class="archive-filters__field" data-filter-field="entity">
          <input name="entity" type="text" placeholder="Search entities" value="${escapeAttribute(filters.entity)}" autocomplete="off" data-filter-input="entity">
          <div class="picker-results picker-results--dropdown archive-filters__results" data-filter-results="entity"></div>
        </label>
      </div>
    </section>
  `;
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

function appendLocalComment(postSlug, comment) {
  if (!state.publicState?.commentsByPost) return;
  const current = state.publicState.commentsByPost.get(postSlug) || [];
  state.publicState.commentsByPost.set(postSlug, dedupeCommentList([...current, comment]));
}

function dedupeCommentList(comments) {
  const seen = new Set();
  return (Array.isArray(comments) ? comments : []).filter((comment) => {
    const id = String(comment?.id || "").trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function renderArchiveMapPanel() {
  return `
    <section class="surface-panel archive-map-card">
      <div class="tag-row archive-map-card__tags" data-investigation-map-tags></div>
      <div class="map-board map-board--leaflet map-board--compact" data-investigation-map-canvas></div>
      <div class="button-row">
        <a class="button-ghost" href="./map.html">Open full map</a>
      </div>
    </section>
  `;
}

function renderArchiveStatusOption(option, selectedValue) {
  const value = String(option?.value || "");
  const isActive = value === String(selectedValue || "");
  return `
    <button
      class="archive-status-menu__option${isActive ? " is-active" : ""}"
      type="button"
      role="option"
      aria-selected="${isActive ? "true" : "false"}"
      data-status-option="${escapeAttribute(value)}"
    >
      ${escapeHtml(String(option?.label || ""))}
    </button>
  `;
}

function archiveStatusLabel(value) {
  return ARCHIVE_STATUS_OPTIONS.find((option) => option.value === String(value || ""))?.label || "All statuses";
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
  state.archiveFilters = currentArchiveFilters(canEdit);
  state.archiveFilterOpenField = "";
  state.archiveStatusMenuOpen = false;

  listGrid.innerHTML = `
    ${canEdit ? renderAuthoringLeadCard() : ""}
    <div class="story-list__results" data-investigation-results></div>
  `;
  if (filtersShell instanceof HTMLElement) {
    filtersShell.innerHTML = renderArchiveFiltersPanel(entries, publicState, activeArchiveFilters(), canEdit);
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
    if (event.key !== "Enter") return;
    event.preventDefault();
    const descriptor = archiveFilterSuggestions(field, entries, publicState);
    const nextValue = descriptor.matching[0] || String(target.value || "").trim();
    target.value = nextValue;
    state.archiveFilters = {
      ...activeArchiveFilters(),
      [field]: nextValue
    };
    state.archiveFilterOpenField = "";
    syncArchiveFiltersToUrl(canEdit);
    renderInvestigationArchiveResults(entries, publicState, canEdit);
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
      state.archiveFilters = { tag: "", entity: "", status: "" };
      state.archiveFilterOpenField = "";
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

    const suggestion = target.closest("[data-filter-suggestion]");
    if (suggestion instanceof HTMLElement) {
      const field = suggestion.getAttribute("data-filter-suggestion") || "";
      const value = suggestion.getAttribute("data-filter-value") || "";
      const input = shell.querySelector(`[data-filter-input="${field}"]`);
      if (input instanceof HTMLInputElement) input.value = value;
      state.archiveFilters = {
        ...activeArchiveFilters(),
        [field]: value
      };
      state.archiveFilterOpenField = "";
      syncArchiveFiltersToUrl(canEdit);
      renderInvestigationArchiveResults(entries, publicState, canEdit);
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
  renderArchiveSuggestionPanel("tag", archiveFilterSuggestions("tag", entries, publicState));
  renderArchiveSuggestionPanel("entity", archiveFilterSuggestions("entity", entries, publicState));
}

function archiveFilterSuggestions(field, entries, publicState) {
  const filters = activeArchiveFilters();
  const query = String(filters?.[field] || "").trim().toLowerCase();
  const values = field === "tag"
    ? dedupe(entries.flatMap((entry) => Array.isArray(entry.tags) ? entry.tags : []))
    : dedupe(entries.flatMap((entry) => archiveEntryEntityOptions(entry, publicState)));
  const matching = values
    .filter((value) => String(value || "").trim())
    .filter((value) => !query || value.toLowerCase().includes(query))
    .slice(0, 8);
  return { field, query, matching };
}

function renderArchiveSuggestionPanel(field, descriptor) {
  const host = document.querySelector(`[data-filter-results="${field}"]`);
  if (!(host instanceof HTMLElement)) return;
  const isOpen = state.archiveFilterOpenField === field;
  const query = String(descriptor?.query || "").trim();
  const matching = Array.isArray(descriptor?.matching) ? descriptor.matching : [];
  if (!isOpen) {
    host.removeAttribute("data-open");
    host.innerHTML = "";
    return;
  }
  host.setAttribute("data-open", "yes");
  host.innerHTML = matching.length
    ? matching
        .map(
          (value) => `
            <button class="picker-chip" type="button" data-filter-suggestion="${escapeAttribute(field)}" data-filter-value="${escapeAttribute(value)}">
              <strong>${escapeHtml(value)}</strong>
              <span>Use ${field}</span>
            </button>
          `
        )
        .join("")
    : `<div class="picker-hint">${query ? `No ${field} matches yet.` : `Start typing to filter by ${field}.`}</div>`;
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
  history.replaceState({}, "", url);
}

function updateArchiveMapPreview(filteredEntries, entries, publicState) {
  const tagsHost = document.querySelector("[data-investigation-map-tags]");
  const canvas = document.querySelector("[data-investigation-map-canvas]");
  if (!(tagsHost instanceof HTMLElement) || !(canvas instanceof HTMLElement)) return;
  const activeEntities = archiveEntitiesForEntries(filteredEntries, publicState);
  const defaultEntities = archiveHasActiveFilters() ? [] : archiveEntitiesForEntries(entries, publicState);
  const entities = activeEntities.length ? activeEntities : defaultEntities;
  if (!entities.length) {
    tagsHost.innerHTML = "";
    destroyLeafletPreview(canvas);
    canvas.innerHTML = `<div class="map-empty">${archiveHasActiveFilters() ? "No locations tagged in filtered results." : "No locations tagged in the archive yet."}</div>`;
    return;
  }

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
  renderLeafletPreviewMap(canvas, mappedEntities);
}

function archiveEntitiesForEntries(entries, publicState) {
  const entityMap = new Map((publicState?.approvedEntities || []).map((entity) => [entity.slug, entity]));
  const refs = dedupe(
    (Array.isArray(entries) ? entries : []).flatMap((entry) => [
      ...(Array.isArray(entry?.entity_refs) ? entry.entity_refs : []),
      ...(entry?.body ? collectEntityRefsFromText(entry.body, publicState?.approvedEntities || []) : [])
    ])
  );
  return refs.map((slug) => entityMap.get(slug)).filter(Boolean);
}

function destroyLeafletPreview(canvas) {
  if (canvas?.__leafletPreviewMap) {
    canvas.__leafletPreviewMap.remove();
    canvas.__leafletPreviewMap = null;
  }
}

function renderLeafletPreviewMap(canvas, entities) {
  if (!window.L) {
    canvas.innerHTML = `<div class="map-empty">Map library unavailable.</div>`;
    return;
  }
  destroyLeafletPreview(canvas);
  canvas.innerHTML = "";
  const previewMap = window.L.map(canvas, {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    tap: false,
    touchZoom: false
  }).setView(SITE.map.defaultCenter, SITE.map.defaultZoom);
  canvas.__leafletPreviewMap = previewMap;
  window.L.tileLayer(SITE.map.tileUrl, {
    attribution: SITE.map.tileAttribution,
    minZoom: SITE.map.minZoom
  }).addTo(previewMap);
  const markers = window.L.layerGroup().addTo(previewMap);
  const points = [];
  for (const entity of entities) {
    if (!Number.isFinite(entity.lat) || !Number.isFinite(entity.lng)) continue;
    points.push([entity.lat, entity.lng]);
    const marker = window.L.circleMarker([entity.lat, entity.lng], {
      radius: 6,
      color: "#6f0d09",
      weight: 2,
      fillColor: "#b3201a",
      fillOpacity: 0.88
    }).addTo(markers);
    marker.bindTooltip(escapeHtml(entity.name), { direction: "top", opacity: 0.92 });
  }
  if (points.length) previewMap.fitBounds(points, { padding: [28, 28] });
  else previewMap.setView(SITE.map.defaultCenter, SITE.map.defaultZoom);
  window.setTimeout(() => previewMap.invalidateSize(), 60);
}

function filterArchiveEntries(entries, publicState, filters) {
  const tagQuery = String(filters?.tag || "").trim().toLowerCase();
  const entityQuery = String(filters?.entity || "").trim().toLowerCase();
  const statusQuery = String(filters?.status || "").trim().toLowerCase();
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (statusQuery && normalizeDraftStatus(entry.archiveStatus) !== statusQuery) return false;
    if (tagQuery) {
      const matchesTag = (Array.isArray(entry.tags) ? entry.tags : [])
        .map((tag) => String(tag || "").trim().toLowerCase())
        .some((tag) => tag.includes(tagQuery));
      if (!matchesTag) return false;
    }
    if (entityQuery) {
      const matchesEntity = archiveEntryEntityOptions(entry, publicState)
        .map((value) => String(value || "").trim().toLowerCase())
        .some((value) => value.includes(entityQuery));
      if (!matchesEntity) return false;
    }
    return true;
  });
}

function archiveEntryEntityOptions(entry, publicState) {
  const entityMap = new Map((publicState?.approvedEntities || []).map((entity) => [entity.slug, entity]));
  const refs = dedupe([
    ...(Array.isArray(entry?.entity_refs) ? entry.entity_refs : []),
    ...(entry?.body ? collectEntityRefsFromText(entry.body, publicState?.approvedEntities || []) : [])
  ]);
  return dedupe(
    refs.flatMap((slug) => {
      const entity = entityMap.get(slug);
      if (!entity) return [slug];
      return [entity.slug, entity.name, entity.location];
    })
  );
}

function normalizeDraftStatus(status) {
  return String(status || "").trim().toLowerCase();
}

function isPageDraft(draft) {
  return String(draft?.content_type || "").trim().toLowerCase() === "page" &&
    STATIC_EDITABLE_PAGES.has(cleanSlug(draft?.page_id || ""));
}

function investigationDrafts(drafts) {
  return (Array.isArray(drafts) ? drafts : []).filter((draft) => !isPageDraft(draft));
}

function pageDrafts(drafts) {
  return (Array.isArray(drafts) ? drafts : []).filter((draft) => isPageDraft(draft));
}

function staticPageMeta(pageId) {
  return STATIC_PAGE_META[cleanSlug(pageId || "")] || { title: "Static page", path: "./index.html" };
}

function staticPageDraftSlug(pageId) {
  return `page-${cleanSlug(pageId || "")}`;
}

function staticPageSummary(content) {
  const plainText = Object.values(content || {})
    .map((value) => stripHtml(String(value || "")).trim())
    .filter(Boolean);
  return trimmed(plainText.find((value) => value.length > 40) || plainText.join(" "), 180);
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function buildStaticPageDraftPayload(pageId, content) {
  const cleanPageId = cleanSlug(pageId || "");
  const meta = staticPageMeta(cleanPageId);
  const titleKey = cleanPageId === "home" ? "home.hero.title" : `${cleanPageId}.hero.title`;
  const ledeKey = cleanPageId === "home" ? "home.hero.lede" : `${cleanPageId}.hero.lede`;
  const title = stripHtml(content?.[titleKey] || meta.title) || meta.title;
  const summary = stripHtml(content?.[ledeKey] || staticPageSummary(content));
  return {
    slug: staticPageDraftSlug(cleanPageId),
    content_type: "page",
    page_id: cleanPageId,
    page_path: meta.path,
    title,
    summary: summary || `${meta.title} update`,
    status: "candidate",
    date: new Date().toISOString().slice(0, 10),
    markdown: "",
    tags: [],
    entity_refs: [],
    page_content: cloneStaticEditContent(content),
    author_pubkey: state.viewer?.pubkey || ""
  };
}

function findPageDraftPreview(publicState, pageId, draftSlug) {
  const cleanPageId = cleanSlug(pageId || "");
  return pageDrafts(publicState?.drafts || []).find(
    (draft) => draft.slug === draftSlug && cleanSlug(draft.page_id || "") === cleanPageId
  ) || null;
}

function latestApprovedPageDraft(publicState, pageId) {
  const cleanPageId = cleanSlug(pageId || "");
  const history = publicState?.draftHistoryBySlug?.get?.(staticPageDraftSlug(cleanPageId)) || [];
  return history.find(
    (draft) => isPageDraft(draft) && cleanSlug(draft.page_id || "") === cleanPageId && normalizeDraftStatus(draft.status) === "approved"
  ) || null;
}

function pageDraftHref(draft, statusOverride = "") {
  const pageId = cleanSlug(draft?.page_id || "");
  const meta = staticPageMeta(pageId);
  const status = normalizeDraftStatus(statusOverride || draft?.status);
  if (["revision", "approved", "denied"].includes(status)) return meta.path;
  return `${meta.path}?draft=${encodeURIComponent(draft.slug)}`;
}

function pageDraftActionLabel(draft, statusOverride = "") {
  const status = normalizeDraftStatus(statusOverride || draft?.status);
  return ["revision", "approved", "denied"].includes(status) ? "Open page" : "Open preview";
}

function pageDraftLabel(draft) {
  const meta = staticPageMeta(draft?.page_id || "");
  return meta.title;
}

function draftReviewAction(draft) {
  const tag = Array.isArray(draft?._event?.tags)
    ? draft._event.tags.find((item) => Array.isArray(item) && item[0] === "review")
    : null;
  return String(tag?.[1] || "").trim().toLowerCase();
}

function draftStatusLabel(status, reviewAction = "") {
  const clean = normalizeDraftStatus(status);
  const action = String(reviewAction || "").trim().toLowerCase();
  if (["candidate", "review", "submitted"].includes(clean)) return "Submitted";
  if (clean === "approved") return "Approved";
  if (clean === "revision" || action === "revise") return "Revision requested";
  if (clean === "denied" || action === "deny") return "Denied";
  return "Draft";
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
  if (window.marked) {
    window.marked.setOptions({ gfm: true, breaks: false });
    node.innerHTML = window.marked.parse(String(markdown || ""));
  } else {
    node.innerHTML = renderMiniMarkdown(markdown);
  }

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

function buildToc(article, target) {
  if (!target) return;
  const items = [...article.querySelectorAll("h2, h3")];
  if (!items.length) {
    target.innerHTML = "<p>No sections available.</p>";
    return;
  }
  target.innerHTML = items
    .map(
      (item) => `
        <a class="toc-link toc-link--${item.tagName.toLowerCase()}" href="#${escapeAttribute(item.id)}">
          ${escapeHtml(item.textContent || "")}
        </a>
      `
    )
    .join("");
}

async function loadPosts() {
  if (!state.postsPromise) {
    state.postsPromise = fetchJson("./content/investigations/index.json")
      .then((data) => Promise.all((Array.isArray(data.files) ? data.files : []).map((file) => loadPost(file))))
      .then((posts) => posts.filter(Boolean).sort((left, right) => String(right.date || "").localeCompare(String(left.date || ""))));
  }
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

function draftOwnerPubkey(draft) {
  const revisions = Array.isArray(draft?.revisions) ? draft.revisions : [];
  const oldest = revisions.length ? revisions[revisions.length - 1] : null;
  return String(oldest?.author || draft?.author || "").trim().toLowerCase();
}

function draftToInvestigationPreview(draft) {
  const reviewAction = draftReviewAction(draft);
  return {
    ...draft,
    body: draft.markdown || "",
    statusLabel: draftStatusLabel(draft.status, reviewAction),
    records: [],
    tags: Array.isArray(draft.tags) ? draft.tags : [],
    title: draft.title || "Untitled investigation",
    summary: draft.summary || "No summary added yet.",
    location: draft.location || "Draft location pending"
  };
}

function renderReviewPreviewPanel(draft) {
  const status = normalizeDraftStatus(draft.status);
  const owner = state.publicState?.users?.find((user) => user.pubkey === draftOwnerPubkey(draft)) || null;
  const ownerLabel = owner?.displayName || owner?.username || shortReviewKey(draftOwnerPubkey(draft));
  const reviewAction = draftReviewAction(draft);
  const canReview = ["candidate", "review", "submitted"].includes(status);
  const isPage = isPageDraft(draft);
  const previewLabel = isPage ? "Page review" : "Review preview";
  const openHref = isPage
    ? pageDraftHref(draft, draft.status)
    : normalizeDraftStatus(draft.status) === "revision"
      ? `./editor.html?slug=${encodeURIComponent(draft.slug)}`
      : "./investigations.html";
  const openLabel = isPage
    ? pageDraftActionLabel(draft, draft.status)
    : normalizeDraftStatus(draft.status) === "revision"
      ? "Open in editor"
      : "Back to investigations";
  return `
    <div class="eyebrow">${escapeHtml(previewLabel)}</div>
    <h3>${escapeHtml(draftStatusLabel(status, reviewAction))}</h3>
    <p class="muted-text">Submitted by ${escapeHtml(ownerLabel)}. This view is read-only so the review decision happens against what was actually submitted.</p>
    <div class="tag-row">
      <span class="tag">${escapeHtml(isPage ? pageDraftLabel(draft) : "Investigation")}</span>
      <span class="tag">${escapeHtml(draftStatusLabel(status, reviewAction))}</span>
      <span class="tag">${escapeHtml(formatDate(draft.date))}</span>
    </div>
    <div class="button-row button-row--tight">
      ${
        canReview
          ? `
            <button class="button" type="button" data-review-action="approve" data-draft-slug="${escapeAttribute(draft.slug)}">Approve</button>
            <button class="button-ghost" type="button" data-review-action="revise" data-draft-slug="${escapeAttribute(draft.slug)}">Request revision</button>
            <button class="button-ghost" type="button" data-review-action="deny" data-draft-slug="${escapeAttribute(draft.slug)}">Deny</button>
          `
          : `<a class="button-ghost" href="${escapeAttribute(openHref)}">${escapeHtml(openLabel)}</a>`
      }
    </div>
    ${
      canReview
        ? ""
        : `<p class="muted-text">${
            normalizeDraftStatus(draft.status) === "revision"
              ? isPage
                ? "Revision has been requested on this page update."
                : "Revision has been requested on this investigation."
              : isPage
                ? "This page update is not waiting for review right now."
                : "This investigation is not waiting for review right now."
          }</p>`
    }
  `;
}

function bindReviewPreviewPanel(panel, draft) {
  const buttons = panel.querySelectorAll("[data-review-action]");
  for (const button of buttons) {
    button.addEventListener("click", async () => {
      await publishReviewDecision(panel, draft, button);
    });
  }
}

function renderStaticPageReviewPreview(draft) {
  const main = document.querySelector(".page-shell main");
  if (!(main instanceof HTMLElement)) return;
  let shell = document.querySelector("[data-static-review-shell]");
  if (!(shell instanceof HTMLElement)) {
    shell = document.createElement("section");
    shell.className = "section section--tight";
    shell.setAttribute("data-static-review-shell", "");
    main.prepend(shell);
  }
  shell.innerHTML = `<div class="wrap"><div class="surface-panel" data-static-review-panel>${renderReviewPreviewPanel(draft)}</div></div>`;
  const panel = shell.querySelector("[data-static-review-panel]");
  if (panel instanceof HTMLElement) bindReviewPreviewPanel(panel, draft);
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
    state.publicState = await loadPublicState(true);
    state.notifications = [];
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

function reviewStatusForAction(action) {
  if (action === "approve") return "approved";
  if (action === "deny") return "denied";
  return "revision";
}

function reviewActionMessage(action, draft = null) {
  if (isPageDraft(draft)) {
    if (action === "approve") return "Page update approved for publish.";
    if (action === "deny") return "Page update denied.";
    return "Revision requested on this page update.";
  }
  if (action === "approve") return "Investigation approved for publish.";
  if (action === "deny") return "Investigation denied.";
  return "Revision requested.";
}

async function hydrateNotifications(force = false) {
  if (!state.session) {
    state.notifications = [];
    state.notificationsLoading = false;
    return;
  }
  const publicState = await getPublicState();
  if (!editorEntryAllowed(publicState) && !state.viewer) {
    state.viewer = deriveIdentity(state.session.secretKeyHex);
  }
  if (!state.viewer) return;
  state.notificationsLoading = true;
  renderNavigation();
  try {
    state.notifications = await buildNotifications(publicState, force);
  } catch {
    state.notifications = [];
  } finally {
    state.notificationsLoading = false;
    renderNavigation();
  }
}

async function buildNotifications(publicState) {
  const viewer = state.viewer;
  if (!viewer) return [];
  const notifications = [];
  const isAdmin = publicState.admins?.includes(viewer.pubkey);
  const commentMap = new Map((publicState.allComments || []).map((comment) => [comment.id, comment]));

  for (const comment of publicState.comments || []) {
    if (!comment.parent_id || comment.author === viewer.pubkey) continue;
    const parent = commentMap.get(comment.parent_id);
    if (!parent || parent.author !== viewer.pubkey) continue;
    notifications.push({
      id: `comment-reply:${comment.id}`,
      createdAt: comment.created_at,
      href: `./investigation.html?slug=${encodeURIComponent(comment.post_slug)}#comment-${encodeURIComponent(comment.id)}`,
      label: "Comment reply",
      title: "Someone replied to your comment",
      detail: trimmed(comment.markdown, 100)
    });
  }

  for (const status of publicState.submissionStatuses?.values?.() || []) {
    if (status.author_pubkey !== viewer.pubkey || status.by === viewer.pubkey) continue;
    notifications.push({
      id: `submission-status:${status.submission_id}:${status.updated_at}`,
      createdAt: status.updated_at,
      href: "./submit.html",
      label: "Submission update",
      title: `Submission ${status.status}`,
      detail: status.note || "A submission you sent has a new status."
    });
  }

  for (const draft of publicState.drafts || []) {
    const reviewAction = draftReviewAction(draft);
    const ownerPubkey = draftOwnerPubkey(draft);
    const isPending = ["candidate", "review", "submitted"].includes(normalizeDraftStatus(draft.status));
    const isPage = isPageDraft(draft);
    const reviewHref = isPage
      ? pageDraftHref(draft, draft.status)
      : normalizeDraftStatus(draft.status) === "revision"
        ? `./editor.html?slug=${encodeURIComponent(draft.slug)}`
        : `./investigation.html?draft=${encodeURIComponent(draft.slug)}`;
    const reviewLabel = isPage ? "Page review" : "Investigation review";
    const reviewDetail = isPage ? pageDraftLabel(draft) : draft.title;
    if (ownerPubkey === viewer.pubkey && ["approve", "revise", "deny"].includes(reviewAction)) {
      notifications.push({
        id: `draft-review:${draft.slug}:${draft.created_at}`,
        createdAt: draft.created_at,
        href: reviewHref,
        label: reviewLabel,
        title: reviewNotificationTitle(reviewAction, isPage),
        detail: reviewDetail
      });
    }
    if (isAdmin && isPending) {
      notifications.push({
        id: `pending-draft:${draft.slug}:${draft.created_at}`,
        createdAt: draft.created_at,
        href: isPage ? pageDraftHref(draft, "candidate") : `./investigation.html?draft=${encodeURIComponent(draft.slug)}`,
        label: "Review queue",
        title: isPage ? "New page update pending review" : "New investigation pending review",
        detail: reviewDetail
      });
    }
  }

  if (isAdmin) {
    for (const comment of publicState.comments || []) {
      if (comment.author === viewer.pubkey) continue;
      notifications.push({
        id: `post-comment:${comment.id}`,
        createdAt: comment.created_at,
        href: `./investigation.html?slug=${encodeURIComponent(comment.post_slug)}#comment-${encodeURIComponent(comment.id)}`,
        label: "Post reply",
        title: "New comment on a published investigation",
        detail: trimmed(comment.markdown, 100)
      });
    }
  }

  const submissionNotifications = await loadSubmissionNotifications(publicState, viewer.pubkey, isAdmin);
  notifications.push(...submissionNotifications);

  const dismissed = dismissedNotificationIds();

  return notifications
    .sort((left, right) => right.createdAt - left.createdAt)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
    .filter((item) => !dismissed.has(item.id))
    .slice(0, 12);
}

async function loadSubmissionNotifications(publicState, viewerPubkey, isAdmin) {
  if (!state.session?.secretKeyHex) return [];
  const notifications = [];
  const knownSitePubkeys = notificationSitePubkeys(publicState);
  const ownSubmissions = await loadUserSubmissions(state.session.secretKeyHex).catch(() => []);
  const ownThreads = await Promise.all(
    ownSubmissions.slice(0, 8).map(async (submission) => ({
      submissionId: submission.id,
      messages: await loadSubmissionThread(state.session.secretKeyHex, submission.id, knownSitePubkeys).catch(() => [])
    }))
  );
  for (const thread of ownThreads) {
    for (const message of thread.messages) {
      if (message.author === viewerPubkey) continue;
      notifications.push({
        id: `submission-chat:${thread.submissionId}:${message.id}`,
        createdAt: Number(message.event?.created_at || 0),
        href: `./submit.html?chat=${encodeURIComponent(thread.submissionId)}`,
        label: "Submission chat",
        title: "New message in a submission thread",
        detail: trimmed(message.payload?.body || "", 100)
      });
    }
  }
  if (isAdmin) {
    const activeSitePubkey = state.publicState?.siteInfo?.activePubkey || "";
    const share = activeSitePubkey
      ? await loadAdminKeyShare(state.session.secretKeyHex, activeSitePubkey).catch(() => null)
      : null;
    if (share?.siteSecretKeyHex) {
      const inboxSubmissions = await loadInboxSubmissions(share.siteSecretKeyHex).catch(() => []);
      const inboxThreads = await Promise.all(
        inboxSubmissions.slice(0, 8).map(async (submission) => ({
          submissionId: submission.id,
          messages: await loadSubmissionThread(share.siteSecretKeyHex, submission.id, [submission.author]).catch(() => [])
        }))
      );
      for (const thread of inboxThreads) {
        for (const message of thread.messages) {
          if (message.author === viewerPubkey) continue;
          notifications.push({
            id: `admin-chat:${thread.submissionId}:${message.id}`,
            createdAt: Number(message.event?.created_at || 0),
            href: `./admin.html?tab=submissions&chat=${encodeURIComponent(thread.submissionId)}&with=${encodeURIComponent(submissionAuthor(thread.submissionId, inboxSubmissions))}`,
            label: "Submission chat",
            title: "New submission message in the shared inbox",
            detail: trimmed(message.payload?.body || "", 100)
          });
        }
      }
    }
  }
  return notifications;
}

function submissionAuthor(submissionId, submissions) {
  return submissions.find((submission) => submission.id === submissionId)?.author || "";
}

function notificationSitePubkeys(publicState) {
  return dedupe([
    publicState?.siteInfo?.activePubkey || "",
    publicState?.siteInfo?.fallbackPubkey || "",
    ...((publicState?.siteInfo?.events || []).map((event) => event.site_pubkey || ""))
  ]);
}

function dismissedNotificationIds() {
  if (!state.viewer?.pubkey) return new Set();
  try {
    const raw = window.localStorage.getItem(notificationDismissedKey(state.viewer.pubkey));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

function notificationDismissedKey(pubkey) {
  return `${SITE.nostr.storageNamespace}.notifications.dismissed.${pubkey}`;
}

function dismissNotification(id) {
  if (!state.viewer?.pubkey || !id) return;
  const dismissed = dismissedNotificationIds();
  dismissed.add(String(id));
  window.localStorage.setItem(notificationDismissedKey(state.viewer.pubkey), JSON.stringify([...dismissed]));
  state.notifications = state.notifications.filter((item) => item.id !== id);
}

function clearNotifications() {
  if (!state.viewer?.pubkey || !state.notifications.length) return;
  const dismissed = dismissedNotificationIds();
  for (const item of state.notifications) dismissed.add(item.id);
  window.localStorage.setItem(notificationDismissedKey(state.viewer.pubkey), JSON.stringify([...dismissed]));
  state.notifications = [];
}

function countUnreadNotifications(notifications) {
  return Array.isArray(notifications) ? notifications.length : 0;
}

function renderNotificationItem(item) {
  return `
    <a class="profile-menu__notice-item" href="${escapeAttribute(item.href)}" data-notification-link="${escapeAttribute(item.id)}">
      <span class="profile-menu__notice-label">${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail || "")}</span>
    </a>
  `;
}

function reviewNotificationTitle(action, isPage = false) {
  if (isPage) {
    if (action === "approve") return "Your page update was approved";
    if (action === "deny") return "A page update was denied";
    return "Revision was requested on your page update";
  }
  if (action === "approve") return "Your investigation was approved";
  if (action === "deny") return "An investigation was denied";
  return "Revision was requested on your investigation";
}

function shortReviewKey(value) {
  const clean = String(value || "").trim();
  return clean.length > 12 ? `${clean.slice(0, 8)}...${clean.slice(-4)}` : clean || "Editor";
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

function renderLeafletMap(canvas, entities) {
  if (!window.L) {
    canvas.innerHTML = `<div class="map-empty">Map library unavailable.</div>`;
    return;
  }
  canvas.innerHTML = "";
  if (!state.map) {
    state.map = window.L.map(canvas, {
      zoomControl: true,
      scrollWheelZoom: false
    }).setView(SITE.map.defaultCenter, SITE.map.defaultZoom);
    window.L.tileLayer(SITE.map.tileUrl, {
      attribution: SITE.map.tileAttribution,
      minZoom: SITE.map.minZoom
    }).addTo(state.map);
  }
  if (state.markers) state.markers.remove();
  state.markerIndex = new Map();
  state.markers = window.L.layerGroup().addTo(state.map);

  const points = [];
  for (const entity of entities) {
    if (!Number.isFinite(entity.lat) || !Number.isFinite(entity.lng)) continue;
    points.push([entity.lat, entity.lng]);
    const marker = window.L.circleMarker([entity.lat, entity.lng], {
      radius: 8,
      color: "#6f0d09",
      weight: 2,
      fillColor: "#b3201a",
      fillOpacity: 0.88
    }).addTo(state.markers);
    state.markerIndex.set(entity.slug, marker);
    marker.bindPopup(`
      <div class="map-popup">
        <strong>${escapeHtml(entity.name)}</strong>
        <div>${escapeHtml(entity.location)}</div>
        <a href="./map.html?entity=${encodeURIComponent(entity.slug)}">Open entry</a>
      </div>
    `);
    marker.on("click", () => {
      const card = document.querySelector(`[data-entity-card="${entity.slug}"]`);
      if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  if (points.length) {
    state.map.fitBounds(points, { padding: [40, 40] });
  } else {
    state.map.setView(SITE.map.defaultCenter, SITE.map.defaultZoom);
  }

  window.setTimeout(() => state.map?.invalidateSize(), 50);
}

function bindMapEntityCards() {
  for (const card of document.querySelectorAll("[data-entity-card]")) {
    if (!(card instanceof HTMLElement) || card.dataset.bound === "yes") continue;
    card.dataset.bound = "yes";
    card.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".entity-card__links a")) return;
      focusEntityOnMap(card.getAttribute("data-entity-card") || "");
    });
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target;
      if (target instanceof Element && target.closest(".entity-card__links a")) return;
      event.preventDefault();
      focusEntityOnMap(card.getAttribute("data-entity-card") || "");
    });
  }
}

function focusEntityOnMap(slug) {
  const clean = cleanSlug(slug || "");
  if (!clean) return;
  const marker = state.markerIndex?.get(clean);
  const card = document.querySelector(`[data-entity-card="${clean}"]`);
  if (card instanceof HTMLElement) {
    for (const item of document.querySelectorAll(".entity-card--focus")) item.classList.remove("entity-card--focus");
    card.classList.add("entity-card--focus");
  }
  if (marker && state.map) {
    const latLng = marker.getLatLng();
    state.map.flyTo(latLng, Math.max(state.map.getZoom(), 8), { duration: 0.45 });
    marker.openPopup();
  }
}

function focusRequestedEntity() {
  const requested = cleanSlug(new URLSearchParams(window.location.search).get("entity") || "");
  if (!requested) return;
  focusEntityOnMap(requested);
  const card = document.querySelector(`[data-entity-card="${requested}"]`);
  if (card instanceof HTMLElement) card.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function getPublicState() {
  if (state.publicState) return state.publicState;
  try {
    await ensureEventToolsLoaded();
    if (!state.guestSession) {
      state.guestSession = await getOrCreateGuestSession().catch(() => null);
    }
    state.publicState = await loadPublicState();
    if (state.session && !state.viewer) {
      state.viewer = deriveIdentity(state.session.secretKeyHex);
    }
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
      admins: []
    };
    return state.publicState;
  }
}

async function getViewer() {
  if (state.viewer) return state.viewer;
  if (!state.session) throw new Error("Log in first.");
  await ensureEventToolsLoaded();
  state.viewer = deriveIdentity(state.session.secretKeyHex);
  return state.viewer;
}

function editorEntryAllowed(publicState) {
  if (!state.session || !trustedAdminPubkeys(publicState).length) return false;
  if (!state.viewer) {
    state.viewer = deriveIdentity(state.session.secretKeyHex);
  }
  return trustedAdminPubkeys(publicState).includes(state.viewer.pubkey);
}

function trustedAdminPubkeys(publicState) {
  const admins = new Set(Array.isArray(publicState?.admins) ? publicState.admins : []);
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

async function connectLiveStaticPageOverlay() {
  const overlayState = state.pageOverlay;
  if (!overlayState?.pageId || overlayState.controller) return;

  try {
    const secretKeyHex = await getRequestSignerSecretKey();
    if (!secretKeyHex) return;
    overlayState.controller = await connectStaticPageOverlay({
      pageId: overlayState.pageId,
      secretKeyHex,
      kind: SITE.nostr.kinds.collabDocument,
      getTrustedPubkeys: () => trustedAdminPubkeys(state.publicState),
      canPublish: () => editorEntryAllowed(state.publicState),
      onRemoteContent: (content, detail) => handleLiveStaticPageContent(content, detail),
      onStatus: (detail) => handleLiveStaticPageStatus(detail),
    });
  } catch {
    return;
  }
}

function destroyStaticPageOverlay() {
  try {
    state.pageOverlay?.controller?.destroy?.();
  } catch {
    return;
  } finally {
    state.pageOverlay = null;
  }
}

function handleLiveStaticPageStatus(detail) {
  if (!state.pageOverlay || detail?.pageId !== state.pageOverlay.pageId) return;
  state.pageOverlay.status = String(detail?.state || "idle");
}

function handleLiveStaticPageContent(content, detail) {
  const overlayState = state.pageOverlay;
  if (!overlayState || detail?.pageId !== overlayState.pageId) return;

  const fallback = overlayState.publishedContent || overlayState.committedContent;
  const nextContent = detail?.hasLiveContent
    ? cloneStaticEditContent(content)
    : cloneStaticEditContent(fallback);

  overlayState.liveContent = detail?.hasLiveContent ? cloneStaticEditContent(content) : null;
  overlayState.currentContent = cloneStaticEditContent(nextContent);

  if (state.staticEdit?.enabled) {
    if (!staticEditContentMatches(state.staticEdit.history[state.staticEdit.historyIndex], nextContent)) {
      state.staticEdit.pendingLiveContent = cloneStaticEditContent(nextContent);
      state.staticEdit.status = "New live page updates are available. Snapshot or leave edit mode to refresh.";
      renderStaticEditBar();
    }
    return;
  }

  applyStaticEditContent(overlayState.elements, nextContent, fallback);

  if (state.staticEdit) {
    state.staticEdit.originalContent = cloneStaticEditContent(nextContent);
    if (!state.staticEdit.savedAt) {
      state.staticEdit.savedContent = cloneStaticEditContent(nextContent);
      state.staticEdit.history = [cloneStaticEditContent(nextContent)];
      state.staticEdit.historyIndex = 0;
      state.staticEdit.saveState = "idle";
    }
    if (!state.staticEdit.enabled) {
      state.staticEdit.status = state.staticEdit.savedAt
        ? `Local snapshot ready from ${formatLocalTimestamp(state.staticEdit.savedAt)}. Press Ctrl+Shift+E to resume it.`
        : "Press Ctrl+Shift+E to edit this page.";
      renderStaticEditBar();
    }
  }
}

function queueStaticEditLivePublish() {
  const editState = state.staticEdit;
  const overlayState = state.pageOverlay;
  if (!editState?.enabled || !overlayState?.controller) return;
  if (editState.livePublishTimer) window.clearTimeout(editState.livePublishTimer);
  editState.livePublishTimer = window.setTimeout(async () => {
    editState.livePublishTimer = 0;
    try {
      const nextContent = collectStaticEditContent(editState.elements);
      const changed = await overlayState.controller.setContent(nextContent);
      if (changed) {
        overlayState.currentContent = cloneStaticEditContent(nextContent);
      }
    } catch {
      return;
    }
  }, 220);
}

function renderStaticEditBar() {
  const editState = state.staticEdit;
  if (!editState) return;
  let bar = document.querySelector("[data-static-edit-bar]");
  if (!(bar instanceof HTMLElement)) {
    bar = document.createElement("div");
    bar.className = "static-edit-bar";
    bar.setAttribute("data-static-edit-bar", "");
    document.body.append(bar);
  }
  bar.classList.toggle("is-visible", editState.enabled);
  bar.innerHTML = `
    <div class="static-edit-bar__copy">
      <strong>Page edit mode</strong>
      <span>${escapeHtml(editState.status || "Edit directly on the page.")}</span>
    </div>
    <div class="static-edit-bar__actions">
      <button class="button-ghost static-edit-bar__button" type="button" data-static-edit-revert>Revert</button>
      <button class="button-ghost static-edit-bar__button" type="button" data-static-edit-undo ${editState.historyIndex > 0 ? "" : "disabled"}>Undo</button>
      <button class="button-ghost static-edit-bar__button" type="button" data-static-edit-redo ${editState.historyIndex < editState.history.length - 1 ? "" : "disabled"}>Redo</button>
      <button class="button static-edit-bar__button" type="button" data-static-edit-snapshot>Snapshot</button>
    </div>
  `;
}

function handleStaticEditShortcut(event) {
  if (!state.staticEdit) return;
  if (event.key === "Escape" && state.staticEdit.enabled) {
    event.preventDefault();
    cancelStaticEditChanges();
    return;
  }
  if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== "e") return;
  event.preventDefault();
  toggleStaticEditMode();
}

function toggleStaticEditMode(force) {
  const editState = state.staticEdit;
  if (!editState) return;
  const next = typeof force === "boolean" ? force : !editState.enabled;
  if (next && editState.savedAt) {
    applyStaticEditContent(editState.elements, editState.savedContent, editState.originalContent);
  }
  editState.enabled = next;
  document.body.classList.toggle("is-static-editing", next);
  for (const element of editState.elements) {
    element.contentEditable = next ? "true" : "false";
    element.spellcheck = next;
    element.classList.toggle("static-edit-target", next);
  }
  if (!next && editState.pendingLiveContent) {
    applyStaticEditContent(editState.elements, editState.pendingLiveContent, editState.originalContent);
    editState.originalContent = cloneStaticEditContent(editState.pendingLiveContent);
    editState.pendingLiveContent = null;
  }
  editState.status = next
    ? editState.savedAt
      ? `Editing local snapshot from ${formatLocalTimestamp(editState.savedAt)}.`
      : "Editing this page directly. Snapshot when ready."
    : editState.savedAt
      ? `Local snapshot saved ${formatLocalTimestamp(editState.savedAt)}.`
      : "Press Ctrl+Shift+E to edit this page.";
  renderStaticEditBar();
}

function handleStaticEditInteraction(event) {
  const editState = state.staticEdit;
  if (!editState) return;
  const target = event.target;
  if (!(target instanceof Element)) return;

  const action = target.closest("[data-static-edit-snapshot], [data-static-edit-undo], [data-static-edit-redo], [data-static-edit-revert]");
  if (action instanceof HTMLElement) {
    event.preventDefault();
    if (action.hasAttribute("data-static-edit-snapshot")) {
      void saveStaticEditSnapshot();
      return;
    }
    if (action.hasAttribute("data-static-edit-undo")) {
      stepStaticEditHistory(-1);
      return;
    }
    if (action.hasAttribute("data-static-edit-redo")) {
      stepStaticEditHistory(1);
      return;
    }
    if (action.hasAttribute("data-static-edit-revert")) {
      revertStaticEditToPublished();
    }
    return;
  }

  if (!editState.enabled) return;
  const editable = target.closest("[data-static-edit]");
  if (!(editable instanceof HTMLElement)) return;
  const link = target.closest("a");
  if (link) {
    event.preventDefault();
  }
}

function handleStaticEditInput(event) {
  const editState = state.staticEdit;
  if (!editState?.enabled) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches("[data-static-edit]")) return;
  queueStaticEditHistory();
  queueStaticEditLivePublish();
}

function handleStaticEditPaste(event) {
  const editState = state.staticEdit;
  if (!editState?.enabled) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.matches("[data-static-edit]")) return;
  event.preventDefault();
  const text = event.clipboardData?.getData("text/plain") || "";
  if (!text) return;
  document.execCommand("insertText", false, text);
}

function queueStaticEditHistory() {
  const editState = state.staticEdit;
  if (!editState) return;
  if (editState.historyTimer) window.clearTimeout(editState.historyTimer);
  editState.historyTimer = window.setTimeout(() => {
    editState.historyTimer = 0;
    const nextContent = collectStaticEditContent(editState.elements);
    const currentContent = editState.history[editState.historyIndex] || editState.originalContent;
    if (staticEditContentMatches(currentContent, nextContent)) return;
    editState.history = editState.history.slice(0, editState.historyIndex + 1);
    editState.history.push(cloneStaticEditContent(nextContent));
    editState.historyIndex = editState.history.length - 1;
    editState.saveState = "dirty";
    editState.status = "Unsaved page edits.";
    renderStaticEditBar();
  }, 120);
}

function stepStaticEditHistory(direction) {
  const editState = state.staticEdit;
  if (!editState) return;
  const nextIndex = editState.historyIndex + direction;
  if (nextIndex < 0 || nextIndex >= editState.history.length) return;
  editState.historyIndex = nextIndex;
  applyStaticEditContent(editState.elements, editState.history[nextIndex], editState.originalContent);
  editState.saveState = staticEditContentMatches(editState.history[nextIndex], editState.originalContent) ? "idle" : "dirty";
  editState.status = direction < 0 ? "Undid the last page edit." : "Restored the next page edit.";
  renderStaticEditBar();
}

function revertStaticEditToPublished() {
  const editState = state.staticEdit;
  if (!editState) return;
  clearStaticEditSnapshot(editState.pageId);
  applyStaticEditContent(editState.elements, editState.originalContent, editState.originalContent);
  editState.savedContent = cloneStaticEditContent(editState.originalContent);
  editState.history = [cloneStaticEditContent(editState.originalContent)];
  editState.historyIndex = 0;
  editState.savedAt = 0;
  editState.saveState = "idle";
  editState.status = "Reverted to the published page.";
  renderStaticEditBar();
}

function cancelStaticEditChanges() {
  const editState = state.staticEdit;
  if (!editState) return;
  if (editState.historyTimer) {
    window.clearTimeout(editState.historyTimer);
    editState.historyTimer = 0;
  }
  if (editState.livePublishTimer) {
    window.clearTimeout(editState.livePublishTimer);
    editState.livePublishTimer = 0;
  }
  const baseline = cloneStaticEditContent(editState.pendingLiveContent || editState.originalContent);
  applyStaticEditContent(editState.elements, baseline, editState.originalContent);
  editState.history = [cloneStaticEditContent(editState.savedContent || baseline)];
  editState.historyIndex = 0;
  editState.saveState = editState.savedAt ? "saved" : "idle";
  editState.enabled = false;
  editState.pendingLiveContent = null;
  document.body.classList.remove("is-static-editing");
  for (const element of editState.elements) {
    element.contentEditable = "false";
    element.spellcheck = false;
    element.classList.remove("static-edit-target");
  }
  editState.status = editState.savedAt
    ? `Discarded unsaved changes. Local snapshot is still ready from ${formatLocalTimestamp(editState.savedAt)}.`
    : "Discarded unsaved changes and returned to the published page.";
  renderStaticEditBar();
}

async function saveStaticEditSnapshot() {
  const editState = state.staticEdit;
  if (!editState) return;
  const content = collectStaticEditContent(editState.elements);
  try {
    if (editState.livePublishTimer) {
      window.clearTimeout(editState.livePublishTimer);
      editState.livePublishTimer = 0;
    }
    if (state.pageOverlay?.controller) {
      await state.pageOverlay.controller.setContent(content).catch(() => false);
      await state.pageOverlay.controller.flush?.().catch(() => null);
      state.pageOverlay.currentContent = cloneStaticEditContent(content);
      editState.originalContent = cloneStaticEditContent(content);
    }
  } catch {
    // Snapshot review should still work even if the live overlay publish path is unavailable.
  }
  const savedAt = Date.now();
  persistStaticEditSnapshot(editState.pageId, savedAt, content);
  editState.savedContent = cloneStaticEditContent(content);
  editState.savedAt = savedAt;
  editState.saveState = "saved";
  editState.status = `Snapshot saved locally at ${formatLocalTimestamp(savedAt)}. Sending it to review...`;
  if (!staticEditContentMatches(editState.history[editState.historyIndex], content)) {
    editState.history.push(cloneStaticEditContent(content));
    editState.historyIndex = editState.history.length - 1;
  }
  renderStaticEditBar();
  try {
    if (!state.session?.secretKeyHex) throw new Error("Log in with an admin account first.");
    const payload = buildStaticPageDraftPayload(editState.pageId, content);
    await publishTaggedJson({
      kind: SITE.nostr.kinds.draft,
      secretKeyHex: state.session.secretKeyHex,
      tags: [
        ["d", payload.slug],
        ["status", payload.status],
        ["content", payload.content_type],
        ["page", payload.page_id]
      ],
      content: payload
    });
    state.publicState = await loadPublicState(true);
    state.notifications = [];
    void hydrateNotifications(true);
    editState.status = `Snapshot saved locally at ${formatLocalTimestamp(savedAt)} and sent to review.`;
  } catch (error) {
    editState.status = `Snapshot saved locally at ${formatLocalTimestamp(savedAt)}. Review handoff failed: ${String(error?.message || error || "Unknown error")}`;
    editState.saveState = "dirty";
  }
  renderStaticEditBar();
}

function persistStaticEditSnapshot(pageId, savedAt, content) {
  window.localStorage.setItem(staticEditStorageKey(pageId), JSON.stringify({
    pageId,
    savedAt,
    content
  }));
}

function collectStaticEditContent(elements) {
  return Object.fromEntries(
    (Array.isArray(elements) ? elements : []).map((element) => [
      element.getAttribute("data-static-edit") || "",
      element.innerHTML
    ])
  );
}

function applyStaticEditContent(elements, content, fallback = {}) {
  for (const element of Array.isArray(elements) ? elements : []) {
    const key = element.getAttribute("data-static-edit") || "";
    element.innerHTML = Object.prototype.hasOwnProperty.call(content || {}, key)
      ? String(content[key] || "")
      : String(fallback?.[key] || "");
  }
}

function loadStaticEditSnapshot(pageId) {
  try {
    const raw = window.localStorage.getItem(staticEditStorageKey(pageId));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.content ? parsed : null;
  } catch {
    return null;
  }
}

function clearStaticEditSnapshot(pageId) {
  window.localStorage.removeItem(staticEditStorageKey(pageId));
}

function staticEditStorageKey(pageId) {
  return `${SITE.nostr.storageNamespace}.static-edit.${pageId}`;
}

function staticEditContentMatches(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

function cloneStaticEditContent(content) {
  return JSON.parse(JSON.stringify(content || {}));
}

function renderError(node, message) {
  if (!node) return;
  node.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function renderLoadingState(message) {
  const reloadHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `
    <div class="loading-state loading-state--panel" role="status" aria-live="polite">
      <div class="loading-state__message">
        <span class="loading-spinner" aria-hidden="true"></span>
        <span>${escapeHtml(message)}</span>
      </div>
      <div class="loading-state__slow">
        <span>This is taking longer than expected.</span>
        <a class="button-ghost loading-state__reload" href="${escapeAttribute(reloadHref)}">Reload</a>
      </div>
    </div>
  `;
}

function renderTagList(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => `<a class="tag tag--link" href="./investigations.html?tag=${encodeURIComponent(String(tag || "").trim())}">${escapeHtml(String(tag))}</a>`)
    .join("");
}

function renderMiniMarkdown(markdown) {
  const text = escapeHtml(String(markdown || "")).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>");
  return `<p>${text}</p>`;
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

function trimmed(value, length) {
  const text = String(value || "").trim();
  return text.length > length ? `${text.slice(0, Math.max(0, length - 1))}...` : text;
}

function dedupe(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "");
}
