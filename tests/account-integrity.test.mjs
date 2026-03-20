import test from "node:test";
import assert from "node:assert/strict";

import {
  assertNetworkSessionUsernameIntegrity,
  assertSessionUsernameIntegrity,
  buildRemovedAccountMessage,
  buildUsernameLoginMismatchMessage,
  buildUsernameConflictMessage,
  clearCachedSessionUsernameIntegrity,
  currentSessionUsernameConflictMessage,
  inspectUsernameClaim,
  isRemovedAccountError,
  isUsernameConflictError,
  readCachedSessionUsernameIntegrity,
  resolveRemovedSessionAccount,
  resolveNextAvailableUsername,
  resolveSessionUsernameConflict,
  sessionHasUsernameConflict
} from "../scripts/core/account-integrity.js";

test("session username integrity accepts the canonical owner and rejects newer claimants", () => {
  const publicState = {
    connected: true,
    syncInfo: { remoteEventCount: 2, cachedEventCount: 0, mergedEventCount: 2 },
    usernameRegistry: [
      {
        username: "aux",
        owner_pubkey: "a".repeat(64),
        claimant_pubkeys: ["a".repeat(64), "b".repeat(64)],
        conflict: true
      }
    ],
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
    ]
  };

  assert.equal(sessionHasUsernameConflict(publicState, { username: "aux", pubkey: "a".repeat(64) }), false);
  assert.equal(sessionHasUsernameConflict(publicState, { username: "aux", pubkey: "b".repeat(64) }), true);

  assert.doesNotThrow(() => {
    assertSessionUsernameIntegrity(publicState, { username: "aux", pubkey: "a".repeat(64) });
  });
  assert.throws(() => {
    assertSessionUsernameIntegrity(publicState, { username: "aux", pubkey: "b".repeat(64) }, { action: "publish a submission" });
  }, /already claimed/);
});

test("session username integrity accepts a rotated pubkey when it belongs to the canonical owner chain", () => {
  const rootPubkey = "a".repeat(64);
  const rotatedPubkey = "c".repeat(64);
  const publicState = {
    connected: true,
    syncInfo: { remoteEventCount: 3, cachedEventCount: 0, mergedEventCount: 3 },
    identityChain: {
      validLinks: [{ old_pubkey: rootPubkey, new_pubkey: rotatedPubkey }],
      pendingLinks: [],
      predecessorByPubkey: new Map([[rotatedPubkey, rootPubkey]]),
      successorByPubkey: new Map([[rootPubkey, rotatedPubkey]]),
      canonicalByPubkey: new Map([
        [rootPubkey, rootPubkey],
        [rotatedPubkey, rootPubkey]
      ]),
      membersByCanonical: new Map([[rootPubkey, [rootPubkey, rotatedPubkey]]]),
      headByCanonical: new Map([[rootPubkey, rotatedPubkey]]),
      currentByPubkey: new Map([
        [rootPubkey, rotatedPubkey],
        [rotatedPubkey, rotatedPubkey]
      ])
    },
    usernameRegistry: [
      {
        username: "aux",
        owner_pubkey: rootPubkey,
        claimant_pubkeys: [rootPubkey, rotatedPubkey],
        conflict: true
      }
    ],
    users: [
      {
        pubkey: rootPubkey,
        username: "aux",
        claimedUsername: "aux",
        usernameConflict: false,
        usernameOwnerPubkey: rootPubkey
      }
    ]
  };

  assert.equal(sessionHasUsernameConflict(publicState, { username: "aux", pubkey: rotatedPubkey }), false);
});

