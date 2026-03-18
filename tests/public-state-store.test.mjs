import test from "node:test";
import assert from "node:assert/strict";

import { createPublicStateStore } from "../scripts/core/public-state-store.js";

function createBaselineState(overrides = {}) {
  return {
    admins: [],
    users: [],
    approvedEntities: [],
    drafts: [],
    allComments: [],
    pendingAdminKeyRequests: [],
    siteInfo: {},
    ...overrides
  };
}

test("public state store hydrates from cache and notifies on digest changes", async () => {
  const cached = createBaselineState({ admins: ["root"] });
  const fresh = createBaselineState({ admins: ["root", "aux"] });
  const notifications = [];

  const store = createPublicStateStore({
    shouldRefresh: () => false,
    deps: {
      getCachedPublicState: () => cached,
      ensureEventToolsLoaded: async () => {},
      startPublicStateRepairPeer: async () => {},
      loadPublicState: async () => fresh,
      publicStateNeedsRepair: () => false,
      requestPublicStateRepair: async () => {},
      rememberPublicState: (value) => value,
      setTimeout: () => 1,
      clearTimeout: () => {}
    }
  });

  store.subscribe((snapshot) => notifications.push(snapshot));

  assert.deepEqual(store.value.admins, ["root"]);
  const result = await store.hydrate({ force: true, reason: "unit-hydrate" });
  assert.equal(result.changed, true);
  assert.deepEqual(store.value.admins, ["root", "aux"]);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].reason, "unit-hydrate");
});

test("public state store requests repair through injected transport and schedules follow-up hydrate", async () => {
  const repairCalls = [];
  const scheduled = [];
  const store = createPublicStateStore({
    getSessionSecretKey: async () => "sekret",
    page: "unit-page",
    shouldRefresh: () => false,
    deps: {
      getCachedPublicState: () => createBaselineState(),
      ensureEventToolsLoaded: async () => {},
      startPublicStateRepairPeer: async () => {},
      loadPublicState: async () => createBaselineState(),
      publicStateNeedsRepair: () => true,
      requestPublicStateRepair: async (secretKeyHex, payload) => {
        repairCalls.push({ secretKeyHex, payload });
      },
      rememberPublicState: (value) => value,
      setTimeout: (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length;
      },
      clearTimeout: () => {}
    }
  });

  const repaired = await store.maybeRequestRepair(createBaselineState({ rawEvents: [{ id: "one" }] }), "unit-repair");
  assert.equal(repaired, true);
  assert.equal(repairCalls.length, 1);
  assert.equal(repairCalls[0].secretKeyHex, "sekret");
  assert.equal(repairCalls[0].payload.page, "unit-page");
  assert.equal(repairCalls[0].payload.reason, "unit-repair");
  assert.equal(scheduled.length, 1);
});
