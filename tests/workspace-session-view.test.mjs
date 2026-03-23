import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceSessionView } from "../scripts/core/workspace-session-view.js";

test("workspace session view derives stale and conflict messaging from session identity", () => {
  const view = createWorkspaceSessionView({
    state: {
      session: { username: "aux" },
      sessionIdentity: {
        staleKey: true,
        staleSession: { claimedUsername: "aux" },
        usernameConflict: true,
        usernameIntegrity: {
          conflict: true,
          claimedUsername: "aux",
          ownerPubkey: "owner-pubkey"
        }
      }
    },
    tabs: {
      currentUser: () => ({ pubkey: "aux-pubkey" }),
      currentUserIsAdmin: () => true,
      currentUserHasInboxAccess: () => true,
      currentUserPendingKeyRequest: () => ({ id: "pending" })
    },
    selectors: {
      visibleWorkspaceUsers: () => [{ pubkey: "aux-pubkey" }],
      workspaceUserStats: () => ({ total: 1, visible: 1, removed: 0, admins: 1 }),
      visibleWorkspaceEntities: () => [{ slug: "animal-agriculture" }]
    }
  });

  assert.equal(view.currentUser()?.pubkey, "aux-pubkey");
  assert.equal(view.currentUserIsAdmin(), true);
  assert.equal(view.currentUserHasInboxAccess(), true);
  assert.equal(view.currentUserPendingKeyRequest()?.id, "pending");
  assert.match(view.currentStaleSessionMessage(), /older password/i);
  assert.match(view.currentSessionUsernameConflictMessage(), /already claimed/i);
  assert.equal(view.visibleWorkspaceUsers().length, 1);
  assert.equal(view.visibleWorkspaceEntities().length, 1);
  assert.deepEqual(view.workspaceUserStats(), { total: 1, visible: 1, removed: 0, admins: 1 });
});
