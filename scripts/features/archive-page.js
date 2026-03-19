import {
  draftReviewAction,
  draftStatusLabel,
  investigationDrafts,
  normalizeDraftStatus
} from "../core/page-drafts.js";
import { cycleHighlightIndex } from "../core/search-controls.js";
import { formatDate, sortDateValue } from "../core/formatting.js";
import { dedupeStrings as dedupe, escapeAttribute, escapeHtml } from "../core/text-utils.js";
import { renderTagList } from "../core/rendering.js";
import {
  archiveEntitiesForEntries,
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
} from "../surfaces/archive.js";

export function createArchivePageFeature({
  state,
  viewerController,
  postsStore,
  getPublicState,
  publicStateNeedsRepair,
  queueLeafletBoundsFit,
  renderError,
  renderLoadingState
} = {}) {
  function mount() {
    void initInvestigationCards();
    void initAuthoringEntry();
  }

  function isInteractionActive() {
    const active = document.activeElement;
    return active instanceof HTMLElement && Boolean(active.closest("[data-investigation-filters]"));
  }

  async function initInvestigationCards() {
    const homeGrid = document.querySelector("[data-home-investigations]");
    const listGrid = document.querySelector("[data-investigation-list]");
    const rail = document.querySelector("[data-investigation-rail]");
    const archiveSummaryHosts = document.querySelectorAll("[data-archive-summary]");
    if (!homeGrid && !listGrid && !archiveSummaryHosts.length) return;

    const cachedPosts = postsStore.current();
    const cachedPublicState = state.publicState;
    const renderedCachedCards = Boolean(cachedPosts.length);
    if (cachedPosts.length) {
      const cachedState = cachedPublicState || { drafts: [], approvedEntities: [], users: [] };
      const canEditCached = viewerController.canEdit(cachedState);
      if (archiveSummaryHosts.length) hydrateArchiveSummaryLinks(cachedPosts, cachedState);
      if (homeGrid instanceof HTMLElement) {
        const count = Number(homeGrid.getAttribute("data-count") || "2");
        homeGrid.innerHTML = cachedPosts.filter((post) => post.featured).slice(0, count).map((post) => renderInvestigationCard(post, true)).join("");
      }
      if (listGrid instanceof HTMLElement) {
        const entries = canEditCached
          ? buildInvestigationArchiveEntries(cachedPosts, investigationDrafts(cachedState.drafts || []))
          : buildPublishedArchiveEntries(cachedPosts);
        initializeArchiveView(entries, cachedState, canEditCached);
      }
    } else {
      if (homeGrid instanceof HTMLElement) homeGrid.innerHTML = renderLoadingState("Looking up featured investigations...");
      if (listGrid instanceof HTMLElement) listGrid.innerHTML = renderLoadingState("Looking up investigations...");
      if (rail instanceof HTMLElement) rail.innerHTML = renderLoadingState("Looking up filters and map data...");
    }

    try {
      const publicStatePromise = getPublicState();
      const posts = await postsStore.refresh();
      const optimisticState = state.publicState || cachedPublicState || { drafts: [], approvedEntities: [], users: [] };
      const optimisticCanEdit = viewerController.canEdit(optimisticState);
      if (archiveSummaryHosts.length) hydrateArchiveSummaryLinks(posts, optimisticState);
      if (homeGrid instanceof HTMLElement) {
        const count = Number(homeGrid.getAttribute("data-count") || "2");
        homeGrid.innerHTML = posts.filter((post) => post.featured).slice(0, count).map((post) => renderInvestigationCard(post, true)).join("");
      }
      if (listGrid instanceof HTMLElement && !renderedCachedCards) {
        const optimisticEntries = optimisticCanEdit
          ? buildInvestigationArchiveEntries(posts, investigationDrafts(optimisticState.drafts || []))
          : buildPublishedArchiveEntries(posts);
        initializeArchiveView(optimisticEntries, optimisticState, optimisticCanEdit);
      }
      const publicState = await publicStatePromise;
      const canEdit = viewerController.canEdit(publicState);
      if (archiveSummaryHosts.length) hydrateArchiveSummaryLinks(posts, publicState);
      if (homeGrid instanceof HTMLElement) {
        const count = Number(homeGrid.getAttribute("data-count") || "2");
        homeGrid.innerHTML = posts.filter((post) => post.featured).slice(0, count).map((post) => renderInvestigationCard(post, true)).join("");
      }
      if (listGrid instanceof HTMLElement) {
        const entries = canEdit
          ? buildInvestigationArchiveEntries(posts, investigationDrafts(publicState.drafts || []))
          : buildPublishedArchiveEntries(posts);
        initializeArchiveView(entries, publicState, canEdit);
      }
    } catch {
      if (!renderedCachedCards) {
        renderError(homeGrid || listGrid, "Investigation feed unavailable.");
        if (rail instanceof HTMLElement) renderError(rail, "Archive tools unavailable.");
      }
    }
  }

  async function initAuthoringEntry() {
    const host = document.querySelector("[data-authoring-entry]");
    if (!(host instanceof HTMLElement)) return;
    const cachedPublicState = state.publicState;
    if (cachedPublicState) {
      host.innerHTML = viewerController.canEdit(cachedPublicState) ? `<a class="button" href="./editor.html">Create investigation</a>` : "";
    }
    const publicState = await getPublicState();
    host.innerHTML = viewerController.canEdit(publicState) ? `<a class="button" href="./editor.html">Create investigation</a>` : "";
  }

  function hydrateArchiveSummaryLinks(posts, publicState) {
    const hosts = [...document.querySelectorAll("[data-archive-summary]")];
    if (!hosts.length) return;
    const markup = renderArchiveSummaryMarkup(posts, publicState);
    for (const host of hosts) {
      if (host instanceof HTMLElement) host.innerHTML = markup;
    }
  }

  function renderArchiveSummaryMarkup(posts, publicState) {
    const publishedCount = Array.isArray(posts) ? posts.length : 0;
    const activeCount = investigationDrafts(publicState?.drafts || []).length;
    const investigationCount = publishedCount > 0 ? publishedCount : activeCount;
    const investigationLabel = publishedCount > 0 ? "Published investigations" : "Active investigations";
    const entities = Array.isArray(publicState?.approvedEntities) ? publicState.approvedEntities : [];
    const mappedCount = entities.filter((entity) => Number.isFinite(entity.lat) && Number.isFinite(entity.lng)).length;
    const locationCount = dedupe(entities.map((entity) => String(entity.location || "").trim()).filter(Boolean)).length;
    const tagCount = dedupe((Array.isArray(posts) ? posts : []).flatMap((post) => (Array.isArray(post?.tags) ? post.tags : []))).length;
    return `
      <a class="hero-summary__item" href="./investigations.html"><strong>${investigationCount}</strong><span>${investigationLabel}</span></a>
      <a class="hero-summary__item" href="./map.html#entity-index"><strong>${entities.length}</strong><span>Tracked entities</span></a>
      <a class="hero-summary__item" href="./map.html#map-board"><strong>${Math.max(mappedCount, locationCount)}</strong><span>Locations</span></a>
      <a class="hero-summary__item" href="./investigations.html"><strong>${tagCount}</strong><span>Archive tags</span></a>
    `;
  }

  function buildPublishedArchiveEntries(posts, { showPublicStatus = false } = {}) {
    return (Array.isArray(posts) ? posts : []).map((post) => ({
      ...post,
      archiveStatus: "posted",
      statusLabel: showPublicStatus ? "Posted" : "",
      showStatusPill: showPublicStatus,
      href: `./investigation.html?slug=${encodeURIComponent(post.slug)}`,
      actionLabel: "Open investigation"
    }));
  }

  function buildInvestigationArchiveEntries(posts, drafts) {
    const staticSlugs = new Set((Array.isArray(posts) ? posts : []).map((post) => post.slug));
    const published = buildPublishedArchiveEntries(posts, { showPublicStatus: true });
    const relayEntries = (Array.isArray(drafts) ? drafts : [])
      .filter((draft) => !(staticSlugs.has(draft.slug) && normalizeDraftStatus(draft.status) === "approved"))
      .map((draft) => {
        const status = normalizeDraftStatus(draft.status);
        const reviewAction = draftReviewAction(draft);
        const archived = ["candidate", "review", "submitted"].includes(status) ? "submitted" : status === "approved" ? "approved" : status;
        const isEditable = status === "draft" || status === "revision";
        return {
          ...draft,
          body: draft.markdown || "",
          archiveStatus: archived,
          statusLabel: draftStatusLabel(status, reviewAction),
          showStatusPill: true,
          href: isEditable ? `./editor.html?slug=${encodeURIComponent(draft.slug)}` : `./investigation.html?draft=${encodeURIComponent(draft.slug)}`,
          actionLabel: isEditable ? "Continue writing" : "Open preview",
          location: draft.location || "Draft location pending",
          summary: draft.summary || "This investigation does not have a summary yet.",
          eyebrow: "Investigation"
        };
      });
    return [...relayEntries, ...published].sort((left, right) => {
      const leftStamp = sortDateValue(left);
      const rightStamp = sortDateValue(right);
      if (leftStamp !== rightStamp) return rightStamp - leftStamp;
      return String(left.title || "").localeCompare(String(right.title || ""));
    });
  }

  function renderInvestigationCard(post, compact) {
    const href = post.href || `./investigation.html?slug=${encodeURIComponent(post.slug)}`;
    const eyebrow = post.eyebrow || "Case file";
    const actionLabel = post.actionLabel || "Open investigation";
    const statusPill = post.showStatusPill !== false && post.statusLabel
      ? `<span class="status-pill status-pill--${escapeAttribute(post.archiveStatus || "posted")}">${escapeHtml(post.statusLabel)}</span>`
      : "";
    const tags = renderTagList((post.tags || []).slice(0, compact ? 2 : 4));
    if (!compact) {
      return `<article class="investigation-card investigation-card--list ${post.cardClass || ""}"><div class="investigation-card__body"><div class="investigation-card__head"><div class="eyebrow">${escapeHtml(eyebrow)}</div>${statusPill}</div><h3><a href="${href}">${escapeHtml(post.title)}</a></h3><p class="card-meta">${escapeHtml(post.location)} <span>${escapeHtml(formatDate(post.date))}</span></p><p class="card-summary">${escapeHtml(post.summary)}</p><div class="tag-row">${tags}</div></div><div class="investigation-card__rail"><a class="text-link" href="${href}">${escapeHtml(actionLabel)}</a></div></article>`;
    }
    return `<article class="investigation-card investigation-card--compact"><div class="investigation-card__head"><div class="eyebrow">${escapeHtml(eyebrow)}</div>${statusPill}</div><h3><a href="${href}">${escapeHtml(post.title)}</a></h3><p class="card-meta">${escapeHtml(post.location)} <span>${escapeHtml(formatDate(post.date))}</span></p><p>${escapeHtml(post.summary)}</p><div class="tag-row">${tags}</div><a class="text-link" href="${href}">${escapeHtml(actionLabel)}</a></article>`;
  }

  function activeArchiveFilters() {
    return state.archiveFilters || { tag: "", entity: "", status: "", author: "" };
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
    listGrid.innerHTML = `${canEdit ? renderAuthoringLeadCard() : ""}<div class="story-list__results" data-investigation-results></div>`;
    if (filtersShell instanceof HTMLElement) {
      filtersShell.innerHTML = renderArchiveFiltersPanel({ filters: activeArchiveFilters(), canEdit, statusMenuOpen: state.archiveStatusMenuOpen });
      bindInvestigationFilters(entries, publicState, canEdit);
    }
    if (mapShell instanceof HTMLElement) mapShell.innerHTML = renderArchiveMapPanel();
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
      state.archiveFilters = { ...activeArchiveFilters(), [name]: String(target.value || "").trim() };
      state.archiveFilterOpenField = name;
      state.archiveFilterHighlight = archiveFilterSuggestions(name, entries, publicState, activeArchiveFilters()).matching.length ? 0 : -1;
      syncArchiveFiltersToUrl(canEdit);
      scheduleArchiveResults(entries, publicState, canEdit);
    });
    shell.addEventListener("keydown", (event) => handleArchiveKeydown(event, shell, entries, publicState, canEdit));
    shell.addEventListener("click", (event) => handleArchiveClick(event, shell, entries, publicState, canEdit));
    if (!shell.dataset.outsideBound) {
      shell.dataset.outsideBound = "yes";
      document.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element) || shell.contains(target)) return;
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

  function handleArchiveKeydown(event, shell, entries, publicState, canEdit) {
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
      if (handled) event.preventDefault();
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
  }

  function handleArchiveClick(event, shell, entries, publicState, canEdit) {
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
      state.archiveFilters = { ...activeArchiveFilters(), status: String(statusOption.getAttribute("data-status-option") || "").trim().toLowerCase() };
      state.archiveStatusMenuOpen = false;
      updateArchiveStatusMenu(shell);
      syncArchiveFiltersToUrl(canEdit);
      renderInvestigationArchiveResults(entries, publicState, canEdit);
      return;
    }
    if (target.closest("[data-clear-investigation-filters]")) {
      state.archiveFilters = { tag: "", entity: "", status: "", author: "" };
      state.archiveFilterOpenField = "";
      state.archiveFilterHighlight = -1;
      state.archiveStatusMenuOpen = false;
      for (const field of ["tag", "entity"]) {
        const input = shell.querySelector(`[data-filter-input="${field}"]`);
        if (input instanceof HTMLInputElement) input.value = "";
      }
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
      if (input instanceof HTMLInputElement) window.setTimeout(() => input.focus({ preventScroll: true }), 0);
      return;
    }
    const suggestion = target.closest("[data-filter-suggestion]");
    if (suggestion instanceof HTMLElement) {
      const field = suggestion.getAttribute("data-filter-suggestion") || "";
      const value = suggestion.getAttribute("data-filter-value") || "";
      commitArchiveFilterSelection(field, value, shell, entries, publicState, canEdit);
    }
  }

  function updateArchiveStatusMenu(shell = document.querySelector("[data-investigation-filters]")) {
    if (!(shell instanceof HTMLElement)) return;
    const activeValue = String(activeArchiveFilters().status || "");
    const current = shell.querySelector("[data-status-current]");
    const toggle = shell.querySelector("[data-status-toggle]");
    const panel = shell.querySelector("[data-status-panel]");
    if (current instanceof HTMLElement) current.textContent = archiveStatusLabel(activeValue);
    if (toggle instanceof HTMLElement) toggle.setAttribute("aria-expanded", state.archiveStatusMenuOpen ? "true" : "false");
    const menu = shell.querySelector("[data-status-menu]");
    if (menu instanceof HTMLElement) menu.classList.toggle("is-open", state.archiveStatusMenuOpen);
    if (panel instanceof HTMLElement) panel.toggleAttribute("hidden", !state.archiveStatusMenuOpen);
    for (const option of shell.querySelectorAll("[data-status-option]")) {
      if (!(option instanceof HTMLElement)) continue;
      const isActive = (option.getAttribute("data-status-option") || "") === activeValue;
      option.classList.toggle("is-active", isActive);
      option.setAttribute("aria-selected", isActive ? "true" : "false");
    }
  }

  function commitArchiveFilterSelection(field, value, shell, entries, publicState, canEdit) {
    const cleanField = String(field || "").trim();
    if (!cleanField) return;
    const input = shell?.querySelector?.(`[data-filter-input="${CSS.escape(cleanField)}"]`);
    if (input instanceof HTMLInputElement) input.value = String(value || "");
    state.archiveFilters = { ...activeArchiveFilters(), [cleanField]: String(value || "").trim() };
    state.archiveFilterOpenField = "";
    state.archiveFilterHighlight = -1;
    syncArchiveFiltersToUrl(canEdit);
    renderInvestigationArchiveResults(entries, publicState, canEdit);
  }

  function scheduleArchiveResults(entries, publicState, canEdit) {
    if (state.archiveFilterTimer) window.clearTimeout(state.archiveFilterTimer);
    state.archiveFilterTimer = window.setTimeout(() => renderInvestigationArchiveResults(entries, publicState, canEdit), 120);
  }

  function renderInvestigationArchiveResults(entries, publicState, canEdit) {
    const host = document.querySelector("[data-investigation-results]");
    if (!(host instanceof HTMLElement)) return;
    const filteredEntries = filterArchiveEntries(entries, publicState, activeArchiveFilters());
    host.innerHTML = filteredEntries.length ? filteredEntries.map((post) => renderInvestigationCard(post, false)).join("") : `<div class="empty-state">No investigations match these filters yet.</div>`;
    updateArchiveFilterPanels(entries, publicState);
    updateArchiveSummary();
    if (!state.archiveFilterOpenField) updateArchiveMapPreview(filteredEntries, entries, publicState);
  }

  function updateArchiveSummary() {
    const clearButton = document.querySelector("[data-clear-investigation-filters]");
    if (clearButton instanceof HTMLElement) clearButton.hidden = !archiveHasActiveFilters();
  }

  function updateArchiveFilterPanels(entries, publicState) {
    syncArchiveFilterFieldControls();
    const tagHost = document.querySelector('[data-filter-results="tag"]');
    if (tagHost instanceof HTMLElement) {
      tagHost.innerHTML = renderArchiveSuggestionPanel("tag", archiveFilterSuggestions("tag", entries, publicState, activeArchiveFilters()), state.archiveFilterOpenField, state.archiveFilterHighlight);
    }
    const entityHost = document.querySelector('[data-filter-results="entity"]');
    if (entityHost instanceof HTMLElement) {
      entityHost.innerHTML = renderArchiveSuggestionPanel("entity", archiveFilterSuggestions("entity", entries, publicState, activeArchiveFilters()), state.archiveFilterOpenField, state.archiveFilterHighlight);
    }
  }

  function syncArchiveFilterFieldControls() {
    const shell = document.querySelector("[data-investigation-filters]");
    if (!(shell instanceof HTMLElement)) return;
    const filters = activeArchiveFilters();
    for (const field of ["tag", "entity"]) {
      const value = String(filters?.[field] || "");
      const input = shell.querySelector(`[data-filter-input="${CSS.escape(field)}"]`);
      if (input instanceof HTMLInputElement && input.value !== value) input.value = value;
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
    if (filters.tag) url.searchParams.set("tag", filters.tag); else url.searchParams.delete("tag");
    if (filters.entity) url.searchParams.set("entity", filters.entity); else url.searchParams.delete("entity");
    if (canEdit && filters.status) url.searchParams.set("status", filters.status); else url.searchParams.delete("status");
    if (filters.author) url.searchParams.set("author", filters.author); else url.searchParams.delete("author");
    history.replaceState({}, "", url);
  }

  function updateArchiveMapPreview(filteredEntries, entries, publicState) {
    const tagsHost = document.querySelector("[data-investigation-map-tags]");
    const canvas = document.querySelector("[data-investigation-map-canvas]");
    if (!(tagsHost instanceof HTMLElement) || !(canvas instanceof HTMLElement)) return;
    const activeEntities = archiveEntitiesForEntries(filteredEntries, publicState);
    const defaultEntities = archiveHasActiveFilters() ? [] : archiveEntitiesForEntries(entries, publicState);
    const fallbackEntities = !archiveHasActiveFilters() && publicStateNeedsRepair(publicState) && state.lastGoodArchiveMapEntities.length ? state.lastGoodArchiveMapEntities : [];
    const entities = activeEntities.length ? activeEntities : defaultEntities.length ? defaultEntities : fallbackEntities;
    if (!entities.length) {
      tagsHost.innerHTML = "";
      destroyLeafletPreview(canvas);
      canvas.innerHTML = `<div class="map-empty">${archiveHasActiveFilters() ? "No locations tagged in filtered results." : "No locations tagged in the archive yet."}</div>`;
      return;
    }
    state.lastGoodArchiveMapEntities = entities.map((entity) => ({ ...entity }));
    const mappedEntities = entities.filter((entity) => Number.isFinite(entity.lat) && Number.isFinite(entity.lng));
    tagsHost.innerHTML = entities.slice(0, 4).map((entity) => `<a class="tag tag--link" href="./map.html?entity=${encodeURIComponent(entity.slug)}">${escapeHtml(entity.name)}</a>`).join("");
    if (!mappedEntities.length) {
      destroyLeafletPreview(canvas);
      canvas.innerHTML = `<div class="map-empty">No mapped locations in the current results.</div>`;
      return;
    }
    renderLeafletPreviewMap(canvas, mappedEntities, queueLeafletBoundsFit);
  }

  return {
    mount,
    isInteractionActive,
    hydrateArchiveSummaryLinks,
    renderArchiveSummaryMarkup,
    renderInvestigationCard
  };
}
