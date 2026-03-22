import test from "node:test";
import assert from "node:assert/strict";

import SITE from "../scripts/core/site-config.js";
import { loadGraphProjection, loadWorkspaceProjection } from "../scripts/core/runtime-projections.js";

test("runtime projections treat the configured root admin as admin before public-state hydration catches up", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = String(input || "");
      if (url.includes("/content/investigations/index.json") || url.endsWith("./content/investigations/index.json")) {
        return new Response(JSON.stringify({ files: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.includes("/content/graph/wiki-seed.json") || url.endsWith("./content/graph/wiki-seed.json")) {
        return new Response(JSON.stringify({ entities: [], relationships: [], draft_relationships: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error(`Unexpected fetch in runtime projection test: ${url}`);
    };

    const session = {
      pubkey: String(SITE.nostr.rootAdminPubkey || "").trim().toLowerCase()
    };
    const host = {
      async getProjection(channel) {
        if (channel === "publicState") {
          return {
            connected: false,
            admins: [],
            approvedEntities: []
          };
        }
        if (channel === "graphDraft") {
          return {
            entities: [],
            relationships: []
          };
        }
        return null;
      }
    };

    const graphProjection = await loadGraphProjection({ session, host });
    const workspaceProjection = await loadWorkspaceProjection({ session, host });

    assert.equal(graphProjection.viewerIsAdmin, true);
    assert.equal(workspaceProjection.isAdmin, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
