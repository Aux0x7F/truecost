import test from "node:test";
import assert from "node:assert/strict";

import {
  renderEntityLocationFilterSuggestions,
  renderEntityManagementRail,
  renderEntityPickerResultsMarkup,
  renderLocationResultsMarkup,
  renderSubmissionFilterSuggestions
} from "../scripts/surfaces/workspace-filters.js";

test("workspace filter surfaces render attached search suggestions and rails", () => {
  const workspaceState = {
    entityFilters: { query: "yard", status: "approved", location: "phoenix", author: "aux" },
    entityLocationFilterOpen: true,
    entityLocationFilterHighlight: 0,
    submissionFilters: { query: "status:confirmed" },
    submissionFilterOpen: true,
    submissionFilterHighlight: 0
  };

  const rail = renderEntityManagementRail(workspaceState, {
    escapeHtml: (value) => String(value || ""),
    entityLocationSuggestions: () => ["Phoenix, Arizona"]
  });
  assert.match(rail, /data-entity-filter-query/);
  assert.match(rail, /data-entity-filter-location/);
  assert.match(rail, /data-entity-location-suggestion="Phoenix, Arizona"/);

  const submissionSuggestions = renderSubmissionFilterSuggestions(workspaceState, {
    escapeHtml: (value) => String(value || ""),
    submissionFilterSuggestions: () => ["status:confirmed"]
  });
  assert.match(submissionSuggestions, /data-submission-filter-suggestion="status:confirmed"/);
});

test("workspace picker surfaces keep entity and location result markup out of controllers", () => {
  const entityMarkup = renderEntityPickerResultsMarkup(
    "entityRefs",
    "yard",
    [{ slug: "county-yard", name: "County Yard", location: "Phoenix, Arizona" }],
    {
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  );
  assert.match(entityMarkup, /data-entity-pick="county-yard"/);

  const locationMarkup = renderLocationResultsMarkup(
    "phoenix",
    ["Phoenix, Arizona"],
    {
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  );
  assert.match(locationMarkup, /data-location-pick="Phoenix, Arizona"/);

  const emptyLocationMarkup = renderLocationResultsMarkup("", [], {
    escapeAttribute: (value) => String(value || ""),
    escapeHtml: (value) => String(value || "")
  });
  assert.equal(emptyLocationMarkup, "");

  const locationSuggestions = renderEntityLocationFilterSuggestions(
    {
      entityFilters: { location: "phoenix" },
      entityLocationFilterOpen: true,
      entityLocationFilterHighlight: 0
    },
    {
      escapeHtml: (value) => String(value || ""),
      entityLocationSuggestions: () => ["Phoenix, Arizona"]
    }
  );
  assert.match(locationSuggestions, /data-entity-location-suggestion="Phoenix, Arizona"/);
});
