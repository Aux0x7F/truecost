import test from "node:test";
import assert from "node:assert/strict";

import { renderSearchSuggestions } from "../scripts/core/search-controls.js";

test("renderSearchSuggestions uses attached autocomplete rows by default", () => {
  const markup = renderSearchSuggestions({
    isOpen: true,
    query: "phoenix",
    items: ["Phoenix, Arizona"],
    renderPrimary: (value) => `<strong>${value}</strong>`
  });

  assert.match(markup, /workspace-search__option/);
  assert.doesNotMatch(markup, /picker-chip/);
});
