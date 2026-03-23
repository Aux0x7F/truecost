import test from "node:test";
import assert from "node:assert/strict";

import {
  renderWikiIndexView,
  renderWikiPageView
} from "../scripts/surfaces/wiki-page.js";

const graphState = {
  entities: [
    {
      slug: "north-valley-foods",
      name: "North Valley Foods",
      type: "company",
      summary: "Parent company",
      location: "Phoenix, Arizona",
      taxonomy: ["industry:animal-agriculture", "stage:processing"],
      citation_count: 2,
      visibility: "public"
    },
    {
      slug: "phoenix-cold-storage",
      name: "Phoenix Cold Storage",
      type: "facility",
      summary: "Draft warehouse",
      location: "Phoenix, Arizona",
      taxonomy: ["stage:warehousing"],
      citation_count: 0,
      visibility: "draft"
    }
  ],
  graph: {
    availableNodeTypes: ["company", "facility", "investigation"]
  }
};

test("wiki index view renders searchable directory and admin action", () => {
  const view = renderWikiIndexView({
    graphState,
    query: "phoenix",
    typeFilters: ["company", "facility"],
    viewerIsAdmin: true
  });

  assert.match(view.article, /Wiki directory/);
  assert.match(view.article, /North Valley Foods/);
  assert.match(view.article, /Phoenix Cold Storage/);
  assert.match(view.rail, /Search wiki/);
  assert.match(view.rail, /Create entity/);
});

test("wiki page view renders quick info, relationships, citations, and graph link", () => {
  const view = renderWikiPageView({
    wikiView: {
      entity: {
        slug: "north-valley-foods",
        name: "North Valley Foods",
        type: "company",
        summary: "Parent company",
        body: "Paragraph one.\n\nParagraph two.",
        taxonomy: ["industry:animal-agriculture"],
        location: "Phoenix, Arizona",
        quickFacts: [{ label: "HQ", value: "Phoenix, Arizona" }],
        visibility: "public"
      },
      relationships: [
        {
          label: "Owns",
          direction: "outbound",
          target_label: "North Valley Processing Campus",
          summary: "Parent company to facility",
          visibility: "public"
        }
      ],
      relatedInvestigations: [
        {
          slug: "placeholder-turnstile",
          title: "Placeholder investigation",
          date: "2026-03-09"
        }
      ],
      citationsCount: 3
    },
    viewerIsAdmin: true
  });

  assert.match(view.article, /North Valley Foods/);
  assert.match(view.article, /Paragraph one\./);
  assert.match(view.rail, /Quick info/);
  assert.match(view.rail, /Relationships/);
  assert.match(view.rail, /North Valley Processing Campus/);
  assert.match(view.rail, /Related investigations/);
  assert.match(view.rail, /Open in graph explorer/);
  assert.match(view.rail, /Add relationship/);
});
