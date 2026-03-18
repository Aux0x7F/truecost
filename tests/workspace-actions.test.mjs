import test from "node:test";
import assert from "node:assert/strict";

import {
  renderLookupCandidate,
  renderSubmissionCard,
  renderUserCard
} from "../scripts/surfaces/workspace-actions.js";

function deps() {
  return {
    currentUserIsAdmin: () => true,
    userNeedsCurrentSiteKey: () => false,
    resolveWorkspaceUserKarma: () => 12,
    formatWorkspaceKarma: (value) => String(value || 0),
    renderUserIdentityButton: (user) => `<button>${user.displayName || user.username || user.pubkey}</button>`,
    escapeHtml: (value) => String(value || ""),
    escapeAttribute: (value) => String(value || ""),
    workspaceUserStats: () => ({ total: 1, active: 1, karmaBuckets: {} }),
    resolveWorkspaceUser: (pubkey) => ({ pubkey, displayName: "Author", username: "author" }),
    trimmed: (value) => String(value || ""),
    deriveSubmissionReviewState: () => ({ viewerConfirmed: false, confirmCount: 0 }),
    renderSubmissionStatusTags: () => '<span class="tag">Unconfirmed</span>',
    resolveEntityDisplayValue: (value) => value,
    describeSubmissionAttachment: (attachment) => attachment?.type || "file"
  };
}

test("renderUserCard keeps roster actions inside the workspace action surface", () => {
  const markup = renderUserCard(
    {
      pubkey: "user-1",
      username: "author",
      displayName: "Author",
      submissionCount: 2,
      commentCount: 3,
      isAdmin: false
    },
    { publicState: { rootAdminPubkey: "root" }, viewer: { pubkey: "viewer" } },
    deps()
  );

  assert.match(markup, /Take action/);
  assert.match(markup, /2 submissions/);
  assert.match(markup, /Karma 12/);
});

test("renderLookupCandidate stays action-oriented without duplicating roster logic", () => {
  const markup = renderLookupCandidate(
    {
      userLookupResult: {
        pubkey: "user-1",
        username: "author",
        displayName: "Author",
        isAdmin: false
      },
      viewer: { pubkey: "viewer" },
      publicState: { rootAdminPubkey: "root" }
    },
    deps()
  );

  assert.match(markup, /Take action/);
  assert.match(markup, /member/);
});

test("renderSubmissionCard keeps submission controls in the action surface", () => {
  const markup = renderSubmissionCard(
    {
      id: "submission-1",
      author: "user-1",
      latest: {
        payload: {
          subject: "Lead",
          location: "Phoenix",
          details: "Details",
          entity_refs: ["county-line"],
          attachment: { type: "pdf" }
        }
      }
    },
    { publicState: { submissionStatuses: new Map() } },
    deps()
  );

  assert.match(markup, /View/);
  assert.match(markup, /Confirm/);
  assert.match(markup, /Delete/);
  assert.match(markup, /Attachments: pdf/);
});
