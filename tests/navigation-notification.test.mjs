import test from "node:test";
import assert from "node:assert/strict";

import {
  clampNotificationsPanel,
  closeProfileMenu,
  createNavigationUiState,
  keepProfileMenuOpen,
  toggleNotificationsPanel,
  toggleProfileMenu
} from "../scripts/core/navigation-state.js";
import {
  countNotificationItems,
  createNotificationState
} from "../scripts/core/notification-state.js";

test("navigation ui state keeps notification panel constrained to available items", () => {
  const state = createNavigationUiState();
  assert.equal(state.profileMenuOpen, false);
  assert.equal(toggleProfileMenu(state), true);
  assert.equal(state.profileMenuOpen, true);
  assert.equal(toggleNotificationsPanel(state, { count: 2, loading: false }), true);
  assert.equal(state.notificationsExpanded, true);
  assert.equal(clampNotificationsPanel(state, { count: 0, loading: false }), false);
  keepProfileMenuOpen(state);
  assert.equal(state.profileMenuOpen, true);
  closeProfileMenu(state);
  assert.deepEqual(state, { profileMenuOpen: false, notificationsExpanded: false });
});

test("notification state hydrates, dismisses, and clears items against local storage keys", async () => {
  const storage = new Map();
  let viewerPubkey = "viewer";
  const notificationState = createNotificationState({
    storageNamespace: "truecost.test",
    getSession: () => ({ username: "aux" }),
    getViewerPubkey: () => viewerPubkey,
    getPublicState: async () => ({ ok: true }),
    buildNotifications: async () => [
      { id: "a", createdAt: 3 },
      { id: "b", createdAt: 2 },
      { id: "a", createdAt: 1 }
    ],
    readStorage: (key) => storage.get(key) || null,
    writeStorage: (key, value) => storage.set(key, value)
  });

  const hydrated = await notificationState.hydrate();
  assert.equal(countNotificationItems(hydrated), 2);
  assert.deepEqual(hydrated.map((item) => item.id), ["a", "b"]);

  notificationState.dismiss("a");
  assert.deepEqual(notificationState.items.map((item) => item.id), ["b"]);
  assert.match(storage.get("truecost.test.notifications.dismissed.viewer"), /"a"/);

  await notificationState.hydrate();
  assert.deepEqual(notificationState.items.map((item) => item.id), ["b"]);

  notificationState.clear();
  assert.deepEqual(notificationState.items, []);

  viewerPubkey = "";
  notificationState.reset();
  assert.deepEqual(notificationState.items, []);
});
