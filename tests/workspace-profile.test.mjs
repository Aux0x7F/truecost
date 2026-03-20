import test from "node:test";
import assert from "node:assert/strict";

import { applyOptimisticWorkspaceProfileUpdate } from "../scripts/core/workspace-profile.js";

test("optimistic workspace profile update rewrites the current session user", () => {
  const publicState = {
    users: [
      {
        pubkey: "a".repeat(64),
        username: "aux",
        claimedUsername: "aux",
        displayName: "Old Name",
        bio: "Old bio",
        socialLinks: ["https://example.com/old"]
      }
    ]
  };

  const nextState = applyOptimisticWorkspaceProfileUpdate(
    publicState,
    { pubkey: "a".repeat(64), username: "aux" },
    {
      displayName: "Aux",
      bio: "Updated bio",
      avatarUrl: "https://example.com/avatar.png",
      avatarBlob: { url: "https://example.com/avatar.png" },
      socialLinks: ["https://example.com/new", ""]
    }
  );

  assert.equal(nextState.users[0].displayName, "Aux");
  assert.equal(nextState.users[0].bio, "Updated bio");
  assert.equal(nextState.users[0].avatarUrl, "https://example.com/avatar.png");
  assert.deepEqual(nextState.users[0].socialLinks, ["https://example.com/new"]);
  assert.equal(publicState.users[0].bio, "Old bio");
});

test("optimistic workspace profile update creates a session user placeholder when missing", () => {
  const nextState = applyOptimisticWorkspaceProfileUpdate(
    { users: [] },
    { pubkey: "b".repeat(64), username: "aux" },
    {
      displayName: "Aux",
      bio: "Fresh profile",
      socialLinks: []
    }
  );

  assert.equal(nextState.users.length, 1);
  assert.equal(nextState.users[0].pubkey, "b".repeat(64));
  assert.equal(nextState.users[0].username, "aux");
  assert.equal(nextState.users[0].displayName, "Aux");
  assert.equal(nextState.users[0].bio, "Fresh profile");
});
