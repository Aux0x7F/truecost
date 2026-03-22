import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspacePageController } from "../scripts/features/workspace-page.js";

test("workspace page controller routes basic tab and lifecycle events through callbacks", async () => {
  class FakeElement {}
  globalThis.Element = FakeElement;
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLFormElement = class HTMLFormElement extends FakeElement {};

  const shellListeners = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const shell = {
    addEventListener(type, handler) {
      shellListeners.set(type, handler);
    }
  };
  const state = {
    activeTab: "profile",
    submissionFilters: {},
    entityFilters: {},
    userFilters: {},
    commentFilters: {}
  };
  const calls = [];
  const documentStub = {
    visibilityState: "visible",
    querySelector(selector) {
      if (selector === "[data-workspace-page]") return {};
      if (selector === "[data-workspace-shell]") return shell;
      return null;
    },
    addEventListener(type, handler) {
      documentListeners.set(type, handler);
    }
  };
  const windowStub = {
    addEventListener(type, handler) {
      windowListeners.set(type, handler);
    }
  };

  const controller = createWorkspacePageController({
    state,
    deps: {
      document: documentStub,
      window: windowStub,
      getStoredSession: () => ({ username: "aux" })
    },
    callbacks: {
      refreshWorkspace: async () => {
        calls.push("refresh");
      },
      renderWorkspace: (options = {}) => {
        calls.push(`render:${options.soft ? "soft" : "full"}`);
      },
      setActiveTab: (tab) => {
        state.activeTab = tab;
        calls.push(`tab:${tab}`);
      },
      syncWorkspace: async (force) => {
        calls.push(`sync:${force ? "force" : "normal"}`);
      }
    }
  });

  assert.equal(controller.start(), true);
  await Promise.resolve();
  assert.deepEqual(calls, ["refresh"]);

  class TabTarget extends FakeElement {
    closest(selector) {
      if (selector === "[data-workspace-tab]") {
        return {
          getAttribute(name) {
            return name === "data-workspace-tab" ? "dashboard" : "";
          }
        };
      }
      return null;
    }
  }

  await shellListeners.get("click")({ target: new TabTarget() });
  assert.deepEqual(calls.slice(-2), ["tab:dashboard", "render:full"]);

  documentListeners.get("visibilitychange")();
  windowListeners.get("focus")();
  assert.deepEqual(calls.slice(-2), ["sync:force", "sync:force"]);
});
