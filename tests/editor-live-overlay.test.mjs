import test from "node:test";
import assert from "node:assert/strict";

import { createEditorLiveOverlayController } from "../scripts/features/editor-live-overlay.js";

test("editor live overlay restores remote content only for the active document", async () => {
  const events = [];
  const state = {
    session: {
      secretKeyHex: "secret"
    },
    draftStatus: "draft",
    liveController: null,
    liveDocumentId: "",
    liveStatus: "idle",
    livePublishTimer: 0
  };
  const controller = createEditorLiveOverlayController({
    window: {
      setTimeout(handler) {
        handler();
        return 1;
      },
      clearTimeout() {}
    },
    state,
    connectStructuredUnitOverlay: async () => ({
      getContent() {
        return {
          title: "Remote"
        };
      },
      destroy() {},
      setContent() {
        events.push(["set"]);
      },
      flush() {
        events.push(["flush"]);
      }
    }),
    kind: 1,
    resolveSlug: () => "draft-a",
    investigationDocumentId: (slug) => `investigation:${slug}`,
    currentUserIsAdmin: () => true,
    trustedAdminPubkeys: () => [],
    buildDraftPayload: () => ({
      title: "Draft",
      markdown: "Body"
    }),
    draftToDocument: (value) => ({
      title: value.title || ""
    }),
    fingerprintDocument: (value) => JSON.stringify(value),
    readCurrentDocument: () => ({
      title: "Local"
    }),
    applyDocument: (value) => {
      events.push(["apply", value.title]);
    },
    updateMetaPanel: (message) => {
      events.push(["meta", message]);
    }
  });

  await controller.ensure();
  assert.equal(state.liveDocumentId, "investigation:draft-a");
  assert.deepEqual(events, [
    ["apply", "Remote"],
    ["meta", "Applied live updates from another admin."]
  ]);
});

test("editor live overlay publishes draft payload on schedule", async () => {
  const events = [];
  let scheduled = null;
  const state = {
    session: {
      secretKeyHex: "secret"
    },
    draftStatus: "draft",
    liveController: null,
    liveDocumentId: "",
    liveStatus: "idle",
    livePublishTimer: 0
  };
  const controller = createEditorLiveOverlayController({
    window: {
      setTimeout(handler) {
        scheduled = handler;
        return 2;
      },
      clearTimeout() {}
    },
    state,
    connectStructuredUnitOverlay: async () => ({
      getContent() {
        return {};
      },
      destroy() {},
      async setContent(payload) {
        events.push(["set", payload.title]);
      },
      async flush() {
        events.push(["flush"]);
      }
    }),
    kind: 1,
    resolveSlug: () => "draft-b",
    investigationDocumentId: (slug) => `investigation:${slug}`,
    currentUserIsAdmin: () => true,
    trustedAdminPubkeys: () => [],
    buildDraftPayload: () => ({
      title: "Draft B",
      markdown: "Body"
    }),
    draftToDocument: (value) => value,
    fingerprintDocument: (value) => JSON.stringify(value),
    readCurrentDocument: () => ({
      title: "Draft B"
    }),
    applyDocument: () => {},
    updateMetaPanel: () => {}
  });

  controller.schedule(1);
  await scheduled?.();
  assert.deepEqual(events, [
    ["set", "Draft B"],
    ["flush"]
  ]);
});