test("session username integrity rejects an older rotated key as stale", async () => {
  const originalPubkey = "a".repeat(64);
  const currentPubkey = "c".repeat(64);
  const publicState = {
    connected: true,
    syncInfo: { remoteEventCount: 3, cachedEventCount: 0, mergedEventCount: 3 },
    identityChain: {
      validLinks: [{ old_pubkey: originalPubkey, new_pubkey: currentPubkey }],
      pendingLinks: [],
      predecessorByPubkey: new Map([[currentPubkey, originalPubkey]]),
      successorByPubkey: new Map([[originalPubkey, currentPubkey]]),
      canonicalByPubkey: new Map([
        [originalPubkey, originalPubkey],
        [currentPubkey, originalPubkey]
      ]),
      membersByCanonical: new Map([[originalPubkey, [originalPubkey, currentPubkey]]]),
      headByCanonical: new Map([[originalPubkey, currentPubkey]]),
      currentByPubkey: new Map([
        [originalPubkey, currentPubkey],
        [currentPubkey, currentPubkey]
      ])
    },
    usernameRegistry: [
      {
        username: "aux",
        owner_pubkey: originalPubkey,
        claimant_pubkeys: [originalPubkey, currentPubkey],
        conflict: false
      }
    ],
    users: [
      {
        pubkey: currentPubkey,
        username: "aux",
        claimedUsername: "aux",
        usernameConflict: false,
        usernameOwnerPubkey: originalPubkey
      }
    ]
  };

  assert.throws(
    () => assertSessionUsernameIntegrity(publicState, { username: "aux", pubkey: originalPubkey }, { action: "open this account" }),
    /older password/
  );

  await assert.rejects(
    assertNetworkSessionUsernameIntegrity(publicState, { username: "aux", pubkey: originalPubkey }, {
      action: "open this account",
      lookupUsers: async () => [
        {
          pubkey: currentPubkey,
          username: "aux",
          claimedUsername: "aux",
          usernameConflict: false
        }
      ],
      requireLookup: true
    }),
    /older password/
  );
});

test("network-backed username integrity rejects an older password from local account history before lookup", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
  storage.set(
    "truecost.v2.account-history",
    JSON.stringify({
      aux: {
        username: "aux",
        currentPubkey: "c".repeat(64),
        knownPubkeys: ["a".repeat(64), "c".repeat(64)],
        updatedAt: Date.now()
      }
    })
  );

  await assert.rejects(
    assertNetworkSessionUsernameIntegrity(
      {
        connected: false,
        syncInfo: { remoteEventCount: 0, cachedEventCount: 0, mergedEventCount: 0 },
        usernameRegistry: [],
        users: []
      },
      { username: "aux", pubkey: "a".repeat(64) },
      {
        action: "open this account",
        lookupUsers: async () => {
          throw new Error("lookup should not run for a known stale key");
        },
        requireLookup: true
      }
    ),
    /older password/
  );
});

test("local current account history suppresses provisional conflicts from older keys in the same account", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
  storage.set(
    "truecost.v2.account-history",
    JSON.stringify({
      aux: {
        username: "aux",
        currentPubkey: "e".repeat(64),
        knownPubkeys: ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64), "e".repeat(64)],
        updatedAt: Date.now()
      }
    })
  );

  const integrity = resolveSessionUsernameConflict(
    {
      connected: true,
      syncInfo: { remoteEventCount: 2, cachedEventCount: 0, mergedEventCount: 2 },
      usernameRegistry: [
        {
          username: "aux",
          owner_pubkey: "b".repeat(64),
          claimant_pubkeys: ["b".repeat(64), "e".repeat(64)],
          conflict: true
        }
      ],
      users: [
        {
          pubkey: "e".repeat(64),
          username: "",
          claimedUsername: "aux",
          usernameConflict: true,
          usernameOwnerPubkey: "b".repeat(64)
        }
      ]
    },
    { username: "aux", pubkey: "e".repeat(64) }
  );

  assert.equal(integrity.conflict, false);
  assert.equal(integrity.source, "history-current");

  await assert.doesNotReject(
    assertNetworkSessionUsernameIntegrity(
      {
        connected: true,
        syncInfo: { remoteEventCount: 2, cachedEventCount: 0, mergedEventCount: 2 },
        usernameRegistry: [],
        users: []
      },
      { username: "aux", pubkey: "e".repeat(64) },
      {
        action: "rotate this account",
        lookupUsers: async () => [
          {
            pubkey: "b".repeat(64),
            username: "aux",
            claimedUsername: "aux",
            usernameConflict: false
          }
        ],
        requireLookup: true
      }
    )
  );
});

