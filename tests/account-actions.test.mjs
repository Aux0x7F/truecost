import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPasswordLengthMessage,
  openAccountSession,
  PASSWORD_MIN_LENGTH,
  rotateAccountPassword,
  translateLoginError
} from "../scripts/core/account-actions.js";
import {
  createStaleSessionError,
  isPasswordReuseError,
  rememberAccountRotationHistoryEntry,
  rememberCurrentAccountHistoryEntry
} from "../scripts/core/session-identity.js";

test.beforeEach(() => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
});

test("login translates stale-password verification into a generic mismatch", async () => {
  const error = translateLoginError(
    createStaleSessionError({ claimedUsername: "testiprofile", currentContext: "open this account" }),
    "testiprofile"
  );

  assert.equal(error.code, "LOGIN_MISMATCH");
  assert.match(String(error.message || ""), /already exists and your password did not match/);
});

test("openAccountSession saves the session once validation passes even if rebroadcast warns", async () => {
  const calls = [];
  const session = {
    username: "testiprofile",
    secretKeyHex: "a".repeat(64),
    pubkey: "a".repeat(64)
  };

  const result = await openAccountSession({
    username: "testiprofile",
    password: "secret123",
    loadPublicState: async () => ({ connected: true, usernameRegistry: [], users: [] }),
    signInWithCredentials: async (_username, _password, options = {}) => {
      await options.validateSession(session);
      calls.push("signin");
      return session;
    },
    saveSession: (nextSession) => calls.push(["save", nextSession.pubkey]),
    rebroadcastAccount: async () => {
      calls.push("rebroadcast");
      throw new Error("refresh warning");
    },
    rememberCurrentAccountSession: (nextSession) => calls.push(["remember", nextSession.pubkey]),
    assertNetworkSessionUsernameIntegrity: async () => calls.push("validate"),
    lookupUsers: async () => []
  });

  assert.equal(result.session.pubkey, session.pubkey);
  assert.match(result.warning, /refresh warning/);
  assert.deepEqual(calls, [
    "validate",
    "signin",
    ["save", session.pubkey],
    ["remember", session.pubkey],
    "rebroadcast"
  ]);
});

test("openAccountSession rejects short passwords before any network work", async () => {
  let called = false;
  await assert.rejects(
    openAccountSession({
      username: "testiprofile",
      password: "short",
      loadPublicState: async () => {
        called = true;
        return {};
      },
      signInWithCredentials: async () => {
        called = true;
        return null;
      }
    }),
    (error) => {
      assert.match(String(error.message || ""), new RegExp(buildPasswordLengthMessage(PASSWORD_MIN_LENGTH)));
      return true;
    }
  );
  assert.equal(called, false);
});

test("rotateAccountPassword rejects a previously used password before publishing or mutating local state", async () => {
  const previousSession = { username: "testiprofile", pubkey: "a".repeat(64) };
  const nextSessions = ["b", "c", "d", "e"].map((value) => ({
    username: "testiprofile",
    pubkey: value.repeat(64)
  }));
  let accountHistory = rememberCurrentAccountHistoryEntry(null, previousSession);
  let currentSession = previousSession;
  for (const nextSession of nextSessions) {
    accountHistory = rememberAccountRotationHistoryEntry(accountHistory, currentSession, nextSession);
    currentSession = nextSession;
  }

  let rotateCalled = false;
  let saveCalled = false;
  let rememberCalled = false;

  await assert.rejects(
    rotateAccountPassword({
      session: { username: "testiprofile", pubkey: "e".repeat(64) },
      nextPassword: "reused-password",
      currentPublicState: {},
      loadAccountHistory: async () => accountHistory,
      loadPublicState: async () => ({ connected: true, usernameRegistry: [], users: [] }),
      deriveSecretKeyHex: async () => "b".repeat(64),
      deriveIdentity: (secretKeyHex) => ({ pubkey: secretKeyHex }),
      assertNetworkSessionUsernameIntegrity: async () => {},
      lookupUsers: async () => [],
      rotateAccountCredentials: async () => {
        rotateCalled = true;
        return null;
      },
      saveSession: () => {
        saveCalled = true;
      },
      rememberAccountRotation: () => {
        rememberCalled = true;
      }
    }),
    (error) => {
      assert.equal(isPasswordReuseError(error), true);
      return true;
    }
  );

  assert.equal(rotateCalled, false);
  assert.equal(saveCalled, false);
  assert.equal(rememberCalled, false);
});

