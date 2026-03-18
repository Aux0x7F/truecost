import test from "node:test";
import assert from "node:assert/strict";

import { applyDerivedCommentState, normalizePublicState } from "../scripts/core/public-state.js";

function buildBaseState() {
  return {
    users: [],
    metrics: {},
    commentVotes: new Map(),
    allComments: [],
    commentsByPost: new Map(),
    commentsByAuthor: new Map(),
    rawEvents: []
  };
}

test("stale refresh does not flatten or drop later optimistic replies", () => {
  const optimistic = applyDerivedCommentState(buildBaseState(), [
    { id: "evt-c1", id_event: "evt-c1", post_slug: "post", author: "u", markdown: "Test 1", parent_id: "", root_id: "", created_at: 1 },
    { id: "evt-r1", id_event: "evt-r1", post_slug: "post", author: "u", markdown: "Test 1 2", parent_id: "evt-c1", root_id: "evt-c1", created_at: 2 },
    { id: "evt-c2", id_event: "evt-c2", post_slug: "post", author: "u", markdown: "Test 2", parent_id: "", root_id: "", created_at: 3 },
    { id: "evt-r2", id_event: "evt-r2", post_slug: "post", author: "u", markdown: "Test 2 2", parent_id: "evt-c2", root_id: "evt-c2", created_at: 4 }
  ]);

  const staleRemote = applyDerivedCommentState(buildBaseState(), [
    { id: "evt-c1", id_event: "evt-c1", post_slug: "post", author: "u", markdown: "Test 1", parent_id: "", root_id: "", created_at: 1 },
    { id: "evt-r1", id_event: "evt-r1", post_slug: "post", author: "u", markdown: "Test 1 2", parent_id: "evt-c1", root_id: "evt-c1", created_at: 2 },
    { id: "evt-c2", id_event: "evt-c2", post_slug: "post", author: "u", markdown: "Test 2", parent_id: "", root_id: "", created_at: 3 }
  ]);

  const merged = normalizePublicState(staleRemote, optimistic);
  const threads = merged.commentThreadsByPost.get("post") || [];

  assert.deepEqual(threads.map((comment) => comment.id), ["evt-c1", "evt-c2"]);
  assert.deepEqual((threads[0]?.replies || []).map((comment) => comment.id), ["evt-r1"]);
  assert.deepEqual((threads[1]?.replies || []).map((comment) => comment.id), ["evt-r2"]);
});
