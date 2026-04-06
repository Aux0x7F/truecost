import test from "node:test";
import assert from "node:assert/strict";

import {
  getMockAdminSession,
  isLocalDevelopmentHost,
  mergeLocalAdminPublicState
} from "../scripts/core/dev-local-admin.js";

test("isLocalDevelopmentHost matches localhost variants", () => {
  assert.equal(isLocalDevelopmentHost("localhost"), true);
  assert.equal(isLocalDevelopmentHost("127.0.0.1"), true);
  assert.equal(isLocalDevelopmentHost("app.localhost"), true);
  assert.equal(isLocalDevelopmentHost("example.org"), false);
});

test("mergeLocalAdminPublicState overlays admin access without dropping existing data", () => {
  const mockSession = getMockAdminSession();
  const nextState = mergeLocalAdminPublicState(
    {
      connected: true,
      admins: ["existing-admin"],
      rootAdminPubkey: "root-admin",
      users: [
        {
          pubkey: "reader-pubkey",
          username: "reader",
          displayName: "Reader",
          socialLinks: ["https://example.org/@reader"]
        }
      ],
      approvedEntities: [{ slug: "county-yard" }],
      rawEvents: [
        {
          id: "cached:1",
          pubkey: "existing-admin",
          sig: "sig",
          kind: 0,
          created_at: 1,
          content: "",
          tags: []
        }
      ]
    },
    {
      username: "localadmin",
      pubkey: "dev-admin-pubkey",
      displayName: "Local Admin"
    }
  );

  assert.deepEqual(nextState.admins.sort(), [mockSession.pubkey, "existing-admin"]);
  assert.equal(nextState.rootAdminPubkey, "root-admin");
  assert.equal(nextState.approvedEntities.length, 1);
  assert.equal(nextState.users.length, 2);
  assert.equal(
    nextState.users.find((user) => user.pubkey === mockSession.pubkey)?.isAdmin,
    true
  );
  assert.equal(
    nextState.users.find((user) => user.pubkey === mockSession.pubkey)?.claimedUsername,
    "localadmin"
  );
});
