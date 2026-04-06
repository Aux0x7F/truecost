import test from "node:test";
import assert from "node:assert/strict";

import { createImmediateSiteShell } from "../scripts/core/immediate-site-shell.js";

test("immediate site shell treats cached admin sessions as admin, not just the root admin", () => {
  class FakeElement {
    constructor() {
      this.innerHTML = "";
      this.classList = {
        toggle() {},
        contains() {
          return false;
        }
      };
    }
    setAttribute() {}
    addEventListener() {}
  }

  globalThis.HTMLElement = FakeElement;
  globalThis.document = {
    body: {
      dataset: { page: "workspace" },
      classList: {
        toggle() {}
      }
    },
    querySelector(selector) {
      return {
        "[data-site-nav]": nav
      }[selector] || null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {}
  };
  globalThis.window = {
    innerWidth: 1200,
    addEventListener() {},
    dispatchEvent() {},
    location: {
      reload() {}
    }
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type) {
      this.type = type;
    }
  };

  const nav = new FakeElement();
  const shell = createImmediateSiteShell({
    site: {
      nostr: {
        rootAdminPubkey: "root-admin"
      }
    },
    navKeys: {
      workspace: ["workspace"]
    },
    renderNavigationMarkup({ isAdmin }) {
      return isAdmin ? "<nav>Admin</nav>" : "<nav>User</nav>";
    },
    deps: {
      getStoredSession: () => ({
        username: "localadmin",
        pubkey: "local-admin-pubkey"
      }),
      getCachedPublicState: () => ({
        admins: [],
        users: [
          {
            pubkey: "local-admin-pubkey",
            username: "localadmin",
            isAdmin: true
          }
        ]
      }),
      publicStateHasAdminPubkey: (publicState, pubkey) =>
        (publicState?.users || []).some((user) => user.pubkey === pubkey && user.isAdmin)
    }
  });

  shell.mount();
  assert.match(nav.innerHTML, /Admin/);
});
