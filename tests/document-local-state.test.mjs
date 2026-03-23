import test from "node:test";
import assert from "node:assert/strict";

import {
  createMemoryRuntimeDatabase,
  createRuntimeHost,
  createSharedRuntimeClient
} from "../vendor/nostr-site-support.esm.js";
import { createRuntimeDocumentLocalState } from "../scripts/core/document-local-state.js";

test("runtime document local state stores draft and history through projection envelopes", async () => {
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase()
  });
  const client = createSharedRuntimeClient({
    hostFactory: () => host
  });
  const localState = createRuntimeDocumentLocalState({
    getRuntimeClient: async () => client,
    resolveParams: (slug = "") => ({ docId: `investigation:${slug || "unsaved"}` }),
    draftKey: "draft"
  });

  await localState.saveDraft("factory-farms", { title: "Factory farms" });
  await localState.saveHistory("factory-farms", [{ label: "snapshot-1" }]);

  assert.deepEqual(await localState.loadDraft("factory-farms"), { title: "Factory farms" });
  assert.deepEqual(await localState.loadHistory("factory-farms"), [{ label: "snapshot-1" }]);
});

test("runtime document local state can move unsaved state onto a real slug", async () => {
  const host = createRuntimeHost({
    database: createMemoryRuntimeDatabase()
  });
  const client = createSharedRuntimeClient({
    hostFactory: () => host
  });
  const localState = createRuntimeDocumentLocalState({
    getRuntimeClient: async () => client,
    resolveParams: (slug = "") => ({ docId: `investigation:${slug || "unsaved"}` }),
    draftKey: "draft"
  });

  await localState.saveDraft("", { title: "Unsaved title" });
  await localState.saveHistory("", [{ label: "draft-1" }]);
  await localState.moveState("", "factory-farms");

  assert.equal(await localState.loadDraft(""), null);
  assert.deepEqual(await localState.loadHistory(""), []);
  assert.deepEqual(await localState.loadDraft("factory-farms"), { title: "Unsaved title" });
  assert.deepEqual(await localState.loadHistory("factory-farms"), [{ label: "draft-1" }]);
});
