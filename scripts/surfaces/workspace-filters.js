import {
  renderSearchField,
  renderSearchSuggestions
} from "../core/search-controls.js";

export function renderEntityManagementRail(workspaceState, deps = {}) {
  return `
    <div class="workspace-rail-copy">
      <div class="eyebrow">Filter entities</div>
      <p>Search by name or alias, then narrow by status, place, or submitting user.</p>
    </div>
    ${renderSearchField({
      srLabel: "Search entities",
      inputAttributes: {
        class: "workspace-search__input",
        "data-entity-filter-query": true,
        type: "text",
        maxlength: "120",
        placeholder: "Search entities",
        value: workspaceState.entityFilters.query || "",
        autocomplete: "off"
      },
      clearButton: workspaceState.entityFilters.query
        ? {
            attributes: { "data-clear-entity-filter": "query" },
            ariaLabel: "Clear entity search"
          }
        : null
    })}
    <label class="workspace-select">
      <span class="sr-only">Filter by entity status</span>
      <select data-entity-filter-status>
        <option value="">All statuses</option>
        <option value="approved" ${workspaceState.entityFilters.status === "approved" ? "selected" : ""}>Approved</option>
        <option value="pending" ${workspaceState.entityFilters.status === "pending" ? "selected" : ""}>Pending</option>
        <option value="denied" ${workspaceState.entityFilters.status === "denied" ? "selected" : ""}>Denied</option>
        <option value="deleted" ${workspaceState.entityFilters.status === "deleted" ? "selected" : ""}>Deleted</option>
      </select>
    </label>
    ${renderSearchField({
      srLabel: "Filter by state or country",
      inputAttributes: {
        class: "workspace-search__input",
        "data-entity-filter-location": true,
        type: "text",
        maxlength: "120",
        placeholder: "State or county",
        value: workspaceState.entityFilters.location || "",
        autocomplete: "off"
      },
      clearButton: workspaceState.entityFilters.location
        ? {
            attributes: { "data-clear-entity-filter": "location" },
            ariaLabel: "Clear location filter"
          }
        : null,
      resultsHtml: renderEntityLocationFilterSuggestions(workspaceState, deps)
    })}
    ${renderSearchField({
      srLabel: "Filter by submitting user",
      inputAttributes: {
        class: "workspace-search__input",
        "data-entity-filter-author": true,
        type: "text",
        maxlength: "120",
        placeholder: "Submitted by",
        value: workspaceState.entityFilters.author || "",
        autocomplete: "off"
      },
      clearButton: workspaceState.entityFilters.author
        ? {
            attributes: { "data-clear-entity-filter": "author" },
            ariaLabel: "Clear submitter filter"
          }
        : null
    })}
  `;
}

export function renderEntityLocationFilterSuggestions(workspaceState, deps = {}) {
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  return renderSearchSuggestions({
    isOpen: workspaceState.entityLocationFilterOpen,
    query: workspaceState.entityFilters.location,
    items: deps.entityLocationSuggestions ? deps.entityLocationSuggestions() : [],
    highlightedIndex: workspaceState.entityLocationFilterHighlight,
    itemAttributes: (value, index) => ({
      "data-entity-location-suggestion": value,
      "data-entity-location-index": index
    }),
    renderPrimary: (value) => `<strong>${escapeHtml(value)}</strong>`
  });
}

export function renderSubmissionFilterSuggestions(workspaceState, deps = {}) {
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  return renderSearchSuggestions({
    isOpen: workspaceState.submissionFilterOpen,
    query: workspaceState.submissionFilters.query,
    items: deps.submissionFilterSuggestions ? deps.submissionFilterSuggestions() : [],
    highlightedIndex: workspaceState.submissionFilterHighlight,
    itemAttributes: (token, index) => ({
      "data-submission-filter-suggestion": token,
      "data-submission-filter-index": index
    }),
    renderPrimary: (token) => `<strong>${escapeHtml(token)}</strong>`
  });
}

export function renderEntityPickerResultsMarkup(fieldName, query, matches, deps = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  if (!query) return "";
  if (!matches.length) {
    return `<div class="picker-hint">No match yet. Use the create button to add a new entity.</div>`;
  }
  return matches
    .map(
      (entity) => `
        <button class="picker-chip" type="button" data-entity-pick="${escapeAttribute(entity.slug)}" data-target-field="${fieldName}">
          <strong>${escapeHtml(entity.name)}</strong>
          <span>${escapeHtml(entity.location)}</span>
        </button>
      `
    )
    .join("");
}

export function renderLocationResultsMarkup(query, matches, deps = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  if (!query && !matches.length) return "";
  if (!matches.length) {
    return `<div class="picker-hint">No saved location matches. Keep the typed value to create a new one.</div>`;
  }
  return matches
    .map(
      (location) => `
        <button class="picker-chip" type="button" data-location-pick="${escapeAttribute(location)}">
          <strong>${escapeHtml(location)}</strong>
        </button>
      `
    )
    .join("");
}
