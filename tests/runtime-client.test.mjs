import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryRuntimeDatabase } from "../vendor/nostr-site-support.esm.js";
import {
  createSiteRuntimeClient,
  getCachedSiteRuntimeProjection
} from "../scripts/core/runtime-client.js";
import { createSiteRuntimeHost } from "../scripts/core/site-runtime-host.js";

function createPublicState(version = "1") {
  return {
    connected: true,
    syncInfo: {
      version
    },
    users: [],
    approvedEntities: [],
    commentsByPost: new Map(),
    commentIndex: new Map(),
    commentThreadsByPost: new Map()
  };
}

test("site runtime client fallback host shares session and projection updates", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
  const sessionChanges = [];
  const database = createMemoryRuntimeDatabase();
  const host = createSiteRuntimeHost({
    database,
    deps: {
      openAccountSession: async () => ({
        session: {
          username: "aux",
          secretKeyHex: "a".repeat(64),
          pubkey: "b".repeat(64)
        },
        warning: ""
      }),
      loadPublicState: async () => createPublicState("1")
    }
  });

  const client = createSiteRuntimeClient({
    workerUrl: "",
    hostFactory: () => host,
    onSessionChanged: (session) => {
      sessionChanges.push(session?.pubkey || "");
    }
  });

  const unsubscribe = await client.subscribeProjection("publicState", {}, () => {}, {
    emitCurrent: false,
    refresh: false
  });

  const login = await client.signIn({
    username: "aux",
    password: "secret123"
  });
  assert.equal(login.session.pubkey, "b".repeat(64));
  assert.equal(sessionChanges.at(-1), "b".repeat(64));

  const publicState = await client.getProjection("publicState", {}, { preferFresh: true });
  assert.equal(publicState.status, "ready");
  assert.equal(publicState.value.syncInfo.version, "1");

  await client.rememberProjection("publicState", {}, createPublicState("2"), {
    source: "test"
  });
  const cached = client.getCachedProjection("publicState", {});
  assert.equal(cached.value.syncInfo.version, "2");

  await client.signOut();
  assert.equal(sessionChanges.at(-1), "");

  unsubscribe();
  client.destroy();
});

test("site runtime client keeps a sync bootstrap snapshot for cached public state", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
  const database = createMemoryRuntimeDatabase();
  const host = createSiteRuntimeHost({
    database,
    deps: {
      loadPublicState: async () => ({
        admins: ["admin-pubkey"],
        users: [{ pubkey: "admin-pubkey", username: "aux", displayName: "Aux" }],
        approvedEntities: [],
        commentsByPost: new Map(),
        commentIndex: new Map(),
        commentThreadsByPost: new Map()
      })
    }
  });

  const client = createSiteRuntimeClient({
    workerUrl: "",
    hostFactory: () => host
  });

  await client.refreshProjection("publicState", {}, { reason: "bootstrap-test" });
  const cached = getCachedSiteRuntimeProjection("publicState", {});

  assert.equal(cached?.value?.admins?.includes("admin-pubkey"), true);
  assert.equal(cached?.value?.users?.[0]?.displayName, "Aux");

  client.destroy();
});

test("site runtime client seeds public state from the runtime bootstrap envelope without hitting the host loader", async () => {
  const storage = new Map();
  const bootstrapKey = "truecost.v2.runtime-public-state-bootstrap";
  storage.set(bootstrapKey, JSON.stringify({
    value: {
      admins: ["bootstrap-admin"],
      users: [{ pubkey: "bootstrap-admin", username: "aux", displayName: "Aux" }]
    },
    status: "ready",
    digest: "bootstrap-digest",
    updatedAt: 1,
    meta: { source: "runtime-bootstrap" }
  }));
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };

  let loaderCalls = 0;
  const host = createSiteRuntimeHost({
    database: createMemoryRuntimeDatabase(),
    deps: {
      loadPublicState: async () => {
        loaderCalls += 1;
        return createPublicState("loader");
      }
    }
  });

  const client = createSiteRuntimeClient({
    workerUrl: "",
    hostFactory: () => host
  });

  await client.seedSession(null, { force: false });
  const cached = client.getCachedProjection("publicState", {});

  assert.equal(cached?.value?.admins?.includes("bootstrap-admin"), true);
  assert.equal(loaderCalls, 0);

  client.destroy();
});

test("site runtime client keeps sync bootstrap snapshots for global projection state", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };
  const database = createMemoryRuntimeDatabase();
  const host = createSiteRuntimeHost({
    database
  });
  const client = createSiteRuntimeClient({
    workerUrl: "",
    hostFactory: () => host
  });

  await client.rememberProjection(
    "accountHistory",
    { username: "aux", __projectionScope: "global" },
    {
      username: "aux",
      currentPubkey: "pubkey-current",
      knownPubkeys: ["pubkey-old", "pubkey-current"],
      updatedAt: 1
    },
    { source: "test" }
  );

  const cached = getCachedSiteRuntimeProjection("accountHistory", {
    username: "aux",
    __projectionScope: "global"
  });

  assert.equal(cached?.value?.currentPubkey, "pubkey-current");
  assert.deepEqual(cached?.value?.knownPubkeys, ["pubkey-old", "pubkey-current"]);

  client.destroy();
});
