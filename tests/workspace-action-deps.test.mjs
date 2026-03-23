import test from "node:test";
import assert from "node:assert/strict";

import {
  createWorkspaceActionSurfaceDeps,
  renderWorkspaceUserIdentityButton
} from "../scripts/core/workspace-action-deps.js";

test("renderWorkspaceUserIdentityButton marks the signed-in viewer and falls back to initials", () => {
  const markup = renderWorkspaceUserIdentityButton({
    user: {
      pubkey: "abc123",
      username: "aux"
    },
    viewerPubkey: "ABC123",
    safeAvatarUrl: () => "",
    shortKey: (value) => value,
    escapeAttribute: (value) => String(value),
    escapeHtml: (value) => String(value),
    profileInitials: (value) => String(value).slice(0, 1).toUpperCase()
  });

  assert.match(markup, /is-self/);
  assert.match(markup, />A<\/span>/);
  assert.match(markup, /<strong>aux<\/strong>/);
});

test("createWorkspaceActionSurfaceDeps builds workspace action helpers from the session view", () => {
  const siteKinds = {
    snapshot: 1,
    adminClaim: 2,
    adminRole: 3,
    userMod: 4,
    snapshotRequest: 5,
    entity: 6,
    draft: 7,
    commentMod: 8,
    submissionStatus: 9,
    adminKeyShare: 10,
    siteKey: 11
  };
  const deps = createWorkspaceActionSurfaceDeps({
    siteKinds,
    sessionView: {
      currentUserIsAdmin: () => true,
      currentUserHasInboxAccess: () => false,
      workspaceUserStats: () => ({ visible: 2 })
    },
    userNeedsCurrentSiteKey: () => false,
    userHasUsernameConflict: () => false,
    resolveWorkspaceUserKarma: () => 0,
    formatWorkspaceKarma: () => "0",
    renderUserIdentityButton: () => "<button></button>",
    escapeHtml: (value) => String(value),
    escapeAttribute: (value) => String(value),
    resolveWorkspaceUser: () => null,
    safeWorkspaceAvatarUrl: () => "",
    safeWorkspaceSocialLinks: () => [],
    profileInitials: () => "A",
    shortKey: (value) => value,
    trimmed: (value) => String(value || "").trim(),
    commentToneState: () => "",
    resolveWorkspaceCommentKarma: () => 0,
    deriveSubmissionReviewState: () => ({}),
    renderSubmissionStatusTags: () => "",
    resolveEntityDisplayValue: () => "",
    describeSubmissionAttachment: () => "",
    renderLoadingState: () => "",
    firstTag: () => ""
  });

  assert.equal(deps.currentUserIsAdmin(), true);
  assert.equal(deps.currentUserHasInboxAccess(), false);
  assert.deepEqual(deps.workspaceUserStats(), { visible: 2 });
  assert.equal(deps.logLabels[siteKinds.siteKey], "Site key rotation");
  assert.deepEqual(deps.logKinds, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
});
