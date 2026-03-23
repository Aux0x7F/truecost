import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceProjectionClient } from "../scripts/core/workspace-runtime-projections.js";

test("workspace projection client reads and writes site-key and inbox projections", async () => {
  const calls = [];
  const runtimeClient = {
    async getProjection(channel, params, options) {
      calls.push(["get", channel, params, options]);
      if (channel === "workspaceSiteKeys") {
        return {
          value: {
            siteKeyShares: [{ sitePubkey: "site-a", siteSecretKeyHex: "a".repeat(64) }]
          }
        };
      }
      if (channel === "workspaceInbox") {
        return {
          value: {
            activeSitePubkey: "site-a",
            submissions: [{ id: "sub-1" }]
          }
        };
      }
      return { value: null };
    },
    async rememberProjection(channel, params, value, meta) {
      calls.push(["remember", channel, params, value, meta]);
      return { value };
    }
  };
  const projectionClient = createWorkspaceProjectionClient({
    getRuntimeClient: async () => runtimeClient,
    resolveSitePubkey: (publicState) => publicState?.siteInfo?.activePubkey || "",
    findSiteKeyShare: (shares, sitePubkey) =>
      (Array.isArray(shares) ? shares : []).find((share) => share.sitePubkey === sitePubkey) || null
  });

  const shares = await projectionClient.loadCachedSiteKeyShares();
  const inbox = await projectionClient.loadCachedInboxProjection();
  await projectionClient.persistSiteKeyShares(
    [{ sitePubkey: "site-b", siteSecretKeyHex: "b".repeat(64) }],
    { siteInfo: { activePubkey: "site-b" } }
  );
  await projectionClient.persistInboxSubmissions(
    [{ id: "sub-2" }],
    { sitePubkey: "site-b", publicState: { siteInfo: { activePubkey: "site-b" } } }
  );
  await projectionClient.clearInboxSubmissions({
    sitePubkey: "site-b",
    publicState: { siteInfo: { activePubkey: "site-b" } }
  });

  assert.deepEqual(shares, [{ sitePubkey: "site-a", siteSecretKeyHex: "a".repeat(64) }]);
  assert.deepEqual(inbox, {
    activeSitePubkey: "site-a",
    submissions: [{ id: "sub-1" }]
  });
  assert.deepEqual(calls.slice(0, 2), [
    ["get", "workspaceSiteKeys", {}, { preferFresh: false, reason: "workspace-site-keys-cache" }],
    ["get", "workspaceInbox", {}, { preferFresh: false, reason: "workspace-inbox-cache" }]
  ]);
  assert.deepEqual(calls.slice(2), [
    [
      "remember",
      "workspaceSiteKeys",
      {},
      {
        activeSitePubkey: "site-b",
        siteKeyShares: [{ sitePubkey: "site-b", siteSecretKeyHex: "b".repeat(64) }],
        siteKeyShare: { sitePubkey: "site-b", siteSecretKeyHex: "b".repeat(64) }
      },
      { source: "workspace-site-key-cache" }
    ],
    [
      "remember",
      "workspaceInbox",
      {},
      {
        activeSitePubkey: "site-b",
        submissions: [{ id: "sub-2" }]
      },
      { source: "workspace-inbox-cache" }
    ],
    [
      "remember",
      "workspaceInbox",
      {},
      {
        activeSitePubkey: "site-b",
        submissions: []
      },
      { source: "workspace-inbox-cache" }
    ]
  ]);
});
