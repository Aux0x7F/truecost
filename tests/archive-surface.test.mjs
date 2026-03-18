import test from "node:test";
import assert from "node:assert/strict";

import {
  archiveFilterSuggestions,
  archiveHasActiveFilters,
  archiveStatusLabel,
  filterArchiveEntries,
  getCurrentArchiveFilters
} from "../scripts/surfaces/archive.js";

const publicState = {
  users: [
    { pubkey: "author-a", username: "aux", displayName: "Aux" },
    { pubkey: "author-b", username: "fieldnotes", displayName: "Field Notes" }
  ],
  approvedEntities: [
    { slug: "county-line", name: "County Line Logistics Yard", location: "Phoenix, Arizona" },
    { slug: "mesa-terminal", name: "Mesa Terminal", location: "Mesa, Arizona" }
  ]
};

const entries = [
  {
    slug: "one",
    title: "One",
    author: "author-a",
    archiveStatus: "posted",
    tags: ["freight", "phoenix"],
    entity_refs: ["county-line"],
    body: "Body"
  },
  {
    slug: "two",
    title: "Two",
    author: "author-b",
    archiveStatus: "draft",
    tags: ["rail", "mesa"],
    entity_refs: ["mesa-terminal"],
    body: "Body"
  }
];

test("archive filters parse and report active state", () => {
  const filters = getCurrentArchiveFilters("?tag=freight&entity=county&status=posted&author=aux", true);
  assert.deepEqual(filters, {
    tag: "freight",
    entity: "county",
    status: "posted",
    author: "aux"
  });
  assert.equal(archiveHasActiveFilters(filters), true);
  assert.equal(archiveHasActiveFilters({ tag: "", entity: "", status: "", author: "" }), false);
  assert.equal(archiveStatusLabel("submitted"), "In review");
});

test("archive entry filtering respects status, tag, entity, and author labels", () => {
  const filtered = filterArchiveEntries(entries, publicState, {
    tag: "freight",
    entity: "county line",
    status: "posted",
    author: "aux"
  });
  assert.deepEqual(filtered.map((entry) => entry.slug), ["one"]);
});

test("archive suggestions stay scoped to the active field query", () => {
  const tagSuggestions = archiveFilterSuggestions("tag", entries, publicState, {
    tag: "ph",
    entity: "",
    status: "",
    author: ""
  });
  assert.deepEqual(tagSuggestions.matching, ["phoenix"]);

  const entitySuggestions = archiveFilterSuggestions("entity", entries, publicState, {
    tag: "",
    entity: "mesa",
    status: "",
    author: ""
  });
  assert.deepEqual(entitySuggestions.matching, ["mesa-terminal", "Mesa Terminal", "Mesa, Arizona"]);
});
