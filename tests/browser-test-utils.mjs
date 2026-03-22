import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function contentType(filePath) {
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".md": "text/markdown; charset=utf-8",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg"
  }[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

export async function createStaticServer(root, port = 0) {
  const staticRoot = await resolveStaticRoot(root);
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const relativePath = urlPath === "/" ? "/index.html" : urlPath;
      const filePath = await resolveServedFile(root, staticRoot, relativePath);
      const buffer = await fs.readFile(filePath);
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      res.end(buffer);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  return {
    server,
    port: typeof address === "object" && address ? address.port : port
  };
}

export async function loadPlaywright(repoRoot = process.cwd()) {
  const candidatePaths = [
    path.resolve(repoRoot, "../nostr-site-hotfix/tooling/browser-smoke/node_modules/playwright/index.mjs"),
    path.resolve(repoRoot, "../nostr-site/tooling/browser-smoke/node_modules/playwright/index.mjs")
  ];
  try {
    for (const playwrightPath of candidatePaths) {
      try {
        return await import(pathToFileURL(playwrightPath).href);
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function prepareBrowserContext(context) {
  if (!context?.addInitScript) return;
  await context.addInitScript(() => {
    globalThis.__TRUECOST_DISABLE_SHARED_WORKER__ = true;
    globalThis.__TRUECOST_RUNTIME_OFFLINE__ = true;
  });
}

async function resolveStaticRoot(root) {
  const candidate = path.resolve(root, "dist");
  try {
    await fs.access(path.join(candidate, "index.html"));
    return candidate;
  } catch {
    return root;
  }
}

async function resolveServedFile(root, staticRoot, relativePath) {
  const servedRoot = staticRoot || root;
  const preferredPath = path.join(servedRoot, relativePath);
  try {
    await fs.access(preferredPath);
    return preferredPath;
  } catch {
    if (servedRoot !== root && !/\.html$/i.test(relativePath)) {
      const sourcePath = path.join(root, relativePath);
      await fs.access(sourcePath);
      return sourcePath;
    }
    throw new Error(`Missing static asset: ${relativePath}`);
  }
}

export function captureRelevantConsoleErrors(page, bucket) {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (
      text.includes("renderSearchField") ||
      text.includes("Node.removeChild") ||
      text.includes("toastui") ||
      text.includes("ReferenceError") ||
      text.includes("TypeError") ||
      text.includes("DOMException")
    ) {
      bucket.push(text);
    }
  });
}

async function seedRuntimeSnapshot(
  page,
  {
    session = undefined,
    publicState = undefined,
    projections = [],
    refreshChannels = []
  } = {}
) {
  await page.evaluate(
    async ({ nextSession, nextPublicState, nextProjections, nextRefreshChannels }) => {
      const { getSiteRuntimeClient } = await import("./scripts/core/runtime-client.js");
      const runtimeClient = await getSiteRuntimeClient();
      if (typeof nextSession !== "undefined") {
        await runtimeClient.seedSession(nextSession ?? null, { force: true });
      }
      if (typeof nextPublicState !== "undefined") {
        await runtimeClient.rememberProjection("publicState", {}, nextPublicState, {
          source: "browser-test-seed"
        });
      }
      for (const projection of Array.isArray(nextProjections) ? nextProjections : []) {
        await runtimeClient.rememberProjection(
          projection?.channel || "",
          projection?.params || {},
          projection?.value ?? null,
          {
            source: "browser-test-seed",
            ...(projection?.meta && typeof projection.meta === "object" ? projection.meta : {})
          }
        );
      }
      if (typeof nextPublicState !== "undefined") {
        await new Promise((resolve) => window.setTimeout(resolve, 80));
        await runtimeClient.rememberProjection("publicState", {}, nextPublicState, {
          source: "browser-test-seed"
        });
      }
      for (const refreshChannel of Array.isArray(nextRefreshChannels) ? nextRefreshChannels : []) {
        await runtimeClient.refreshProjection(String(refreshChannel || "").trim(), {}, {
          reason: "browser-test-seed"
        });
      }
    },
    {
      nextSession: session,
      nextPublicState: publicState,
      nextProjections: projections,
      nextRefreshChannels: refreshChannels
    }
  );
}

async function hydrateLegacyRuntimeCaches(page) {
  await page.evaluate(async () => {
    const sessionModule = await import("./scripts/core/session.js");
    const nostrModule = await import("./scripts/core/nostr.js");
    await Promise.resolve(sessionModule.hydrateStoredSessions?.()).catch(() => null);
    await Promise.resolve(nostrModule.hydrateCachedPublicState?.()).catch(() => null);
  });
}

export async function seedAdminSession(page, { port, secretKeyHex, pubkey }) {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
  const session = { username: "smoke-user", secretKeyHex, pubkey };
  const publicState = {
    admins: [pubkey],
    users: [{ pubkey, username: "smoke-user", displayName: "Smoke User", socialLinks: [] }],
    entities: [{ slug: "county-yard", name: "County Yard", location: "Phoenix, Arizona", status: "approved", type: "facility", notes: "" }],
    approvedEntities: [{ slug: "county-yard", name: "County Yard", location: "Phoenix, Arizona", status: "approved", type: "facility", notes: "" }],
    drafts: [],
    allComments: [],
    comments: [],
    metrics: {},
    rawEvents: [{ id: "cached:1", kind: 0 }],
    syncInfo: { connected: false, remoteEventCount: 0, cachedEventCount: 1, mergedEventCount: 1 }
  };
  await page.evaluate(({ nextSession, nextPublicState }) => {
    localStorage.setItem(
      "truecost.v2.session",
      JSON.stringify(nextSession)
    );
    localStorage.setItem("truecost.v2.public-state-snapshot", JSON.stringify(nextPublicState));
  }, { nextSession: session, nextPublicState: publicState });
  await hydrateLegacyRuntimeCaches(page);
  await seedRuntimeSnapshot(page, { session, publicState, refreshChannels: ["graph"] });
  await page.waitForTimeout(180);
  await seedRuntimeSnapshot(page, { session, publicState, refreshChannels: ["graph"] });
}

export async function seedLegacyAdminSession(page, { port, secretKeyHex, username = "smoke-user", adminPubkey = "" }) {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
  const session = { username, secretKeyHex };
  const publicState = {
    admins: adminPubkey ? [adminPubkey] : [],
    rootAdminPubkey: adminPubkey || "",
    users: [{ pubkey: adminPubkey || "", username, displayName: "Smoke User", socialLinks: [] }],
    entities: [],
    approvedEntities: [],
    drafts: [],
    allComments: [],
    comments: [],
    metrics: {},
    rawEvents: [{ id: "cached:legacy-session", kind: 0 }],
    syncInfo: { connected: false, remoteEventCount: 0, cachedEventCount: 1, mergedEventCount: 1 }
  };
  await page.evaluate(({ nextSession, nextPublicState }) => {
    localStorage.setItem(
      "truecost.v2.session",
      JSON.stringify(nextSession)
    );
    localStorage.setItem("truecost.v2.public-state-snapshot", JSON.stringify(nextPublicState));
  }, { nextSession: session, nextPublicState: publicState });
  await hydrateLegacyRuntimeCaches(page);
  await seedRuntimeSnapshot(page, { publicState });
}

export async function seedKnownUsernameOwner(page, { port, username = "aux", ownerPubkey = "" }) {
  const canonicalOwnerPubkey = ownerPubkey || "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa";
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
  const publicState = {
    connected: true,
    admins: [],
    users: [
      {
        pubkey: canonicalOwnerPubkey,
        username,
        claimedUsername: username,
        displayName: username,
        socialLinks: []
      }
    ],
    usernameRegistry: [
      {
        username,
        owner_pubkey: canonicalOwnerPubkey,
        claimant_pubkeys: [canonicalOwnerPubkey],
        conflict: false
      }
    ],
    usernameCollisions: [],
    entities: [],
    approvedEntities: [],
    drafts: [],
    allComments: [],
    comments: [],
    metrics: {},
    rawEvents: [{ id: "cached:owner", kind: 0 }],
    syncInfo: { connected: true, remoteEventCount: 1, cachedEventCount: 1, mergedEventCount: 1 }
  };
  await page.evaluate(
    ({ claimedUsername, nextOwnerPubkey, nextPublicState }) => {
      localStorage.removeItem("truecost.v2.session");
      localStorage.setItem(
        "truecost.v2.public-state-snapshot",
        JSON.stringify(nextPublicState)
      );
    },
    { claimedUsername: username, nextOwnerPubkey: canonicalOwnerPubkey, nextPublicState: publicState }
  );
  await hydrateLegacyRuntimeCaches(page);
  await seedRuntimeSnapshot(page, { session: null, publicState });
  await page.waitForTimeout(180);
  await seedRuntimeSnapshot(page, { session: null, publicState });
}

export async function seedConflictedUsernameSession(page, { port, secretKeyHex, claimedUsername = "aux", ownerPubkey = "" }) {
  const canonicalOwnerPubkey = ownerPubkey || "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa";
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
  await hydrateLegacyRuntimeCaches(page);
  const derivedConflictSession = await page.evaluate(
    async ({ nextSecretKeyHex, nextClaimedUsername }) => {
      const { deriveIdentity } = await import("./scripts/core/nostr.js");
      const identity = deriveIdentity(String(nextSecretKeyHex || "").trim().toLowerCase());
      return {
        username: String(nextClaimedUsername || "").trim().toLowerCase(),
        secretKeyHex: String(nextSecretKeyHex || "").trim().toLowerCase(),
        pubkey: String(identity?.pubkey || "").trim().toLowerCase()
      };
    },
    { nextSecretKeyHex: secretKeyHex, nextClaimedUsername: claimedUsername }
  );
  const conflictedPubkey = String(derivedConflictSession?.pubkey || "").trim().toLowerCase();
  await page.evaluate(
    ({
      nextClaimedUsername,
      nextOwnerPubkey,
      nextConflictedPubkey
    }) => {
      const nextPublicState = {
        connected: true,
        admins: [],
        users: [
          {
            pubkey: nextOwnerPubkey,
            username: nextClaimedUsername,
            claimedUsername: nextClaimedUsername,
            displayName: nextClaimedUsername,
            socialLinks: []
          },
          {
            pubkey: nextConflictedPubkey,
            username: "",
            claimedUsername: nextClaimedUsername,
            usernameConflict: true,
            usernameOwnerPubkey: nextOwnerPubkey,
            displayName: nextClaimedUsername,
            socialLinks: []
          }
        ],
        usernameRegistry: [
          {
            username: nextClaimedUsername,
            owner_pubkey: nextOwnerPubkey,
            claimant_pubkeys: [nextOwnerPubkey, nextConflictedPubkey],
            conflict: true
          }
        ],
        usernameCollisions: [
          {
            username: nextClaimedUsername,
            owner_pubkey: nextOwnerPubkey,
            claimant_pubkeys: [nextOwnerPubkey, nextConflictedPubkey],
            conflict: true
          }
        ],
        entities: [],
        approvedEntities: [],
        drafts: [],
        allComments: [],
        comments: [],
        metrics: { usernameCollisionCount: 1 },
        rawEvents: [{ id: "cached:conflict", kind: 0 }],
        syncInfo: { connected: true, remoteEventCount: 1, cachedEventCount: 1, mergedEventCount: 1 }
      };
      localStorage.setItem(
        "truecost.v2.username-integrity",
        JSON.stringify({
          [`${String(nextClaimedUsername || "").trim().toLowerCase()}:${String(nextConflictedPubkey || "").trim().toLowerCase()}`]: {
            conflict: true,
            claimedUsername: String(nextClaimedUsername || "").trim().toLowerCase(),
            ownerPubkey: String(nextOwnerPubkey || "").trim().toLowerCase(),
            checkedAt: Date.now(),
            source: "lookup"
          }
        })
      );
      localStorage.setItem(
        "truecost.v2.public-state-snapshot",
        JSON.stringify(nextPublicState)
      );
    },
    {
      nextClaimedUsername: claimedUsername,
      nextOwnerPubkey: canonicalOwnerPubkey,
      nextConflictedPubkey: conflictedPubkey
    }
  );
  await hydrateLegacyRuntimeCaches(page);
  await seedRuntimeSnapshot(page, {
    session: derivedConflictSession,
    publicState: {
      connected: true,
      admins: [],
      users: [
        {
          pubkey: canonicalOwnerPubkey,
          username: claimedUsername,
          claimedUsername,
          displayName: claimedUsername,
          socialLinks: []
        },
        {
          pubkey: conflictedPubkey,
          username: "",
          claimedUsername,
          usernameConflict: true,
          usernameOwnerPubkey: canonicalOwnerPubkey,
          displayName: claimedUsername,
          socialLinks: []
        }
      ],
      usernameRegistry: [
        {
          username: claimedUsername,
          owner_pubkey: canonicalOwnerPubkey,
          claimant_pubkeys: [canonicalOwnerPubkey, conflictedPubkey],
          conflict: true
        }
      ],
      usernameCollisions: [
        {
          username: claimedUsername,
          owner_pubkey: canonicalOwnerPubkey,
          claimant_pubkeys: [canonicalOwnerPubkey, conflictedPubkey],
          conflict: true
        }
      ],
      entities: [],
      approvedEntities: [],
      drafts: [],
      allComments: [],
      comments: [],
      metrics: { usernameCollisionCount: 1 },
      rawEvents: [{ id: "cached:conflict", kind: 0 }],
      syncInfo: { connected: true, remoteEventCount: 1, cachedEventCount: 1, mergedEventCount: 1 }
    }
  });
  await page.evaluate(
    async ({ nextClaimedUsername, nextOwnerPubkey, nextConflictedPubkey }) => {
      const { getSiteRuntimeClient } = await import("./scripts/core/runtime-client.js");
      const runtimeClient = await getSiteRuntimeClient();
      await runtimeClient.rememberProjection(
        "usernameIntegrity",
        {
          username: String(nextClaimedUsername || "").trim().toLowerCase(),
          pubkey: String(nextConflictedPubkey || "").trim().toLowerCase(),
          __projectionScope: "global"
        },
        {
          conflict: true,
          claimedUsername: String(nextClaimedUsername || "").trim().toLowerCase(),
          ownerPubkey: String(nextOwnerPubkey || "").trim().toLowerCase(),
          checkedAt: Date.now(),
          source: "lookup"
        },
        { source: "browser-test-seed" }
      );
    },
    {
      nextClaimedUsername: claimedUsername,
      nextOwnerPubkey: canonicalOwnerPubkey,
      nextConflictedPubkey: conflictedPubkey
    }
  );
}

export async function seedHistoryCurrentUsernameSession(
  page,
  {
    port,
    secretKeyHex,
    pubkey,
    claimedUsername = "aux",
    historicalPubkeys = [],
    staleOwnerPubkey = ""
  }
) {
  const knownPubkeys = [...new Set([...(Array.isArray(historicalPubkeys) ? historicalPubkeys : []), pubkey])]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  const fallbackOwnerPubkey = staleOwnerPubkey || knownPubkeys.find((value) => value !== String(pubkey || "").trim().toLowerCase()) || pubkey;
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({
      nextSecretKeyHex,
      nextPubkey,
      nextClaimedUsername,
      nextKnownPubkeys,
      nextStaleOwnerPubkey
    }) => {
      const normalizedUsername = String(nextClaimedUsername || "").trim().toLowerCase();
      const normalizedPubkey = String(nextPubkey || "").trim().toLowerCase();
      localStorage.setItem(
        "truecost.v2.session",
        JSON.stringify({ username: normalizedUsername, secretKeyHex: nextSecretKeyHex, pubkey: normalizedPubkey })
      );
      localStorage.setItem(
        "truecost.v2.account-history",
        JSON.stringify({
          [normalizedUsername]: {
            username: normalizedUsername,
            currentPubkey: normalizedPubkey,
            knownPubkeys: nextKnownPubkeys,
            updatedAt: Date.now()
          }
        })
      );
      localStorage.setItem(
        "truecost.v2.username-integrity",
        JSON.stringify({
          [`${normalizedUsername}:${normalizedPubkey}`]: {
            conflict: true,
            claimedUsername: normalizedUsername,
            ownerPubkey: String(nextStaleOwnerPubkey || "").trim().toLowerCase(),
            checkedAt: Date.now(),
            source: "lookup"
          }
        })
      );
      localStorage.setItem(
        "truecost.v2.public-state-snapshot",
        JSON.stringify({
          connected: true,
          admins: [normalizedPubkey],
          users: [
            {
              pubkey: normalizedPubkey,
              username: "",
              claimedUsername: normalizedUsername,
              usernameConflict: true,
              usernameOwnerPubkey: String(nextStaleOwnerPubkey || "").trim().toLowerCase(),
              displayName: normalizedUsername,
              socialLinks: []
            }
          ],
          usernameRegistry: [
            {
              username: normalizedUsername,
              owner_pubkey: String(nextStaleOwnerPubkey || "").trim().toLowerCase(),
              claimant_pubkeys: [String(nextStaleOwnerPubkey || "").trim().toLowerCase(), normalizedPubkey],
              conflict: true
            }
          ],
          usernameCollisions: [
            {
              username: normalizedUsername,
              owner_pubkey: String(nextStaleOwnerPubkey || "").trim().toLowerCase(),
              claimant_pubkeys: [String(nextStaleOwnerPubkey || "").trim().toLowerCase(), normalizedPubkey],
              conflict: true
            }
          ],
          entities: [],
          approvedEntities: [],
          drafts: [],
          allComments: [],
          comments: [],
          metrics: { usernameCollisionCount: 1 },
          rawEvents: [{ id: "cached:history-current", kind: 0 }],
          syncInfo: { connected: true, remoteEventCount: 1, cachedEventCount: 1, mergedEventCount: 1 }
        })
      );
    },
    {
      nextSecretKeyHex: secretKeyHex,
      nextPubkey: pubkey,
      nextClaimedUsername: claimedUsername,
      nextKnownPubkeys: knownPubkeys,
      nextStaleOwnerPubkey: fallbackOwnerPubkey
    }
  );
  await hydrateLegacyRuntimeCaches(page);
  await seedRuntimeSnapshot(page, {
    session: { username: claimedUsername, secretKeyHex, pubkey },
    publicState: {
      connected: true,
      admins: [pubkey],
      users: [
        {
          pubkey,
          username: "",
          claimedUsername,
          usernameConflict: true,
          usernameOwnerPubkey: fallbackOwnerPubkey,
          displayName: claimedUsername,
          socialLinks: []
        }
      ],
      usernameRegistry: [
        {
          username: claimedUsername,
          owner_pubkey: fallbackOwnerPubkey,
          claimant_pubkeys: [fallbackOwnerPubkey, pubkey],
          conflict: true
        }
      ],
      usernameCollisions: [
        {
          username: claimedUsername,
          owner_pubkey: fallbackOwnerPubkey,
          claimant_pubkeys: [fallbackOwnerPubkey, pubkey],
          conflict: true
        }
      ],
      entities: [],
      approvedEntities: [],
      drafts: [],
      allComments: [],
      comments: [],
      metrics: { usernameCollisionCount: 1 },
      rawEvents: [{ id: "cached:history-current", kind: 0 }],
      syncInfo: { connected: true, remoteEventCount: 1, cachedEventCount: 1, mergedEventCount: 1 }
    }
  });
  await page.evaluate(
    async ({
      nextClaimedUsername,
      nextPubkey,
      nextKnownPubkeys,
      nextStaleOwnerPubkey
    }) => {
      const { getSiteRuntimeClient } = await import("./scripts/core/runtime-client.js");
      const runtimeClient = await getSiteRuntimeClient();
      const username = String(nextClaimedUsername || "").trim().toLowerCase();
      const pubkey = String(nextPubkey || "").trim().toLowerCase();
      await runtimeClient.rememberProjection(
        "accountHistory",
        {
          username,
          __projectionScope: "global"
        },
        {
          username,
          currentPubkey: pubkey,
          knownPubkeys: nextKnownPubkeys,
          updatedAt: Date.now()
        },
        { source: "browser-test-seed" }
      );
      await runtimeClient.rememberProjection(
        "usernameIntegrity",
        {
          username,
          pubkey,
          __projectionScope: "global"
        },
        {
          conflict: true,
          claimedUsername: username,
          ownerPubkey: String(nextStaleOwnerPubkey || "").trim().toLowerCase(),
          checkedAt: Date.now(),
          source: "lookup"
        },
        { source: "browser-test-seed" }
      );
    },
    {
      nextClaimedUsername: claimedUsername,
      nextPubkey: pubkey,
      nextKnownPubkeys: knownPubkeys,
      nextStaleOwnerPubkey: fallbackOwnerPubkey
    }
  );
}

export async function seedRemovedSession(page, { port, secretKeyHex, pubkey, claimedUsername = "aux" }) {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
  const session = { username: claimedUsername, secretKeyHex, pubkey };
  const publicState = {
    connected: true,
    admins: [],
    users: [],
    usernameRegistry: [],
    usernameCollisions: [],
    removedPubkeys: [pubkey],
    removedUsers: [
      {
        pubkey,
        username: claimedUsername,
        claimedUsername,
        displayName: claimedUsername
      }
    ],
    entities: [],
    approvedEntities: [],
    drafts: [],
    allComments: [
      {
        id: "comment-1",
        author: "1".repeat(64),
        post_slug: "2026-03-09-placeholder-turnstile",
        markdown: "Visible comment",
        created_at: 1,
        visibility: "visible"
      }
    ],
    comments: [],
    metrics: {},
    rawEvents: [{ id: "cached:removed", kind: 0 }],
    syncInfo: { connected: true, remoteEventCount: 1, cachedEventCount: 1, mergedEventCount: 1 }
  };
  await page.evaluate(
    ({ nextSession, nextPublicState }) => {
      localStorage.setItem(
        "truecost.v2.session",
        JSON.stringify(nextSession)
      );
      localStorage.setItem("truecost.v2.public-state-snapshot", JSON.stringify(nextPublicState));
    },
    { nextSession: session, nextPublicState: publicState }
  );
  await seedRuntimeSnapshot(page, { session, publicState });
}