test("rotateAccountPassword commits session and history once publish succeeds", async () => {
  const calls = [];
  const result = await rotateAccountPassword({
    session: {
      username: "testiprofile",
      secretKeyHex: "a".repeat(64),
      pubkey: "a".repeat(64)
    },
    nextPassword: "new-password",
    currentPublicState: { connected: true, usernameRegistry: [], users: [] },
    loadPublicState: async () => ({ connected: true, usernameRegistry: [], users: [] }),
    deriveSecretKeyHex: async () => "f".repeat(64),
    deriveIdentity: (secretKeyHex) => ({ pubkey: secretKeyHex }),
    assertNetworkSessionUsernameIntegrity: async () => calls.push("validate"),
    lookupUsers: async () => [],
    rotateAccountCredentials: async (_session, _password, options = {}) => {
      calls.push(["rotate", options.persistSession]);
      return {
        session: {
          username: "testiprofile",
          secretKeyHex: "f".repeat(64),
          pubkey: "f".repeat(64)
        },
        previousPubkey: "a".repeat(64),
        rotationId: "rotation-1",
        proposed: true,
        accepted: true
      };
    },
    saveSession: (session) => calls.push(["save", session.pubkey]),
    rememberAccountRotation: (previousSession, nextSession) =>
      calls.push(["remember", previousSession.pubkey, nextSession.pubkey]),
    afterCommit: async () => ({ warnings: ["share warning"] })
  });

  assert.equal(result.session.pubkey, "f".repeat(64));
  assert.deepEqual(result.warnings, ["share warning"]);
  assert.deepEqual(calls, [
    "validate",
    ["rotate", false],
    ["save", "f".repeat(64)],
    ["remember", "a".repeat(64), "f".repeat(64)]
  ]);
});

test("rotateAccountPassword rejects short passwords before deriving a new key", async () => {
  let deriveCalled = false;
  await assert.rejects(
    rotateAccountPassword({
      session: {
        username: "testiprofile",
        secretKeyHex: "a".repeat(64),
        pubkey: "a".repeat(64)
      },
      nextPassword: "short",
      currentPublicState: {},
      deriveSecretKeyHex: async () => {
        deriveCalled = true;
        return "f".repeat(64);
      },
      deriveIdentity: (secretKeyHex) => ({ pubkey: secretKeyHex })
    }),
    (error) => {
      assert.match(String(error.message || ""), new RegExp(buildPasswordLengthMessage(PASSWORD_MIN_LENGTH)));
      return true;
    }
  );
  assert.equal(deriveCalled, false);
});

test("rotateAccountPassword repairs a legacy session missing pubkey before validation", async () => {
  const calls = [];
  const repairedSession = {
    username: "testiprofile",
    secretKeyHex: "a".repeat(64),
    pubkey: "a".repeat(64)
  };

  const result = await rotateAccountPassword({
    session: {
      username: "testiprofile",
      secretKeyHex: "a".repeat(64),
      pubkey: ""
    },
    nextPassword: "brand-new-password",
    currentPublicState: { connected: true, usernameRegistry: [], users: [] },
    loadPublicState: async () => ({ connected: true, usernameRegistry: [], users: [] }),
    deriveSecretKeyHex: async () => "f".repeat(64),
    deriveIdentity: (secretKeyHex) => ({ pubkey: secretKeyHex }),
    repairAccountSession: async (session, _options) => {
      calls.push(["save", repairedSession.pubkey]);
      return {
        ...session,
        ...repairedSession
      };
    },
    assertNetworkSessionUsernameIntegrity: async (_publicState, session) => {
      calls.push(["validate", session.pubkey]);
    },
    lookupUsers: async () => [],
    rotateAccountCredentials: async (session) => {
      calls.push(["rotate", session.pubkey]);
      return {
        session: {
          username: "testiprofile",
          secretKeyHex: "f".repeat(64),
          pubkey: "f".repeat(64)
        },
        previousPubkey: "a".repeat(64),
        rotationId: "rotation-legacy",
        proposed: true,
        accepted: true
      };
    },
    saveSession: (session) => calls.push(["save", session.pubkey]),
    rememberAccountRotation: (previousSession, nextSession) =>
      calls.push(["remember", previousSession.pubkey, nextSession.pubkey])
  });

  assert.equal(result.session.pubkey, "f".repeat(64));
  assert.deepEqual(calls, [
    ["save", repairedSession.pubkey],
    ["validate", repairedSession.pubkey],
    ["rotate", repairedSession.pubkey],
    ["save", "f".repeat(64)],
    ["remember", repairedSession.pubkey, "f".repeat(64)]
  ]);
});
