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
  const tabs = new FakeElement();
  const pane = new FakeElement();
  const overlays = new FakeElement();
  shell.children.set("[data-workspace-tabs]", tabs);
  shell.children.set("[data-workspace-pane]", pane);
  shell.children.set("[data-workspace-overlays]", overlays);

  globalThis.document = {
    activeElement: null,
    querySelector(selector) {
      return {
        "[data-workspace-shell]": shell
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
  assert.match(shell.innerHTML, /Looking up workspace/);

  controller.render();
  assert.match(tabs.innerHTML, /Dashboard/);
  assert.match(pane.innerHTML, /Pane/);
});

test("workspace shell controller preserves overlay DOM when unrelated regions rerender", () => {
  class FakeElement {
    constructor() {
      this.textContent = "";
      this._innerHTML = "";
      this.innerHtmlWrites = 0;
      this.children = new Map();
    }
    querySelector(selector) {
      return this.children.get(selector) || null;
    }
    set innerHTML(value) {
      this._innerHTML = value;
      this.innerHtmlWrites += 1;
    }
    get innerHTML() {
      return this._innerHTML;
    }
  }

  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLInputElement = class HTMLInputElement extends FakeElement {};
  globalThis.HTMLTextAreaElement = class HTMLTextAreaElement extends FakeElement {};

  const shell = new FakeElement();
  const tabs = new FakeElement();
  const pane = new FakeElement();
  const overlays = new FakeElement();
  shell.children.set("[data-workspace-tabs]", tabs);
  shell.children.set("[data-workspace-pane]", pane);
  shell.children.set("[data-workspace-overlays]", overlays);

  globalThis.document = {
    activeElement: null,
    querySelector(selector) {
      return {
        "[data-workspace-shell]": shell
      }[selector] || null;
    }
  };

  const state = { session: { pubkey: "admin-pubkey" }, activeTab: "dashboard", publicState: null, passwordRotationModal: { pending: false } };
  let view = {
    title: "Workspace",
    lede: "Manage things",
    tabsMarkup: "<button>Dashboard</button>",
    paneMarkup: "<section>Pane one</section>",
    overlayMarkup: "<div data-password-modal>Overlay</div>"
  };
  const controller = createWorkspaceShellController({
    state,
    deps: {
      renderLoadingState: (message) => `<p>${message}</p>`,
      renderWorkspaceView: () => view
    },
    callbacks: {
      createSurfaceDeps: () => ({}),
      hydrateWorkspaceEnhancements: () => {}
    }
  });

  controller.render();
  const initialOverlayWrites = overlays.innerHtmlWrites;
  const initialOverlayMarkup = overlays.innerHTML;

  view = {
    ...view,
    paneMarkup: "<section>Pane two</section>"
  };
  controller.render({ soft: true });

  assert.equal(overlays.innerHtmlWrites, initialOverlayWrites, "unchanged overlays should not be replaced");
  assert.equal(overlays.innerHTML, initialOverlayMarkup);
  assert.equal(pane.innerHTML, "<section>Pane two</section>");
});
