import test from "node:test";
import assert from "node:assert/strict";

import {
  renderLogPane,
  renderReviewedCard,
  renderReviewCard,
  renderSnapshotSummary
} from "../scripts/surfaces/workspace-review-log.js";

function deps(overrides = {}) {
  return {
    resolveWorkspaceUser: (pubkey) => ({ pubkey, displayName: "Aux", username: "aux" }),
    resolveEntityDisplayValue: (value) => String(value || ""),
    shortKey: (value) => String(value || "").slice(0, 8),
    firstTag: (event, key) => {
      const hit = (event?.tags || []).find((tag) => Array.isArray(tag) && tag[0] === key);
      return hit ? String(hit[1] || "") : "";
    },
    siteKinds: {
      snapshot: 54001,
      snapshotRequest: 54002,
      adminClaim: 54003,
      adminRole: 54004,
      userMod: 54005,
      entity: 54006,
      draft: 54007,
      commentMod: 54008,
      submissionStatus: 54009,
      adminKeyShare: 54010,
      siteKey: 54011
    },
    logKinds: [54001, 54002, 54004, 54006],
    logLabels: {
      54001: "Snapshot",
      54002: "Snapshot request",
      54004: "Admin role change",
      54006: "Entity update"
    },
    ...overrides
  };
}

test("renderSnapshotSummary reports snapshot metadata and review links", () => {
  const markup = renderSnapshotSummary({
    status: "ready",
    generated_at: "2026-03-18T12:00:00Z",
    counts: { posts: 2, entities: 7 },
    git: { branch: "snapshot/test", commit: "abcdef1234567890", pr_url: "https://example.test/pr/1" }
  });

  assert.match(markup, /Latest snapshot/);
  assert.match(markup, /2 posts • 7 entities/);
  assert.match(markup, /snapshot\/test/);
  assert.match(markup, /Open PR/);
});

test("renderReviewCard and renderReviewedCard keep review actions in the shared surface", () => {
  const draft = {
    slug: "yard-audit",
    title: "Yard audit",
    summary: "Investigate warehouse emissions.",
    markdown: "Investigate warehouse emissions in detail.",
    date: "2026-03-18",
    revisionCount: 2,
    entity_refs: ["county-line"],
    status: "revision",
    author: "author-a"
  };

  const pendingMarkup = renderReviewCard(draft, deps());
  const reviewedMarkup = renderReviewedCard(draft);

  assert.match(pendingMarkup, /Ready for review/);
  assert.match(pendingMarkup, /Approve for publish/);
  assert.match(reviewedMarkup, /Revision requested/);
  assert.match(reviewedMarkup, /Open draft/);
});

test("renderLogPane uses shared log routing for audit events", () => {
  const markup = renderLogPane({
    publicState: {
      rawEvents: [
        {
          kind: 54002,
          pubkey: "author-a",
          tags: [["d", "snapshot-1"]]
        },
        {
          kind: 54006,
          pubkey: "author-a",
          tags: [["d", "county-line-yard"]]
        }
      ]
    }
  }, deps());

  assert.match(markup, /Snapshot request/);
  assert.match(markup, /Entity update/);
  assert.match(markup, /admin\.html\?tab=dashboard/);
  assert.match(markup, /admin\.html\?tab=posts/);
});
