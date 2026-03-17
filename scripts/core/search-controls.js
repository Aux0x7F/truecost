import { escapeAttribute, escapeHtml } from "./text-utils.js";

function serializeAttributes(attributes = {}) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== false && value !== null && value !== undefined)
    .map(([key, value]) => {
      if (value === true) return key;
      return `${key}="${escapeAttribute(value)}"`;
    })
    .join(" ");
}

export function cycleHighlightIndex(current, length, delta) {
  if (!Number.isFinite(length) || length <= 0) return -1;
  if (!Number.isFinite(current) || current < 0) return delta < 0 ? length - 1 : 0;
  return (current + delta + length) % length;
}

export function renderSearchField({
  wrapperClass = "workspace-search",
  wrapperAttributes = {},
  srLabel = "",
  inputClass = "workspace-search__input",
  inputAttributes = {},
  clearButton = null,
  loading = false,
  resultsHtml = ""
} = {}) {
  const { class: inputClassName = inputClass, ...inputRest } = inputAttributes || {};
  const wrapperAttrString = serializeAttributes(wrapperAttributes);
  const inputAttrString = serializeAttributes({ class: inputClassName, ...inputRest });
  const clearButtonHtml = clearButton
    ? `<button ${serializeAttributes({
        class: clearButton.className || "workspace-search__clear",
        type: "button",
        ...clearButton.attributes,
        "aria-label": clearButton.ariaLabel || "Clear"
      })}>${escapeHtml(clearButton.text || "×")}</button>`
    : "";
  const spinnerHtml = loading
    ? `<span class="workspace-search__spinner" aria-hidden="true"><span class="loading-spinner"></span></span>`
    : "";
  return `
    <label class="${escapeAttribute(wrapperClass)}"${wrapperAttrString ? ` ${wrapperAttrString}` : ""}>
      ${srLabel ? `<span class="sr-only">${escapeHtml(srLabel)}</span>` : ""}
      <input ${inputAttrString}>
      ${clearButtonHtml}
      ${spinnerHtml}
      ${resultsHtml}
    </label>
  `;
}

export function renderSearchSuggestions({
  isOpen = false,
  query = "",
  items = [],
  highlightedIndex = -1,
  emptyMessage = "",
  requiresQuery = true,
  listClassName = "picker-results picker-results--dropdown workspace-search__results",
  itemClassName = "picker-chip",
  itemAttributes = () => ({}),
  renderPrimary = (item) => `<strong>${escapeHtml(item)}</strong>`,
  renderSecondary = () => ""
} = {}) {
  const cleanQuery = String(query || "").trim();
  if (!isOpen || (requiresQuery && !cleanQuery)) return "";
  const renderedItems = (Array.isArray(items) ? items : []).length
    ? items
        .map((item, index) => {
          const isHighlighted = highlightedIndex === index;
          const attributes = {
            class: `${itemClassName}${isHighlighted ? " is-highlighted" : ""}`,
            type: "button",
            ...itemAttributes(item, index),
            "aria-selected": isHighlighted ? "true" : "false"
          };
          return `
            <button ${serializeAttributes(attributes)}>
              ${renderPrimary(item, index)}
              ${renderSecondary(item, index)}
            </button>
          `;
        })
        .join("")
    : `<div class="picker-hint">${escapeHtml(emptyMessage)}</div>`;
  return `<div class="${escapeAttribute(listClassName)}" data-open="yes">${renderedItems}</div>`;
}
