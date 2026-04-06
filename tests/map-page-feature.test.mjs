import test from "node:test";
import assert from "node:assert/strict";

import { createMapPageFeature } from "../scripts/features/map-page.js";

test("map page feature only exposes entities with coordinates and falls back to static approved entities", async () => {
  class FakeElement {
    constructor() {
      this.innerHTML = "";
    }
  }

  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    querySelector(selector) {
      return {
        "[data-map-list]": list,
        "[data-map-canvas]": canvas,
        "[data-map-shell]": shell
      }[selector] || null;
    }
  };

  const list = new FakeElement();
  const canvas = new FakeElement();
  const shell = new FakeElement();

  const feature = createMapPageFeature({
    state: { publicState: { approvedEntities: [] }, map: null, mapCanvas: null, lastGoodMapEntities: [] },
    postsStore: { load: async () => [] },
    getPublicState: async () => ({
      approvedEntities: [
        { slug: "no-coords", name: "No Coords", location: "Phoenix", status: "approved" }
      ]
    }),
    loadStaticEntities: async () => ([
      { slug: "north-valley", name: "North Valley", location: "Phoenix", lat: 33.4, lng: -112.07, status: "approved" },
      { slug: "no-coords", name: "No Coords", location: "Phoenix", status: "approved" }
    ]),
    queryState: null,
    cleanSlug: (value) => String(value || "").trim().toLowerCase(),
    collectEntityRefsFromText: () => [],
    renderLeafletMapSurface: () => {},
    bindMapEntityCards: () => {},
    scheduleLeafletFocus: () => {},
    renderMapPageSurface: (target) => {
      target.innerHTML = "rendered";
    },
    renderError: () => {},
    renderLoadingState: (message) => message
  });

  const visible = feature.visibleMapEntities(
    { approvedEntities: [{ slug: "missing-coords", name: "Missing Coords", status: "approved" }] },
    [{ slug: "north-valley", name: "North Valley", lat: 33.4, lng: -112.07, status: "approved" }]
  );

  assert.deepEqual(visible.map((entity) => entity.slug), ["north-valley"]);

  await feature.mount();
  assert.equal(list.innerHTML, "rendered");
});

