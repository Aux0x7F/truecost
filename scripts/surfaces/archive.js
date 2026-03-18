import SITE from "../core/site-config.js";
import { collectEntityRefsFromText } from "../core/content-utils.js";
import { renderSearchField, renderSearchSuggestions } from "../core/search-controls.js";
import { dedupeStrings, escapeAttribute, escapeHtml } from "../core/text-utils.js";

export const ARCHIVE_STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "draft", label: "Draft" },
  { value: "submitted", label: "In review" },
  { value: "approved", label: "Approved" },
  { value: "posted", label: "Posted" }
];

export function getCurrentArchiveFilters(search = window.location.search, canEdit = false) {
  const params = new URLSearchParams(search);
  return {
    tag: String(params.get("tag") || "").trim(),
    entity: String(params.get("entity") || "").trim(),
    status: canEdit ? String(params.get("status") || "").trim().toLowerCase() : "",
    author: String(params.get("author") || "").trim().toLowerCase()
  };
}

export function archiveHasActiveFilters(filters = {}) {
  return Boolean(filters.tag || filters.entity || filters.status || filters.author);
}

export function archiveStatusLabel(value) {
  return ARCHIVE_STATUS_OPTIONS.find((option) => option.value === String(value || ""))?.label || "All statuses";
}

