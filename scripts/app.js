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

const state = {
  session: getStoredSession(),
  guestSession: getStoredGuestSession(),
  viewer: null,
  publicState: null,
  postsPromise: null,
  commentReply: null,
  notifications: [],
  notificationsLoading: false,
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
  void initAuthoringEntry();
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
      if (menu) {
        const isOpen = !menu.classList.contains("is-open");
        menu.classList.toggle("is-open", isOpen);
        if (isOpen) markNotificationsSeen();
      }
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
  void hydrateNotifications();
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
  const notifications = isLoggedIn ? state.notifications.slice(0, 8) : [];
  const unreadCount = isLoggedIn ? countUnreadNotifications(notifications) : 0;
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
    <div class="profile-menu ${NAV_KEYS.workspace.includes(page) ? "is-current" : ""}" data-profile-menu>
      <button class="profile-menu__toggle ${currentUser?.avatarUrl ? "has-avatar" : !isLoggedIn ? "is-wordmark" : ""}" type="button" data-profile-toggle aria-label="${isLoggedIn ? "Profile options" : "Log in"}">
        <span class="profile-menu__badge ${currentUser?.avatarUrl ? "has-avatar" : !isLoggedIn ? "is-wordmark" : ""}">${profileBadgeMarkup(currentUser)}</span>
        ${unreadCount ? `<span class="profile-menu__notice">${Math.min(unreadCount, 9)}${unreadCount > 9 ? "+" : ""}</span>` : ""}
      </button>
      <div class="profile-menu__panel">
        ${
          isLoggedIn
            ? `
              ${
                state.notificationsLoading
                  ? `<div class="profile-menu__section"><div class="loading-state" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span>Looking up notifications...</span></div></div>`
                  : notifications.length
                    ? `
                      <div class="profile-menu__section">
                        <div class="profile-menu__section-title">Notifications</div>
                        <div class="profile-menu__notifications">
                          ${notifications.map((item) => renderNotificationItem(item)).join("")}
                        </div>
                      </div>
                    `
                    : ""
              }
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
    const publicState = await getPublicState();
    const canEdit = editorEntryAllowed(publicState);
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
        ? buildInvestigationArchiveEntries(posts, publicState.drafts || [])
        : posts.map((post) => ({
            ...post,
            archiveStatus: "posted",
            statusLabel: "Posted",
            href: `./investigation.html?slug=${encodeURIComponent(post.slug)}`,
            actionLabel: "Open investigation"
          }));
      listGrid.innerHTML = `
        ${canEdit ? renderAuthoringLeadCard() : ""}
        ${entries.map((post) => renderInvestigationCard(post, false)).join("")}
      `;
    }
  } catch {
    renderError(homeGrid || listGrid, "Investigation feed unavailable.");
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

async function initInvestigationDetail() {
  const article = document.querySelector("[data-investigation-article]");
  if (!article) return;
  article.innerHTML = renderLoadingState("Looking up article...");
  const commentPanel = document.querySelector("[data-comment-panel]");
  const reviewPanel = document.querySelector("[data-investigation-review]");
  if (commentPanel) commentPanel.innerHTML = renderLoadingState("Looking up discussion...");

  try {
    const posts = await loadPosts();
    const publicState = await getPublicState();
    const params = new URLSearchParams(window.location.search);
    const slug = cleanSlug(params.get("slug") || "");
    const draftSlug = cleanSlug(params.get("draft") || "");
    const canReview = editorEntryAllowed(publicState);
    const draft = draftSlug
      ? (publicState.drafts || []).find((item) => item.slug === draftSlug) || null
      : null;
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
    setText("[data-investigation-date]", formatDate(post.date));
    setText("[data-investigation-region]", post.location);
    setText("[data-investigation-status]", post.statusLabel || post.status);
    const tags = document.querySelector("[data-investigation-kicker]");
    if (tags) tags.innerHTML = renderTagList(post.tags);
    const records = document.querySelector("[data-investigation-records]");
    if (records) records.innerHTML = renderRecordList(post.records);
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
    if (reviewPanel instanceof HTMLElement) {
      if (isDraftPreview) {
        reviewPanel.hidden = false;
        reviewPanel.innerHTML = renderReviewPreviewPanel(draft);
        bindReviewPreviewPanel(reviewPanel, draft);
      } else {
        reviewPanel.hidden = true;
        reviewPanel.innerHTML = "";
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
    if (reviewPanel instanceof HTMLElement) {
      reviewPanel.hidden = true;
      reviewPanel.innerHTML = "";
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
  focusRequestedEntity();
}

async function renderComments(postSlug, publicState) {
  const panel = document.querySelector("[data-comment-panel]");
  if (!panel) return;

  const comments = publicState.commentsByPost.get(postSlug) || [];
  const threadedComments = buildCommentTree(comments);
  const isLoggedIn = Boolean(state.session);
  const isAdmin = Boolean(state.viewer && publicState.admins.includes(state.viewer.pubkey));
  const currentUser = isLoggedIn && state.viewer
    ? publicState.users.find((user) => user.pubkey === state.viewer.pubkey) || null
    : null;
  const replyTarget = state.commentReply?.postSlug === postSlug
    ? comments.find((comment) => comment.id === state.commentReply.commentId) || null
    : null;
  if (state.commentReply?.postSlug === postSlug && !replyTarget) {
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
            <form class="comment-composer__form" data-comment-form>
              <div class="comment-composer__head">
                <strong>${replyTarget ? "Write a reply" : "Add a comment"}</strong>
                <span>${replyTarget ? "Your reply will appear under the selected comment." : "Keep it specific and tied to the post."}</span>
              </div>
              ${
                replyTarget
                  ? `
                    <div class="comment-composer__reply">
                      <span>Replying to ${escapeHtml(commentAuthorLabel(replyTarget, publicState))}</span>
                      <button class="button-ghost" type="button" data-cancel-reply>Cancel</button>
                    </div>
                  `
                  : ""
              }
              <label class="sr-only" for="commentComposerInput">Comment</label>
              <textarea id="commentComposerInput" class="comment-composer__input" name="markdown" placeholder="${replyTarget ? "Write a reply..." : "Write a comment..."}" required></textarea>
              <div class="comment-composer__footer">
                <span class="muted-text">${replyTarget ? "Replying keeps the thread together." : "Comments show up with your profile."}</span>
                <button class="button" type="submit">${replyTarget ? "Reply" : "Post comment"}</button>
              </div>
              <div class="status-box" data-comment-status aria-live="polite"></div>
            </form>
          </section>
        `
        : `<div class="empty-state">Log in to comment or reply.</div>`
    }
    ${
      threadedComments.length
        ? `<div class="comment-list">${threadedComments.map((comment) => renderComment(comment, publicState, { isAdmin, canReply: isLoggedIn })).join("")}</div>`
        : isLoggedIn
          ? `<div class="comment-list"><div class="empty-state">No comments yet. Start the discussion.</div></div>`
          : ""
    }
  `;

  const form = panel.querySelector("[data-comment-form]");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = panel.querySelector("[data-comment-status]");
      const textarea = form.elements.namedItem("markdown");
      const submitButton = form.querySelector('button[type="submit"]');
      const markdown = String(textarea?.value || "").trim();
      if (!markdown) return;
      const activeReply = state.commentReply?.postSlug === postSlug
        ? comments.find((comment) => comment.id === state.commentReply.commentId) || null
        : null;
      const parentId = activeReply?.id || "";
      const rootId = activeReply ? String(activeReply.root_id || activeReply.parent_id || activeReply.id || "").trim() : "";

      try {
        const viewer = await getViewer();
        if (submitButton instanceof HTMLButtonElement) submitButton.disabled = true;
        if (status) {
          status.textContent = activeReply ? "Posting reply..." : "Posting comment...";
          status.dataset.state = "pending";
        }
        await publishTaggedJson({
          kind: SITE.nostr.kinds.comment,
          secretKeyHex: state.session.secretKeyHex,
          tags: [
            ["d", `comment-${Date.now()}`],
            ["a", postSlug],
            ...(parentId ? [["e", parentId], ["parent", parentId]] : []),
            ...(rootId ? [["root", rootId]] : [])
          ],
          content: {
            post_slug: postSlug,
            markdown,
            parent_id: parentId,
            root_id: rootId
          }
        });
        form.reset();
        state.commentReply = null;
        panel.innerHTML = renderLoadingState("Looking up discussion...");
        state.publicState = await loadPublicState(true);
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
      const input = panel.querySelector("#commentComposerInput");
      if (input instanceof HTMLTextAreaElement) input.focus();
    });
  }

  const cancelReply = panel.querySelector("[data-cancel-reply]");
  if (cancelReply) {
    cancelReply.addEventListener("click", async () => {
      state.commentReply = null;
      await renderComments(postSlug, publicState);
    });
  }

  for (const button of panel.querySelectorAll("[data-hide-comment]")) {
    button.addEventListener("click", async () => {
      try {
        panel.innerHTML = renderLoadingState("Looking up discussion...");
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
      const archived = status === "approved" ? "approved" : status;
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

function normalizeDraftStatus(status) {
  return String(status || "").trim().toLowerCase();
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
  return `
    <div class="eyebrow">Review preview</div>
    <h3>${escapeHtml(draftStatusLabel(status, reviewAction))}</h3>
    <p class="muted-text">Submitted by ${escapeHtml(ownerLabel)}. This view is read-only so the review decision happens against what was actually submitted.</p>
    <div class="tag-row">
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
          : normalizeDraftStatus(draft.status) === "revision"
            ? `<a class="button-ghost" href="./editor.html?slug=${encodeURIComponent(draft.slug)}">Open in editor</a>`
            : `<a class="button-ghost" href="./investigations.html">Back to investigations</a>`
      }
    </div>
    <div class="status-box" data-review-status aria-live="polite"></div>
  `;
}

function bindReviewPreviewPanel(panel, draft) {
  const buttons = panel.querySelectorAll("[data-review-action]");
  for (const button of buttons) {
    button.addEventListener("click", async () => {
      const action = button.getAttribute("data-review-action") || "";
      const statusBox = panel.querySelector("[data-review-status]");
      if (!state.session || !editorEntryAllowed(state.publicState)) return;
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
            ["review", action]
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
          statusBox.textContent = reviewActionMessage(action);
          statusBox.dataset.state = "success";
        }
        window.setTimeout(() => {
          window.location.href = "./investigations.html";
        }, 700);
      } catch (error) {
        if (statusBox instanceof HTMLElement) {
          statusBox.textContent = String(error?.message || error || "Review action failed.");
          statusBox.dataset.state = "error";
        }
      } finally {
        button.removeAttribute("disabled");
      }
    });
  }
}

function reviewStatusForAction(action) {
  if (action === "approve") return "approved";
  if (action === "deny") return "denied";
  return "revision";
}

function reviewActionMessage(action) {
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
  const seenAt = notificationSeenAt();
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
      unread: comment.created_at > seenAt,
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
      unread: status.updated_at > seenAt,
      label: "Submission update",
      title: `Submission ${status.status}`,
      detail: status.note || "A submission you sent has a new status."
    });
  }

  for (const draft of publicState.drafts || []) {
    const reviewAction = draftReviewAction(draft);
    const ownerPubkey = draftOwnerPubkey(draft);
    const isPending = ["candidate", "review", "submitted"].includes(normalizeDraftStatus(draft.status));
    if (ownerPubkey === viewer.pubkey && ["approve", "revise", "deny"].includes(reviewAction)) {
      notifications.push({
        id: `draft-review:${draft.slug}:${draft.created_at}`,
        createdAt: draft.created_at,
        href: normalizeDraftStatus(draft.status) === "revision"
          ? `./editor.html?slug=${encodeURIComponent(draft.slug)}`
          : `./investigation.html?draft=${encodeURIComponent(draft.slug)}`,
        unread: draft.created_at > seenAt,
        label: "Investigation review",
        title: reviewNotificationTitle(reviewAction),
        detail: draft.title
      });
    }
    if (isAdmin && isPending) {
      notifications.push({
        id: `pending-draft:${draft.slug}:${draft.created_at}`,
        createdAt: draft.created_at,
        href: `./investigation.html?draft=${encodeURIComponent(draft.slug)}`,
        unread: draft.created_at > seenAt,
        label: "Review queue",
        title: "New investigation pending review",
        detail: draft.title
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
        unread: comment.created_at > seenAt,
        label: "Post reply",
        title: "New comment on a published investigation",
        detail: trimmed(comment.markdown, 100)
      });
    }
  }

  const submissionNotifications = await loadSubmissionNotifications(publicState, viewer.pubkey, isAdmin);
  notifications.push(...submissionNotifications.map((item) => ({
    ...item,
    unread: item.createdAt > seenAt
  })));

  return notifications
    .sort((left, right) => right.createdAt - left.createdAt)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index)
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
            href: `./admin.html?tab=submissions`,
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

function notificationSitePubkeys(publicState) {
  return dedupe([
    publicState?.siteInfo?.activePubkey || "",
    publicState?.siteInfo?.fallbackPubkey || "",
    ...((publicState?.siteInfo?.events || []).map((event) => event.site_pubkey || ""))
  ]);
}

function notificationSeenAt() {
  if (!state.viewer?.pubkey) return 0;
  const raw = window.localStorage.getItem(notificationSeenKey(state.viewer.pubkey));
  const value = Number(raw || 0);
  return Number.isFinite(value) ? value : 0;
}

function notificationSeenKey(pubkey) {
  return `${SITE.nostr.storageNamespace}.notifications.seen.${pubkey}`;
}

function markNotificationsSeen() {
  if (!state.viewer?.pubkey || !state.notifications.length) return;
  const latest = state.notifications.reduce((max, item) => Math.max(max, Number(item.createdAt || 0)), 0);
  if (!latest) return;
  window.localStorage.setItem(notificationSeenKey(state.viewer.pubkey), String(latest));
  state.notifications = state.notifications.map((item) => ({ ...item, unread: false }));
  const badge = document.querySelector(".profile-menu__notice");
  if (badge) badge.remove();
}

function countUnreadNotifications(notifications) {
  return (Array.isArray(notifications) ? notifications : []).filter((item) => item.unread).length;
}

function renderNotificationItem(item) {
  return `
    <a class="profile-menu__notice-item" href="${escapeAttribute(item.href)}">
      <span class="profile-menu__notice-label">${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail || "")}</span>
    </a>
  `;
}

function reviewNotificationTitle(action) {
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
  if (!state.session || !publicState?.admins?.length) return false;
  if (!state.viewer) {
    state.viewer = deriveIdentity(state.session.secretKeyHex);
  }
  return publicState.admins.includes(state.viewer.pubkey);
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

function renderLoadingState(message) {
  return `
    <div class="loading-state loading-state--panel" role="status" aria-live="polite">
      <span class="loading-spinner" aria-hidden="true"></span>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
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
