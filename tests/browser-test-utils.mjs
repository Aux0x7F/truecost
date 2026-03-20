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
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const relativePath = urlPath === "/" ? "/index.html" : urlPath;
      const filePath = path.join(root, relativePath);
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
  const playwrightPath = path.resolve(repoRoot, "../nostr-site/tooling/browser-smoke/node_modules/playwright/index.mjs");
  try {
    return await import(pathToFileURL(playwrightPath).href);
  } catch {
    return null;
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

export async function seedAdminSession(page, { port, secretKeyHex, pubkey }) {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ secretKeyHex: nextSecretKeyHex, pubkey: nextPubkey }) => {
    localStorage.setItem(
      "truecost.v2.session",
      JSON.stringify({ username: "smoke-user", secretKeyHex: nextSecretKeyHex, pubkey: nextPubkey })
    );
    localStorage.setItem(
      "truecost.v2.public-state-snapshot",
      JSON.stringify({
        admins: [nextPubkey],
        users: [{ pubkey: nextPubkey, username: "smoke-user", displayName: "Smoke User", socialLinks: [] }],
        entities: [{ slug: "county-yard", name: "County Yard", location: "Phoenix, Arizona", status: "approved", type: "facility", notes: "" }],
        approvedEntities: [{ slug: "county-yard", name: "County Yard", location: "Phoenix, Arizona", status: "approved", type: "facility", notes: "" }],
        drafts: [],
        allComments: [],
        comments: [],
        metrics: {},
        rawEvents: [{ id: "cached:1", kind: 0 }],
        syncInfo: { connected: false, remoteEventCount: 0, cachedEventCount: 1, mergedEventCount: 1 }
      })
    );
  }, { secretKeyHex, pubkey });
}

export async function seedKnownUsernameOwner(page, { port, username = "aux", ownerPubkey = "" }) {
  const canonicalOwnerPubkey = ownerPubkey || "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa";
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ claimedUsername, nextOwnerPubkey }) => {
      localStorage.removeItem("truecost.v2.session");
      localStorage.setItem(
        "truecost.v2.public-state-snapshot",
        JSON.stringify({
          connected: true,
          admins: [],
          users: [
            {
              pubkey: nextOwnerPubkey,
              username: claimedUsername,
              claimedUsername,
              displayName: claimedUsername,
              socialLinks: []
            }
          ],
          usernameRegistry: [
            {
              username: claimedUsername,
              owner_pubkey: nextOwnerPubkey,
              claimant_pubkeys: [nextOwnerPubkey],
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
        })
      );
    },
    { claimedUsername: username, nextOwnerPubkey: canonicalOwnerPubkey }
  );
}

export async function seedConflictedUsernameSession(page, { port, secretKeyHex, pubkey, claimedUsername = "aux", ownerPubkey = "" }) {
  const canonicalOwnerPubkey = ownerPubkey || "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa";
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({
      secretKeyHex: nextSecretKeyHex,
      pubkey: nextPubkey,
      claimedUsername: nextClaimedUsername,
      ownerPubkey: nextOwnerPubkey
    }) => {
      localStorage.setItem(
        "truecost.v2.session",
        JSON.stringify({ username: nextClaimedUsername, secretKeyHex: nextSecretKeyHex, pubkey: nextPubkey })
      );
      localStorage.setItem(
        "truecost.v2.username-integrity",
        JSON.stringify({
          [`${String(nextClaimedUsername || "").trim().toLowerCase()}:${String(nextPubkey || "").trim().toLowerCase()}`]: {
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
        JSON.stringify({
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
              pubkey: nextPubkey,
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
              claimant_pubkeys: [nextOwnerPubkey, nextPubkey],
              conflict: true
            }
          ],
          usernameCollisions: [
            {
              username: nextClaimedUsername,
              owner_pubkey: nextOwnerPubkey,
              claimant_pubkeys: [nextOwnerPubkey, nextPubkey],
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
        })
      );
    },
    { secretKeyHex, pubkey, claimedUsername, ownerPubkey: canonicalOwnerPubkey }
  );
}

export async function seedRemovedSession(page, { port, secretKeyHex, pubkey, claimedUsername = "aux" }) {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ nextSecretKeyHex, nextPubkey, nextClaimedUsername }) => {
      localStorage.setItem(
        "truecost.v2.session",
        JSON.stringify({ username: nextClaimedUsername, secretKeyHex: nextSecretKeyHex, pubkey: nextPubkey })
      );
      localStorage.setItem(
        "truecost.v2.public-state-snapshot",
        JSON.stringify({
          connected: true,
          admins: [],
          users: [],
          usernameRegistry: [],
          usernameCollisions: [],
          removedPubkeys: [nextPubkey],
          removedUsers: [
            {
              pubkey: nextPubkey,
              username: nextClaimedUsername,
              claimedUsername: nextClaimedUsername,
              displayName: nextClaimedUsername
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
        })
      );
    },
    { nextSecretKeyHex: secretKeyHex, nextPubkey: pubkey, nextClaimedUsername: claimedUsername }
  );
}
