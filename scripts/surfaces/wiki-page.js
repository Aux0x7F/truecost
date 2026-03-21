import {
  graphEntityExplorerHref,
  graphEntityInvestigationsHref
} from "../core/graph-wiki.js";
import { escapeAttribute, escapeHtml } from "../core/text-utils.js";

export function renderWikiPageView({
  wikiView = null,
  viewerIsAdmin = false
} = {}) {
  if (!wikiView?.entity) {
    return {
      article: `<div class="empty-state">This wiki entry could not be found.</div>`,
      rail: `<div class="empty-state">Select a valid entity to explore its wiki page.</div>`
    };
  }

  const entity = wikiView.entity;
  return {
    article: `
      <article class="wiki-article">
        <div class="eyebrow">Entity wiki</div>
        <h1>${escapeHtml(entity.name)}</h1>
        <p class="hero__lede">${escapeHtml(entity.summary || "No summary yet for this entity.")}</p>
        <div class="tag-row wiki-article__taxonomy">
          <span class="tag">${escapeHtml(entity.type)}</span>
          ${(Array.isArray(entity.taxonomy) ? entity.taxonomy : []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
          ${viewerIsAdmin && entity.visibility === "draft" ? `<span class="tag">Draft</span>` : ""}
        </div>
        ${entity.image?.src ? `<img class="wiki-article__image" src="${escapeAttribute(entity.image.src)}" alt="${escapeAttribute(entity.image.alt || entity.name)}">` : ""}
        <div class="wiki-article__body">
          ${(entity.body || "").trim()
            ? String(entity.body)
                .split(/\n{2,}/)
                .map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`)
                .join("")
            : `<p>No wiki body has been written for this entity yet.</p>`}
        </div>
      </article>
    `,
    rail: `
      <div class="graph-rail__stack">
        <article class="surface-panel graph-rail__panel">
          <div class="eyebrow">Quick info</div>
          <div class="metric-inline"><strong>${escapeHtml(entity.type)}</strong><span>Entity type</span></div>
          ${entity.location ? `<div class="metric-inline"><strong>${escapeHtml(entity.location)}</strong><span>Location</span></div>` : ""}
          ${(entity.quickFacts || []).map((fact) => `<div class="metric-inline"><strong>${escapeHtml(fact.value)}</strong><span>${escapeHtml(fact.label)}</span></div>`).join("")}
        </article>

        <article class="surface-panel graph-rail__panel">
          <div class="eyebrow">Relationships</div>
          ${
            wikiView.relationships.length
              ? wikiView.relationships.map((relationship) => `
                  <div class="wiki-rail__list-item ${relationship.visibility === "draft" ? "is-draft" : ""}">
                    <strong>${escapeHtml(relationship.label)}</strong>
                    <span>${escapeHtml(relationship.direction === "outbound" ? relationship.target_label || relationship.target : relationship.source_label || relationship.source)}</span>
                    ${relationship.summary ? `<p>${escapeHtml(relationship.summary)}</p>` : ""}
                  </div>
                `).join("")
              : `<div class="empty-state">No relationships recorded yet.</div>`
          }
          ${viewerIsAdmin ? `<button class="button button-ghost" type="button" data-open-relationship-modal="${escapeAttribute(entity.slug)}">Add relationship</button>` : ""}
        </article>

        <article class="surface-panel graph-rail__panel">
          <div class="eyebrow">Related investigations</div>
          ${
            wikiView.relatedInvestigations.length
              ? wikiView.relatedInvestigations.map((investigation) => `
                  <a class="wiki-rail__list-item" href="./investigation.html?slug=${encodeURIComponent(investigation.slug)}">
                    <strong>${escapeHtml(investigation.title)}</strong>
                    <span>${escapeHtml(investigation.date || "Undated")}</span>
                  </a>
                `).join("")
              : `<div class="empty-state">No investigation citations yet.</div>`
          }
        </article>

        <article class="surface-panel graph-rail__panel">
          <div class="eyebrow">Citations</div>
          <div class="metric-inline"><strong>${wikiView.citationsCount}</strong><span>Investigation citations</span></div>
          <a href="${escapeAttribute(graphEntityInvestigationsHref(entity.slug))}">Open filtered investigations</a>
        </article>

        <article class="surface-panel graph-rail__panel">
          <div class="eyebrow">Graph</div>
          <a href="${escapeAttribute(graphEntityExplorerHref(entity.slug))}">Open in graph explorer</a>
        </article>
      </div>
    `
  };
}

export function renderWikiIndexView({
  graphState = null,
  query = "",
  typeFilters = [],
  viewerIsAdmin = false
} = {}) {
  const entities = Array.isArray(graphState?.entities) ? graphState.entities : [];
  const availableTypes = (graphState?.graph?.availableNodeTypes || []).filter((type) => type !== "investigation");
  const activeTypeFilters = Array.isArray(typeFilters) && typeFilters.length ? typeFilters : availableTypes;
  const cleanQuery = String(query || "").trim().toLowerCase();
  const filteredEntities = entities.filter((entity) => {
    if (activeTypeFilters.length && !activeTypeFilters.includes(entity.type)) return false;
    if (!cleanQuery) return true;
    const haystack = [
      entity.name,
      entity.summary,
      entity.location,
      ...(Array.isArray(entity.taxonomy) ? entity.taxonomy : []),
      ...(Array.isArray(entity.aliases) ? entity.aliases : [])
    ]
      .map((value) => String(value || "").toLowerCase())
      .join("\n");
    return haystack.includes(cleanQuery);
  });

  return {
    article: `
      <section class="wiki-index">
        <div class="section__head wiki-index__head">
          <div>
            <div class="eyebrow">Wiki directory</div>
            <h2>Entity records</h2>
          </div>
          <p class="muted-text">${filteredEntities.length} visible record${filteredEntities.length === 1 ? "" : "s"}</p>
        </div>
        <div class="wiki-directory">
          ${
            filteredEntities.length
              ? filteredEntities.map((entity) => `
                  <article class="surface-panel wiki-directory__card ${entity.visibility === "draft" ? "is-draft" : ""}">
                    <div class="wiki-directory__head">
                      <div>
                        <div class="eyebrow">${escapeHtml(entity.type)}</div>
                        <h3><a href="./wiki.html?entity=${encodeURIComponent(entity.slug)}">${escapeHtml(entity.name)}</a></h3>
                      </div>
                      ${
                        viewerIsAdmin && entity.visibility === "draft"
                          ? `<span class="tag">Draft</span>`
                          : ""
                      }
                    </div>
                    <p>${escapeHtml(entity.summary || "No summary yet for this wiki entry.")}</p>
                    <div class="tag-row">
                      ${(Array.isArray(entity.taxonomy) ? entity.taxonomy : []).slice(0, 4).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
                    </div>
                    <div class="wiki-directory__meta">
                      ${entity.location ? `<span>${escapeHtml(entity.location)}</span>` : ""}
                      <span>${Number(entity.citation_count || 0)} citation${Number(entity.citation_count || 0) === 1 ? "" : "s"}</span>
                    </div>
                    <div class="wiki-directory__links">
                      <a href="./wiki.html?entity=${encodeURIComponent(entity.slug)}">Open wiki</a>
                      <a href="${escapeAttribute(graphEntityExplorerHref(entity.slug))}">Open in graph</a>
                      <a href="${escapeAttribute(graphEntityInvestigationsHref(entity.slug))}">Related investigations</a>
                    </div>
                  </article>
                `).join("")
              : `<div class="empty-state">No wiki entries match the current search and type filters yet.</div>`
          }
        </div>
      </section>
    `,
    rail: `
      <div class="graph-rail__stack">
        <article class="surface-panel graph-rail__panel">
          <div class="eyebrow">Search wiki</div>
          <label class="sr-only" for="wikiSearchInput">Search wiki</label>
          <input id="wikiSearchInput" class="workspace-search__input" type="search" value="${escapeAttribute(query)}" placeholder="Search entities, aliases, or taxonomy" data-wiki-search>
          <p class="muted-text">Search narrows the current wiki directory. Open any record to inspect the full wiki page.</p>
        </article>

        <article class="surface-panel graph-rail__panel">
          <div class="eyebrow">Types</div>
          <div class="tag-row graph-filter-row">
            ${availableTypes.map((type) => renderWikiFilterChip(type, activeTypeFilters.includes(type))).join("")}
          </div>
        </article>

        <article class="surface-panel graph-rail__panel">
          <div class="eyebrow">Directory</div>
          <div class="metric-inline"><strong>${entities.length}</strong><span>Total entities</span></div>
          <div class="metric-inline"><strong>${filteredEntities.length}</strong><span>Visible records</span></div>
          ${
            viewerIsAdmin
              ? `<button class="button button-ghost" type="button" data-open-graph-entity-modal>Create entity</button>`
              : ""
          }
        </article>
      </div>
    `
  };
}

function renderWikiFilterChip(value, active) {
  return `
    <button
      class="tag tag--button ${active ? "is-selected" : ""}"
      type="button"
      data-wiki-filter-type="${escapeAttribute(value)}"
      aria-pressed="${active ? "true" : "false"}"
    >${escapeHtml(humanizeToken(value))}</button>
  `;
}

function humanizeToken(value) {
  const clean = String(value || "").trim().replace(/[_-]+/g, " ");
  return clean ? clean.replace(/\b\w/g, (match) => match.toUpperCase()) : "";
}
