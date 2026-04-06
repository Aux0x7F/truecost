import {
  renderEditorCitationsView as renderGenericEditorCitationsView,
  renderEditorLoadingMarkup as renderGenericEditorLoadingMarkup,
  renderEditorRailView as renderGenericEditorRailView,
  renderEditorToolbarView as renderGenericEditorToolbarView
} from "../../vendor/nostr-site-support.esm.js";

const ICON_SPRITE_PATH = "./vendor/editor-icons.svg";

export function renderEditorLoadingMarkup(message, deps = {}) {
  return renderGenericEditorLoadingMarkup(message, deps);
}

export function renderEditorShellView({ editorState, deps = {} } = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const currentUserIsAdmin = deps.currentUserIsAdmin || (() => false);
  const canOpenAuthoringShell = deps.canOpenAuthoringShell || currentUserIsAdmin;
  const routeTitle = editorState?.currentSlug ? "Edit investigation" : "New investigation";
  const projectedTitle = String(editorState?.document?.title || "").trim() || routeTitle;
  const documentPanelOpen = String(editorState?.activeRailPanel || "document") === "document";
  const optionsDisabled = documentPanelOpen && !editorState?.mobileRailOpen;

  if (!editorState?.session) {
    return {
      title: "Log in",
      shellMarkup: `
        <section class="surface-panel editor-gate">
          <div class="eyebrow">Authoring</div>
          <h2>Admin access required</h2>
          <p>Log in with an admin account to create or edit investigation drafts.</p>
          <a class="button" href="./admin.html?tab=login">Log in</a>
        </section>
      `
    };
  }

  if (!canOpenAuthoringShell()) {
    return {
      title: "Authoring",
      shellMarkup: `
        <section class="surface-panel editor-gate">
          <div class="eyebrow">Authoring</div>
          <h2>Admin access required</h2>
          <p>This account can use profile tools, but investigation authoring is still limited to admins.</p>
          <a class="button" href="./admin.html?tab=profile">Open profile</a>
        </section>
      `
    };
  }

  return {
    title: projectedTitle,
    shellMarkup: `
      <section class="editor-layout" data-editor-layout>
        <header class="editor-header surface-panel">
          <div class="editor-header__slot editor-header__slot--identity">
            <div class="eyebrow">Investigation editor</div>
          </div>
          <div
            class="editor-header__slot editor-header__slot--status editor-header__mode"
            data-editor-save-status
            data-state="${escapeAttribute(editorState?.saveToast?.visible === false && editorState?.mockMode ? "mock" : (editorState?.saveToast?.state || editorState?.saveStatus?.state || "idle"))}"
            aria-live="polite"
          >${escapeHtml(editorState?.saveToast?.visible === false && editorState?.mockMode ? "UI-only mock mode" : (editorState?.saveToast?.message || editorState?.saveStatus?.message || (editorState?.mockMode ? "UI-only mock mode" : "Unsaved")))}</div>
          <div class="editor-header__slot editor-header__slot--controls">
            <button
              class="editor-options-toggle${documentPanelOpen ? " is-open" : ""}"
              type="button"
              data-editor-open-panel="document"
              aria-expanded="${documentPanelOpen ? "true" : "false"}"
              ${optionsDisabled ? "aria-disabled=\"true\"" : ""}
            >
              <span>Options</span>
            </button>
          </div>
        </header>

        <div class="editor-workspace">
          <section class="editor-compose surface-panel">
            <div class="editor-toolbar" data-editor-toolbar></div>
            <div class="editor-compose__surface">
              <div class="editor-surface" data-editor-surface></div>
              <div class="editor-citations-tile" data-editor-citations-tile></div>
            </div>
          </section>

          <aside class="editor-rail-shell${editorState?.activeRailPanel ? " is-open" : ""}" data-editor-rail-shell>
            <div class="editor-rail" data-editor-rail></div>
          </aside>
        </div>
      </section>
    `
  };
}

