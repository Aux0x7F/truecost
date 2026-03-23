import { investigationDocumentId } from "../core/investigation-document.js";
import { draftToInvestigationPreview, isPageDraft } from "../core/page-drafts.js";
import { bindReviewPreviewPanel, renderReviewPreviewPanel } from "./review-preview.js";

export function createInvestigationDetailSurface({ site, state, deps = {} } = {}) {
  const cleanSlug = deps.cleanSlug || ((value) => String(value || "").trim().toLowerCase());
  const renderError = deps.renderError || (() => {});
  const renderLoadingState = deps.renderLoadingState || ((value) => String(value || ""));
  const getCachedPosts = deps.getCachedPosts || (() => []);
  const refreshPosts = deps.refreshPosts || (async () => []);
  const getPublicState = deps.getPublicState || (async () => null);
  const editorEntryAllowed = deps.editorEntryAllowed || (() => false);
  const loadDraftBySlug = deps.loadDraftBySlug || (async () => null);
  const setText = deps.setText || (() => {});
  const renderMarkdown = deps.renderMarkdown || (() => {});
  const renderArticleBody = deps.renderArticleBody || null;
  const buildArticleMetaLine = deps.buildArticleMetaLine || (() => "");
  const renderTagList = deps.renderTagList || (() => "");
  const renderRecordList = deps.renderRecordList || (() => "");
  const renderInvestigationCard = deps.renderInvestigationCard || (() => "");
  const enrichArticleEntities = deps.enrichArticleEntities || (() => {});
  const archiveEntitiesForEntries = deps.archiveEntitiesForEntries || (() => []);
  const renderLeafletPreviewMap = deps.renderLeafletPreviewMap || (() => {});
  const queueLeafletBoundsFit = deps.queueLeafletBoundsFit || (() => {});
  const destroyLeafletPreview = deps.destroyLeafletPreview || (() => {});
  const renderComments = deps.renderComments || (async () => {});
  const connectStructuredUnitOverlay = deps.connectStructuredUnitOverlay || (async () => null);
  const trustedAdminPubkeys = deps.trustedAdminPubkeys || (() => []);
  const formatDate = deps.formatDate || ((value) => String(value || ""));

  async function init() {
    const article = document.querySelector("[data-investigation-article]");
    if (!(article instanceof HTMLElement)) return;
    destroy();

    const commentPanel = document.querySelector("[data-comment-panel]");
    const reviewShell = document.querySelector("[data-investigation-review-shell]");
    const tagsShell = document.querySelector("[data-investigation-tags-shell]");
    const tagsHost = document.querySelector("[data-investigation-tags]");
    const recordsShell = document.querySelector("[data-investigation-records-shell]");
    const mapShell = document.querySelector("[data-investigation-map-shell]");
    const mapCanvas = document.querySelector("[data-investigation-map-canvas]");
    const params = new URLSearchParams(window.location.search);
    const slug = cleanSlug(params.get("slug") || "");
    const draftSlug = cleanSlug(params.get("draft") || "");
    const cachedPosts = clonePosts(getCachedPosts());
    const cachedPublicState = state.publicState;

    if (!draftSlug && cachedPosts.length) {
      const cachedPost = cachedPosts.find((item) => item.slug === slug) || cachedPosts[0] || null;
      if (cachedPost) {
        if (commentPanel instanceof HTMLElement) commentPanel.innerHTML = "";
        await renderState({
          article,
          commentPanel,
          reviewShell,
          tagsShell,
          tagsHost,
          recordsShell,
          mapShell,
          mapCanvas,
          publicState: cachedPublicState || emptyPublicState(),
          posts: cachedPosts,
          isDraftPreview: false,
          draft: null
        }, cachedPost, { refreshComments: true });
      } else {
        article.innerHTML = renderLoadingState("Looking up article...");
        if (commentPanel instanceof HTMLElement) {
          commentPanel.innerHTML = renderLoadingState("Looking up discussion...");
        }
      }
    } else {
      article.innerHTML = renderLoadingState("Looking up article...");
      if (commentPanel instanceof HTMLElement) {
        commentPanel.innerHTML = renderLoadingState("Looking up discussion...");
      }
    }

    try {
      const posts = await refreshPosts();
      const publicState = await getPublicState();
      const canReview = editorEntryAllowed(publicState);
      let draft = draftSlug
        ? draftToInvestigationDraft(publicState, draftSlug)
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
        : posts.find((item) => item.slug === slug) || posts[0] || null;
      if (!post) throw new Error("No investigations found.");

      state.investigationOverlay = {
        documentId: investigationDocumentId(draftSlug || post.slug || slug),
        slug: cleanSlug(draftSlug || post.slug || slug),
        baselinePost: cloneInvestigationPost(post),
        currentPost: cloneInvestigationPost(post),
        liveContent: null,
        liveFingerprint: "",
        controller: null,
        pollTimer: 0,
        status: "idle",
        posts,
        publicState,
        isDraftPreview,
        draft,
        article,
        commentPanel,
        reviewShell,
        tagsShell,
        tagsHost,
        recordsShell,
        mapShell,
        mapCanvas
      };

      void connectLiveOverlay();
      await renderState(state.investigationOverlay, state.investigationOverlay.currentPost, {
        refreshComments: true
      });
    } catch {
      renderError(article, "This case file could not be loaded.");
      destroy();
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

  async function renderState(overlayState, post, options = {}) {
    if (!overlayState || !post) return;
    const {
      article,
      commentPanel,
      reviewShell,
      tagsShell,
      tagsHost,
      recordsShell,
      mapShell,
      mapCanvas,
      publicState,
      posts,
      isDraftPreview,
      draft
    } = overlayState;
    const refreshComments = Boolean(options.refreshComments);

    if (typeof renderArticleBody === "function") {
      renderArticleBody(article, post);
    } else {
      renderMarkdown(article, post.body);
    }
    setText("[data-investigation-title]", post.title);
    setText("[data-investigation-summary]", post.summary);
    setText("[data-investigation-meta]", buildArticleMetaLine(post));
    const tags = document.querySelector("[data-investigation-kicker]");
    if (tags instanceof HTMLElement) tags.innerHTML = renderTagList(post.tags);
    if (tagsHost instanceof HTMLElement && tagsShell instanceof HTMLElement) {
      const hasTags = Array.isArray(post.tags) && post.tags.length;
      tagsHost.innerHTML = hasTags ? renderTagList(post.tags) : "";
      tagsShell.hidden = !hasTags;
    }
    const records = document.querySelector("[data-investigation-records]");
    if (records instanceof HTMLElement) {
      const hasRecords = Array.isArray(post.records) && post.records.length;
      records.innerHTML = renderRecordList(post.records);
      if (recordsShell instanceof HTMLElement) recordsShell.hidden = !hasRecords;
    }
    const related = document.querySelector("[data-investigation-related]");
    if (related instanceof HTMLElement) {
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
      if (isDraftPreview && draft) {
        reviewShell.hidden = false;
        reviewShell.innerHTML = renderReviewPreviewPanel(draft, { publicState, formatDate });
        bindReviewPreviewPanel(reviewShell, draft, async (currentDraft, button) => {
          if (typeof deps.publishReviewDecision === "function") {
            await deps.publishReviewDecision(reviewShell, currentDraft, button);
          }
        });
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
        renderLeafletPreviewMap(mapCanvas, mappedEntities, queueLeafletBoundsFit);
      } else {
        mapShell.hidden = true;
        destroyLeafletPreview(mapCanvas);
        mapCanvas.innerHTML = "";
      }
    }
    if (commentPanel instanceof HTMLElement) {
      commentPanel.hidden = isDraftPreview;
      if (refreshComments && !isDraftPreview) {
        await renderComments(post.slug, publicState);
      } else if (isDraftPreview) {
        commentPanel.innerHTML = "";
      }
    }
    document.title = `${post.title} | ${site.shortName}`;
  }

  async function connectLiveOverlay() {
    const overlayState = state.investigationOverlay;
    if (!overlayState?.documentId || overlayState.controller) return;

    try {
      overlayState.controller = await connectStructuredUnitOverlay({
        documentId: overlayState.documentId,
        kind: site.nostr.kinds.collabDocument,
        getTrustedPubkeys: () => trustedAdminPubkeys(state.publicState),
        canPublish: () => false,
        onRemoteContent: (content, detail) => {
          void handleLiveContent(content, detail);
        },
        onStatus: (detail) => handleLiveStatus(detail)
      });
      const initialContent = overlayState.controller?.getContent?.() || {};
      if (Object.keys(initialContent).length) {
        await handleLiveContent(initialContent, {
          documentId: overlayState.documentId,
          hasLiveContent: true,
          origin: "initial"
        });
      }
      startLivePolling(overlayState);
    } catch {
      return;
    }
  }

  function destroy() {
    if (state.investigationOverlay?.pollTimer) {
      window.clearInterval(state.investigationOverlay.pollTimer);
      state.investigationOverlay.pollTimer = 0;
    }
    try {
      state.investigationOverlay?.controller?.destroy?.();
    } catch {
      return;
    } finally {
      state.investigationOverlay = null;
    }
  }

  function handleLiveStatus(detail) {
    if (!state.investigationOverlay || detail?.documentId !== state.investigationOverlay.documentId) return;
    state.investigationOverlay.status = String(detail?.state || "idle");
  }

  async function handleLiveContent(content, detail) {
    const overlayState = state.investigationOverlay;
    if (!overlayState || detail?.documentId !== overlayState.documentId) return;
    overlayState.liveFingerprint = detail?.hasLiveContent ? JSON.stringify(content || {}) : "";
    const nextPost = detail?.hasLiveContent
      ? mergeInvestigationPostOverlay(overlayState.baselinePost, content)
      : cloneInvestigationPost(overlayState.baselinePost);
    overlayState.liveContent = detail?.hasLiveContent ? cloneInvestigationPost(content) : null;
    overlayState.currentPost = cloneInvestigationPost(nextPost);
    await renderState(overlayState, overlayState.currentPost, {
      refreshComments: false
    });
  }

  function startLivePolling(overlayState) {
    if (!overlayState?.controller || overlayState.pollTimer) return;
    overlayState.pollTimer = window.setInterval(() => {
      const current = overlayState.controller?.getContent?.() || {};
      const fingerprint = Object.keys(current).length ? JSON.stringify(current) : "";
      if (fingerprint === overlayState.liveFingerprint) return;
      void handleLiveContent(current, {
        documentId: overlayState.documentId,
        hasLiveContent: Boolean(fingerprint),
        origin: "poll"
      });
    }, 1500);
  }

  return {
    init,
    destroy,
    renderState
  };
}

export function mergeInvestigationPostOverlay(basePost, liveContent) {
  const base = cloneInvestigationPost(basePost);
  const live = liveContent && typeof liveContent === "object" ? liveContent : {};
  const next = {
    ...base,
    body: Object.prototype.hasOwnProperty.call(live, "markdown")
      ? String(live.markdown || "")
      : Object.prototype.hasOwnProperty.call(live, "body")
        ? String(live.body || "")
        : base.body,
    markdown: Object.prototype.hasOwnProperty.call(live, "markdown")
      ? String(live.markdown || "")
      : Object.prototype.hasOwnProperty.call(live, "body")
        ? String(live.body || "")
        : String(base.markdown || base.body || "")
  };
  for (const key of ["title", "date", "summary", "location", "status", "statusLabel", "author_pubkey"]) {
    if (Object.prototype.hasOwnProperty.call(live, key)) {
      next[key] = String(live[key] ?? "");
    }
  }
  if (Object.prototype.hasOwnProperty.call(live, "tags")) {
    next.tags = normalizeLiveArray(live.tags);
  }
  if (Object.prototype.hasOwnProperty.call(live, "entity_refs")) {
    next.entity_refs = normalizeLiveArray(live.entity_refs);
  }
  if (Object.prototype.hasOwnProperty.call(live, "records")) {
    next.records = Array.isArray(live.records) ? JSON.parse(JSON.stringify(live.records)) : [];
  }
  if (Object.prototype.hasOwnProperty.call(live, "structured_document")) {
    next.structured_document = live.structured_document ? JSON.parse(JSON.stringify(live.structured_document)) : null;
  }
  if (Object.prototype.hasOwnProperty.call(live, "body_html")) {
    next.body_html = String(live.body_html || "");
  }
  if (Object.prototype.hasOwnProperty.call(live, "search_text")) {
    next.search_text = String(live.search_text || "");
  }
  if (Object.prototype.hasOwnProperty.call(live, "relationship_candidates")) {
    next.relationship_candidates = Array.isArray(live.relationship_candidates)
      ? JSON.parse(JSON.stringify(live.relationship_candidates))
      : [];
  }
  if (Object.prototype.hasOwnProperty.call(live, "citations")) {
    next.citations = Array.isArray(live.citations)
      ? JSON.parse(JSON.stringify(live.citations))
      : [];
  }
  if (Object.prototype.hasOwnProperty.call(live, "featured")) {
    next.featured = Boolean(live.featured);
  }
  return next;
}

export function cloneInvestigationPost(post) {
  return JSON.parse(JSON.stringify(post || {}));
}

export function normalizeLiveArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function clonePosts(posts) {
  return JSON.parse(JSON.stringify(Array.isArray(posts) ? posts : []));
}

function draftToInvestigationDraft(publicState, draftSlug) {
  return (publicState?.drafts || []).find((item) => item.slug === draftSlug) || null;
}

function emptyPublicState() {
  return {
    approvedEntities: [],
    commentsByPost: new Map(),
    commentIndex: new Map(),
    commentThreadsByPost: new Map(),
    users: []
  };
}
