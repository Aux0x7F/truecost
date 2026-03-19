import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceShellController } from "../scripts/features/workspace-shell.js";

test("workspace shell controller renders loading and hydrated views through the shared shell", () => {
  class FakeElement {
    constructor() {
      this.textContent = "";
      this.innerHTML = "";
      this.children = new Map();
    }
    querySelector(selector) {
      return this.children.get(selector) || null;
    }
  }

  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLInputElement = class HTMLInputElement extends FakeElement {};
  globalThis.HTMLTextAreaElement = class HTMLTextAreaElement extends FakeElement {};

  const shell = new FakeElement();
  shell.children.set("[data-workspace-tabs]", new FakeElement());
  shell.children.set("[data-workspace-pane]", new FakeElement());
  shell.children.set("[data-workspace-overlays]", new FakeElement());
  const title = new FakeElement();
  const lede = new FakeElement();

  globalThis.document = {
    activeElement: null,
    querySelector(selector) {
      return {
        "[data-workspace-shell]": shell,
        "[data-workspace-title]": title,
        "[data-workspace-lede]": lede
      }[selector] || null;
    }
  };

  const state = { session: { pubkey: "admin-pubkey" }, activeTab: "dashboard", publicState: null };
  const controller = createWorkspaceShellController({
    state,
    deps: {
      renderLoadingState: (message) => `<p>${message}</p>`,
      renderWorkspaceView: () => ({
        title: "Workspace",
        lede: "Manage things",
        tabsMarkup: "<button>Dashboard</button>",
        paneMarkup: "<section>Pane</section>",
        overlayMarkup: "<div>Overlay</div>"
      })
    },
    callbacks: {
      createSurfaceDeps: () => ({}),
      hydrateWorkspaceEnhancements: () => {}
    }
  });

  controller.renderLoading("Looking up workspace...");
  assert.equal(title.textContent, "Workspace");
  assert.equal(lede.textContent, "Looking up workspace...");

  controller.render();
  assert.equal(title.textContent, "Workspace");
  assert.equal(lede.textContent, "Manage things");
  assert.match(shell.innerHTML, /Dashboard/);
});
