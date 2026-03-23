import { createObservedRegionRouter } from "../core/observed-regions.js";
import { normalizeQuerySlug } from "../core/query-state.js";
import { appendGraphEntityRecord, appendGraphRelationshipRecord } from "../core/graph-records.js";
import { loadGraphDataset } from "../core/graph-data.js";
import { buildEntityWikiView, buildSiteEvidenceGraph } from "../core/graph-wiki.js";
import { renderGraphModal } from "../surfaces/graph-explorer.js";
import {
  renderWikiIndexRailDirectoryPanel,
  renderWikiIndexRailShell,
  renderWikiIndexRailTypesPanel,
  renderWikiIndexView,
  renderWikiPageView
} from "../surfaces/wiki-page.js";

export function createWikiPageFeature({
  state,
  fetchJson,
  postsStore,
  getPublicState,
      getProjection,
      refreshProjection,
      subscribeProjection,
  rememberProjection,
  viewerController,
  queryState
} = {}) {
  const regions = createObservedRegionRouter();
  const viewState = {
    loaded: false,
    bound: false,
    queryBound: false,
    dataset: null,
    query: "",
    typeFilters: [],
    currentSlug: "",
    requestedEntity: "",
    modal: null,
    projectionUnsubscribe: null
  };

  async function mount() {
    if (!pageReady()) return;
    bindInteractions();
    bindQueryState();
    const projectionBound = bindProjection();
    if (!viewState.loaded) {
      regions.apply([
        { name: "wiki-article", selector: "[data-wiki-article]", value: `<div class="loading-state" role="status"><span class="loading-spinner" aria-hidden="true"></span><span>Looking up wiki records...</span></div>` },
        { name: "wiki-rail", selector: "[data-wiki-rail]", value: `<div class="loading-state" role="status"><span class="loading-spinner" aria-hidden="true"></span><span>Looking up wiki records...</span></div>` },
        { name: "wiki-modal", selector: "[data-wiki-modal-root]", value: "" }
      ], { force: true });
    }
    if (!projectionBound) {
      await loadAndRender();
    }
  }

  async function refreshVisibleWiki() {
    if (isInteractionActive()) return;
    if (typeof refreshProjection === "function") {
      await refreshProjection("graph", {}, { reason: "wiki-page-visible-refresh" }).catch(() => loadAndRender());
      return;
    }
    await loadAndRender();
  }

  function isInteractionActive() {
    const active = document.activeElement;
    return Boolean(
      active instanceof HTMLElement &&
        active.closest("[data-wiki-page], [data-wiki-modal-root]")
    ) || Boolean(viewState.modal);
  }

  async function loadAndRender() {
    if (!pageReady()) return;
    viewState.dataset = await loadGraphDataset({
      fetchJson,
      postsStore,
      getPublicState,
      getProjection,
      viewerController
    });
    if (!viewState.loaded) {
      viewState.typeFilters = [...(viewState.dataset.graphState.graph.availableNodeTypes || [])].filter((type) => type !== "investigation");
      viewState.currentSlug = viewState.requestedEntity;
      viewState.loaded = true;
    }
    render();
  }

  function bindInteractions() {
    if (viewState.bound) return;
    viewState.bound = true;
    document.addEventListener("input", handleInput);
    document.addEventListener("click", handleClick);
    document.addEventListener("submit", handleSubmit);
  }

  function bindQueryState() {
    if (viewState.queryBound || !queryState) return;
    viewState.queryBound = true;
    queryState.subscribe(["entity"], ({ entity }) => {
      viewState.requestedEntity = String(entity || "");
      if (!viewState.loaded) return;
      if (viewState.currentSlug === viewState.requestedEntity) return;
      viewState.currentSlug = viewState.requestedEntity;
      render();
    }, {
      normalizers: {
        entity: normalizeQuerySlug
      }
    });
  }

  function handleInput(event) {
    if (!pageReady()) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.matches("[data-wiki-search]")) return;
    viewState.query = String(target.value || "");
    render();
  }

  function handleClick(event) {
    if (!pageReady()) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const closeModal = target.closest("[data-close-graph-modal]");
    if (closeModal || target.matches(".modal-backdrop")) {
      if (target.classList.contains("modal-backdrop") || closeModal) {
        event.preventDefault();
        viewState.modal = null;
        render();
      }
      return;
    }

    const filter = target.closest("[data-wiki-filter-type]");
    if (filter instanceof HTMLElement) {
      event.preventDefault();
      toggleTypeFilter(filter.getAttribute("data-wiki-filter-type") || "");
      return;
    }

    if (target.closest("[data-open-graph-entity-modal]")) {
      event.preventDefault();
      viewState.modal = { kind: "entity" };
      render();
      return;
    }

    const relationship = target.closest("[data-open-relationship-modal]");
    if (relationship instanceof HTMLElement) {
      event.preventDefault();
      const source = String(relationship.getAttribute("data-open-relationship-modal") || "").trim();
      viewState.modal = {
        kind: "relationship",
        source,
        target: "",
        type: ""
      };
      render();
    }
  }

  async function handleSubmit(event) {
    if (!pageReady()) return;
    const target = event.target;
    if (!(target instanceof HTMLFormElement)) return;

    if (target.matches("[data-graph-entity-form]")) {
      event.preventDefault();
      if (!viewState.dataset?.viewerIsAdmin) return;
      const formData = new FormData(target);
      viewState.dataset.draftGraph = appendGraphEntityRecord(
        viewState.dataset.draftGraph,
        Object.fromEntries(formData.entries()),
        viewState.dataset.graphState.entities.map((entity) => entity.slug)
      );
      await persistDraftGraph();
      rebuildDataset();
      const created = viewState.dataset.draftGraph.entities.at(-1);
      viewState.modal = null;
      viewState.currentSlug = created?.slug || viewState.currentSlug;
      syncCurrentSlug();
      render();
      return;
    }

    if (target.matches("[data-graph-relationship-form]")) {
      event.preventDefault();
      if (!viewState.dataset?.viewerIsAdmin) return;
      const formData = new FormData(target);
      viewState.dataset.draftGraph = appendGraphRelationshipRecord(
        viewState.dataset.draftGraph,
        Object.fromEntries(formData.entries())
      );
      await persistDraftGraph();
      rebuildDataset();
      viewState.modal = null;
      render();
    }
  }

  function render() {
    if (!pageReady() || !viewState.dataset) return;
    const wikiView = viewState.currentSlug
      ? buildEntityWikiView(viewState.dataset.graphState, viewState.currentSlug)
      : null;
    const view = wikiView?.entity
      ? renderWikiPageView({
          wikiView,
          viewerIsAdmin: viewState.dataset.viewerIsAdmin
        })
      : renderWikiIndexView({
          graphState: viewState.dataset.graphState,
          query: viewState.query,
          typeFilters: viewState.typeFilters,
          viewerIsAdmin: viewState.dataset.viewerIsAdmin
        });
    const availableTypes = (viewState.dataset?.graphState?.graph?.availableNodeTypes || []).filter((type) => type !== "investigation");
    const activeTypeFilters = Array.isArray(viewState.typeFilters) && viewState.typeFilters.length
      ? viewState.typeFilters
      : availableTypes;
    const filteredEntities = Array.isArray(viewState.dataset?.graphState?.entities)
      ? viewState.dataset.graphState.entities.filter((entity) => {
          if (activeTypeFilters.length && !activeTypeFilters.includes(entity.type)) return false;
          if (!String(viewState.query || "").trim()) return true;
          const haystack = [
            entity.name,
            entity.summary,
            entity.location,
            ...(Array.isArray(entity.taxonomy) ? entity.taxonomy : []),
            ...(Array.isArray(entity.aliases) ? entity.aliases : [])
          ]
            .map((value) => String(value || "").toLowerCase())
            .join("\n");
          return haystack.includes(String(viewState.query || "").trim().toLowerCase());
        })
      : [];

    if (wikiView?.entity) {
      clearWikiIndexRailShell();
    } else {
      ensureWikiIndexRailShell();
      syncWikiSearchValue(viewState.query);
    }

    regions.apply([
      {
        name: "wiki-article",
        selector: "[data-wiki-article]",
        value: view.article
      },
      {
        name: "wiki-rail",
        selector: "[data-wiki-rail]",
        value: wikiView?.entity ? view.rail : document.querySelector("[data-wiki-rail]")?.innerHTML || view.rail
      },
      {
        name: "wiki-rail-types",
        selector: "[data-wiki-rail-types-panel]",
        value: wikiView?.entity
          ? ""
          : renderWikiIndexRailTypesPanel({
              availableTypes,
              activeTypeFilters
            })
      },
      {
        name: "wiki-rail-directory",
        selector: "[data-wiki-rail-directory-panel]",
        value: wikiView?.entity
          ? ""
          : renderWikiIndexRailDirectoryPanel({
              totalEntities: Array.isArray(viewState.dataset?.graphState?.entities) ? viewState.dataset.graphState.entities.length : 0,
              filteredEntities: filteredEntities.length,
              viewerIsAdmin: viewState.dataset.viewerIsAdmin
            })
      },
      {
        name: "wiki-modal",
        selector: "[data-wiki-modal-root]",
        value: renderGraphModal(viewState.modal, viewState.dataset.graphState)
      }
    ]);
  }

  function ensureWikiIndexRailShell() {
    const host = document.querySelector("[data-wiki-rail]");
    if (!(host instanceof HTMLElement)) return;
    if (host.querySelector("[data-wiki-rail-search-panel]")) return;
    host.innerHTML = renderWikiIndexRailShell({ query: viewState.query });
  }

  function clearWikiIndexRailShell() {
    const host = document.querySelector("[data-wiki-rail]");
    if (!(host instanceof HTMLElement)) return;
    if (!host.querySelector("[data-wiki-rail-search-panel]")) return;
    host.innerHTML = "";
    regions.reset();
  }

  function syncWikiSearchValue(query = "") {
    const input = document.querySelector("[data-wiki-search]");
    if (!(input instanceof HTMLInputElement)) return;
    const nextValue = String(query || "");
    if (document.activeElement === input) return;
    if (input.value !== nextValue) input.value = nextValue;
  }

  function toggleTypeFilter(value) {
    const cleanValue = String(value || "").trim().toLowerCase();
    if (!cleanValue) return;
    const next = new Set(viewState.typeFilters);
    if (next.has(cleanValue)) next.delete(cleanValue);
    else next.add(cleanValue);
    viewState.typeFilters = [...next];
    render();
  }

  async function persistDraftGraph() {
    if (typeof rememberProjection !== "function") return;
    viewState.dataset.draftGraph = await rememberProjection(
      "graphDraft",
      {},
      viewState.dataset.draftGraph,
      { source: "graph-draft" }
    )
      .then((projection) => projection?.value ?? viewState.dataset.draftGraph)
      .catch(() => viewState.dataset.draftGraph);
    if (typeof refreshProjection === "function") {
      const refreshedGraph = await refreshProjection("graph", {}, { reason: "graph-draft-update" })
        .then((projection) => projection?.value ?? null)
        .catch(() => null);
      if (refreshedGraph?.graphState) {
        viewState.dataset = refreshedGraph;
      }
    }
  }

  function bindProjection() {
    if (viewState.projectionUnsubscribe || typeof subscribeProjection !== "function") return false;
    Promise.resolve(
      subscribeProjection(
        "graph",
        {},
        (envelope) => {
          const projection = envelope?.value ?? envelope;
          if (!projection?.graphState) return;
          viewState.dataset = projection;
          if (!viewState.loaded) {
            viewState.typeFilters = [...(projection.graphState.graph.availableNodeTypes || [])]
              .filter((type) => type !== "investigation");
            viewState.currentSlug = viewState.requestedEntity;
            viewState.loaded = true;
          }
          render();
        },
        {
          emitCurrent: true,
          refresh: true,
          reason: "wiki-page-projection"
        }
      )
    )
      .then((unsubscribe) => {
        if (typeof unsubscribe === "function") {
          viewState.projectionUnsubscribe = unsubscribe;
        }
      })
      .catch(() => null);
    return true;
  }

  function rebuildDataset() {
    viewState.dataset.graphState = buildSiteEvidenceGraph({
      publicState: viewState.dataset.publicState,
      posts: viewState.dataset.posts,
      seed: viewState.dataset.seed,
      draftGraph: viewState.dataset.draftGraph,
      viewerIsAdmin: viewState.dataset.viewerIsAdmin
    });
  }

  function syncCurrentSlug() {
    if (queryState) {
      queryState.set("entity", viewState.currentSlug, { normalize: normalizeQuerySlug });
      return;
    }
    const url = new URL(window.location.href);
    if (viewState.currentSlug) url.searchParams.set("entity", viewState.currentSlug);
    else url.searchParams.delete("entity");
    history.replaceState({}, "", url);
  }

  function pageReady() {
    return Boolean(document.querySelector("[data-wiki-page]"));
  }

  return {
    isInteractionActive,
    mount,
    refreshVisibleWiki
  };
}