export function renderEditorToolbarView({ toolbarState = {}, editorState = {}, deps = {} } = {}) {
  return renderGenericEditorToolbarView({
    toolbarState,
    editorState,
    deps: {
      ...deps,
      extraWrappedMenuItems: [
        { kind: "entityTile", label: "Entity", icon: "globe" }
      ]
    }
  });
}

export function renderEditorRailView({ editorState, deps = {} } = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const previewHref = deps.previewHref || "";
  const activePanel = String(editorState?.activeRailPanel || "").trim() || inferRailPanel(editorState);

  if (activePanel === "multimedia") {
    return renderGenericEditorRailView({
      editorState,
      deps: { ...deps, escapeAttribute, escapeHtml, previewHref }
    });
  }
  if (activePanel === "citation") {
    return renderCitationRail(editorState, { escapeAttribute, escapeHtml });
  }
  if (activePanel === "entityTile") {
    return renderEntityTileRail(editorState, { escapeAttribute, escapeHtml });
  }
  return renderDocumentRail(editorState, { escapeAttribute, escapeHtml, previewHref });
}

export function renderEditorModalView({ editorState, deps = {} } = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const previewHref = deps.previewHref || "";

  if (!editorState?.mobileRailOpen) {
    return "";
  }

  return `
    <div class="modal-backdrop" data-editor-modal-backdrop>
      <section class="modal-card modal-card--editor modal-card--rail" aria-label="${escapeAttribute(activePanelTitle(editorState))}">
        <div class="editor-modal__header">
          <button class="editor-modal__close" type="button" data-editor-modal-close>
            ${renderIcon("close")}
          </button>
        </div>
        <div class="editor-rail editor-rail--modal">
          ${renderEditorRailView({ editorState, deps: { escapeAttribute, escapeHtml, previewHref } })}
        </div>
      </section>
    </div>
  `;
}

export function renderEditorCitationsView({ citations = [], deps = {} } = {}) {
  return renderGenericEditorCitationsView({ citations, deps });
}

function renderDocumentRail(editorState, deps = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const previewHref = deps.previewHref || "";
  const documentState = editorState?.document || {};
  const historyItems = collectHistoryItems(editorState);

  return `
    <section class="editor-snap-panel surface-panel editor-snap-panel--document">
      ${renderSnapPanelHeading("Page options")}
      <section class="editor-snap-card">
        <label class="editor-rail__field">
          <span>Title</span>
          <input name="title" type="text" maxlength="140" placeholder="Investigation title" value="${escapeAttribute(documentState.title || "")}" required>
        </label>
        <label class="editor-rail__field">
          <span>Summary</span>
          <textarea name="summary" rows="4" placeholder="Short summary">${escapeHtml(documentState.summary || "")}</textarea>
        </label>
        <label class="editor-rail__field">
          <span>Date</span>
          <input name="date" type="date" value="${escapeAttribute(documentState.date || "")}">
        </label>
        <label class="editor-rail__field">
          <span>Tags</span>
          <input name="tags" type="text" placeholder="records, follow-up, budget" value="${escapeAttribute((documentState.tags || []).join(", "))}">
        </label>
        <label class="editor-rail__field">
          <span>Lead entity</span>
          <div class="editor-picker" data-editor-picker="primaryEntity">
            <input name="primaryEntity" type="search" data-editor-entity-input="primaryEntity" autocomplete="off" placeholder="Search saved entities" value="${escapeAttribute(documentState.primaryEntity || "")}">
            <div class="picker-results picker-results--dropdown" data-editor-entity-results="primaryEntity"></div>
          </div>
        </label>
        <label class="editor-rail__field">
          <span>Related entities</span>
          <div class="editor-picker" data-editor-picker="entityRefs">
            <input name="entityRefs" type="search" data-editor-entity-input="entityRefs" autocomplete="off" placeholder="Search saved entities" value="${escapeAttribute((documentState.entityRefs || []).join(", "))}">
            <div class="picker-results picker-results--dropdown" data-editor-entity-results="entityRefs"></div>
          </div>
        </label>
        <label class="editor-rail__toggle">
          <input name="featured" type="checkbox" ${documentState.featured ? "checked" : ""}>
          <span>Show in featured investigations</span>
        </label>
        <div class="editor-rail__hint">
          <strong>Featured list</strong>
          <span>Highlights this investigation in featured investigations.</span>
        </div>
      </section>

      <section class="editor-snap-card">
        <h3>Publish options</h3>
        <div class="editor-rail__hint">
          <strong>Preview</strong>
          <span>${previewHref ? "Open the current draft preview before review." : "A preview link appears after the title creates a slug."}</span>
        </div>
        <div class="button-row">
          <a class="button-ghost${previewHref ? "" : " is-disabled"}" data-editor-preview href="${escapeAttribute(previewHref || "#")}" target="_blank" rel="noreferrer noopener" ${previewHref ? "" : "aria-disabled=\"true\""}>Open preview</a>
          <button class="button${editorState?.mockMode ? " is-disabled" : ""}" type="button" data-editor-submit ${editorState?.mockMode ? "aria-disabled=\"true\"" : ""}>Send to review</button>
        </div>
      </section>

      <section class="editor-snap-card editor-snap-card--history">
        <h3>History</h3>
        <div class="editor-history-stub">
          ${
            historyItems.length
              ? historyItems.map((item) => `
                  <div class="editor-history-stub__item">
                    <strong>${escapeHtml(item.label)}</strong>
                    <span>${escapeHtml(item.meta)}</span>
                  </div>
                `).join("")
              : `<div class="empty-state">Saved snapshots and relay versions will appear here.</div>`
          }
        </div>
      </section>
    </section>
  `;
}

