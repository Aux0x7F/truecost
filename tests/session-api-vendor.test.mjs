import test from "node:test";
import assert from "node:assert/strict";

import { createDeterministicSessionApi } from "../vendor/nostr-site-support.esm.js";

test("vendored deterministic session api supports non-persisted sign-in and rotation", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };

  const api = createDeterministicSessionApi(
    {
      nostr: {
        storageNamespace: "truecost.test",
        appTag: "true-cost-project",
        kinds: {
          profile: 1,
          nameClaim: 2,
          identityRotation: 3
        }
      }
    },
    {
      deriveIdentity: (secretKeyHex) => ({
        pubkey: secretKeyHex.slice(0, 64)
      }),
      ensureEventToolsLoaded: async () => {},
      normalizeUsername: (value) => String(value || "").trim().toLowerCase(),
      publishTaggedJson: async () => ({ ok: true, event: { id: "1" } })
    }
  );

  const signInSession = await api.signInWithCredentials("aux", "secret", { persistSession: false });
  assert.equal(api.getStoredSession(), null);

  const rotation = await api.rotateAccountCredentials(
    {
      username: "aux",
      secretKeyHex: signInSession.secretKeyHex,
      pubkey: signInSession.pubkey
    },
    "next-password",
    { persistSession: false }
  );

  assert.equal(api.getStoredSession(), null);
  assert.notEqual(rotation.session.pubkey, signInSession.pubkey);
});

test("vendored deterministic session api repairs a legacy session missing pubkey", async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key)
  };

  const api = createDeterministicSessionApi(
    {
      nostr: {
        storageNamespace: "truecost.test",
        appTag: "true-cost-project",
        kinds: {
          profile: 1,
          nameClaim: 2,
          identityRotation: 3
        }
      }
    },
    {
      deriveIdentity: (secretKeyHex) => ({
        pubkey: secretKeyHex.slice(0, 64)
      }),
      ensureEventToolsLoaded: async () => {},
      normalizeUsername: (value) => String(value || "").trim().toLowerCase(),
      publishTaggedJson: async () => ({ ok: true, event: { id: "1" } })
    }
  );

  const repaired = await api.repairSession(
    {
      username: "Aux",
      secretKeyHex: "a".repeat(64),
      pubkey: ""
    },
    { persistSession: false }
  );

  assert.equal(repaired.username, "aux");
  assert.equal(repaired.pubkey, "a".repeat(64));
  assert.equal(api.getStoredSession(), null);
});
