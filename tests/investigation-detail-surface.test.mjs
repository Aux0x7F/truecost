import test from "node:test";
import assert from "node:assert/strict";

import {
  cloneInvestigationPost,
  investigationDocumentId,
  mergeInvestigationPostOverlay,
  normalizeLiveArray
} from "../scripts/surfaces/investigation-detail.js";

test("investigationDocumentId normalizes slugs through the shared cleaner", () => {
  assert.equal(investigationDocumentId("  My Draft / Title  "), "investigation:my-draft-title");
});

test("mergeInvestigationPostOverlay applies live body, tags, refs, and records without mutating the base post", () => {
  const base = {
    title: "Base",
    body: "Base body",
    markdown: "Base body",
    tags: ["old"],
    entity_refs: ["entity-a"],
    records: [{ label: "old" }]
  };
  const merged = mergeInvestigationPostOverlay(base, {
    markdown: "Live body",
    tags: [" one ", "", "two"],
    entity_refs: [" entity-b "],
    records: [{ label: "new" }]
  });

  assert.equal(merged.body, "Live body");
  assert.deepEqual(merged.tags, ["one", "two"]);
  assert.deepEqual(merged.entity_refs, ["entity-b"]);
  assert.deepEqual(merged.records, [{ label: "new" }]);
  assert.deepEqual(base.records, [{ label: "old" }]);
});

test("normalizeLiveArray trims and drops empty values", () => {
  assert.deepEqual(normalizeLiveArray([" one ", "", null, "two"]), ["one", "two"]);
});

test("cloneInvestigationPost deep-clones nested content", () => {
  const original = { records: [{ label: "x" }] };
  const cloned = cloneInvestigationPost(original);
  cloned.records[0].label = "y";
  assert.equal(original.records[0].label, "x");
});
