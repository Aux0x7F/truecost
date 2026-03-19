import test from "node:test";
import assert from "node:assert/strict";

import { createMarkdownPageFeature } from "../scripts/features/markdown-page.js";

test("markdown page feature exposes enrichArticleEntities and delegates approved entities to the enricher", () => {
  const calls = [];
  const feature = createMarkdownPageFeature({
    state: { session: null, viewer: null },
    viewerController: {
      trustedPubkeys: () => [],
      sessionPubkey: () => "",
      get: async () => null
    },
    getPublicState: async () => ({ approvedEntities: [] }),
    publishTaggedJson: async () => ({}),
    renderError: () => {},
    renderLoadingState: () => "",
    renderMiniMarkdown: () => "",
    renderMarkedHtml: () => "",
    fetchText: async () => "",
    slugify: (value) => String(value || "").trim().toLowerCase(),
    enrichEntityReferences: (scope, entities) => {
      calls.push({ scope, entities });
    }
  });

  const scope = { nodeType: 1 };
  const publicState = { approvedEntities: [{ slug: "north-valley" }] };

  assert.equal(typeof feature.enrichArticleEntities, "function");
  feature.enrichArticleEntities(scope, publicState);

  assert.deepEqual(calls, [{ scope, entities: publicState.approvedEntities }]);
});
