import {
  graphEntityExplorerHref,
  graphEntityHref,
  graphEntityInvestigationsHref,
  graphInvestigationHref
} from "../core/graph-wiki.js";
import { escapeAttribute, escapeHtml } from "../core/text-utils.js";

const GRAPH_WIDTH = 1100;
const GRAPH_HEIGHT = 760;

export function renderGraphCanvas(filteredGraph, selectedNodeId = "") {
  const nodes = Array.isArray(filteredGraph?.nodes) ? filteredGraph.nodes : [];
  const edges = Array.isArray(filteredGraph?.edges) ? filteredGraph.edges : [];
  const highlightedNodeIds = new Set(Array.isArray(filteredGraph?.highlightedNodeIds) ? filteredGraph.highlightedNodeIds : []);

  if (!nodes.length) {
    return `<div class="empty-state">No graph nodes match the current filters yet.</div>`;
  }

  const layout = layoutGraph(nodes);
  const edgeMarkup = edges
    .map((edge) => {
      const source = layout.get(edge.source);
      const target = layout.get(edge.target);
      if (!source || !target) return "";
      return `
        <line
          class="graph-edge graph-edge--${escapeAttribute(edge.kind || "relationship")} ${edge.visibility === "draft" ? "is-draft" : ""}"
          x1="${source.x}"
          y1="${source.y}"
          x2="${target.x}"
          y2="${target.y}"
          stroke-width="${Math.max(1.5, Math.min(6, Number(edge.weight || 1) * 1.2))}"
          data-graph-edge="${escapeAttribute(edge.id)}"
        ></line>
      `;
    })
    .join("");

  const nodeMarkup = nodes
    .map((node) => {
      const position = layout.get(node.id);
      if (!position) return "";
      const selected = node.id === selectedNodeId;
      const highlighted = highlightedNodeIds.has(node.id);
      return `
        <g
          class="graph-node graph-node--${escapeAttribute(node.type)} ${selected ? "is-selected" : ""} ${highlighted ? "is-highlighted" : ""}"
          data-graph-node="${escapeAttribute(node.id)}"
          transform="translate(${position.x}, ${position.y})"
        >
          <circle r="28"></circle>
          <text class="graph-node__label" text-anchor="middle" y="54">${escapeHtml(node.label)}</text>
        </g>
      `;
    })
    .join("");

  return `
    <svg class="graph-canvas" viewBox="0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}" role="img" aria-label="Relationship graph explorer">
      <g class="graph-canvas__edges">${edgeMarkup}</g>
      <g class="graph-canvas__nodes">${nodeMarkup}</g>
    </svg>
  `;
}

export function renderGraphRail({
  graphState,
  filteredGraph,
  selectedNodeId = "",
  query = "",
  nodeTypeFilters = [],
  relationshipTypeFilters = [],
  viewerIsAdmin = false,
  selectedSummary = null
} = {}) {
  const availableNodeTypes = graphState?.graph?.availableNodeTypes || [];
  const availableRelationshipTypes = graphState?.graph?.availableRelationshipTypes || [];
  return `
    <div class="graph-rail__stack">
      <article class="surface-panel graph-rail__panel">
        <div class="eyebrow">Search</div>
        <label class="sr-only" for="graphSearchInput">Search graph</label>
        <input id="graphSearchInput" class="workspace-search__input" type="search" value="${escapeAttribute(query)}" placeholder="Highlight entities or investigations" data-graph-search>
        <p class="muted-text">Search highlights matches in the current graph. Filters below reduce what is shown.</p>
      </article>

      <article class="surface-panel graph-rail__panel">
        <div class="eyebrow">Filters</div>
        <strong>Node types</strong>
        <div class="tag-row graph-filter-row">
          ${availableNodeTypes.map((type) => renderFilterChip(type, nodeTypeFilters.includes(type), "node-type")).join("")}
        </div>
        <strong>Relationships</strong>
        <div class="tag-row graph-filter-row">
          ${availableRelationshipTypes.map((type) => renderFilterChip(type, relationshipTypeFilters.includes(type), "relationship-type")).join("")}
          <button class="tag tag--button graph-filter-clear" type="button" data-graph-clear-filters>Clear filters</button>
        </div>
      </article>

      <article class="surface-panel graph-rail__panel">
        <div class="eyebrow">Current node</div>
        ${
          selectedSummary
            ? renderSelectedNodeSummary(selectedSummary, viewerIsAdmin)
            : `<div class="empty-state">Select a node to inspect its summary, citations, and links.</div>`
        }
      </article>

      <article class="surface-panel graph-rail__panel">
        <div class="eyebrow">Current graph</div>
        <div class="metric-inline"><strong>${(filteredGraph?.nodes || []).length}</strong><span>Visible nodes</span></div>
        <div class="metric-inline"><strong>${(filteredGraph?.edges || []).length}</strong><span>Visible edges</span></div>
        ${
          viewerIsAdmin
            ? `<button class="button button-ghost" type="button" data-open-graph-entity-modal>Create entity</button>`
            : ""
        }
      </article>
    </div>
  `;
}

