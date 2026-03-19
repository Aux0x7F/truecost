import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceSiteKeyController } from "../scripts/core/workspace-site-key.js";

test("workspace site key controller rotates the inbox key and updates cached share state", async () => {
  const published = [];
  let clearedCache = null;
  let persistedShares = null;
  const state = {
    session: { secretKeyHex: "admin-secret" },
    viewer: { pubkey: "admin-pubkey" },
    publicState: {
      admins: ["admin-pubkey", "other-admin"],
      siteInfo: { activePubkey: "site-before" }
    },
    siteKeyShares: [{ sitePubkey: "site-before", siteSecretKeyHex: "old-secret" }],
    siteKeyShare: { sitePubkey: "site-before", siteSecretKeyHex: "old-secret" },
    keyRequestState: "pending"
  };
  const controller = createWorkspaceSiteKeyController({
    site: { nostr: { storageNamespace: "truecost.test" } },
    state,
    accessController: {
      isAdmin: () => true,
      hasInboxAccess: () => true,
      pendingKeyRequest: () => null,
      viewerPubkey: () => "admin-pubkey"
    },
    deps: {
      buildSiteKeyShare: (secretKeyHex, meta) => ({
        sitePubkey: `pub:${secretKeyHex}`,
        siteSecretKeyHex: secretKeyHex,
        senderPubkey: meta.senderPubkey
      }),
      clearCachedInboxSubmissions: (payload) => {
        clearedCache = payload;
      },
      dedupe: (values) => [...new Set(values)],
      findSiteKeyShare: (shares, sitePubkey) => shares.find((share) => share.sitePubkey === sitePubkey) || null,
      generateSecretKeyHex: async () => "next-site-secret",
      mergeSiteKeyShares: (primary, secondary) => [...(primary || []), ...(secondary || [])],
      persistCachedSiteKeyShares: (payload) => {
        persistedShares = payload;
      },
      publishAdminKeyShare: async (adminSecret, pubkey, sharedSecret) => {
        published.push(["share", adminSecret, pubkey, sharedSecret]);
      },
      publishSiteKeyEvent: async (adminSecret, sharedSecret, payload) => {
        published.push(["rotate", adminSecret, sharedSecret, payload.previousSitePubkey, payload.reason]);
      },
      renderSiteKeyShareStatus: () => "",
      resolveSitePubkey: (publicState) => publicState?.siteInfo?.activePubkey || ""
    }
  });

  await controller.rotateSiteInboxKey([], "rotation");

  assert.equal(state.siteKeyShare.siteSecretKeyHex, "next-site-secret");
  assert.equal(state.publicState.siteInfo.activePubkey, "pub:next-site-secret");
  assert.equal(state.keyRequestState, "");
  assert.deepEqual(
    published,
    [
      ["rotate", "admin-secret", "next-site-secret", "site-before", "rotation"],
      ["share", "admin-secret", "admin-pubkey", "next-site-secret"],
      ["share", "admin-secret", "other-admin", "next-site-secret"]
    ]
  );
  assert.deepEqual(clearedCache, {
    storageNamespace: "truecost.test",
    viewerPubkey: "admin-pubkey",
    sitePubkey: "site-before"
  });
  assert.equal(persistedShares.viewerPubkey, "admin-pubkey");
  assert.equal(persistedShares.storageNamespace, "truecost.test");
});

test("workspace site key controller requests the current share only once per cooldown window", async () => {
  const requested = [];
  let timerDelay = 0;
  const state = {
    session: { secretKeyHex: "admin-secret" },
    publicState: { siteInfo: { activePubkey: "site-now" } },
    keyRequestCache: null,
    keyRequestTimer: 0,
    keyRequestState: ""
  };
  const controller = createWorkspaceSiteKeyController({
    site: { nostr: { storageNamespace: "truecost.test" } },
    state,
    accessController: {
      isAdmin: () => true,
      hasInboxAccess: () => false,
      pendingKeyRequest: () => null,
      viewerPubkey: () => "admin-pubkey"
    },
    deps: {
      publishAdminKeyRequest: async (_secretKeyHex, sitePubkey) => {
        requested.push(sitePubkey);
      },
      resolveSitePubkey: (publicState) => publicState?.siteInfo?.activePubkey || "",
      setTimeout: (_callback, delay) => {
        timerDelay = delay;
        return 1;
      }
    }
  });

  await controller.maybeEnsureCurrentKeyRequest({ onRefresh: () => {} });
  await controller.maybeEnsureCurrentKeyRequest({ onRefresh: () => {} });

  assert.deepEqual(requested, ["site-now"]);
  assert.equal(state.keyRequestState, "pending");
  assert.equal(timerDelay, 3200);
});
