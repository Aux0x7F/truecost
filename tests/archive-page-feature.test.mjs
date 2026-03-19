import test from "node:test";
import assert from "node:assert/strict";

import { createArchivePageFeature } from "../scripts/features/archive-page.js";

test("archive page feature renders featured investigations before slower public-state hydration resolves", async () => {
  class FakeElement {
    constructor(attrs = {}) {
      this.innerHTML = "";
      this.attrs = attrs;
      this.dataset = {};
    }
    getAttribute(name) {
      return this.attrs[name] || "";
    }
  }

  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    querySelector(selector) {
      return {
        "[data-home-investigations]": homeGrid,
        "[data-investigation-list]": null,
        "[data-investigation-rail]": null,
        "[data-authoring-entry]": null
      }[selector] || null;
    },
    querySelectorAll(selector) {
      return selector === "[data-archive-summary]" ? [] : [];
    }
  };

  const homeGrid = new FakeElement({ "data-count": "2" });
  let resolvePosts;
  let resolvePublicState;
  const postsPromise = new Promise((resolve) => {
    resolvePosts = resolve;
  });
  const publicStatePromise = new Promise((resolve) => {
    resolvePublicState = resolve;
  });

  const feature = createArchivePageFeature({
    state: { publicState: null },
    viewerController: {
      canEdit: () => false
    },
    postsStore: {
      current: () => [],
      refresh: async () => postsPromise
    },
    getPublicState: async () => publicStatePromise,
    publicStateNeedsRepair: () => false,
    queueLeafletBoundsFit: () => {},
    renderError: () => {},
    renderLoadingState: (message) => `<div>${message}</div>`
  });

  feature.mount();
  assert.match(homeGrid.innerHTML, /Looking up featured investigations/);

  resolvePosts([
    {
      slug: "north-valley-processing-campus",
      title: "Placeholder investigation: North Valley Processing Campus",
      summary: "Summary",
      location: "North Valley Processing Campus",
      date: "2026-03-09",
      tags: ["placeholder"],
      featured: true
    }
  ]);
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.match(homeGrid.innerHTML, /North Valley Processing Campus/);

  resolvePublicState({ drafts: [], approvedEntities: [], users: [] });
});
