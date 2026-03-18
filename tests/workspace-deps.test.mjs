import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceSurfaceDeps } from "../scripts/surfaces/workspace-deps.js";

test("workspace deps always include the shared search field renderer", () => {
  const deps = createWorkspaceSurfaceDeps({
    currentUserIsAdmin: () => true
  });

  assert.equal(typeof deps.renderSearchField, "function");
  assert.equal(typeof deps.currentUserIsAdmin, "function");
});
