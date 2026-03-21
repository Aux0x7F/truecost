import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSiteEvidenceGraph,
  graphEntityExplorerHref,
  graphEntityHref,
  graphEntityInvestigationsHref,
  graphInvestigationHref
} from "../scripts/core/graph-wiki.js";
import { requestedGraphFocus, requestedWikiEntity } from "../scripts/core/graph-data.js";

test("graph route helpers normalize target URLs", () => {
  assert.equal(graphEntityHref("north-valley-foods"), "./wiki.html?entity=north-valley-foods");
  assert.equal(graphEntityExplorerHref("north-valley-foods"), "./graph.html?focus=north-valley-foods");
  assert.equal(graphEntityInvestigationsHref("north-valley-foods"), "./investigations.html?entity=north-valley-foods");
  assert.equal(graphInvestigationHref("placeholder-turnstile"), "./investigation.html?slug=placeholder-turnstile");
});

test("graph query helpers normalize focus and wiki entity slugs", () => {
  assert.equal(requestedGraphFocus("?focus=North Valley Foods"), "north-valley-foods");
  assert.equal(requestedWikiEntity("?entity=County Line Logistics Yard"), "county-line-logistics-yard");
});

test("site graph builder merges public relationships and admin draft graph", () => {
  const graphState = buildSiteEvidenceGraph({
    publicState: {
      approvedEntities: [
        {
          slug: "north-valley-foods",
          name: "North Valley Foods",
          type: "company",
          summary: "Parent company"
        },
        {
          slug: "county-line-logistics-yard",
          name: "County Line Logistics Yard",
          type: "facility",
          summary: "Yard"
        }
      ],
      relationships: [
        {
          id: "rel:public",
          source: "north-valley-foods",
          target: "county-line-logistics-yard",
          type: "contracts_with",
          label: "Contracts with"
        }
      ]
    },
    posts: [
      {
        slug: "placeholder-turnstile",
        title: "Placeholder",
        summary: "Summary",
        entity_refs: ["north-valley-foods", "county-line-logistics-yard"]
      }
    ],
    seed: { entities: [], relationships: [], draft_relationships: [] },
    draftGraph: {
      entities: [
        {
          slug: "phoenix-cold-storage",
          name: "Phoenix Cold Storage",
          type: "facility",
          visibility: "draft",
          status: "draft"
        }
      ],
      relationships: [
        {
          id: "rel:draft",
          source: "county-line-logistics-yard",
          target: "phoenix-cold-storage",
          type: "warehouses_for",
          label: "Warehouses for",
          visibility: "draft"
        }
      ]
    },
    viewerIsAdmin: true
  });

  assert.equal(graphState.entitiesBySlug.has("phoenix-cold-storage"), true);
  assert.equal(graphState.relationships.some((relationship) => relationship.id === "rel:public"), true);
  assert.equal(graphState.graph.edges.some((edge) => edge.id === "rel:draft"), true);
});
