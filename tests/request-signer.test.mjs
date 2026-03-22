import test from "node:test";
import assert from "node:assert/strict";

import { createRequestSigner } from "../scripts/core/request-signer.js";

test("request signer records visit pulse markers through runtime local state", async () => {
  globalThis.document = {
    body: {
      dataset: {
        page: "home"
      }
    }
  };

  const published = [];
  const remembered = [];
  const signer = createRequestSigner({
    state: {
      session: { secretKeyHex: "a".repeat(64) },
      guestSession: null
    },
    site: {
      nostr: {
        kinds: { visitPulse: 7001 }
      }
    },
    ensureEventToolsLoaded: async () => {},
    getOrCreateGuestSession: async () => null,
    ensureBlobAvailable: async () => {},
    publishTaggedJson: async (payload) => {
      published.push(payload);
    },
    loadVisitPulseMarker: async () => null,
    rememberVisitPulseMarker: async (...args) => {
      remembered.push(args);
    }
  });

  await signer.publishVisitPulse();

  assert.equal(published.length, 1);
  assert.equal(remembered.length, 1);
  assert.equal(remembered[0][0], "visitPulseMarker");
  assert.deepEqual(remembered[0][1], {
    day: new Date().toISOString().slice(0, 10)
  });
});

test("request signer skips duplicate visit pulses when a runtime marker already exists", async () => {
  globalThis.document = {
    body: {
      dataset: {
        page: "home"
      }
    }
  };

  let published = 0;
  const signer = createRequestSigner({
    state: {
      session: { secretKeyHex: "a".repeat(64) },
      guestSession: null
    },
    site: {
      nostr: {
        kinds: { visitPulse: 7001 }
      }
    },
    ensureEventToolsLoaded: async () => {},
    getOrCreateGuestSession: async () => null,
    ensureBlobAvailable: async () => {},
    publishTaggedJson: async () => {
      published += 1;
    },
    loadVisitPulseMarker: async () => ({ recordedAt: Date.now() }),
    rememberVisitPulseMarker: async () => {}
  });

  await signer.publishVisitPulse();

  assert.equal(published, 0);
});
