import test from "node:test";
import assert from "node:assert/strict";

import { createPublicStateStore } from "../scripts/core/public-state-store.js";

function createBaselineState(overrides = {}) {
  return {
    admins: [],
    users: [],
    approvedEntities: [],
    drafts: [],
    allComments: [],
    pendingAdminKeyRequests: [],
    siteInfo: {},
    ...overrides
  };
}

test("public state store hydrates from cache and notifies on digest changes", async () => {
  const cached = createBaselineState({ admins: ["root"] });
  const fresh = createBaselineState({ admins: ["root", "aux"] });
  const notifications = [];

  const store = createPublicStateStore({
    shouldRefresh: () => false,
    deps: {
      getCachedPublicState: () => cached,
      ensureEventToolsLoaded: async () => {},
      startPublicStateRepairPeer: async () => {},
      loadPublicState: async () => fresh,
      publicStateNeedsRepair: () => false,
      requestPublicStateRepair: async () => {},
      rememberPublicState: (value) => value,
      setTimeout: () => 1,
      clearTimeout: () => {}
    }
  });

  store.subscribe((snapshot) => notifications.push(snapshot));

  assert.deepEqual(store.value.admins, ["root"]);
  const result = await store.hydrate({ force: true, reason: "unit-hydrate" });
  assert.equal(result.changed, true);
  assert.deepEqual(store.value.admins, ["root", "aux"]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].reason, "unit-hydrate");
});

test("public state store requests repair through injected transport and schedules follow-up hydrate", async () => {
  const repairCalls = [];
  const scheduled = [];
  const store = createPublicStateStore({
    getSessionSecretKey: async () => "sekret",
    page: "unit-page",
    shouldRefresh: () => false,
    deps: {
      getCachedPublicState: () => createBaselineState(),
      ensureEventToolsLoaded: async () => {},
      startPublicStateRepairPeer: async () => {},
      loadPublicState: async () => createBaselineState(),
      publicStateNeedsRepair: () => true,
      requestPublicStateRepair: async (secretKeyHex, payload) => {
        repairCalls.push({ secretKeyHex, payload });
      },
      rememberPublicState: (value) => value,
      setTimeout: (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
      clearTimeout: () => {}
    }
  });

  const repaired = await store.maybeRequestRepair(createBaselineState({ rawEvents: [{ id: "one" }] }), "unit-repair");
  assert.equal(repaired, true);
  assert.equal(repairCalls.length, 1);
  assert.equal(repairCalls[0].secretKeyHex, "sekret");
  assert.equal(repairCalls[0].payload.page, "unit-page");
  assert.equal(repairCalls[0].payload.reason, "unit-repair");
  assert.equal(scheduled.length, 1);
});

test("public state digest changes when username ownership conflicts change", async () => {
  const cached = createBaselineState({
    users: [
      {
        pubkey: "a".repeat(64),
        username: "aux",
        claimedUsername: "aux",
        usernameConflict: false,
        usernameOwnerPubkey: "a".repeat(64)
      }
    ],
    usernameCollisions: []
  });
  const fresh = createBaselineState({
    users: [
      {
        pubkey: "a".repeat(64),
        username: "aux",
        claimedUsername: "aux",
        usernameConflict: false,
        usernameOwnerPubkey: "a".repeat(64)
      },
      {
        pubkey: "b".repeat(64),
        username: "",
        claimedUsername: "aux",
        usernameConflict: true,
        usernameOwnerPubkey: "a".repeat(64)
      }
    ],
    usernameCollisions: [
      {
        username: "aux",
        owner_pubkey: "a".repeat(64),
        claimant_pubkeys: ["a".repeat(64), "b".repeat(64)],
        conflict: true
      }
    ]
  });
  const store = createPublicStateStore({
    shouldRefresh: () => false,
    deps: {
      getCachedPublicState: () => cached,
      ensureEventToolsLoaded: async () => {},
      startPublicStateRepairPeer: async () => {},
      loadPublicState: async () => fresh,
      publicStateNeedsRepair: () => false,
      requestPublicStateRepair: async () => {},
      rememberPublicState: (value) => value,
      setTimeout: () => 1,
      clearTimeout: () => {}
    }
  });

  const initialDigest = store.digest;
  await store.hydrate({ force: true, reason: "username-conflict" });
  assert.notEqual(store.digest, initialDigest);
});

test("public state digest changes when removed pubkeys change", async () => {
  const cached = createBaselineState({
    users: [{ pubkey: "a".repeat(64), username: "aux" }],
    removedPubkeys: []
  });
  const fresh = createBaselineState({
    users: [{ pubkey: "a".repeat(64), username: "aux" }],
    removedPubkeys: ["b".repeat(64)]
  });
  const store = createPublicStateStore({
    shouldRefresh: () => false,
    deps: {
      getCachedPublicState: () => cached,
      ensureEventToolsLoaded: async () => {},
      startPublicStateRepairPeer: async () => {},
      loadPublicState: async () => fresh,
      publicStateNeedsRepair: () => false,
      requestPublicStateRepair: async () => {},
      rememberPublicState: (value) => value,
      setTimeout: () => 1,
      clearTimeout: () => {}
    }
  });

  const initialDigest = store.digest;
  await store.hydrate({ force: true, reason: "removed-users" });
  assert.notEqual(store.digest, initialDigest);
});

test("public state digest changes when the identity chain changes", async () => {
  const rootPubkey = "a".repeat(64);
  const rotatedPubkey = "b".repeat(64);
  const cached = createBaselineState({
    admins: [rootPubkey],
    identityChain: {
      validLinks: [],
      pendingLinks: [],
      predecessorByPubkey: new Map(),
      successorByPubkey: new Map(),
      canonicalByPubkey: new Map(),
      membersByCanonical: new Map()
    }
  });
  const fresh = createBaselineState({
    admins: [rootPubkey],
    identityChain: {
      validLinks: [{ old_pubkey: rootPubkey, new_pubkey: rotatedPubkey }],
      pendingLinks: [],
      predecessorByPubkey: new Map([[rotatedPubkey, rootPubkey]]),
      successorByPubkey: new Map([[rootPubkey, rotatedPubkey]]),
      canonicalByPubkey: new Map([
        [rootPubkey, rootPubkey],
        [rotatedPubkey, rootPubkey]
      ]),
      membersByCanonical: new Map([[rootPubkey, [rootPubkey, rotatedPubkey]]])
    }
  });
  const store = createPublicStateStore({
    shouldRefresh: () => false,
    deps: {
      getCachedPublicState: () => cached,
      ensureEventToolsLoaded: async () => {},
      startPublicStateRepairPeer: async () => {},
      loadPublicState: async () => fresh,
      publicStateNeedsRepair: () => false,
      requestPublicStateRepair: async () => {},
      rememberPublicState: (value) => value,
      setTimeout: () => 1,
      clearTimeout: () => {}
    }
  });

  const initialDigest = store.digest;
  await store.hydrate({ force: true, reason: "identity-rotation" });
  assert.notEqual(store.digest, initialDigest);
});
