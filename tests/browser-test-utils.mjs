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
