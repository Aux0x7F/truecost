import { buildEntityUsage } from "../core/posts-store.js";
import { escapeAttribute, escapeHtml } from "../core/text-utils.js";

export function createMapPageFeature({
  state,
  postsStore,
  getPublicState,
  cleanSlug,
  collectEntityRefsFromText,
  renderLeafletMapSurface,
  bindMapEntityCards,
  requestedMapEntity,
  scheduleLeafletFocus,
  renderMapPageSurface,
  renderError,
  renderLoadingState
} = {}) {
  async function mount() {
    const list = document.querySelector("[data-map-list]");
    const canvas = document.querySelector("[data-map-canvas]");
    if (!(list instanceof HTMLElement) || !(canvas instanceof HTMLElement)) return;
    const mapReady = Boolean(state.map && state.mapCanvas === canvas);
    const cachedEntities = visibleMapEntities(state.publicState);
    const renderedCachedMap = Boolean(cachedEntities.length);
    if (cachedEntities.length) {
      renderMapPageSurface(list, canvas, cachedEntities, null, mapSurfaceDeps());
    } else {
      const hasStableMapData = Array.isArray(state.lastGoodMapEntities) && state.lastGoodMapEntities.length;
      if (!hasStableMapData) list.innerHTML = renderLoadingState("Looking up map entries...");
      if (!mapReady) canvas.innerHTML = renderLoadingState("Looking up map data...");
    }

    try {
      const publicState = await getPublicState();
      const entities = visibleMapEntities(publicState);
      if (!entities.length) {
        list.innerHTML = `<div class="empty-state">Published entities will appear here once approved entries are available.</div>`;
        canvas.innerHTML = `<div class="map-empty">Map data unavailable.</div>`;
        return;
      }
      state.lastGoodMapEntities = entities.map((entity) => ({ ...entity }));
      const posts = await postsStore.load().catch(() => []);
      const entityUsage = buildEntityUsage(posts, entities, collectEntityRefsFromText);
      renderMapPageSurface(list, canvas, entities, entityUsage, mapSurfaceDeps());
      state.mapViewDigest = dataDigest({ approvedEntities: entities });
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
      bindMapEntityCards: () => bindMapEntityCards((slug) => scheduleMapEntityFocus(slug)),
      focusRequestedEntity,
      queryEntityCard: (slug) => document.querySelector(`[data-entity-card="${slug}"]`)
    };
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

  function isInteractionActive() {
    const active = document.activeElement;
    return active instanceof HTMLElement && Boolean(active.closest("[data-map-shell], [data-map-list]"));
  }

  function dataDigest(publicState) {
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

  function scheduleMapEntityFocus(slug, options = {}, attempt = 0) {
    scheduleLeafletFocus(
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

  return {
    dataDigest,
    isInteractionActive,
    mount,
    visibleMapEntities,
    mapSurfaceDeps,
    scheduleMapEntityFocus,
    focusRequestedEntity
  };
}