test("cached lookup conflicts from older keys do not poison the current local account head", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
  storage.set(
    "truecost.v2.account-history",
    JSON.stringify({
      aux: {
        username: "aux",
        currentPubkey: "e".repeat(64),
        knownPubkeys: ["a".repeat(64), "b".repeat(64), "c".repeat(64), "d".repeat(64), "e".repeat(64)],
        updatedAt: Date.now()
      }
    })
  );
  storage.set(
    "truecost.v2.username-integrity",
    JSON.stringify({
      [`aux:${"e".repeat(64)}`]: {
        conflict: true,
        claimedUsername: "aux",
        ownerPubkey: "b".repeat(64),
        checkedAt: Date.now(),
        source: "lookup"
      }
    })
  );

  const integrity = resolveSessionUsernameConflict(
    {
      connected: false,
      syncInfo: { remoteEventCount: 0, cachedEventCount: 0, mergedEventCount: 0 },
      usernameRegistry: [],
      users: []
    },
    { username: "aux", pubkey: "e".repeat(64) }
  );

  assert.equal(integrity.conflict, false);
  assert.equal(integrity.source, "history-current");
  assert.equal(readCachedSessionUsernameIntegrity({ username: "aux", pubkey: "e".repeat(64) }), null);
});

test("session username integrity messaging names the taken handle", () => {
  const message = buildUsernameConflictMessage({
    claimedUsername: "aux",
    action: "comment from this account"
  });
  assert.match(message, /@aux/);
  assert.match(message, /comment from this account/);

  const publicState = {
    connected: true,
    syncInfo: { remoteEventCount: 2, cachedEventCount: 0, mergedEventCount: 2 },
    usernameRegistry: [{ username: "aux", owner_pubkey: "a".repeat(64), claimant_pubkeys: ["a".repeat(64), "b".repeat(64)], conflict: true }],
    users: [{ pubkey: "b".repeat(64), username: "", claimedUsername: "aux", usernameConflict: true, usernameOwnerPubkey: "a".repeat(64) }]
  };
  const integrity = resolveSessionUsernameConflict(publicState, { username: "aux", pubkey: "b".repeat(64) });
  assert.equal(integrity.conflict, true);
  assert.equal(currentSessionUsernameConflictMessage(publicState, { username: "aux", pubkey: "b".repeat(64) }, "update this profile"), message.replace("comment from this account", "update this profile"));
});

test("network-backed username integrity refuses a taken username before saving the session and caches the conflict", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };

  const session = { username: "aux", pubkey: "b".repeat(64) };

  await assert.rejects(
    assertNetworkSessionUsernameIntegrity(
      { usernameRegistry: [], users: [] },
      session,
      {
        action: "open this account",
        lookupUsers: async () => [{ pubkey: "a".repeat(64), username: "aux", claimedUsername: "aux", usernameConflict: false }],
        requireLookup: true
      }
    ),
    /already claimed/
  );

  const cachedIntegrity = readCachedSessionUsernameIntegrity(session);
  assert.equal(cachedIntegrity?.conflict, true);
  assert.equal(cachedIntegrity?.ownerPubkey, "a".repeat(64));
  await assert.rejects(
    assertNetworkSessionUsernameIntegrity(
      { usernameRegistry: [], users: [] },
      session,
      {
        action: "open this account",
        lookupUsers: async () => [{ pubkey: "a".repeat(64), username: "aux", claimedUsername: "aux", usernameConflict: false }],
        requireLookup: true
      }
    ),
    (error) => {
      assert.equal(isUsernameConflictError(error), true);
      assert.equal(error.claimedUsername, "aux");
      return true;
    }
  );

  clearCachedSessionUsernameIntegrity(session);
  assert.equal(readCachedSessionUsernameIntegrity(session), null);
});

test("lookup-backed cached conflicts survive an untrusted no-conflict snapshot", () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };

  const session = { username: "aux", pubkey: "b".repeat(64) };
  storage.set(
    "truecost.v2.username-integrity",
    JSON.stringify({
      [`aux:${"b".repeat(64)}`]: {
        conflict: true,
        claimedUsername: "aux",
        ownerPubkey: "a".repeat(64),
        checkedAt: Date.now(),
        source: "lookup"
      }
    })
  );

  const integrity = resolveSessionUsernameConflict(
    {
      connected: false,
      syncInfo: { remoteEventCount: 0, cachedEventCount: 0, mergedEventCount: 0 },
      usernameRegistry: [],
      users: []
    },
    session
  );

  assert.equal(integrity.conflict, true);
  assert.equal(integrity.source, "cache");
  assert.equal(readCachedSessionUsernameIntegrity(session)?.conflict, true);
});

