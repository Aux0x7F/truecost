import test from "node:test";
import assert from "node:assert/strict";

import {
  renderGraphCanvas,
  renderGraphModal,
  renderGraphRail
} from "../scripts/surfaces/graph-explorer.js";

const graphState = {
  entities: [
    {
      slug: "north-valley-foods",
      name: "North Valley Foods",
      type: "company",
      summary: "Parent company",
      visibility: "public",
      image: null
    }
  ],
  graph: {
    availableNodeTypes: ["industry", "company", "investigation"],
    availableRelationshipTypes: ["owns", "transports_to"]
  }
};

const filteredGraph = {
  nodes: [
    { id: "north-valley-foods", slug: "north-valley-foods", kind: "entity", type: "company", label: "North Valley Foods" },
    { id: "investigation:placeholder-turnstile", slug: "placeholder-turnstile", kind: "investigation", type: "investigation", label: "Placeholder investigation" }
  ],
  edges: [
    { id: "rel:1", source: "north-valley-foods", target: "investigation:placeholder-turnstile", type: "cites", kind: "citation", weight: 1, visibility: "public" }
  ],
  highlightedNodeIds: ["north-valley-foods"]
};

test("graph canvas renders nodes, edges, and highlighted state", () => {
  const markup = renderGraphCanvas(filteredGraph, "north-valley-foods");
  assert.match(markup, /data-graph-node="north-valley-foods"/);
  assert.match(markup, /data-graph-edge="rel:1"/);
  assert.match(markup, /is-selected/);
  assert.match(markup, /is-highlighted/);
});

test("graph rail renders search, filters, and selected entity summary", () => {
  const markup = renderGraphRail({
    graphState,
    filteredGraph,
    selectedNodeId: "north-valley-foods",
    query: "north valley",
    nodeTypeFilters: ["company", "investigation"],
    relationshipTypeFilters: ["owns", "transports_to"],
    viewerIsAdmin: true,
    selectedSummary: {
      kind: "entity",
      slug: "north-valley-foods",
      label: "North Valley Foods",
      summary: "Parent company",
      type: "company",
      citationsCount: 3,
      visibility: "public"
    }
  });

  assert.match(markup, /Search/);
  assert.match(markup, /Current node/);
  assert.match(markup, /North Valley Foods/);
  assert.match(markup, /Open wiki/);
  assert.match(markup, /Clear filters/);
  assert.match(markup, /Create entity/);
});

test("graph modal renders admin entity and relationship forms", () => {
  const entityModal = renderGraphModal({ kind: "entity" }, graphState);
  const relationshipModal = renderGraphModal(
    {
      kind: "relationship",
      source: "north-valley-foods",
      target: "",
      type: "owns"
    },
    graphState
  );

  assert.match(entityModal, /Create entity/);
  assert.match(entityModal, /data-graph-entity-form/);
  assert.match(relationshipModal, /Add draft relationship/);
  assert.match(relationshipModal, /data-graph-relationship-form/);
});