function renderCitationRail(editorState, deps = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const citations = Array.isArray(editorState?.documentCitations) ? editorState.documentCitations : [];
  const citationDraft = editorState?.citationDraft || {};
  const editing = Boolean(editorState?.citationEditorOpen);
  const isEdit = Boolean(editorState?.editingCitationId);

  return `
    <section class="editor-snap-panel surface-panel editor-snap-panel--citation">
      ${renderSnapPanelHeading("Citations")}
      <section class="editor-snap-card">
        <div class="editor-library-list editor-live-citations--rail">
          <button class="editor-library-row editor-library-row--action editor-library-row--action-plain" type="button" data-editor-citation-add>
            <span class="editor-library-row__title">Create citation</span>
          </button>
          ${
            citations.length
              ? citations.map((citation, index) => `
                  <div
                    id="editor-citation-${citation.number || index + 1}"
                    class="editor-library-row editor-library-row--split"
                    data-editor-citation-row="${escapeAttribute(citation.id)}"
                  >
                    <button class="editor-library-row__main editor-library-row__main--citation" type="button" data-editor-citation-edit="${escapeAttribute(citation.id)}">
                      <span class="editor-library-row__title">${escapeHtml(formatCitationLabel(citation))}</span>
                    </button>
                    <button class="editor-library-row__insert" type="button" data-editor-citation-insert="${escapeAttribute(citation.id)}" title="Insert citation">
                      ${renderIcon("plus")}
                    </button>
                  </div>
                `).join("")
              : `<div class="empty-state">Citations used in this document will appear here.</div>`
          }
        </div>
      </section>

      ${
        editing
          ? `
            <section class="editor-pane-modal editor-pane-modal--citation">
              <div class="editor-pane-modal__body">
                ${renderCitationField("Title", "citationTitle", citationDraft.title || "", "Resource title", escapeAttribute)}
                ${renderCitationField("Author", "citationAuthor", citationDraft.author || "", "Author", escapeAttribute)}
                ${renderCitationField("Source", "citationSource", citationDraft.source || "", "Publication/source", escapeAttribute)}
                ${renderCitationField("Publisher", "citationPublisher", citationDraft.publisher || "", "Publisher", escapeAttribute)}
                ${renderCitationField("Publication date", "citationPublishedAt", citationDraft.publishedAt || "", "Publication date", escapeAttribute)}
                ${renderCitationField("Page or section", "citationPage", citationDraft.page || "", "Page or section", escapeAttribute)}
                ${renderCitationField("URL", "citationHref", citationDraft.href || "", "URL", escapeAttribute, "url")}
                ${renderCitationField("Archive URL", "citationArchiveHref", citationDraft.archiveHref || "", "Archive URL", escapeAttribute, "url")}
                ${renderCitationField("Accessed date", "citationAccessedAt", citationDraft.accessedAt || "", "Accessed date", escapeAttribute)}
                <label class="editor-rail__field">
                  <span>Note</span>
                  <textarea name="citationNote" rows="4" placeholder="Note">${escapeHtml(citationDraft.note || "")}</textarea>
                </label>
              </div>
              <div class="editor-pane-modal__footer">
                <button class="button-ghost" type="button" data-editor-citation-cancel>Cancel</button>
                ${isEdit ? `<button class="button-ghost button-ghost--danger" type="button" data-editor-citation-delete>Delete</button>` : ""}
                <button class="button" type="button" data-editor-citation-save>Done</button>
              </div>
            </section>
          `
          : ""
      }
    </section>
  `;
}