test("network-backed username integrity does not reject the canonical owner from provisional state conflict", async () => {
  const session = { username: "aux", pubkey: "a".repeat(64) };
  let lookupOptions = null;

  await assert.doesNotReject(() =>
    assertNetworkSessionUsernameIntegrity(
      {
        usernameRegistry: [
          {
            username: "aux",
            owner_pubkey: "b".repeat(64),
            claimant_pubkeys: ["b".repeat(64)],
            conflict: false
          }
        ],
        users: [
          {
            pubkey: "b".repeat(64),
            username: "aux",
            claimedUsername: "aux",
            usernameConflict: false,
            usernameOwnerPubkey: "b".repeat(64)
          }
        ]
      },
      session,
      {
        action: "open this account",
        lookupUsers: async (_username, options = {}) => {
          lookupOptions = options;
          return [
            {
              pubkey: "a".repeat(64),
              username: "aux",
              claimedUsername: "aux",
              usernameConflict: false
            },
            {
              pubkey: "b".repeat(64),
              username: "",
              claimedUsername: "aux",
              usernameConflict: true
            }
          ];
        },
        requireLookup: true
      }
    )
  );

  assert.deepEqual(lookupOptions, {
    includePubkeys: ["a".repeat(64)]
  });
});

test("network-backed username integrity treats unresolved provisional conflicts as verification failures", async () => {
  const session = { username: "aux", pubkey: "a".repeat(64) };

  await assert.rejects(
    assertNetworkSessionUsernameIntegrity(
      {
        usernameRegistry: [
          {
            username: "aux",
            owner_pubkey: "b".repeat(64),
            claimant_pubkeys: ["b".repeat(64)],
            conflict: false
          }
        ],
        users: [
          {
            pubkey: "b".repeat(64),
            username: "aux",
            claimedUsername: "aux",
            usernameConflict: false,
            usernameOwnerPubkey: "b".repeat(64)
          }
        ]
      },
      session,
      {
        action: "open this account",
        lookupUsers: async () => [],
        requireLookup: true
      }
    ),
    /Could not verify whether @aux belongs to this account/
  );
});

test("removed accounts are blocked from session validation", async () => {
  const publicState = {
    connected: true,
    syncInfo: { remoteEventCount: 1 },
    removedPubkeys: ["a".repeat(64)],
    removedUsers: [{ pubkey: "a".repeat(64), claimedUsername: "aux", displayName: "Aux" }],
    usernameRegistry: [],
    users: []
  };

  assert.throws(
    () => assertSessionUsernameIntegrity(publicState, { username: "aux", pubkey: "a".repeat(64) }),
    (error) => {
      assert.equal(isRemovedAccountError(error), true);
      assert.match(String(error?.message || ""), /removed from this site/);
      return true;
    }
  );

  await assert.rejects(
    assertNetworkSessionUsernameIntegrity(publicState, { username: "aux", pubkey: "a".repeat(64) }, { requireLookup: true }),
    (error) => {
      assert.equal(isRemovedAccountError(error), true);
      assert.equal(error.claimedUsername, "aux");
      return true;
    }
  );

  assert.match(buildRemovedAccountMessage({ claimedUsername: "aux" }), /@aux/);
});

test("network-backed username integrity prefers a removed-account error for removed duplicate claimants", async () => {
  const session = { username: "aux", pubkey: "b".repeat(64) };

  await assert.rejects(
    assertNetworkSessionUsernameIntegrity(
      {
        connected: true,
        syncInfo: { remoteEventCount: 1 },
        removedPubkeys: [],
        removedUsers: [],
        usernameRegistry: [],
        users: []
      },
      session,
      {
        action: "open this account",
        lookupUsers: async () => [
          {
            pubkey: "a".repeat(64),
            username: "aux",
            claimedUsername: "aux",
            usernameConflict: false
          },
          {
            pubkey: "b".repeat(64),
            username: "",
            claimedUsername: "aux",
            usernameConflict: false,
            removed: true
          }
        ],
        requireLookup: true
      }
    ),
    (error) => {
      assert.equal(isRemovedAccountError(error), true);
      assert.equal(error.claimedUsername, "aux");
      return true;
    }
  );
});

