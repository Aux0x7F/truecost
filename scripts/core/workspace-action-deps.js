export function renderWorkspaceUserIdentityButton({
  user,
  fallbackPubkey = user?.pubkey || "",
  viewerPubkey = "",
  safeAvatarUrl,
  shortKey,
  escapeAttribute,
  escapeHtml,
  profileInitials
} = {}) {
  const cleanPubkey = String(fallbackPubkey || user?.pubkey || "").trim().toLowerCase();
  const displayName = user?.displayName || user?.username || user?.claimedUsername || shortKey?.(cleanPubkey);
  const avatarUrl = safeAvatarUrl?.(user?.avatarUrl || "");
  const isViewer = cleanPubkey && cleanPubkey === String(viewerPubkey || "").trim().toLowerCase();
  const avatar = avatarUrl
    ? `<span class="workspace-user__avatar workspace-user__avatar--image"><img src="${escapeAttribute?.(avatarUrl)}" alt="${escapeAttribute?.(displayName)}"></span>`
    : `<span class="workspace-user__avatar">${escapeHtml?.(profileInitials?.(displayName))}</span>`;
  return `
    <button class="user-link workspace-user-link${isViewer ? " is-self" : ""}" type="button" data-open-user-modal="${escapeAttribute?.(cleanPubkey)}" data-user-pubkey="${escapeAttribute?.(cleanPubkey)}">
      ${avatar}
      <strong>${escapeHtml?.(displayName)}</strong>
    </button>
  `;
}

export function createWorkspaceActionSurfaceDeps({
  siteKinds,
  sessionView,
  userNeedsCurrentSiteKey,
  userHasUsernameConflict,
  resolveWorkspaceUserKarma,
  formatWorkspaceKarma,
  renderUserIdentityButton,
  escapeHtml,
  escapeAttribute,
  resolveWorkspaceUser,
  safeWorkspaceAvatarUrl,
  safeWorkspaceSocialLinks,
  profileInitials,
  shortKey,
  trimmed,
  commentToneState,
  resolveWorkspaceCommentKarma,
  deriveSubmissionReviewState,
  renderSubmissionStatusTags,
  resolveEntityDisplayValue,
  describeSubmissionAttachment,
  renderLoadingState,
  firstTag
} = {}) {
  return {
    currentUserIsAdmin: () => sessionView?.currentUserIsAdmin?.(),
    currentUserHasInboxAccess: () => sessionView?.currentUserHasInboxAccess?.(),
    userNeedsCurrentSiteKey,
    userHasUsernameConflict,
    resolveWorkspaceUserKarma,
    formatWorkspaceKarma,
    renderUserIdentityButton,
    escapeHtml,
    escapeAttribute,
    workspaceUserStats: () => sessionView?.workspaceUserStats?.(),
    resolveWorkspaceUser,
    safeWorkspaceAvatarUrl,
    safeWorkspaceSocialLinks,
    profileInitials,
    shortKey,
    trimmed,
    commentToneState,
    resolveWorkspaceCommentKarma,
    deriveSubmissionReviewState,
    renderSubmissionStatusTags,
    resolveEntityDisplayValue,
    describeSubmissionAttachment,
    renderLoadingState,
    logKinds: [
      siteKinds.snapshot,
      siteKinds.adminClaim,
      siteKinds.adminRole,
      siteKinds.userMod,
      siteKinds.snapshotRequest,
      siteKinds.entity,
      siteKinds.draft,
      siteKinds.commentMod,
      siteKinds.submissionStatus,
      siteKinds.adminKeyShare,
      siteKinds.siteKey
    ],
    logLabels: {
      [siteKinds.snapshot]: "Snapshot",
      [siteKinds.adminClaim]: "Root admin claim",
      [siteKinds.adminRole]: "Admin role change",
      [siteKinds.userMod]: "User moderation",
      [siteKinds.snapshotRequest]: "Snapshot request",
      [siteKinds.entity]: "Entity update",
      [siteKinds.draft]: "Post update",
      [siteKinds.commentMod]: "Comment moderation",
      [siteKinds.submissionStatus]: "Submission status",
      [siteKinds.adminKeyShare]: "Site key share",
      [siteKinds.siteKey]: "Site key rotation"
    },
    siteKinds,
    firstTag
  };
}
