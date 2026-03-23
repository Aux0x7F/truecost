import test from "node:test";
import assert from "node:assert/strict";

import { createSiteOverlayConnector } from "../scripts/core/overlay-connector.js";
import { createSiteSignerClient } from "../scripts/core/site-signer.js";
import { createSiteActivityClient } from "../scripts/core/runtime-activity.js";
import { createAvatarCacheRefresher } from "../scripts/core/avatar-cache.js";

test("site activity records visit pulse markers through runtime actions", async () => {
  const calls = [];
  const activity = createSiteActivityClient({
    site: {
      nostr: {
        kinds: { visitPulse: 7001 }
      }
    },
    resolveSecretKey: async () => "a".repeat(64),
    getRuntimeClient: async () => ({
      callAction: async (action, payload) => {
        calls.push([action, payload]);
        return { ok: true };
      }
    }),
    getPage: () => "home"
  });

  await activity.publishVisitPulse();

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "activity.recordVisitPulse");
  assert.equal(calls[0][1].page, "home");
  assert.equal(calls[0][1].secretKeyHex, "a".repeat(64));
});

test("avatar cache refresher reloads the image source after ensuring the blob", async () => {
  const ensured = [];
  const refresher = createAvatarCacheRefresher({
    resolveSecretKey: async () => "a".repeat(64),
    ensureBlobAvailable: async (secretKeyHex, reference) => {
      ensured.push([secretKeyHex, reference]);
    }
  });

  const target = {
    dataset: {
      avatarSha: "deadbeef",
      avatarUrl: "https://example.com/avatar.jpg",
      avatarType: "image/jpeg",
      avatarName: "avatar"
    },
    currentSrc: "",
    src: "https://example.com/avatar.jpg"
  };

  await refresher.refreshAvatarFromCache(target);

  assert.equal(ensured.length, 1);
  assert.equal(ensured[0][0], "a".repeat(64));
  assert.match(String(target.src || ""), /^https:\/\/example\.com\/avatar\.jpg\?refresh=/);
});

test("site signer client falls back to a guest session when no signed-in session is available", async () => {
  const state = {
    session: null,
    guestSession: null
  };
  let ensureCalls = 0;
  let guestCalls = 0;
  const signerClient = createSiteSignerClient({
    state,
    ensureEventToolsLoaded: async () => {
      ensureCalls += 1;
    },
    getOrCreateGuestSession: async () => {
      guestCalls += 1;
      return { secretKeyHex: "b".repeat(64) };
    }
  });

  const secretKeyHex = await signerClient.resolveSecretKey();

  assert.equal(secretKeyHex, "b".repeat(64));
  assert.equal(state.guestSession?.secretKeyHex, "b".repeat(64));
  assert.equal(ensureCalls, 1);
  assert.equal(guestCalls, 1);
});

test("site overlay connector injects the resolved signer into live overlay connections", async () => {
  const calls = [];
  const connector = createSiteOverlayConnector({
    resolveSecretKey: async () => "c".repeat(64),
    connectStaticPageOverlay: async (options) => {
      calls.push(["page", options]);
      return { kind: "page" };
    },
    connectStructuredUnitOverlay: async (options) => {
      calls.push(["unit", options]);
      return { kind: "unit" };
    }
  });

  const pageResult = await connector.connectStaticPageOverlay({ pageId: "about" });
  const unitResult = await connector.connectStructuredUnitOverlay({ documentId: "investigation:test" });

  assert.equal(pageResult.kind, "page");
  assert.equal(unitResult.kind, "unit");
  assert.equal(calls[0][1].secretKeyHex, "c".repeat(64));
  assert.equal(calls[1][1].secretKeyHex, "c".repeat(64));
  assert.equal(calls[0][1].pageId, "about");
  assert.equal(calls[1][1].documentId, "investigation:test");
});
