import SITE from "../core/site-config.js";
import { createObservedRegionRouter } from "../core/observed-regions.js";
import { normalizeQuerySlug } from "../core/query-state.js";
import { appendDraftEntity, appendDraftRelationship, saveGraphDraftState } from "../core/graph-drafts.js";
import { loadGraphDataset } from "../core/graph-data.js";
import { buildEntityWikiView, buildSiteEvidenceGraph, filterEvidenceGraph } from "../core/graph-wiki.js";
import {
  renderGraphCanvas,
  renderGraphModal,
  renderGraphRail
} from "../surfaces/graph-explorer.js";

export function createGraphPageFeature({
  state,
  fetchJson,
  postsStore,
  getPublicState,
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
    nodeTypeFilters: [],
    relationshipTypeFilters: [],
    selectedNodeId: "",
    requestedFocus: "",
    modal: null
  };

  async function mount() {
    if (!pageReady()) return;
    bindInteractions();
    bindQueryState();
    if (!viewState.loaded) {
      regions.apply([
        { name: "graph-canvas", selector: "[data-graph-canvas-shell]", value: `<div class="loading-state" role="status"><span class="loading-spinner" aria-hidden="true"></span><span>Building graph explorer...</span></div>` },
        { name: "graph-rail", selector: "[data-graph-rail]", value: `<div class="loading-state" role="status"><span class="loading-spinner" aria-hidden="true"></span><span>Building graph explorer...</span></div>` },
        { name: "graph-modal", selector: "[data-graph-modal-root]", value: "" }
      ], { force: true });
    }
    await loadAndRender();
  }

  async function refreshVisibleGraph() {
    if (isInteractionActive()) return;
    await loadAndRender();
  }

  function isInteractionActive() {
    const active = document.activeElement;
    return Boolean(
      active instanceof HTMLElement &&
        active.closest("[data-graph-page], [data-graph-modal-root]")
    ) || Boolean(viewState.modal);
  }

  async function loadAndRender() {
    if (!pageReady()) return;
    const dataset = await loadGraphDataset({
      fetchJson,
      postsStore,
      getPublicState,
      viewerController
    });
    viewState.dataset = dataset;
    if (!viewState.loaded) {
      viewState.nodeTypeFilters = [...(dataset.graphState.graph.defaultNodeTypes || [])];
      viewState.relationshipTypeFilters = [...(dataset.graphState.graph.availableRelationshipTypes || [])];
      viewState.selectedNodeId = resolveRequestedNodeId(dataset.graphState, viewState.requestedFocus);
    }
    viewState.loaded = true;
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
    queryState.subscribe(["focus"], ({ focus }) => {
      viewState.requestedFocus = String(focus || "");
      if (!viewState.loaded || !viewState.dataset) return;
      const nextSelectedNodeId = resolveRequestedNodeId(viewState.dataset.graphState, viewState.requestedFocus);
      if (nextSelectedNodeId === viewState.selectedNodeId) return;
      viewState.selectedNodeId = nextSelectedNodeId;
      render();
    }, {
      normalizers: {
        focus: normalizeQuerySlug
      }
    });
  }

  function handleInput(event) {
    if (!pageReady()) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.matches("[data-graph-search]")) return;
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

    const node = target.closest("[data-graph-node]");
    if (node instanceof Element) {
      event.preventDefault();
      selectNode(node.getAttribute("data-graph-node") || "");
      return;
    }

    const filter = target.closest("[data-graph-filter-kind]");
    if (filter instanceof HTMLElement) {
      event.preventDefault();
      toggleFilter(
        filter.getAttribute("data-graph-filter-kind") || "",
        filter.getAttribute("data-graph-filter-value") || ""
      );
      return;
    }

    if (target.closest("[data-graph-clear-filters]")) {
      event.preventDefault();
      clearFilters();
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
        target: viewState.selectedNodeId && viewState.selectedNodeId !== source ? viewState.selectedNodeId : "",
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
      viewState.selectedNodeId = created?.slug || viewState.selectedNodeId;
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
    const filteredGraph = filterEvidenceGraph(viewState.dataset.graphState, {
      query: viewState.query,
      nodeTypes: viewState.nodeTypeFilters,
      relationshipTypes: viewState.relationshipTypeFilters
    });
    const selectedNodeId = resolveSelectedNodeId(filteredGraph);
    viewState.selectedNodeId = selectedNodeId;
    syncFocusSelection(selectedNodeId);
    const selectedSummary = buildSelectedNodeSummary(viewState.dataset.graphState, selectedNodeId);

    regions.apply([
      {
        name: "graph-canvas",
        selector: "[data-graph-canvas-shell]",
        value: renderGraphCanvas(filteredGraph, selectedNodeId)
      },
      {
        name: "graph-rail",
        selector: "[data-graph-rail]",
        value: renderGraphRail({
          graphState: viewState.dataset.graphState,
          filteredGraph,
          selectedNodeId,
          query: viewState.query,
          nodeTypeFilters: viewState.nodeTypeFilters,
          relationshipTypeFilters: viewState.relationshipTypeFilters,
          viewerIsAdmin: viewState.dataset.viewerIsAdmin,
          selectedSummary
        })
      },
      {
        name: "graph-modal",
        selector: "[data-graph-modal-root]",
        value: renderGraphModal(viewState.modal, viewState.dataset.graphState)
      }
    ]);
  }

  function selectNode(nodeId) {
    viewState.selectedNodeId = String(nodeId || "").trim();
    const selectedNode = findSelectedNode(viewState.selectedNodeId);
    const focusValue = selectedNode?.slug || viewState.selectedNodeId;
    if (queryState) {
      queryState.set("focus", focusValue, { normalize: normalizeQuerySlug });
      render();
      return;
    }
    render();
  }

  function toggleFilter(kind, value) {
    const cleanKind = String(kind || "").trim();
    const cleanValue = String(value || "").trim().toLowerCase();
    if (!cleanKind || !cleanValue) return;
    if (cleanKind === "node-type") {
      viewState.nodeTypeFilters = toggleFilterValue(
        viewState.nodeTypeFilters,
        cleanValue,
        viewState.dataset?.graphState?.graph?.defaultNodeTypes || []
      );
    }
    if (cleanKind === "relationship-type") {
      viewState.relationshipTypeFilters = toggleFilterValue(
        viewState.relationshipTypeFilters,
        cleanValue,
        viewState.dataset?.graphState?.graph?.availableRelationshipTypes || []
      );
    }
    render();
  }

  function clearFilters() {
    viewState.nodeTypeFilters = [...(viewState.dataset?.graphState?.graph?.defaultNodeTypes || [])];
    viewState.relationshipTypeFilters = [...(viewState.dataset?.graphState?.graph?.availableRelationshipTypes || [])];
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

  function resolveSelectedNodeId(filteredGraph) {
    const visibleNodes = Array.isArray(filteredGraph?.nodes) ? filteredGraph.nodes : [];
    const visibleIds = new Set(visibleNodes.map((node) => node.id));
    if (viewState.selectedNodeId && visibleIds.has(viewState.selectedNodeId)) return viewState.selectedNodeId;
    const requested = resolveRequestedNodeId(viewState.dataset?.graphState, viewState.requestedFocus);
    if (requested && visibleIds.has(requested)) return requested;
    return visibleNodes[0]?.id || "";
  }

  function buildSelectedNodeSummary(graphState, nodeId) {
    const node = (graphState?.graph?.nodes || []).find((item) => item.id === nodeId) || null;
    if (!node) return null;
    if (node.kind === "investigation") {
      return {
        kind: "investigation",
        slug: node.slug,
        label: node.label,
        summary: node.summary,
        type: node.type
      };
    }
    const wikiView = buildEntityWikiView(graphState, node.slug);
    if (!wikiView?.entity) return null;
    return {
      kind: "entity",
      slug: wikiView.entity.slug,
      label: wikiView.entity.name,
      summary: wikiView.entity.summary,
      type: wikiView.entity.type,
      visibility: wikiView.entity.visibility,
      image: wikiView.entity.image,
      citationsCount: wikiView.citationsCount
    };
  }

  function syncFocusSelection(selectedNodeId) {
    const selectedNode = findSelectedNode(selectedNodeId);
    const focusValue = String(selectedNode?.slug || selectedNodeId || "").trim();
    if (queryState) {
      queryState.set("focus", focusValue, { normalize: normalizeQuerySlug });
      return;
    }
    const url = new URL(window.location.href);
    if (focusValue) url.searchParams.set("focus", focusValue);
    else url.searchParams.delete("focus");
    history.replaceState({}, "", url);
  }

  function findSelectedNode(selectedNodeId) {
    return (viewState.dataset?.graphState?.graph?.nodes || []).find((node) => node.id === selectedNodeId) || null;
  }

  function pageReady() {
    return Boolean(document.querySelector("[data-graph-page]"));
  }

  return {
    isInteractionActive,
    mount,
    refreshVisibleGraph
  };
}

function toggleFilterValue(values, targetValue, fallbackValues) {
  const next = new Set(Array.isArray(values) ? values : []);
  if (next.has(targetValue)) {
    next.delete(targetValue);
  } else {
    next.add(targetValue);
  }
  const filtered = [...next].filter(Boolean);
  if (!filtered.length) return [...new Set((Array.isArray(fallbackValues) ? fallbackValues : []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean))];
  return filtered;
}

function resolveRequestedNodeId(graphState, requestedValue = "") {
  const cleanValue = String(requestedValue || "").trim().toLowerCase();
  if (!cleanValue) return "";
  const nodes = Array.isArray(graphState?.graph?.nodes) ? graphState.graph.nodes : [];
  const direct = nodes.find((node) => String(node.id || "").trim().toLowerCase() === cleanValue);
  if (direct) return direct.id;
  const bySlug = nodes.find((node) => String(node.slug || "").trim().toLowerCase() === cleanValue);
  return bySlug?.id || "";
}
