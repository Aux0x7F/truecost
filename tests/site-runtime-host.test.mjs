import test from "node:test";
import assert from "node:assert/strict";

import { createMemoryRuntimeDatabase } from "../vendor/nostr-site-support.esm.js";
import { createSiteRuntimeHost } from "../scripts/core/site-runtime-host.js";
import { buildStaticPageDocument } from "../scripts/core/static-page-document.js";

function createPublicState() {
  return {
    connected: true,
    users: [],
    approvedEntities: [],
    commentsByPost: new Map(),
    commentIndex: new Map(),
    commentThreadsByPost: new Map()
  };
}

test("site runtime host persists session and exposes builtin/runtime projections", async () => {
  const database = createMemoryRuntimeDatabase();
  const session = {
    username: "aux",
    secretKeyHex: "a".repeat(64),
    pubkey: "b".repeat(64)
  };
  const host = createSiteRuntimeHost({
    database,
    deps: {
      openAccountSession: async () => ({
        session,
        warning: "network is catching up"
      }),
      loadPublicState: async () => createPublicState(),
      loadGraphProjection: async () => ({
        viewerIsAdmin: true,
        publicState: createPublicState(),
        posts: [],
        seed: {},
        draftGraph: { entities: [], relationships: [] },
        graphState: {
          graph: {
            nodes: [],
            edges: []
          }
        }
      })
    }
  });

  const signedIn = await host.signIn({
    username: "aux",
    password: "secret123"
  });
  assert.equal(signedIn.session.pubkey, session.pubkey);
  assert.match(String(signedIn.warning || ""), /catching up/);

  const currentSession = await host.getSession();
  assert.equal(currentSession.pubkey, session.pubkey);

  const sessionProjection = await host.getProjection("session", {}, { preferFresh: true });
  assert.equal(sessionProjection.value.pubkey, session.pubkey);

  const viewerProjection = await host.getProjection("viewer", {}, { preferFresh: true });
  assert.deepEqual(viewerProjection.value, {
    username: "aux",
    pubkey: session.pubkey
  });

  const publicStateProjection = await host.getProjection("publicState", {}, { preferFresh: true });
  assert.equal(publicStateProjection.value.connected, true);

  const graphProjection = await host.getProjection("graph", {}, { preferFresh: true });
  assert.equal(graphProjection.value.viewerIsAdmin, true);

  await host.rememberProjection("graphDraft", {}, {
    entities: [{ slug: "north-valley-foods" }],
    relationships: []
  }, {
    source: "test"
  });
  const rememberedDraft = await host.getProjection("graphDraft", {}, { preferFresh: false });
  assert.deepEqual(rememberedDraft.value.entities, [{ slug: "north-valley-foods" }]);

  const restartedHost = createSiteRuntimeHost({
    database,
    deps: {
      openAccountSession: async () => ({
        session
      }),
      loadPublicState: async () => createPublicState()
    }
  });
  await restartedHost.seedSession(session, { force: true });
  const persistedDraft = await restartedHost.getProjection("graphDraft", {}, { preferFresh: true });
  assert.deepEqual(persistedDraft.value.entities, [{ slug: "north-valley-foods" }]);
});

test("site runtime host falls back to cached public state when live refresh is unavailable", async () => {
  const database = createMemoryRuntimeDatabase();
  const cachedPublicState = {
    connected: true,
    admins: ["b".repeat(64)],
    users: [{ pubkey: "b".repeat(64), username: "aux", displayName: "Aux", socialLinks: [] }],
    approvedEntities: [],
    commentsByPost: new Map(),
    commentIndex: new Map(),
    commentThreadsByPost: new Map()
  };

  await database.setProjection("publicState", {}, {
    channel: "publicState",
    params: {},
    value: cachedPublicState,
    meta: { source: "test-cache" }
  });

  const host = createSiteRuntimeHost({
    database,
    deps: {
      loadPublicState: async () => {
        throw new Error("Nostr tools unavailable.");
      }
    }
  });

  const publicStateProjection = await host.getProjection("publicState", {}, { preferFresh: true });
  assert.equal(publicStateProjection.value.connected, true);
  assert.deepEqual(publicStateProjection.value.admins, cachedPublicState.admins);
});

test("site runtime host round-trips static page snapshots through the document store", async () => {
  const database = createMemoryRuntimeDatabase();
  const host = createSiteRuntimeHost({ database });

  await host.openDocument({
    docId: "static-page:about",
    kind: "static-page",
    initialDocument: buildStaticPageDocument({
      pageId: "about"
    })
  });

  const saved = await host.applyDocument({
    docId: "static-page:about",
    document: buildStaticPageDocument({
      pageId: "about",
      savedAt: 789,
      content: {
        "about.hero.title": "<strong>About</strong>"
      }
    })
  });

  assert.equal(saved.value.document.metadata.pageId, "about");
  assert.equal(saved.value.document.metadata.savedAt, 789);
  assert.deepEqual(saved.value.document.metadata.pageContent, {
    "about.hero.title": "<strong>About</strong>"
  });
});