export function renderArchiveStatusOption(option, selectedValue) {
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

export function renderAuthoringLeadCard() {
  return `
    <article class="surface-panel authoring-card">
      <div class="eyebrow">For editors</div>
      <h3>Write in the full editor</h3>
      <p>Drafts save as you work, submitted investigations open in review preview, and approved posts roll into the next bakedown.</p>
      <div class="button-row"><a class="button" href="./editor.html">Create investigation</a></div>
    </article>
  `;
}

export function renderArchiveFiltersPanel({ filters = {}, canEdit = false, statusMenuOpen = false } = {}) {
  return `
    <section class="surface-panel archive-filters">
      <div class="archive-filters__head">
        <button class="text-link archive-filters__clear" type="button" data-clear-investigation-filters ${archiveHasActiveFilters(filters) ? "" : "hidden"}>Clear</button>
      </div>
      <div class="archive-filters__form" data-investigation-filters>
        ${
          canEdit
            ? `
              <div class="archive-status-menu${statusMenuOpen ? " is-open" : ""}" data-status-menu>
                <button
                  class="archive-status-menu__toggle"
                  type="button"
                  data-status-toggle
                  aria-expanded="${statusMenuOpen ? "true" : "false"}"
                  aria-haspopup="listbox"
                >
                  <span data-status-current>${escapeHtml(archiveStatusLabel(filters.status))}</span>
                </button>
                <div class="archive-status-menu__panel" data-status-panel role="listbox" ${statusMenuOpen ? "" : "hidden"}>
                  ${ARCHIVE_STATUS_OPTIONS.map((option) => renderArchiveStatusOption(option, filters.status)).join("")}
                </div>
              </div>
            `
            : ""
        }
        ${renderArchiveSearchField("tag", filters.tag)}
        ${renderArchiveSearchField("entity", filters.entity)}
      </div>
    </section>
  `;
}

function renderArchiveSearchField(field, value) {
  return renderSearchField({
    wrapperClass: "archive-filters__field",
    wrapperAttributes: { "data-filter-field": field },
    srLabel: field === "tag" ? "Search tags" : "Search entities",
    inputAttributes: {
      name: field,
      type: "text",
      placeholder: field === "tag" ? "Search tags" : "Search entities",
      value,
      autocomplete: "off",
      "data-filter-input": field
    },
    clearButton: value
      ? {
          className: "workspace-search__clear archive-filters__clear-button",
          attributes: { "data-clear-archive-field": field },
          ariaLabel: `Clear ${field} filter`
        }
      : null,
    resultsHtml: `<div class="picker-results picker-results--dropdown archive-filters__results" data-filter-results="${escapeAttribute(field)}"></div>`
  });
}

export function renderArchiveMapPanel() {
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

export function filterArchiveEntries(entries, publicState, filters) {
  const tagQuery = String(filters?.tag || "").trim().toLowerCase();
  const entityQuery = String(filters?.entity || "").trim().toLowerCase();
  const statusQuery = String(filters?.status || "").trim().toLowerCase();
  const authorQuery = String(filters?.author || "").trim().toLowerCase();
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (statusQuery && normalizeDraftStatus(entry.archiveStatus) !== statusQuery) return false;
    if (authorQuery) {
      const author = String(entry.author || "").trim().toLowerCase();
      const authorUser = (publicState?.users || []).find((user) => user.pubkey === author) || null;
      const authorLabels = [author, authorUser?.username, authorUser?.displayName]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean);
      if (!authorLabels.some((value) => value.includes(authorQuery))) return false;
    }
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

export function archiveFilterSuggestions(field, entries, publicState, filters) {
  const query = String(filters?.[field] || "").trim().toLowerCase();
  const values = field === "tag"
    ? dedupeStrings(entries.flatMap((entry) => Array.isArray(entry.tags) ? entry.tags : []))
    : dedupeStrings(entries.flatMap((entry) => archiveEntryEntityOptions(entry, publicState)));
  const matching = values
    .filter((value) => String(value || "").trim())
    .filter((value) => !query || value.toLowerCase().includes(query))
    .slice(0, 8);
  return { field, query, matching };
}

export function renderArchiveSuggestionPanel(field, descriptor, openField = "", highlightedIndex = -1) {
  return renderSearchSuggestions({
    isOpen: openField === field,
    query: descriptor?.query,
    items: Array.isArray(descriptor?.matching) ? descriptor.matching : [],
    highlightedIndex,
    emptyMessage: `No ${field} matches yet.`,
    listClassName: "picker-results picker-results--dropdown archive-filters__results",
    itemAttributes: (value) => ({
      "data-filter-suggestion": field,
      "data-filter-value": value
    }),
    renderPrimary: (value) => `<strong>${escapeHtml(value)}</strong>`,
    renderSecondary: () => `<span>Use ${escapeHtml(field)}</span>`
  });
}

export function archiveEntryEntityOptions(entry, publicState) {
  const entityMap = new Map((publicState?.approvedEntities || []).map((entity) => [entity.slug, entity]));
  const refs = dedupeStrings([
    ...(Array.isArray(entry?.entity_refs) ? entry.entity_refs : []),
    ...(entry?.body ? collectEntityRefsFromText(entry.body, publicState?.approvedEntities || []) : [])
  ]);
  return dedupeStrings(
    refs.flatMap((slug) => {
      const entity = entityMap.get(slug);
      if (!entity) return [slug];
      return [entity.slug, entity.name, entity.location];
    })
  );
}

export function archiveEntitiesForEntries(entries, publicState) {
  const entityMap = new Map((publicState?.approvedEntities || []).map((entity) => [entity.slug, entity]));
  const refs = dedupeStrings(
    (Array.isArray(entries) ? entries : []).flatMap((entry) => [
      ...(Array.isArray(entry?.entity_refs) ? entry.entity_refs : []),
      ...(entry?.body ? collectEntityRefsFromText(entry.body, publicState?.approvedEntities || []) : [])
    ])
  );
  return refs.map((slug) => entityMap.get(slug)).filter(Boolean);
}

export function destroyLeafletPreview(canvas) {
  if (canvas?.__leafletPreviewMap) {
    canvas.__leafletPreviewMap.remove();
    canvas.__leafletPreviewMap = null;
  }
}

export function renderLeafletPreviewMap(canvas, entities, queueLeafletBoundsFit) {
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
  queueLeafletBoundsFit(previewMap, points, {
    padding: [28, 28],
    duration: 0.4,
    defaultCenter: SITE.map.defaultCenter,
    defaultZoom: SITE.map.defaultZoom,
    singleZoom: 8
  });
}

function normalizeDraftStatus(status) {
  return String(status || "").trim().toLowerCase();
}