function renderEntityTileRail(editorState, deps = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const draft = editorState?.entityTileDraft || {};
  const results = Array.isArray(editorState?.entityTileMatches) ? editorState.entityTileMatches : [];
  const editingInstance = String(editorState?.entityTileEditorMode || "").trim() === "instance" && editorState?.selectedNode?.name === "investigationEntityTile";
  const selectedLabel = String(draft.label || draft.selected?.name || draft.entity || draft.query || "Entity").trim() || "Entity";
  const selectedMeta = String(draft.meta || [draft.selected?.type, draft.selected?.location].filter(Boolean).join(" · ") || "Entity").trim();
  return `
    <section class="editor-snap-panel surface-panel editor-snap-panel--entity">
      ${renderSnapPanelHeading(editingInstance ? "Entity" : "Insert an entity")}
      <section class="editor-snap-card">
        <label class="editor-search-field">
          <span class="sr-only">Search saved entities</span>
          <input name="entityTileSearch" type="search" value="${escapeAttribute(draft.query || "")}" placeholder="Search saved entities">
          ${draft.query ? `<button class="editor-search-field__clear" type="button" data-editor-entity-clear-search>${renderIcon("close")}</button>` : ""}
        </label>
        <div class="editor-results">
          ${
            results.length
              ? results.map((entity) => `
                  <div class="editor-library-row editor-library-row--split editor-library-row--entity">
                    <button class="editor-library-row__main editor-library-row__main--entity" type="button" data-editor-entity-tile-pick="${escapeAttribute(entity.slug)}">
                      <span class="editor-library-row__title">${escapeHtml(entity.name || entity.slug)}</span>
                      <span class="editor-library-row__meta">${escapeHtml([entity.type, entity.location].filter(Boolean).join(" · ") || "Entity")}</span>
                    </button>
                    <button class="editor-library-row__insert" type="button" data-editor-entity-tile-pick="${escapeAttribute(entity.slug)}" title="Insert entity">
                      ${renderIcon("plus")}
                    </button>
                  </div>
                `).join("")
              : `<div class="empty-state">${draft.query ? "No saved entity matches that search." : "Start typing to search saved entities."}</div>`
          }
        </div>
      </section>
      ${
        editingInstance
          ? `
            <section class="editor-snap-card">
              <h3>Selected entity</h3>
              <div class="editor-library-row editor-library-row--split editor-library-row--entity is-current">
                <div class="editor-library-row__main editor-library-row__main--entity">
                  <span class="editor-library-row__title">${escapeHtml(selectedLabel)}</span>
                  <span class="editor-library-row__meta">${escapeHtml(selectedMeta)}</span>
                </div>
              </div>
              <div class="editor-rail__field editor-rail__field--static">
                <span>Wrap</span>
                ${renderControlStrip([
                  renderEntityPlacementButton("float-left", draft.placement || "center"),
                  renderEntityPlacementButton("center", draft.placement || "center"),
                  renderEntityPlacementButton("float-right", draft.placement || "center"),
                  renderEntityPlacementButton("full-width", draft.placement || "center")
                ], "editor-control-strip--attached")}
              </div>
            </section>
          `
          : ""
      }
    </section>
  `;
}

