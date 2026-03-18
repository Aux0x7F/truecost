import SITE from "./site-config.js";
import { buildCommentThreadState } from "../../vendor/nostr-site-support.esm.js";
import { regroupRecordsByKey as regroupComments } from "./comment-utils.js";
import { safeJson } from "./text-utils.js";

export function clonePublicState(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      return value;
    }
  }
  return value;
}

export function isUsablePublicState(publicState) {
  if (!publicState || typeof publicState !== "object") return false;
  if (publicState.connected) return true;
  return Boolean(
    (Array.isArray(publicState.users) && publicState.users.length) ||
      (Array.isArray(publicState.entities) && publicState.entities.length) ||
      (Array.isArray(publicState.drafts) && publicState.drafts.length) ||
      (Array.isArray(publicState.allComments) && publicState.allComments.length) ||
      (Array.isArray(publicState.rawEvents) && publicState.rawEvents.length)
  );
}

export function normalizeAdminPubkeys(publicState) {
  const values = Array.isArray(publicState?.admins) ? publicState.admins : [];
  return dedupeValues(
    values
      .map((value) => {
        if (typeof value === "string") return value;
        if (value && typeof value === "object") return value.pubkey;
        return "";
      })
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

export function publicStateHasAdminPubkey(publicState, pubkey = "") {
  const cleanPubkey = String(pubkey || "").trim().toLowerCase();
  if (!cleanPubkey) return false;
  const rootAdminPubkey = String(publicState?.rootAdminPubkey || SITE.nostr.rootAdminPubkey || "")
    .trim()
    .toLowerCase();
  return normalizeAdminPubkeys(publicState).includes(cleanPubkey) || (rootAdminPubkey && rootAdminPubkey === cleanPubkey);
}

export function normalizePublicState(publicState, previousPublicState) {
  const next = publicState && typeof publicState === "object" ? publicState : null;
  const previous = previousPublicState && typeof previousPublicState === "object" ? previousPublicState : null;
  const source = next || previous;
  if (!source) return publicState;
  const merged = mergePublicState(next, previous);
  if (!isUsablePublicState(merged) && previous) return previous;
  return applyAuthorCommentModeration(merged);
}

export function applyDerivedCommentState(publicState, nextAllComments = null) {
  const source = publicState && typeof publicState === "object" ? publicState : {};
  const rawComments = Array.isArray(nextAllComments)
    ? nextAllComments
    : Array.isArray(source.allComments)
      ? source.allComments
      : [];
  const allComments = rawComments.map((comment) => enrichCommentVoteState(comment, source.commentVotes));
  const visibleComments = allComments.filter((comment) => String(comment?.visibility || "visible").trim().toLowerCase() !== "hidden");
  const hiddenComments = allComments.filter((comment) => String(comment?.visibility || "").trim().toLowerCase() === "hidden");
  const commentsByPost = regroupComments(visibleComments, "post_slug");
  const commentsByAuthor = regroupComments(visibleComments, "author");
  const commentThreadState = buildCommentThreadState(visibleComments);
  const users = Array.isArray(source.users)
    ? source.users.map((user) => ({
        ...user,
        commentCount: (commentsByAuthor.get(user.pubkey) || []).length
      }))
    : [];
  return {
    ...source,
    users,
    allComments,
    comments: visibleComments,
    hiddenComments,
    commentsByPost,
    commentsByAuthor,
    commentIndex: commentThreadState.commentsById,
    commentChildrenByParent: commentThreadState.childrenByParent,
    commentThreadsByPost: commentThreadState.threadsByPost,
    commentOrphansByPost: commentThreadState.orphansByPost,
    metrics: {
      ...(source.metrics || {}),
      commentCount: visibleComments.length,
      hiddenCommentCount: hiddenComments.length
    }
  };
}

function applyAuthorCommentModeration(publicState) {
  const rawEvents = Array.isArray(publicState?.rawEvents) ? publicState.rawEvents : [];
  const allComments = Array.isArray(publicState?.allComments) ? publicState.allComments : [];
  if (!rawEvents.length || !allComments.length) return publicState;

  const commentsById = new Map(allComments.map((comment) => [String(comment.id || "").trim(), comment]));
  const authorModeration = new Map();
  for (const event of rawEvents) {
    if (Number(event?.kind) !== Number(SITE.nostr.kinds.commentMod)) continue;
    const payload = safeJson(event.content);
    const targetId = String(payload?.target_id || firstTag(event, "e") || "").trim();
    const action = String(payload?.action || firstTag(event, "op") || "").trim().toLowerCase();
    if (!targetId || !action) continue;
    const targetComment = commentsById.get(targetId);
    if (!targetComment || String(targetComment.author || "").trim().toLowerCase() !== String(event.pubkey || "").trim().toLowerCase()) continue;
    const prior = authorModeration.get(targetId);
    const next = {
      action: action === "restore" ? "restore" : "hide",
      note: String(payload?.note || "").trim(),
      updated_at: Number(event.created_at || 0) || 0,
      by: String(event.pubkey || "").trim().toLowerCase()
    };
    if (!prior || next.updated_at >= prior.updated_at) authorModeration.set(targetId, next);
  }
  if (!authorModeration.size) return publicState;

  const resolvedComments = allComments.map((comment) => {
    const moderation = authorModeration.get(String(comment.id || "").trim());
    if (!moderation) return { ...comment };
    return {
      ...comment,
      visibility: moderation.action === "hide" ? "hidden" : "visible",
      moderation
    };
  });
  const resolvedById = new Map(resolvedComments.map((comment) => [String(comment.id || "").trim(), comment]));
  const cascadedComments = resolvedComments.map((comment) => {
    const branch = collectCommentAncestors(String(comment.id || "").trim(), resolvedById);
    if (branch.every((branchComment) => String(branchComment?.visibility || "visible") !== "hidden")) {
      return comment;
    }
    return {
      ...comment,
      visibility: "hidden"
    };
  });
  return applyDerivedCommentState(publicState, cascadedComments);
}

function mergePublicState(nextState, previousState) {
  if (!nextState) return previousState;
  if (!previousState) return nextState;
  const merged = {
    ...previousState,
    ...nextState,
    connected: Boolean(nextState.connected || previousState.connected),
    rootAdminPubkey: String(nextState.rootAdminPubkey || previousState.rootAdminPubkey || "").trim()
  };

  merged.metrics = mergeObjects(previousState.metrics, nextState.metrics);
  merged.siteInfo = mergeObjects(previousState.siteInfo, nextState.siteInfo);
  merged.snapshotInfo = mergeObjects(previousState.snapshotInfo, nextState.snapshotInfo);
  merged.admins = normalizeAdminPubkeys({
    admins: [...(previousState.admins || []), ...(nextState.admins || [])]
  });
  merged.rawEvents = mergeRecordsByKey(previousState.rawEvents, nextState.rawEvents, (item) => item?.id, compareRecordsByTime);
  merged.users = mergeRecordsByKey(previousState.users, nextState.users, (item) => item?.pubkey, compareRecordsByTime);
  merged.entities = mergeRecordsByKey(previousState.entities, nextState.entities, (item) => item?.slug, compareRecordsByTime);
  merged.approvedEntities = mergeRecordsByKey(
    previousState.approvedEntities,
    nextState.approvedEntities,
    (item) => item?.slug,
    compareRecordsByTime
  );
  merged.drafts = mergeRecordsByKey(
    previousState.drafts,
    nextState.drafts,
    (item) => item?.id || `${item?.slug || ""}:${item?.created_at || ""}:${item?.status || ""}`,
    compareRecordsByTime
  );
  merged.pendingAdminKeyRequests = mergeRecordsByKey(
    previousState.pendingAdminKeyRequests,
    nextState.pendingAdminKeyRequests,
    (item) => item?.id || `${item?.requester_pubkey || ""}:${item?.site_pubkey || ""}`,
    compareRecordsByTime
  );
  merged.adminKeyShareMetadata = mergeRecordsByKey(
    previousState.adminKeyShareMetadata,
    nextState.adminKeyShareMetadata,
    (item) => `${item?.recipient_pubkey || ""}:${item?.site_pubkey || ""}`,
    compareRecordsByTime
  );
  merged.allComments = mergeRecordsByKey(
    previousState.allComments,
    nextState.allComments,
    (item) => item?.id,
    compareRecordsByTime
  );
  if (!merged.approvedEntities.length && merged.entities.length) {
    merged.approvedEntities = merged.entities.filter((entity) => String(entity?.status || "").trim().toLowerCase() === "approved");
  }
  return applyDerivedCommentState(merged);
}

function mergeRecordsByKey(previousValues, nextValues, keyResolver, sortComparer) {
  const merged = new Map();
  for (const value of Array.isArray(previousValues) ? previousValues : []) {
    const key = String(keyResolver(value) || "").trim().toLowerCase();
    if (!key) continue;
    merged.set(key, cloneValue(value));
  }
  for (const value of Array.isArray(nextValues) ? nextValues : []) {
    const key = String(keyResolver(value) || "").trim().toLowerCase();
    if (!key) continue;
    const existing = merged.get(key);
    merged.set(key, existing ? mergeObjects(existing, value) : cloneValue(value));
  }
  const values = [...merged.values()];
  if (typeof sortComparer === "function") values.sort(sortComparer);
  return values;
}

function mergeObjects(previousValue, nextValue) {
  if (!previousValue || typeof previousValue !== "object") return cloneValue(nextValue);
  if (!nextValue || typeof nextValue !== "object") return cloneValue(previousValue);
  if (Array.isArray(previousValue) || Array.isArray(nextValue)) {
    return dedupeValues([...(Array.isArray(previousValue) ? previousValue : []), ...(Array.isArray(nextValue) ? nextValue : [])]);
  }
  const merged = {
    ...cloneValue(previousValue),
    ...cloneValue(nextValue)
  };
  for (const [key, value] of Object.entries(merged)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = mergeObjects(previousValue?.[key], nextValue?.[key]);
    }
  }
  return merged;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  return value;
}

function dedupeValues(values) {
  const seen = new Set();
  const deduped = [];
  for (const value of Array.isArray(values) ? values : []) {
    const marker = typeof value === "string"
      ? value.trim().toLowerCase()
      : JSON.stringify(value);
    if (!marker || seen.has(marker)) continue;
    seen.add(marker);
    deduped.push(cloneValue(value));
  }
  return deduped;
}

function compareRecordsByTime(left, right) {
  return recordTimestamp(right) - recordTimestamp(left);
}

function recordTimestamp(record) {
  const candidates = [
    record?.created_at,
    record?.updated_at,
    record?.version_ts,
    record?.sharedAt,
    record?.requested_at,
    record?.rotated_at
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = Date.parse(candidate);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return 0;
}

function collectCommentAncestors(commentId, commentsById) {
  const lineage = [];
  let current = commentsById.get(commentId) || null;
  const seen = new Set();
  while (current) {
    const currentId = String(current.id || "").trim();
    if (!currentId || seen.has(currentId)) break;
    seen.add(currentId);
    lineage.push(current);
    const parentId = String(current.parent_id || "").trim();
    current = parentId ? commentsById.get(parentId) || null : null;
  }
  return lineage;
}

function enrichCommentVoteState(comment, commentVotes) {
  const summary = resolveStoredCommentVoteSummary(commentVotes, comment?.id);
  return {
    ...comment,
    score: summary.score,
    upvoteCount: summary.upvoteCount,
    downvoteCount: summary.downvoteCount
  };
}

function resolveStoredCommentVoteSummary(commentVotes, commentId) {
  const key = String(commentId || "").trim();
  const summary = commentVotes instanceof Map ? commentVotes.get(key) : null;
  return summary || {
    score: 0,
    upvoteCount: 0,
    downvoteCount: 0
  };
}

function firstTag(event, key) {
  const tag = (event?.tags || []).find((item) => Array.isArray(item) && item[0] === key);
  return String(tag?.[1] || "");
}
