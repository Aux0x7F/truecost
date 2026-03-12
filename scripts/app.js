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
  loadPublicState,
  publishTaggedJson
} from "./core/nostr.js";
import { clearSession, getOrCreateGuestSession, getStoredGuestSession, getStoredSession } from "./core/session.js";

const NAV_KEYS = {
  home: ["home"],
  investigations: ["investigations", "investigation"],
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

const state = {
  session: getStoredSession(),
  guestSession: getStoredGuestSession(),
  viewer: null,
  publicState: null,
  postsPromise: null,
  map: null,
  markers: null
};

document.addEventListener("DOMContentLoaded", () => {
  initExternalLinks();
  initNavigation();
  initInvestigationCards();
  void initInvestigationDetail();
  void initMarkdownArticles();
  void initMapPage();
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
      const menu = profileToggle.closest("[data-profile-menu]");
      if (menu) menu.classList.toggle("is-open");
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
      if (!menu.contains(target)) menu.classList.remove("is-open");
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
  renderNavigation();
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
      state.publicState?.admins?.includes(state.viewer.pubkey)
  );
  const mapEnabled = Boolean(state.publicState?.connected);
  const mapCurrent = NAV_KEYS.map.includes(page);

  nav.innerHTML = `
    <a class="${navLinkClass(page, "home")}" href="./index.html">Home</a>
    <a class="${navLinkClass(page, "investigations")}" href="./investigations.html">Investigations</a>
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
    <div class="profile-menu ${NAV_KEYS.workspace.includes(page) ? "is-current" : ""}" data-profile-menu>
      <button class="profile-menu__toggle ${currentUser?.avatarUrl ? "has-avatar" : !isLoggedIn ? "is-wordmark" : ""}" type="button" data-profile-toggle aria-label="Profile options">
        <span class="profile-menu__badge ${currentUser?.avatarUrl ? "has-avatar" : !isLoggedIn ? "is-wordmark" : ""}">${profileBadgeMarkup(currentUser)}</span>
        <span class="profile-menu__label">${isLoggedIn ? (isAdmin ? "Profile / Admin" : "Profile options") : "Log in"}</span>
      </button>
      <div class="profile-menu__panel">
        ${
          isLoggedIn
            ? `
              <a href="./admin.html?tab=profile">Profile options</a>
              ${isAdmin ? `<a href="./admin.html?tab=dashboard">Admin</a>` : ""}
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
  if (!homeGrid && !listGrid) return;

  try {
    const posts = await loadPosts();
    if (homeGrid) {
      const count = Number(homeGrid.getAttribute("data-count") || "2");
      homeGrid.innerHTML = posts
        .filter((post) => post.featured)
        .slice(0, count)
        .map((post) => renderInvestigationCard(post, true))
        .join("");
    }
    if (listGrid) {
      listGrid.innerHTML = posts.map((post) => renderInvestigationCard(post, false)).join("");
    }
  } catch {
    renderError(homeGrid || listGrid, "Investigation feed unavailable.");
  }
}

async function initInvestigationDetail() {
  const article = document.querySelector("[data-investigation-article]");
  if (!article) return;

  try {
    const posts = await loadPosts();
    const slug = cleanSlug(new URLSearchParams(window.location.search).get("slug") || "");
    const post = posts.find((item) => item.slug === slug) || posts[0];
    if (!post) throw new Error("No investigations found.");

    renderMarkdown(article, post.body);
    setText("[data-investigation-title]", post.title);
    setText("[data-investigation-summary]", post.summary);
    setText("[data-investigation-date]", formatDate(post.date));
    setText("[data-investigation-region]", post.location);
    setText("[data-investigation-status]", post.status);
    const tags = document.querySelector("[data-investigation-kicker]");
    if (tags) tags.innerHTML = renderTagList(post.tags);
    const records = document.querySelector("[data-investigation-records]");
    if (records) records.innerHTML = renderRecordList(post.records);
    const related = document.querySelector("[data-investigation-related]");
    if (related) {
      related.innerHTML = posts
        .filter((item) => item.slug !== post.slug)
        .slice(0, 2)
        .map((item) => renderInvestigationCard(item, true))
        .join("");
    }

    const publicState = await getPublicState();
    enrichArticleEntities(article, publicState);
    await renderComments(post.slug, publicState);
    document.title = `${post.title} | ${SITE.shortName}`;
  } catch {
    renderError(article, "This case file could not be loaded.");
  }
}

async function initMarkdownArticles() {
  const article = document.querySelector("[data-markdown-article]");
  if (!article) return;

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
  focusRequestedEntity();
}

async function renderComments(postSlug, publicState) {
  const panel = document.querySelector("[data-comment-panel]");
  if (!panel) return;

  const comments = publicState.commentsByPost.get(postSlug) || [];
  const isLoggedIn = Boolean(state.session);
  const isAdmin = Boolean(state.viewer && publicState.admins.includes(state.viewer.pubkey));

  panel.innerHTML = `
    <div class="comment-panel__head">
      <div>
        <div class="eyebrow">Discussion</div>
        <h2>Comments</h2>
      </div>
      <p>${comments.length} visible comment${comments.length === 1 ? "" : "s"}</p>
    </div>
    ${
      isLoggedIn
        ? `
          <form class="comment-form" data-comment-form>
            <label>
              <span>Add a comment</span>
              <textarea name="markdown" placeholder="Keep it brief and tied to the post." required></textarea>
            </label>
            <div class="button-row">
              <button class="button" type="submit">Post comment</button>
            </div>
            <div class="status-box" data-comment-status></div>
          </form>
        `
        : `<div class="empty-state">Log in to join the discussion.</div>`
    }
    ${
      comments.length
        ? `<div class="comment-list">${comments.map((comment) => renderComment(comment, publicState, isAdmin)).join("")}</div>`
        : isLoggedIn
          ? `<div class="comment-list"><div class="empty-state">No comments yet.</div></div>`
          : ""
    }
  `;

  const form = panel.querySelector("[data-comment-form]");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = panel.querySelector("[data-comment-status]");
      const textarea = form.elements.namedItem("markdown");
      const markdown = String(textarea?.value || "").trim();
      if (!markdown) return;

      try {
        const viewer = await getViewer();
        await publishTaggedJson({
          kind: SITE.nostr.kinds.comment,
          secretKeyHex: state.session.secretKeyHex,
          tags: [["d", `comment-${Date.now()}`], ["a", postSlug]],
          content: {
            post_slug: postSlug,
            markdown
          }
        });
        if (status) {
          status.textContent = "Comment published.";
          status.dataset.state = "success";
        }
        form.reset();
        state.publicState = await loadPublicState(true);
        state.viewer = viewer;
        await renderComments(postSlug, state.publicState);
      } catch (error) {
        if (status) {
          status.textContent = String(error?.message || error || "Comment failed.");
          status.dataset.state = "error";
        }
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

function renderComment(comment, publicState, isAdmin) {
  const author = publicState.users.find((user) => user.pubkey === comment.author);
  const authorLabel = author?.displayName || author?.username || "User";
  return `
    <article class="comment-card">
      <div class="comment-card__meta">
        <strong>${escapeHtml(authorLabel)}</strong>
        <span>${formatDateTime(comment.created_at)}</span>
      </div>
      <div class="comment-card__body">${renderMiniMarkdown(comment.markdown)}</div>
      ${isAdmin ? `<div class="comment-card__actions"><button type="button" class="button-ghost" data-hide-comment="${escapeAttribute(comment.id)}">Hide</button></div>` : ""}
    </article>
  `;
}

function renderInvestigationCard(post, compact) {
  return `
    <article class="investigation-card ${compact ? "investigation-card--compact" : ""}">
      <div class="eyebrow">Case file</div>
      <h3><a href="./investigation.html?slug=${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h3>
      <p class="card-meta">${escapeHtml(post.location)} <span>${escapeHtml(formatDate(post.date))}</span></p>
      <p>${escapeHtml(post.summary)}</p>
      <div class="tag-row">${renderTagList((post.tags || []).slice(0, compact ? 2 : 4))}</div>
      <a class="text-link" href="./investigation.html?slug=${encodeURIComponent(post.slug)}">Open investigation</a>
    </article>
  `;
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

function renderEntityCard(entity, posts) {
  return `
    <article class="entity-card" id="entity-card-${escapeAttribute(entity.slug)}" data-entity-card="${escapeAttribute(entity.slug)}">
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

function focusRequestedEntity() {
  const requested = cleanSlug(new URLSearchParams(window.location.search).get("entity") || "");
  if (!requested) return;
  const card = document.querySelector(`[data-entity-card="${requested}"]`);
  if (card) {
    card.classList.add("entity-card--focus");
    card.scrollIntoView({ behavior: "smooth", block: "center" });
  }
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

function renderError(node, message) {
  if (!node) return;
  node.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function renderTagList(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => `<span class="tag">${escapeHtml(String(tag))}</span>`)
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