function inferRailPanel(editorState = {}) {
  const selectedName = String(editorState?.selectedNode?.name || "").trim();
  if (selectedName === "templateMultimedia") return "multimedia";
  if (selectedName === "templateCitation") return "citation";
  if (selectedName === "investigationEntityTile") return "entityTile";
  return "document";
}

function activePanelTitle(editorState = {}) {
  const panel = String(editorState?.activeRailPanel || "").trim() || inferRailPanel(editorState);
  if (panel === "multimedia") return "Media";
  if (panel === "citation") return "Citations";
  if (panel === "entityTile") return "Insert an entity";
  return "Page options";
}

function collectHistoryItems(editorState = {}) {
  const localSnapshots = Array.isArray(editorState?.localSnapshots) ? editorState.localSnapshots : [];
  const relayVersions = Array.isArray(editorState?.relayVersions) ? editorState.relayVersions : [];
  const localItems = localSnapshots.slice(0, 4).map((snapshot) => ({
    label: snapshot?.label || "Local snapshot",
    meta: snapshot?.saved_at || "Saved locally"
  }));
  const relayItems = relayVersions.slice(0, 4).map((version) => ({
    label: version?.title || "Saved draft",
    meta: version?.status || "Relay version"
  }));
  return [...localItems, ...relayItems].slice(0, 8);
}

function formatCitationLabel(citation = {}) {
  const title = String(citation.title || citation.href || "Citation").trim();
  const page = String(citation.page || "").trim();
  return page ? `${title}, ${page}` : title;
}

function renderIcon(name) {
  return `
    <svg class="editor-icon" aria-hidden="true" focusable="false">
      <use href="${ICON_SPRITE_PATH}#icon-${name}"></use>
    </svg>
  `;
}

function renderCitationField(label, name, value, placeholder, escapeAttribute, type = "text") {
  return `
    <label class="editor-rail__field">
      <span>${label}</span>
      <input name="${name}" type="${type}" value="${escapeAttribute(value || "")}" placeholder="${placeholder}">
    </label>
  `;
}

function renderSnapPanelHeading(label) {
  return `
    <header class="editor-snap-panel__heading">
      <div class="eyebrow">${label}</div>
    </header>
  `;
}

function renderControlStrip(items = [], className = "") {
  return `<div class="editor-control-strip${className ? ` ${className}` : ""}">${items.filter(Boolean).join('<div class="editor-control-strip__divider" aria-hidden="true"></div>')}</div>`;
}

function renderEntityPlacementButton(value, current = "") {
  const clean = String(value || "").trim().toLowerCase();
  const titles = {
    "float-left": "Wrap left",
    "center": "Center",
    "float-right": "Wrap right",
    "full-width": "Full width"
  };
  const icons = {
    "float-left": "align-left",
    "center": "align-center",
    "float-right": "align-right"
  };
  const content = icons[clean]
    ? renderIcon(icons[clean])
    : "<span>Full</span>";
  return `<button class="editor-ribbon__icon-button${current === clean ? " is-active" : ""}${icons[clean] ? "" : " editor-ribbon__icon-button--labelled"}" type="button" data-editor-entity-placement="${clean}" title="${titles[clean] || "Wrap"}">${content}</button>`;
}
