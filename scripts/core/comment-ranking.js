import { applyDerivedCommentState } from "./public-state.js";

export function emptyCommentVoteSummary() {
  return {
    score: 0,
    upvoteCount: 0,
    downvoteCount: 0,
    byPubkey: new Map()
  };
}

export function resolveCommentVoteSummary(publicState, commentId) {
  const summary = publicState?.commentVotes instanceof Map
    ? publicState.commentVotes.get(String(commentId || "").trim())
    : null;
  return summary || emptyCommentVoteSummary();
}

export function resolveCurrentVoteForComment(publicState, commentId, viewerPubkey) {
  const cleanViewer = String(viewerPubkey || "").trim().toLowerCase();
  if (!cleanViewer) return 0;
  const summary = resolveCommentVoteSummary(publicState, commentId);
  return summary.byPubkey instanceof Map
    ? Number(summary.byPubkey.get(cleanViewer) || 0) || 0
    : 0;
}

export function rankVisibleCommentThreads(nodes, publicState, viewerPubkey = "") {
  return (Array.isArray(nodes) ? nodes : []).slice().sort((left, right) => {
    const leftOwn = Boolean(viewerPubkey) && left?.author === viewerPubkey;
    const rightOwn = Boolean(viewerPubkey) && right?.author === viewerPubkey;
    if (leftOwn !== rightOwn) return leftOwn ? -1 : 1;
    const leftVotes = resolveCommentVoteSummary(publicState, left?.id);
    const rightVotes = resolveCommentVoteSummary(publicState, right?.id);
    if (leftVotes.score !== rightVotes.score) return rightVotes.score - leftVotes.score;
    if (leftVotes.upvoteCount !== rightVotes.upvoteCount) return rightVotes.upvoteCount - leftVotes.upvoteCount;
    const leftTime = Number(left?.created_at || 0);
    const rightTime = Number(right?.created_at || 0);
    if (leftTime !== rightTime) return rightTime - leftTime;
    return String(left?.id || "").localeCompare(String(right?.id || ""));
  });
}

export function commentAffectsThreadRanking(publicState, commentId) {
  const cleanId = String(commentId || "").trim();
  if (!cleanId || !(publicState?.commentIndex instanceof Map)) return false;
  const comment = publicState.commentIndex.get(cleanId) || null;
  return Boolean(comment) && !String(comment?.parent_id || "").trim();
}

export function applyCommentVoteToPublicState(publicState, commentId, viewerPubkey, nextValue) {
  const cleanId = String(commentId || "").trim();
  const cleanViewer = String(viewerPubkey || "").trim().toLowerCase();
  if (!cleanId || !cleanViewer || !publicState) return publicState;
  const commentVotes = publicState.commentVotes instanceof Map
    ? new Map(publicState.commentVotes)
    : new Map();
  const existing = resolveCommentVoteSummary(publicState, cleanId);
  const byPubkey = new Map(existing.byPubkey instanceof Map ? existing.byPubkey : []);
  const currentValue = Number(byPubkey.get(cleanViewer) || 0) || 0;
  const summary = {
    score: Number(existing.score || 0) || 0,
    upvoteCount: Number(existing.upvoteCount || 0) || 0,
    downvoteCount: Number(existing.downvoteCount || 0) || 0,
    byPubkey
  };

  if (currentValue > 0) {
    summary.score -= 1;
    summary.upvoteCount = Math.max(0, summary.upvoteCount - 1);
  } else if (currentValue < 0) {
    summary.score += 1;
    summary.downvoteCount = Math.max(0, summary.downvoteCount - 1);
  }

  if (nextValue > 0) {
    summary.score += 1;
    summary.upvoteCount += 1;
    byPubkey.set(cleanViewer, 1);
  } else if (nextValue < 0) {
    summary.score -= 1;
    summary.downvoteCount += 1;
    byPubkey.set(cleanViewer, -1);
  } else {
    byPubkey.delete(cleanViewer);
  }

  commentVotes.set(cleanId, summary);
  return applyDerivedCommentState({
    ...publicState,
    commentVotes
  });
}
