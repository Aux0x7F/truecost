import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCommentVoteToPublicState,
  rankVisibleCommentThreads,
  resolveCommentVoteSummary,
  resolveCurrentVoteForComment
} from "../scripts/core/comment-ranking.js";
import { applyDerivedCommentState } from "../scripts/core/public-state.js";

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

test("comment votes update visible vote state for roots and replies", () => {
  const base = applyDerivedCommentState(buildBaseState(), [
    { id: "evt-c1", post_slug: "post", author: "author-a", markdown: "Root one", parent_id: "", root_id: "", created_at: 1 },
    { id: "evt-r1", post_slug: "post", author: "author-b", markdown: "Reply one", parent_id: "evt-c1", root_id: "evt-c1", created_at: 2 }
  ]);

  const votedRoot = applyCommentVoteToPublicState(base, "evt-c1", "viewer-a", 1);
  assert.equal(resolveCommentVoteSummary(votedRoot, "evt-c1").score, 1);
  assert.equal(resolveCurrentVoteForComment(votedRoot, "evt-c1", "viewer-a"), 1);

  const votedReply = applyCommentVoteToPublicState(votedRoot, "evt-r1", "viewer-a", -1);
  assert.equal(resolveCommentVoteSummary(votedReply, "evt-r1").score, -1);
  assert.equal(resolveCurrentVoteForComment(votedReply, "evt-r1", "viewer-a"), -1);

  const clearedReply = applyCommentVoteToPublicState(votedReply, "evt-r1", "viewer-a", 0);
  assert.equal(resolveCommentVoteSummary(clearedReply, "evt-r1").score, 0);
  assert.equal(resolveCurrentVoteForComment(clearedReply, "evt-r1", "viewer-a"), 0);
});

test("only root comments rerank by karma while replies stay attached in thread order", () => {
  const base = applyDerivedCommentState(buildBaseState(), [
    { id: "evt-c1", post_slug: "post", author: "author-a", markdown: "Root one", parent_id: "", root_id: "", created_at: 1 },
    { id: "evt-c2", post_slug: "post", author: "author-b", markdown: "Root two", parent_id: "", root_id: "", created_at: 2 },
    { id: "evt-r1", post_slug: "post", author: "author-c", markdown: "Reply one", parent_id: "evt-c2", root_id: "evt-c2", created_at: 3 },
    { id: "evt-r2", post_slug: "post", author: "author-d", markdown: "Reply two", parent_id: "evt-c2", root_id: "evt-c2", created_at: 4 }
  ]);

  const initialRoots = rankVisibleCommentThreads(base.commentThreadsByPost.get("post") || [], base, "");
  assert.deepEqual(initialRoots.map((comment) => comment.id), ["evt-c2", "evt-c1"]);

  const rerankedRootsState = applyCommentVoteToPublicState(base, "evt-c1", "viewer-a", 1);
  const rerankedRoots = rankVisibleCommentThreads(rerankedRootsState.commentThreadsByPost.get("post") || [], rerankedRootsState, "");
  assert.deepEqual(rerankedRoots.map((comment) => comment.id), ["evt-c1", "evt-c2"]);

  const replyVotedState = applyCommentVoteToPublicState(rerankedRootsState, "evt-r2", "viewer-a", 1);
  const rerankedAfterReplyVote = rankVisibleCommentThreads(replyVotedState.commentThreadsByPost.get("post") || [], replyVotedState, "");
  assert.deepEqual(rerankedAfterReplyVote.map((comment) => comment.id), ["evt-c1", "evt-c2"]);
  assert.deepEqual(
    (rerankedAfterReplyVote.find((comment) => comment.id === "evt-c2")?.replies || []).map((comment) => comment.id),
    ["evt-r1", "evt-r2"]
  );
  assert.equal(resolveCommentVoteSummary(replyVotedState, "evt-r2").score, 1);
});