export function renderGraphModal(modalState, graphState) {
  if (!modalState) return "";
  if (modalState.kind === "entity") {
    return `
      <div class="modal-backdrop" data-close-graph-modal>
        <section class="modal-card" aria-label="Create wiki entity">
          <div class="modal-card__head">
            <div>
              <div class="eyebrow">Wiki administration</div>
              <h2>Create entity</h2>
            </div>
            <button class="button-ghost" type="button" data-close-graph-modal>Close</button>
          </div>
          <form class="tip-form graph-admin-form" data-graph-entity-form>
            <label><span>Name</span><input name="name" type="text" maxlength="120" required value="${escapeAttribute(modalState.seedName || "")}"></label>
            <label><span>Type</span><input name="type" type="text" maxlength="80" placeholder="company, industry, facility" value="${escapeAttribute(modalState.seedType || "")}"></label>
            <label><span>Location</span><input name="location" type="text" maxlength="120" value="${escapeAttribute(modalState.seedLocation || "")}"></label>
            <label><span>Summary</span><input name="summary" type="text" maxlength="180" value="${escapeAttribute(modalState.seedSummary || "")}"></label>
            <label><span>Taxonomy</span><input name="taxonomy" type="text" maxlength="180" placeholder="industry:animal-agriculture, stage:processing"></label>
            <label><span>Quick facts</span><input name="quickFacts" type="text" maxlength="200" placeholder="County: Maricopa, Role: Operator"></label>
            <label><span>Wiki body</span><textarea name="body" rows="6" placeholder="Write the initial wiki body.">${escapeHtml(modalState.seedBody || "")}</textarea></label>
            <div class="graph-admin-form__actions">
              <button class="button" type="submit">Save draft entity</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }
  if (modalState.kind === "relationship") {
    const entities = Array.isArray(graphState?.entities) ? graphState.entities : [];
    return `
      <div class="modal-backdrop" data-close-graph-modal>
        <section class="modal-card" aria-label="Create relationship">
          <div class="modal-card__head">
            <div>
              <div class="eyebrow">Relationship</div>
              <h2>Add draft relationship</h2>
            </div>
            <button class="button-ghost" type="button" data-close-graph-modal>Close</button>
          </div>
          <form class="tip-form graph-admin-form" data-graph-relationship-form>
            <label>
              <span>Source</span>
              <select name="source">
                ${entities.map((entity) => `<option value="${escapeAttribute(entity.slug)}" ${entity.slug === modalState.source ? "selected" : ""}>${escapeHtml(entity.name)}</option>`).join("")}
              </select>
            </label>
            <label>
              <span>Target</span>
              <select name="target">
                ${entities.map((entity) => `<option value="${escapeAttribute(entity.slug)}" ${entity.slug === modalState.target ? "selected" : ""}>${escapeHtml(entity.name)}</option>`).join("")}
              </select>
            </label>
            <label><span>Type</span><input name="type" type="text" maxlength="80" placeholder="owns, transports_to, contracts_with" value="${escapeAttribute(modalState.type || "")}"></label>
            <label><span>Summary</span><input name="summary" type="text" maxlength="180" value="${escapeAttribute(modalState.summary || "")}"></label>
            <label><span>Qualifiers</span><input name="qualifiers" type="text" maxlength="200" placeholder="route: County Line corridor, mode: truck"></label>
            <label><span>Evidence investigations</span><input name="evidence" type="text" maxlength="200" placeholder="placeholder-turnstile, lorem-ipsum-goose"></label>
            <div class="tip-form__split">
              <label><span>Start date</span><input name="start_at" type="date" value="${escapeAttribute(modalState.start_at || "")}"></label>
              <label><span>End date</span><input name="end_at" type="date" value="${escapeAttribute(modalState.end_at || "")}"></label>
            </div>
            <label><span>Weight</span><input name="weight" type="number" min="1" max="10" step="1" value="${escapeAttribute(String(modalState.weight || 2))}"></label>
            <div class="graph-admin-form__actions">
              <button class="button" type="submit">Save draft relationship</button>
            </div>
          </form>
        </section>
      </div>
    `;
  }
  return "";
}

function renderFilterChip(value, active, kind) {
  return `
    <button
      class="tag tag--button ${active ? "is-selected" : ""}"
      type="button"
      data-graph-filter-kind="${escapeAttribute(kind)}"
      data-graph-filter-value="${escapeAttribute(value)}"
      aria-pressed="${active ? "true" : "false"}"
    >${escapeHtml(humanizeToken(value))}</button>
  `;
}

function renderSelectedNodeSummary(summary, viewerIsAdmin) {
  if (summary.kind === "investigation") {
    return `
      <div class="graph-summary-card">
        <strong>${escapeHtml(summary.label)}</strong>
        <p>${escapeHtml(summary.summary || "This investigation anchors one or more graph citations.")}</p>
        <div class="tag-row"><span class="tag">${escapeHtml(summary.type)}</span></div>
        <div class="graph-summary-card__links">
          <a href="${escapeAttribute(graphInvestigationHref(summary.slug))}">Open investigation</a>
        </div>
      </div>
    `;
  }

  return `
    <div class="graph-summary-card">
      ${summary.image?.src ? `<img class="graph-summary-card__image" src="${escapeAttribute(summary.image.src)}" alt="${escapeAttribute(summary.image.alt || summary.label)}">` : ""}
      <strong>${escapeHtml(summary.label)}</strong>
      <p>${escapeHtml(summary.summary || "No summary yet for this wiki entry.")}</p>
      <div class="tag-row">
        <span class="tag">${escapeHtml(summary.type)}</span>
        ${summary.visibility === "draft" && viewerIsAdmin ? `<span class="tag">Draft</span>` : ""}
      </div>
      <div class="metric-inline"><strong>${summary.citationsCount || 0}</strong><span>Citations</span></div>
      <div class="graph-summary-card__links">
        <a href="${escapeAttribute(graphEntityHref(summary.slug))}">Open wiki</a>
        <a href="${escapeAttribute(graphEntityInvestigationsHref(summary.slug))}">Related investigations</a>
        <a href="${escapeAttribute(graphEntityExplorerHref(summary.slug))}">Open in graph</a>
        ${viewerIsAdmin ? `<button class="button-ghost" type="button" data-open-relationship-modal="${escapeAttribute(summary.slug)}">Add relationship</button>` : ""}
      </div>
    </div>
  `;
}

function layoutGraph(nodes = []) {
  const groups = new Map();
  const orderedTypes = orderGraphTypes(nodes.map((node) => node.type));
  for (const type of orderedTypes) groups.set(type, []);
  for (const node of nodes) {
    const bucket = groups.get(node.type) || [];
    bucket.push(node);
    groups.set(node.type, bucket);
  }

  const columns = [...groups.entries()].filter(([, group]) => group.length);
  const layout = new Map();
  const leftPadding = 90;
  const rightPadding = 90;
  const topPadding = 90;
  const bottomPadding = 120;
  const width = GRAPH_WIDTH - leftPadding - rightPadding;
  const height = GRAPH_HEIGHT - topPadding - bottomPadding;

  columns.forEach(([type, group], columnIndex) => {
    const x = columns.length === 1
      ? GRAPH_WIDTH / 2
      : leftPadding + (width * columnIndex) / (columns.length - 1);
    group.forEach((node, rowIndex) => {
      const y = group.length === 1
        ? GRAPH_HEIGHT / 2
        : topPadding + (height * rowIndex) / (group.length - 1);
      layout.set(node.id, { x, y, type });
    });
  });

  return layout;
}

function orderGraphTypes(types = []) {
  const preferred = ["industry", "company", "facility", "agency", "person", "vehicle", "investigation"];
  const available = [...new Set((Array.isArray(types) ? types : []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
  return [
    ...preferred.filter((type) => available.includes(type)),
    ...available.filter((type) => !preferred.includes(type))
  ];
}

function humanizeToken(value) {
  const clean = String(value || "").trim().replace(/[_-]+/g, " ");
  return clean ? clean.replace(/\b\w/g, (match) => match.toUpperCase()) : "";
}
