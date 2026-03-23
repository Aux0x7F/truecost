import { createObservedRegionRouter } from "../core/observed-regions.js";
import { scrollElementWithinContainer } from "../core/dom.js";
import { normalizeQuerySlug } from "../core/query-state.js";
import { appendGraphEntityRecord, appendGraphRelationshipRecord } from "../core/graph-records.js";
import { loadGraphDataset } from "../core/graph-data.js";
import {
  buildEntityWikiView,
  buildSiteEvidenceGraph,
  filterEvidenceGraph
} from "../core/graph-wiki.js";
import { cycleHighlightIndex } from "../core/search-controls.js";
import {
  renderGraphCanvas,
  renderGraphModal,
  renderGraphRailCurrentGraphPanel,
  renderGraphRailCurrentNodePanel,
  renderGraphRailFiltersPanel,
  renderGraphRailShell,
  renderGraphSearchSuggestions
} from "../surfaces/graph-explorer.js";

export function createGraphPageFeature({
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
    searchSuggestions: [],
    searchOpen: false,
    searchHighlight: -1,
    nodeTypeFilters: [],
    relationshipTypeFilters: [],
    selectedNodeId: "",
    requestedFocus: "",
    pendingSummaryScroll: false,
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
        { name: "graph-canvas", selector: "[data-graph-canvas-shell]", value: `<div class="loading-state" role="status"><span class="loading-spinner" aria-hidden="true"></span><span>Building graph explorer...</span></div>` },
        { name: "graph-rail", selector: "[data-graph-rail]", value: `<div class="loading-state" role="status"><span class="loading-spinner" aria-hidden="true"></span><span>Building graph explorer...</span></div>` },
        { name: "graph-modal", selector: "[data-graph-modal-root]", value: "" }
      ], { force: true });
    }
    if (!projectionBound) {
      await loadAndRender();
    }
  }

  async function refreshVisibleGraph() {
    if (isInteractionActive()) return;
    if (typeof refreshProjection === "function") {
      await refreshProjection("graph", {}, { reason: "graph-page-visible-refresh" }).catch(() => loadAndRender());
      return;
    }
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
      getProjection,
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
    document.addEventListener("keydown", handleKeydown);
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
      viewState.pendingSummaryScroll = true;
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
    viewState.searchHighlight = -1;
    updateGraphSearchSuggestions();
    render();
  }

  function handleKeydown(event) {
    if (!pageReady()) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (!target.matches("[data-graph-search]")) return;
    const suggestions = viewState.searchSuggestions;
    if (event.key === "Escape") {
      if (viewState.searchOpen) {
        event.preventDefault();
        viewState.searchOpen = false;
        viewState.searchHighlight = -1;
        renderGraphSearchSuggestionsPanel();
      }
      return;
    }
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      viewState.searchOpen = true;
      viewState.searchHighlight = cycleHighlightIndex(viewState.searchHighlight, suggestions.length, 1);
      renderGraphSearchSuggestionsPanel();
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      viewState.searchOpen = true;
      viewState.searchHighlight = cycleHighlightIndex(viewState.searchHighlight, suggestions.length, -1);
      renderGraphSearchSuggestionsPanel();
      return;
    }
    if (event.key === "Enter" && suggestions.length && viewState.searchOpen) {
      event.preventDefault();
      const nextSuggestion = suggestions[Math.max(0, viewState.searchHighlight)];
      if (nextSuggestion) {
        commitGraphSearchSuggestion(nextSuggestion);
      }
    }
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

    const searchSuggestion = target.closest("[data-graph-search-suggestion]");
    if (searchSuggestion instanceof HTMLElement) {
      event.preventDefault();
      const suggestion = viewState.searchSuggestions.find(
        (item) => item.id === String(searchSuggestion.getAttribute("data-graph-search-suggestion") || "")
      );
      if (suggestion) {
        commitGraphSearchSuggestion(suggestion);
      }
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
      viewState.selectedNodeId = created?.slug || viewState.selectedNodeId;
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
    const filteredGraph = filterEvidenceGraph(viewState.dataset.graphState, {
      query: viewState.query,
      nodeTypes: viewState.nodeTypeFilters,
      relationshipTypes: viewState.relationshipTypeFilters
    });
    const selectedNodeId = resolveSelectedNodeId(filteredGraph);
    const previousSelectedNodeId = viewState.selectedNodeId;
    viewState.selectedNodeId = selectedNodeId;
    syncFocusSelection(selectedNodeId);
    const selectedSummary = buildSelectedNodeSummary(viewState.dataset.graphState, selectedNodeId);

    ensureGraphRailShell();
    syncGraphSearchValue(viewState.query);
    renderGraphSearchSuggestionsPanel();

    regions.apply([
      {
        name: "graph-canvas",
        selector: "[data-graph-canvas-shell]",
        value: renderGraphCanvas(filteredGraph, selectedNodeId)
      },
      {
        name: "graph-rail-filters",
        selector: "[data-graph-rail-filters-panel]",
        value: renderGraphRailFiltersPanel({
          graphState: viewState.dataset.graphState,
          nodeTypeFilters: viewState.nodeTypeFilters,
          relationshipTypeFilters: viewState.relationshipTypeFilters
        })
      },
      {
        name: "graph-rail-current-node",
        selector: "[data-graph-rail-current-node-panel]",
        value: renderGraphRailCurrentNodePanel({
          selectedSummary,
          viewerIsAdmin: viewState.dataset.viewerIsAdmin
        })
      },
      {
        name: "graph-rail-current-graph",
        selector: "[data-graph-rail-current-graph-panel]",
        value: renderGraphRailCurrentGraphPanel({
          filteredGraph,
          viewerIsAdmin: viewState.dataset.viewerIsAdmin
        })
      },
      {
        name: "graph-modal",
        selector: "[data-graph-modal-root]",
        value: renderGraphModal(viewState.modal, viewState.dataset.graphState)
      }
    ]);
    if (selectedSummary && (viewState.pendingSummaryScroll || previousSelectedNodeId !== selectedNodeId)) {
      viewState.pendingSummaryScroll = false;
      scrollGraphRailToSummary();
    }
  }

  function ensureGraphRailShell() {
    const host = document.querySelector("[data-graph-rail]");
    if (!(host instanceof HTMLElement)) return;
    if (host.querySelector("[data-graph-rail-search-panel]")) return;
    host.innerHTML = renderGraphRailShell({ query: viewState.query });
  }

  function syncGraphSearchValue(query = "") {
    const input = document.querySelector("[data-graph-search]");
    if (!(input instanceof HTMLInputElement)) return;
    const nextValue = String(query || "");
    if (document.activeElement === input) return;
    if (input.value !== nextValue) input.value = nextValue;
  }

  function renderGraphSearchSuggestionsPanel() {
    const host = document.querySelector("[data-graph-search-results]");
    if (!(host instanceof HTMLElement)) return;
    host.innerHTML = renderGraphSearchSuggestions({
      isOpen: viewState.searchOpen,
      query: viewState.query,
      suggestions: viewState.searchSuggestions,
      highlightedIndex: viewState.searchHighlight
    });
  }

  function selectNode(nodeId) {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLInputElement && activeElement.matches("[data-graph-search]")) {
      activeElement.blur();
    }
    viewState.selectedNodeId = String(nodeId || "").trim();
    viewState.searchOpen = false;
    viewState.searchHighlight = -1;
    viewState.pendingSummaryScroll = true;
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
    updateGraphSearchSuggestions();
    render();
  }

  function clearFilters() {
    viewState.nodeTypeFilters = [...(viewState.dataset?.graphState?.graph?.defaultNodeTypes || [])];
    viewState.relationshipTypeFilters = [...(viewState.dataset?.graphState?.graph?.availableRelationshipTypes || [])];
    updateGraphSearchSuggestions();
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
            viewState.nodeTypeFilters = [...(projection.graphState.graph.defaultNodeTypes || [])];
            viewState.relationshipTypeFilters = [...(projection.graphState.graph.availableRelationshipTypes || [])];
            viewState.selectedNodeId = resolveRequestedNodeId(projection.graphState, viewState.requestedFocus);
            viewState.loaded = true;
          }
          updateGraphSearchSuggestions();
          render();
        },
        {
          emitCurrent: true,
          refresh: true,
          reason: "graph-page-projection"
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
    updateGraphSearchSuggestions();
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

  function updateGraphSearchSuggestions() {
    if (!viewState.dataset?.graphState) {
      viewState.searchSuggestions = [];
      viewState.searchOpen = false;
      viewState.searchHighlight = -1;
      return;
    }
    const query = String(viewState.query || "").trim();
    if (!query) {
      viewState.searchSuggestions = [];
      viewState.searchOpen = false;
      viewState.searchHighlight = -1;
      return;
    }
    const baseGraph = filterEvidenceGraph(viewState.dataset.graphState, {
      query: "",
      nodeTypes: viewState.nodeTypeFilters,
      relationshipTypes: viewState.relationshipTypeFilters
    });
    const matches = getGraphSearchSuggestions(baseGraph, query);
    viewState.searchSuggestions = matches;
    viewState.searchOpen = matches.length > 0;
    viewState.searchHighlight = matches.length
      ? Math.min(Math.max(viewState.searchHighlight, -1), matches.length - 1)
      : -1;
  }

  function commitGraphSearchSuggestion(suggestion) {
    viewState.query = String(suggestion?.label || "");
    viewState.searchOpen = false;
    viewState.searchHighlight = -1;
    viewState.searchSuggestions = [];
    const input = document.querySelector("[data-graph-search]");
    if (input instanceof HTMLInputElement) input.value = viewState.query;
    render();
    selectNode(suggestion?.id || "");
  }

  function scrollGraphRailToSummary() {
    window.requestAnimationFrame(() => {
      const rail = document.querySelector("[data-graph-rail]");
      const card = document.querySelector("[data-graph-summary-card]");
      if (!(rail instanceof HTMLElement) || !(card instanceof HTMLElement)) return;
      scrollElementWithinContainer(rail, card, { padding: 16 });
    });
  }

  return {
    isInteractionActive,
    mount,
    refreshVisibleGraph
  };
}

function getGraphSearchSuggestions(filteredGraph, query = "") {
  const cleanQuery = String(query || "").trim().toLowerCase();
  if (!cleanQuery) return [];
  const nodes = Array.isArray(filteredGraph?.nodes) ? filteredGraph.nodes : [];
  const seen = new Set();
  return nodes
    .map((node) => {
      const label = String(node?.label || "").trim();
      const slug = String(node?.slug || "").trim();
      const type = String(node?.type || "").trim();
      const haystack = [label, slug, type].map((value) => value.toLowerCase());
      const rank = haystack.some((value) => value.startsWith(cleanQuery))
        ? 0
        : haystack.some((value) => value.includes(cleanQuery))
          ? 1
          : 99;
      return {
        id: String(node?.id || "").trim(),
        slug,
        label: label || slug,
        type,
        kind: String(node?.kind || "").trim(),
        rank
      };
    })
    .filter((item) => item.id && item.rank < 99)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      return left.label.localeCompare(right.label);
    })
    .slice(0, 8);
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
