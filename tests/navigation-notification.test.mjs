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

test("notification state hydrates, dismisses, and clears items against runtime-backed dismissed ids", async () => {
  const persisted = new Map();
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
    loadDismissedIds: async (pubkey) => persisted.get(pubkey) || [],
    saveDismissedIds: async (pubkey, ids) => {
      persisted.set(pubkey, [...ids]);
    }
  });

  const hydrated = await notificationState.hydrate();
  assert.equal(countNotificationItems(hydrated), 2);
  assert.deepEqual(hydrated.map((item) => item.id), ["a", "b"]);

  notificationState.dismiss("a");
  assert.deepEqual(notificationState.items.map((item) => item.id), ["b"]);
  assert.deepEqual(persisted.get("viewer"), ["a"]);

  await notificationState.hydrate();
  assert.deepEqual(notificationState.items.map((item) => item.id), ["b"]);

  notificationState.clear();
  assert.deepEqual(notificationState.items, []);

  viewerPubkey = "";
  notificationState.reset();
  assert.deepEqual(notificationState.items, []);
});

test("notification state supports runtime-backed dismissed ids without rereading storage on every action", async () => {
  const persisted = new Map();
  const saves = [];
  const notificationState = createNotificationState({
    storageNamespace: "truecost.test",
    getSession: () => ({ username: "aux" }),
    getViewerPubkey: () => "viewer",
    getPublicState: async () => ({ ok: true }),
    buildNotifications: async () => [
      { id: "a", createdAt: 2 },
      { id: "b", createdAt: 1 }
    ],
    loadDismissedIds: async (pubkey) => persisted.get(pubkey) || [],
    saveDismissedIds: async (pubkey, ids) => {
      persisted.set(pubkey, [...ids]);
      saves.push({ pubkey, ids: [...ids] });
    }
  });

  await notificationState.hydrate();
  notificationState.dismiss("a");
  notificationState.clear();

  assert.deepEqual(persisted.get("viewer"), ["a", "b"]);
  assert.equal(saves.length, 2);
});
