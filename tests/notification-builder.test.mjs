import test from "node:test";
import assert from "node:assert/strict";

import { createSiteNotificationBuilder } from "../scripts/core/notification-builders.js";

test("site notification builder composes comment, review, and admin queue notifications", async () => {
  const buildNotifications = createSiteNotificationBuilder({
    deps: {
      publicStateHasAdminPubkey: () => true,
      loadUserSubmissions: async () => [],
      loadSubmissionThread: async () => [],
      loadAdminKeyShare: async () => null,
      loadInboxSubmissions: async () => []
    }
  });

  const notifications = await buildNotifications({
    viewer: { pubkey: "viewer" },
    sessionSecretKeyHex: "secret",
    publicState: {
      admins: ["viewer"],
      comments: [
        {
          id: "reply-1",
          parent_id: "root-1",
          author: "other",
          post_slug: "case-file",
          markdown: "Reply body",
          created_at: 12
        }
      ],
      allComments: [
        { id: "root-1", author: "viewer" },
        {
          id: "reply-1",
          parent_id: "root-1",
          author: "other",
          post_slug: "case-file",
          markdown: "Reply body",
          created_at: 12
        }
      ],
      drafts: [
        {
          slug: "draft-1",
          title: "Draft title",
          status: "candidate",
          created_at: 22,
          revisions: [{ author: "viewer" }],
          _event: { tags: [["review", "approve"]] }
        },
        {
          slug: "page-home",
          content_type: "page",
          page_id: "home",
          status: "candidate",
          created_at: 24,
          revisions: [{ author: "someone-else" }]
        }
      ],
      submissionStatuses: new Map()
    }
  });

  assert.equal(notifications.some((item) => item.id === "comment-reply:reply-1"), true);
  assert.equal(notifications.some((item) => item.id === "draft-review:draft-1:22"), true);
  assert.equal(notifications.some((item) => item.id === "pending-draft:page-home:24"), true);
});
