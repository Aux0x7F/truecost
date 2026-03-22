import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPasswordReuseMessage,
  buildStaleSessionMessage,
  createPasswordReuseError,
  isPasswordReuseError,
  readStoredAccountHistory,
  resetStoredAccountHistory,
  rememberAccountRotation,
  rememberCurrentAccountSession,
  resolveSessionIdentityState,
  resolveStaleSessionFromHistory,
  resolveStaleSessionAccount,
  rotationReusesIdentityKey,
  sessionUsesCurrentIdentityKey
} from "../scripts/core/account-management.js";

test.beforeEach(() => {
  resetStoredAccountHistory();
});

test("account management resolves the latest identity head for rotated sessions", () => {
  const originalPubkey = "a".repeat(64);
  const currentPubkey = "b".repeat(64);
  const publicState = {
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
    }
  };

  const staleIdentity = resolveSessionIdentityState(publicState, {
    username: "aux",
    pubkey: originalPubkey
  });
  const currentIdentity = resolveSessionIdentityState(publicState, {
    username: "aux",
    pubkey: currentPubkey
  });

  assert.equal(staleIdentity.isStaleKey, true);
  assert.equal(staleIdentity.currentPubkey, currentPubkey);
  assert.equal(currentIdentity.isCurrentKey, true);
  assert.equal(sessionUsesCurrentIdentityKey(publicState, { username: "aux", pubkey: currentPubkey }), true);
  assert.deepEqual(resolveStaleSessionAccount(publicState, { username: "aux", pubkey: originalPubkey }), {
    claimedUsername: "aux",
    sessionPubkey: originalPubkey,
    canonicalPubkey: originalPubkey,
    currentPubkey,
    identityMemberPubkeys: [originalPubkey, currentPubkey]
  });
  assert.match(buildStaleSessionMessage({ claimedUsername: "aux" }), /older password/);
});

test("account management rejects password rotations that reuse an existing identity key", () => {
  const originalPubkey = "a".repeat(64);
  const currentPubkey = "b".repeat(64);
  const publicState = {
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
    }
  };

  assert.equal(rotationReusesIdentityKey(publicState, { username: "aux", pubkey: currentPubkey }, originalPubkey), true);
  assert.equal(rotationReusesIdentityKey(publicState, { username: "aux", pubkey: currentPubkey }, currentPubkey), true);
  assert.equal(rotationReusesIdentityKey(publicState, { username: "aux", pubkey: currentPubkey }, "c".repeat(64)), false);
  assert.match(buildPasswordReuseMessage({ claimedUsername: "aux" }), /must use a password that has not been used before/);
  assert.equal(isPasswordReuseError(createPasswordReuseError({ claimedUsername: "aux" })), true);
});

test("account management uses local account history for current key and password reuse checks", () => {
  const previousSession = { username: "aux", pubkey: "a".repeat(64) };
  const currentSession = { username: "aux", pubkey: "b".repeat(64) };

  rememberCurrentAccountSession(previousSession);
  rememberAccountRotation(previousSession, currentSession);

  assert.deepEqual(readStoredAccountHistory("aux"), {
    username: "aux",
    currentPubkey: "b".repeat(64),
    knownPubkeys: ["a".repeat(64), "b".repeat(64)],
    updatedAt: readStoredAccountHistory("aux").updatedAt
  });
  assert.deepEqual(resolveStaleSessionFromHistory(previousSession), {
    claimedUsername: "aux",
    sessionPubkey: "a".repeat(64),
    canonicalPubkey: "a".repeat(64),
    currentPubkey: "b".repeat(64),
    identityMemberPubkeys: ["a".repeat(64), "b".repeat(64)]
  });
  assert.equal(rotationReusesIdentityKey({}, currentSession, "a".repeat(64)), true);
});
