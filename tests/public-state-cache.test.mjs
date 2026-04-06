import test from "node:test";
import assert from "node:assert/strict";

import {
  clearPublicStateCacheStorage,
  isRecoverablePublicStateCacheError,
  publicEventCacheStorageKey,
  publicStateSnapshotStorageKey,
  repairPublicStateCacheStorage,
  sanitizeStoredPublicEventCache,
  sanitizeStoredPublicStateSnapshot
} from "../scripts/core/public-state-cache.js";

test("sanitizeStoredPublicEventCache drops malformed cached events", () => {
  const raw = JSON.stringify([
    null,
    { id: "missing-fields" },
    {
      id: "evt-1",
      pubkey: "a".repeat(64),
      sig: "b".repeat(128),
      kind: 1,
      created_at: 10,
      tags: [["t", "true-cost-project"]],
      content: "ok"
    }
  ]);
  const sanitized = sanitizeStoredPublicEventCache(raw);
  assert.equal(sanitized.valid, true);
  assert.deepEqual(JSON.parse(sanitized.nextValue), [
    {
      id: "evt-1",
      pubkey: "a".repeat(64),
      sig: "b".repeat(128),
      kind: 1,
      created_at: 10,
      tags: [["t", "true-cost-project"]],
      content: "ok"
    }
  ]);
});

test("sanitizeStoredPublicStateSnapshot strips null array entries but keeps snapshot structure", () => {
  const raw = JSON.stringify({
    admins: ["a".repeat(64)],
    users: [null, { pubkey: "a".repeat(64), username: "aux" }],
    rawEvents: [
      null,
      { id: "cached:broken", kind: 0 },
      {
        id: "evt-1",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 1,
        created_at: 10,
        tags: [["t", "true-cost-project"]],
        content: "ok"
      }
    ],
    identityChain: {
      canonicalByPubkey: {
        __nostrSiteType: "Map",
        entries: [[["bad"]], ["a".repeat(64), "a".repeat(64)]]
      }
    }
  });
  const sanitized = sanitizeStoredPublicStateSnapshot(raw);
  assert.equal(sanitized.valid, true);
  const nextValue = JSON.parse(sanitized.nextValue);
  assert.deepEqual(nextValue.users, [{ pubkey: "a".repeat(64), username: "aux" }]);
  assert.deepEqual(nextValue.rawEvents, [
    {
      id: "evt-1",
      pubkey: "a".repeat(64),
      sig: "b".repeat(128),
      kind: 1,
      created_at: 10,
      tags: [["t", "true-cost-project"]],
      content: "ok"
    }
  ]);
  assert.deepEqual(nextValue.identityChain.canonicalByPubkey, {
    __nostrSiteType: "Map",
    entries: [["a".repeat(64), "a".repeat(64)]]
  });
});

test("repairPublicStateCacheStorage rewrites malformed cached state and event cache", () => {
  const storage = createMemoryStorage({
    [publicStateSnapshotStorageKey("truecost.test")]: JSON.stringify({
      users: [null, { pubkey: "a".repeat(64), username: "aux" }]
    }),
    [publicEventCacheStorageKey("truecost.test")]: JSON.stringify([
      { id: "bad" },
      {
        id: "evt-1",
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 1,
        created_at: 10,
        tags: [],
        content: ""
      }
    ])
  });

  const result = repairPublicStateCacheStorage(storage, "truecost.test");
  assert.deepEqual(result, {
    repairedSnapshot: true,
    repairedEventCache: true,
    removedSnapshot: false,
    removedEventCache: false
  });
  assert.deepEqual(JSON.parse(storage.getItem(publicStateSnapshotStorageKey("truecost.test"))), {
    users: [{ pubkey: "a".repeat(64), username: "aux" }]
  });
  assert.deepEqual(JSON.parse(storage.getItem(publicEventCacheStorageKey("truecost.test"))), [
    {
      id: "evt-1",
      pubkey: "a".repeat(64),
      sig: "b".repeat(128),
      kind: 1,
      created_at: 10,
      tags: [],
      content: ""
    }
  ]);
});

test("clearPublicStateCacheStorage removes both stored cache keys", () => {
  const storage = createMemoryStorage({
    [publicStateSnapshotStorageKey("truecost.test")]: "{}",
    [publicEventCacheStorageKey("truecost.test")]: "[]"
  });
  const result = clearPublicStateCacheStorage(storage, "truecost.test");
  assert.deepEqual(result, {
    clearedSnapshot: true,
    clearedEventCache: true
  });
  assert.equal(storage.getItem(publicStateSnapshotStorageKey("truecost.test")), null);
  assert.equal(storage.getItem(publicEventCacheStorageKey("truecost.test")), null);
});

test("isRecoverablePublicStateCacheError recognizes created_at cache crashes", () => {
  assert.equal(isRecoverablePublicStateCacheError(new TypeError("can't access property \"created_at\", l is undefined")), true);
  assert.equal(isRecoverablePublicStateCacheError(new Error("Unexpected end of JSON input")), true);
  assert.equal(isRecoverablePublicStateCacheError(new Error("Relay connection timed out.")), false);
});

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}
