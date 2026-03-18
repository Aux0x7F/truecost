import test from "node:test";
import assert from "node:assert/strict";

import { requestedMapEntity } from "../scripts/surfaces/map.js";

test("requestedMapEntity returns the cleaned requested entity slug", () => {
  const requested = requestedMapEntity("?entity=County-Line", (value) => String(value || "").trim().toLowerCase());
  assert.equal(requested, "county-line");
});
