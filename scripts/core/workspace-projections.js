import { cleanSlug } from "./nostr.js";

export function resolveWorkspaceUser(publicState, pubkey) {
  const cleanPubkey = String(pubkey || "").trim().toLowerCase();
  return (publicState?.users || []).find((user) => user.pubkey === cleanPubkey) || null;
}

export function resolveWorkspaceCommentKarma(publicState, commentOrId) {
  const commentId =
    typeof commentOrId === "string"
      ? String(commentOrId || "").trim()
      : String(commentOrId?.id || "").trim();
  if (!commentId) return 0;
  const summary = publicState?.commentVotes instanceof Map
    ? publicState.commentVotes.get(commentId)
    : null;
  return Number(summary?.score || commentOrId?.score || 0) || 0;
}

export function resolveWorkspaceUserKarma(publicState, pubkey) {
  const cleanPubkey = String(pubkey || "").trim().toLowerCase();
  if (!cleanPubkey) return 0;
  const comments = publicState?.commentsByAuthor instanceof Map
    ? publicState.commentsByAuthor.get(cleanPubkey) || []
    : [];
  return comments.reduce((total, comment) => total + resolveWorkspaceCommentKarma(publicState, comment), 0);
}

export function userNeedsCurrentSiteKey({ user, publicState, siteKeyShare, activeSitePubkey = "" } = {}) {
  const targetPubkey = String(user?.pubkey || "").trim().toLowerCase();
  const sitePubkey = String(activeSitePubkey || "").trim().toLowerCase();
  if (!targetPubkey || !sitePubkey || !user?.isAdmin || !siteKeyShare) return false;
  return !(publicState?.adminKeyShareMetadata || []).some(
    (share) => share.recipient_pubkey === targetPubkey && share.site_pubkey === sitePubkey
  );
}

export function resolveEntityByNameOrSlug(publicState, value) {
  const clean = String(value || "").trim().toLowerCase();
  return (publicState?.approvedEntities || []).find(
    (entity) => entity.slug === cleanSlug(clean) || entity.name.toLowerCase() === clean
  ) || null;
}

export function resolveEntityDisplayValue(publicState, value) {
  const entity = resolveEntityByNameOrSlug(publicState, value);
  return entity?.name || String(value || "");
}

export function renderSubmissionStatusTags(reviewState) {
  const tags = [];
  if (reviewState.confirmCount) tags.push(`<span class="tag">Confirmed${reviewState.confirmCount > 1 ? ` (${reviewState.confirmCount})` : ""}</span>`);
  else tags.push(`<span class="tag">Unconfirmed</span>`);
  if (reviewState.viewedCount) tags.push(`<span class="tag">${reviewState.viewedCount > 1 ? `${reviewState.viewedCount} viewed` : "Viewed"}</span>`);
  else tags.push(`<span class="tag">Unviewed</span>`);
  return tags.join("");
}

export function describeSubmissionAttachment(attachment) {
  const type = String(attachment?.type || "").trim();
  const name = String(attachment?.name || "").trim();
  if (name && type) return `${name} • ${type}`;
  return name || type || "Encrypted file";
}

export function renderSiteKeyShareStatus({
  siteKeyShare = null,
  siteKeyShares = [],
  pendingKeyRequest = null,
  keyRequestState = ""
} = {}) {
  if (siteKeyShare) {
    const olderCount = Math.max(0, siteKeyShares.length - 1);
    return olderCount
      ? `This account can read new private submissions and ${olderCount} older encrypted record${olderCount === 1 ? "" : "s"}.`
      : "This account can read new private submissions.";
  }
  if (pendingKeyRequest || keyRequestState === "pending") {
    return "This account is waiting for the current shared inbox key.";
  }
  if (siteKeyShares.length) {
    return "This account has older inbox keys, but not the current one yet.";
  }
  return "Waiting for shared inbox access.";
}
