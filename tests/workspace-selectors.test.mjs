import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceSelectorController } from "../scripts/core/workspace-selectors.js";
import { collectWorkspaceUsers, filterVisibleWorkspaceUsers } from "../scripts/core/workspace-data.js";

test("workspace selector controller hydrates lookup candidates and derives location suggestions", () => {
  const state = {
    publicState: {
      users: [{ pubkey: "known-pubkey", username: "aux", displayName: "Auxiliary" }],
      entities: [
        { slug: "county-yard", location: "Phoenix, Arizona", author_pubkey: "known-pubkey" },
        { slug: "north-valley", location: "North Valley, CA", author_pubkey: "other-pubkey" }
      ]
    },
    userLookupQuery: "",
    userFilters: { karma: "" },
    entityFilters: { location: "pho", status: "", query: "", author: "" }
  };
  const controller = createWorkspaceSelectorController({
    state,
    deps: {
      buildEntityLocationFilterValues: (entities) => entities.map((entity) => entity.location),
      buildWorkspaceUserStats: () => ({ total: 1, active: 1, karmaBuckets: {} }),
      dedupe: (values) => [...new Set(values)],
      filterVisibleWorkspaceEntities: ({ publicState }) => publicState.entities,
      filterVisibleWorkspaceUsers: ({ publicState }) => publicState.users,
      findLocalUserCandidate: (value, { users }) =>
        users.find((user) => user.username === String(value || "").trim().toLowerCase()) || null,
      normalizeUsername: (value) => String(value || "").trim().toLowerCase(),
      publicStateHasAdminPubkey: (_publicState, pubkey) => pubkey === "known-pubkey",
      resolveWorkspaceSitePubkey: () => "site-pubkey",
      resolveWorkspaceUser: (pubkey) => state.publicState.users.find((user) => user.pubkey === pubkey) || null,
      resolveWorkspaceUserKarma: () => 0,
      shortKey: (value) => `short:${value}`
    }
  });

  const local = controller.findLocalUserCandidate("aux");
  assert.equal(local.displayName, "Auxiliary");
  assert.equal(local.isAdmin, true);
  assert.deepEqual(controller.entityLocationSuggestions(), ["Phoenix, Arizona"]);

  controller.applyEntityLocationSuggestion("North Valley, CA");
  assert.equal(state.entityFilters.location, "North Valley, CA");
  assert.equal(state.entityLocationFilterOpen, false);
  assert.equal(state.entityLocationFilterHighlight, -1);
});

test("workspace user filtering hides removed users by default and shows them when role=removed", () => {
  const publicState = {
    users: [
      { pubkey: "admin-pubkey", username: "aux", displayName: "Aux", isAdmin: true, commentCount: 1, submissionCount: 0 },
      { pubkey: "member-pubkey", username: "field", displayName: "Field", isAdmin: false, commentCount: 1, submissionCount: 0 },
      { pubkey: "moderated-removed", username: "gone", displayName: "Gone", moderation: { action: "removed" } }
    ],
    removedUsers: [
      { pubkey: "removed-pubkey", claimedUsername: "ghost", displayName: "Ghost" }
    ]
  };

  let visible = filterVisibleWorkspaceUsers({
    publicState,
    query: "",
    karmaBucket: "",
    role: "",
    resolveWorkspaceUserKarma: () => 0,
    karmaBucketMatches: () => true
  });
  assert.deepEqual(visible.map((user) => user.pubkey), ["admin-pubkey", "member-pubkey"]);

  visible = filterVisibleWorkspaceUsers({
    publicState,
    query: "",
    karmaBucket: "",
    role: "removed",
    resolveWorkspaceUserKarma: () => 0,
    karmaBucketMatches: () => true
  });
  assert.deepEqual(visible.map((user) => user.pubkey).sort(), ["moderated-removed", "removed-pubkey"]);
  assert.equal(visible.every((user) => user.removed), true);
});

test("workspace user collection keeps sparse activity-only users visible", () => {
  const users = collectWorkspaceUsers({
    admins: ["a".repeat(64)],
    allComments: [{ id: "c1", author: "b".repeat(64), markdown: "Comment" }],
    submissionCountByAuthor: new Map([["c".repeat(64), 2]])
  });

  assert.deepEqual(
    users.map((user) => user.pubkey).sort(),
    ["a".repeat(64), "b".repeat(64), "c".repeat(64)].sort()
  );
  assert.equal(users.find((user) => user.pubkey === "a".repeat(64))?.isAdmin, true);
  assert.equal(users.find((user) => user.pubkey === "b".repeat(64))?.commentCount, 1);
  assert.equal(users.find((user) => user.pubkey === "c".repeat(64))?.submissionCount, 2);
});
