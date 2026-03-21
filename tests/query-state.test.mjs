import test from "node:test";
import assert from "node:assert/strict";

import {
  createQueryState,
  normalizeQuerySlug
} from "../scripts/core/query-state.js";

test("query state notifies only when watched values change", () => {
  let href = "https://example.test/graph.html?focus=animal-agriculture";
  const listeners = new Set();
  const notifications = [];
  const queryState = createQueryState({
    getHref: () => href,
    getSearch: () => new URL(href).search,
    replaceUrl: (url) => {
      href = String(url);
    },
    addPopstateListener: (listener) => listeners.add(listener),
    removePopstateListener: (listener) => listeners.delete(listener)
  });

  const unsubscribe = queryState.subscribe(["focus"], (selection) => {
    notifications.push(selection.focus);
  }, {
    normalizers: {
      focus: normalizeQuerySlug
    }
  });

  assert.deepEqual(notifications, ["animal-agriculture"]);
  assert.equal(queryState.set("focus", "North Valley Foods", { normalize: normalizeQuerySlug }), true);
  assert.deepEqual(notifications, ["animal-agriculture", "north-valley-foods"]);

  const popListener = [...listeners][0];
  href = "https://example.test/graph.html?focus=county-line-logistics-yard";
  popListener();
  assert.deepEqual(notifications, [
    "animal-agriculture",
    "north-valley-foods",
    "county-line-logistics-yard"
  ]);

  assert.equal(queryState.set("focus", "county-line-logistics-yard", { normalize: normalizeQuerySlug }), false);
  unsubscribe();
  queryState.destroy();
});
