import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAdminPubkeys, publicStateHasAdminPubkey } from "../scripts/core/public-state.js";

test("normalizeAdminPubkeys accepts string and object admin records", () => {
  const admins = normalizeAdminPubkeys({
    admins: [
      "ABC123",
      { pubkey: "def456" },
      { pubkey: "ABC123" },
      null,
      ""
    ]
  });

  assert.deepEqual(admins, ["abc123", "def456"]);
});

test("publicStateHasAdminPubkey matches normalized admin entries", () => {
  const publicState = {
    admins: [{ pubkey: "ABC123" }],
    rootAdminPubkey: "ROOT999"
  };

  assert.equal(publicStateHasAdminPubkey(publicState, "abc123"), true);
  assert.equal(publicStateHasAdminPubkey(publicState, "root999"), true);
  assert.equal(publicStateHasAdminPubkey(publicState, "missing"), false);
});
