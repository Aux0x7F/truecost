import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceDeepLinkController } from "../scripts/features/workspace-deep-links.js";

test("workspace deep link controller resolves user and comment links from the url param", async () => {
  globalThis.HTMLElement = class HTMLElement {};
  const calls = [];
  const focusedCard = new globalThis.HTMLElement();
  focusedCard.classList = {
    add(value) {
      calls.push(["addClass", value]);
    },
    remove(value) {
      calls.push(["removeClass", value]);
    }
  };
  focusedCard.scrollIntoView = (options) => {
    calls.push(["scroll", options]);
  };
  globalThis.document = {
    querySelector: (selector) => (selector === '[data-user-card="abcd"]' ? focusedCard : null)
  };
  globalThis.window = {
    location: new URL("https://example.test/admin.html?tab=users&user=abcd"),
    setTimeout(callback) {
      callback();
      return 1;
    }
  };
  globalThis.history = {
    replaceState: (_state, _title, url) => {
      calls.push(["replaceState", String(url)]);
    }
  };

  const state = {
    activeTab: "users",
    userLookupQuery: "",
    userLookupResult: { pubkey: "abcd" },
    commentFilters: { query: "" }
  };
  const controller = createWorkspaceDeepLinkController({
    state,
    deps: {
      normalizeDirectPubkey: (value) => String(value || "").trim().toLowerCase()
    },
    callbacks: {
      renderWorkspace: (options) => {
        calls.push(["render", options]);
      },
      resolveUserLookupQuery: async (query, options) => {
        calls.push(["resolve", query, options]);
      }
    }
  });

  await controller.maybeResolveUserDeepLink();
  assert.ok(calls.some(([type]) => type === "scroll"));

  state.activeTab = "moderation";
  controller.maybeResolveCommentDeepLink();
  assert.equal(state.commentFilters.query, "abcd");

  controller.clearWorkspaceLinkedUser();
  assert.ok(calls.some(([type]) => type === "replaceState"));
});
