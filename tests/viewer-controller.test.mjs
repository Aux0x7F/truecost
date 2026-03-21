import test from "node:test";
import assert from "node:assert/strict";

import { createViewerController } from "../scripts/core/viewer-controller.js";

test("viewer controller backfills a legacy session pubkey when identity can be derived", () => {
  const state = {
    session: {
      username: "aux",
      secretKeyHex: "a".repeat(64),
      pubkey: ""
    },
    viewer: null
  };
  const persisted = [];
  const controller = createViewerController({
    state,
    site: { nostr: {} },
    deriveIdentity: (secretKeyHex) => ({ pubkey: secretKeyHex }),
    hasNostrTools: () => true,
    persistSession: (session) => persisted.push(session.pubkey)
  });

  const viewer = controller.primeFromSession(true);

  assert.equal(viewer?.pubkey, "a".repeat(64));
  assert.equal(state.session.pubkey, "a".repeat(64));
  assert.deepEqual(persisted, ["a".repeat(64)]);
});

test("viewer controller keeps an existing session pubkey intact", () => {
  const state = {
    session: {
      username: "aux",
      secretKeyHex: "a".repeat(64),
      pubkey: "b".repeat(64)
    },
    viewer: null
  };
  const controller = createViewerController({
    state,
    site: { nostr: {} },
    deriveIdentity: () => ({ pubkey: "c".repeat(64) }),
    hasNostrTools: () => true
  });

  const viewer = controller.primeFromSession(true);

  assert.equal(viewer?.pubkey, "b".repeat(64));
  assert.equal(state.session.pubkey, "b".repeat(64));
});

test("viewer controller can resolve admin access from a legacy session once identity derivation is available", () => {
  const pubkey = "a".repeat(64);
  const state = {
    session: {
      username: "aux",
      secretKeyHex: "seed-secret",
      pubkey: ""
    },
    viewer: null
  };
  const controller = createViewerController({
    state,
    site: { nostr: { rootAdminPubkey: pubkey } },
    deriveIdentity: () => ({ pubkey }),
    hasNostrTools: () => true
  });

  assert.equal(controller.canEdit({ admins: [] }), true);
  assert.equal(state.session.pubkey, pubkey);
});
