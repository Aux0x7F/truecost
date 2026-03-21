import SITE from "../core/site-config.js";
import { createObservedRegionRouter } from "../core/observed-regions.js";
import { appendDraftEntity, appendDraftRelationship, saveGraphDraftState } from "../core/graph-drafts.js";
import { loadGraphDataset, requestedWikiEntity } from "../core/graph-data.js";
import { buildEntityWikiView, buildSiteEvidenceGraph } from "../core/graph-wiki.js";
import { renderGraphModal } from "../surfaces/graph-explorer.js";
import { renderWikiIndexView, renderWikiPageView } from "../surfaces/wiki-page.js";

export function createWikiPageFeature({
  state,
  fetchJson,
  postsStore,
  getPublicState,
  viewerController
} = {}) {
  const regions = createObservedRegionRouter();
  const viewState = {
    loaded: false,
    bound: false,
    dataset: null,
    query: "",
    typeFilters: [],
    currentSlug: "",
    modal: null
  };

  async function mount() {
    if (!pageReady()) return;
    bindInteractions();
    if (!viewState.loaded) {
      regions.apply([
        { name: "wiki-hero-title", selector: "[data-wiki-hero-title]", kind: "text", value: "Loading wiki..." },
        { name: "wiki-hero-lede", selector: "[data-wiki-hero-lede]", kind: "text", value: "Looking up entity records and graph context." },
        { name: "wiki-article", selector: "[data-wiki-article]", value: `<div class="loading-state" role="status"><span class="loading-spinner" aria-hidden="true"></span><span>Looking up wiki records...</span></div>` },
        { name: "wiki-rail", selector: "[data-wiki-rail]", value: `<div class="loading-state" role="status"><span class="loading-spinner" aria-hidden="true"></span><span>Looking up wiki records...</span></div>` },
        { name: "wiki-modal", selector: "[data-wiki-modal-root]", value: "" }
      ], { force: true });
    }
    await loadAndRender();
  }

  async function refreshVisibleWiki() {
    if (isInteractionActive()) return;
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
      viewerController
    });
    if (!viewState.loaded) {
      viewState.typeFilters = [...(viewState.dataset.graphState.graph.availableNodeTypes || [])].filter((type) => type !== "investigation");
      viewState.currentSlug = requestedWikiEntity(window.location.search);
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

  function handleSubmit(event) {
    if (!pageReady()) return;
    const target = event.target;
    if (!(target instanceof HTMLFormElement)) return;

    if (target.matches("[data-graph-entity-form]")) {
      event.preventDefault();
      if (!viewState.dataset?.viewerIsAdmin) return;
      const formData = new FormData(target);
      viewState.dataset.draftGraph = appendDraftEntity(
        viewState.dataset.draftGraph,
        Object.fromEntries(formData.entries()),
        viewState.dataset.graphState.entities.map((entity) => entity.slug)
      );
      persistDraftGraph();
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
      viewState.dataset.draftGraph = appendDraftRelationship(
        viewState.dataset.draftGraph,
        Object.fromEntries(formData.entries())
      );
      persistDraftGraph();
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

    regions.apply([
      {
        name: "wiki-hero-title",
        selector: "[data-wiki-hero-title]",
        kind: "text",
        value: wikiView?.entity?.name || "Entity wiki"
      },
      {
        name: "wiki-hero-lede",
        selector: "[data-wiki-hero-lede]",
        kind: "text",
        value: wikiView?.entity?.summary || "Browse entity records, relationships, and investigation citations."
      },
      {
        name: "wiki-article",
        selector: "[data-wiki-article]",
        value: view.article
      },
      {
        name: "wiki-rail",
        selector: "[data-wiki-rail]",
        value: view.rail
      },
      {
        name: "wiki-modal",
        selector: "[data-wiki-modal-root]",
        value: renderGraphModal(viewState.modal, viewState.dataset.graphState)
      }
    ]);
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

  function persistDraftGraph() {
    viewState.dataset.draftGraph = saveGraphDraftState(SITE.nostr.storageNamespace, viewState.dataset.draftGraph);
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
    const url = new URL(window.location.href);
    if (viewState.currentSlug) {
      url.searchParams.set("entity", viewState.currentSlug);
    } else {
      url.searchParams.delete("entity");
    }
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
