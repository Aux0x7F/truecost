import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceUserLookupController } from "../scripts/features/workspace-user-lookup.js";

test("workspace user lookup prefers local matches, falls back to direct pubkeys, and clears state", async () => {
  const state = {
    publicState: { admins: ["b".repeat(64)] },
    userLookupDebounce: 0,
    userLookupRequestId: 0,
    userLookupQuery: "",
    userLookupResult: null,
    userLookupLoading: false,
    userDirectStatus: ""
  };
  const renders = [];
  let linkedUserCleared = false;
  const controller = createWorkspaceUserLookupController({
    state,
    lookupUsers: async () => [],
    normalizeDirectPubkey: (value) => /^[a-f0-9]{64}$/i.test(String(value || "").trim()) ? String(value || "").trim().toLowerCase() : "",
    publicStateHasAdminPubkey: (publicState, pubkey) => (publicState.admins || []).includes(pubkey),
    renderWorkspace: (options) => renders.push(options),
    clearLinkedUser: () => {
      linkedUserCleared = true;
    },
    findLocalUserCandidate: (value) => String(value || "").trim().toLowerCase() === "aux"
      ? { pubkey: "a".repeat(64), username: "aux", displayName: "Aux" }
      : null,
    hydrateLookupCandidate: (user) => ({ ...user, displayName: user.displayName || user.username || "Direct match" })
  });

  await controller.resolve("aux");
  assert.equal(state.userLookupResult?.username, "aux");
  assert.match(state.userDirectStatus, /current roster/);

  await controller.resolve("b".repeat(64));
  assert.equal(state.userLookupResult?.pubkey, "b".repeat(64));
  assert.equal(state.userLookupResult?.isAdmin, true);
  assert.match(state.userDirectStatus, /managed directly/);
  assert.equal(controller.resolveDirectPubkey(), "b".repeat(64));

  controller.clear();
  assert.equal(state.userLookupQuery, "");
  assert.equal(state.userLookupResult, null);
  assert.equal(linkedUserCleared, true);
  assert.ok(renders.length >= 2);
});

test("workspace user lookup surfaces username conflicts in status copy", async () => {
  const state = {
    publicState: { admins: [] },
    userLookupDebounce: 0,
    userLookupRequestId: 0,
    userLookupQuery: "",
    userLookupResult: null,
    userLookupLoading: false,
    userDirectStatus: ""
  };
  const controller = createWorkspaceUserLookupController({
    state,
    lookupUsers: async () => [],
    normalizeDirectPubkey: () => "",
    publicStateHasAdminPubkey: () => false,
    renderWorkspace: () => {},
    clearLinkedUser: () => {},
    findLocalUserCandidate: () => ({
      pubkey: "b".repeat(64),
      username: "",
      claimedUsername: "aux",
      usernameConflict: true,
      displayName: "Aux"
    }),
    hydrateLookupCandidate: (user) => user
  });

  await controller.resolve("aux");
  assert.match(state.userDirectStatus, /conflicting claim/i);
});