test("untrusted cached removal state does not block the canonical owner", async () => {
  const session = { username: "aux", pubkey: "a".repeat(64) };
  await assert.doesNotReject(() =>
    assertNetworkSessionUsernameIntegrity(
      {
        connected: false,
        syncInfo: { remoteEventCount: 0, cachedEventCount: 12, mergedEventCount: 12 },
        removedPubkeys: ["a".repeat(64)],
        removedUsers: [{ pubkey: "a".repeat(64), claimedUsername: "aux", displayName: "Aux" }],
        usernameRegistry: [],
        users: []
      },
      session,
      {
        action: "open this account",
        lookupUsers: async () => [
          {
            pubkey: "a".repeat(64),
            username: "aux",
            claimedUsername: "aux",
            usernameConflict: false
          }
        ],
        requireLookup: true
      }
    )
  );
});

test("untrusted cached username conflicts do not block the canonical owner in view state", () => {
  const session = { username: "aux", pubkey: "a".repeat(64) };
  const publicState = {
    connected: false,
    syncInfo: { remoteEventCount: 0, cachedEventCount: 1, mergedEventCount: 1 },
    usernameRegistry: [
      {
        username: "aux",
        owner_pubkey: "b".repeat(64),
        claimant_pubkeys: ["b".repeat(64), "a".repeat(64)],
        conflict: true
      }
    ],
    users: [
      {
        pubkey: "a".repeat(64),
        username: "aux",
        claimedUsername: "aux",
        usernameConflict: true,
        usernameOwnerPubkey: "b".repeat(64)
      }
    ]
  };

  const integrity = resolveSessionUsernameConflict(publicState, session);
  assert.equal(integrity.conflict, false);
  assert.equal(integrity.source, "state-untrusted");
  assert.equal(sessionHasUsernameConflict(publicState, session), false);
});

test("removed session account resolution only trusts live removal state", () => {
  const session = { username: "aux", pubkey: "a".repeat(64) };

  assert.equal(
    resolveRemovedSessionAccount(
      {
        connected: false,
        syncInfo: { remoteEventCount: 0, cachedEventCount: 12, mergedEventCount: 12 },
        removedPubkeys: ["a".repeat(64)],
        removedUsers: [{ pubkey: "a".repeat(64), claimedUsername: "aux", displayName: "Aux" }]
      },
      session
    ),
    null
  );

  assert.deepEqual(
    resolveRemovedSessionAccount(
      {
        connected: true,
        syncInfo: { remoteEventCount: 1, cachedEventCount: 12, mergedEventCount: 13 },
        removedPubkeys: ["a".repeat(64)],
        removedUsers: [{ pubkey: "a".repeat(64), claimedUsername: "aux", displayName: "Aux" }]
      },
      session
    ),
    { pubkey: "a".repeat(64), claimedUsername: "aux", displayName: "Aux" }
  );
});

test("login mismatch messaging and local username inspection support append-next guidance", async () => {
  const publicState = {
    usernameRegistry: [
      { username: "aux", owner_pubkey: "a".repeat(64), claimant_pubkeys: ["a".repeat(64)], conflict: false },
      { username: "aux2", owner_pubkey: "b".repeat(64), claimant_pubkeys: ["b".repeat(64)], conflict: false }
    ],
    users: []
  };

  assert.match(buildUsernameLoginMismatchMessage("aux"), /already exists and your password did not match/);
  assert.deepEqual(
    inspectUsernameClaim(publicState, "aux", { currentPubkey: "", currentUsername: "" }),
    {
      state: "taken",
      claimedUsername: "aux",
      ownerPubkey: "a".repeat(64)
    }
  );
  assert.deepEqual(
    inspectUsernameClaim(publicState, "aux3", { currentPubkey: "", currentUsername: "aux" }),
    {
      state: "available",
      claimedUsername: "aux3",
      ownerPubkey: ""
    }
  );

  const nextAvailable = await resolveNextAvailableUsername(publicState, "aux", {
    lookupUsers: async () => []
  });
  assert.deepEqual(nextAvailable, { username: "aux3", verified: true });
});
