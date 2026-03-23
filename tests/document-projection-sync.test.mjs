import test from "node:test";
import assert from "node:assert/strict";

import { createDocumentProjectionSync } from "../scripts/core/document-projection-sync.js";

test("document projection sync keeps last applied document when projection fingerprint is unchanged", async () => {
  const events = [];
  const state = {
    draftStatus: "draft",
    suppressSyncDepth: 0,
    documentController: null,
    documentControllerId: "",
    documentProjection: null,
    documentProjectionFingerprint: "",
    documentSyncTimer: 0
  };
  const projection = {
    document: {
      title: "Doc A"
    }
  };
  const sync = createDocumentProjectionSync({
    window: {
      setTimeout(handler) {
        handler();
        return 1;
      },
      clearTimeout() {}
    },
    state,
    canEdit: () => true,
    resolveDocId: () => "doc:a",
    createController: async () => ({
      subscribe(listener) {
        events.push(["subscribe"]);
        this.listener = listener;
      },
      async open() {
        events.push(["open"]);
        return projection;
      },
      async replaceDocument(nextDocument) {
        events.push(["replace", nextDocument.title]);
        return {
          document: nextDocument
        };
      },
      destroy() {
        events.push(["destroy"]);
      }
    }),
    buildDocument: () => ({
      title: "Doc A"
    }),
    projectionToDocument: (value) => ({
      title: value.document.title
    }),
    readCurrentDocument: () => ({
      title: "Doc A"
    }),
    createBlankDocument: () => ({
      title: ""
    }),
    fingerprintDocument: (value) => JSON.stringify(value),
    applyDocument: () => {
      events.push(["apply"]);
    },
    updateMetaPanel: (message) => {
      events.push(["meta", message]);
    },
    restoreMessage: "restored"
  });

  await sync.ensure();
  assert.deepEqual(events, [
    ["subscribe"],
    ["open"]
  ]);

  events.length = 0;
  sync.handleProjection(projection, { source: "source" });
  assert.deepEqual(events, []);
});

test("document projection sync replaces runtime document when editor can write", async () => {
  const events = [];
  const state = {
    draftStatus: "draft",
    suppressSyncDepth: 0,
    documentController: null,
    documentControllerId: "",
    documentProjection: null,
    documentProjectionFingerprint: "",
    documentSyncTimer: 0
  };
  const sync = createDocumentProjectionSync({
    window: {
      setTimeout(handler) {
        handler();
        return 9;
      },
      clearTimeout() {}
    },
    state,
    canEdit: () => true,
    resolveDocId: () => "doc:b",
    createController: async () => ({
      subscribe() {},
      async open() {
        return {
          document: {
            title: "Doc B"
          }
        };
      },
      async replaceDocument(nextDocument) {
        events.push(["replace", nextDocument.title]);
        return {
          document: nextDocument
        };
      },
      destroy() {}
    }),
    buildDocument: () => ({
      title: "Doc B2"
    }),
    projectionToDocument: (value) => ({
      title: value.document.title
    }),
    readCurrentDocument: () => ({
      title: "Doc B"
    }),
    createBlankDocument: () => ({
      title: ""
    }),
    fingerprintDocument: (value) => JSON.stringify(value),
    applyDocument: () => {},
    updateMetaPanel: () => {}
  });

  await sync.syncNow(true);
  assert.deepEqual(events, [["replace", "Doc B2"]]);
});
