import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const port = 4173;
const secretKeyHex = "1111111111111111111111111111111111111111111111111111111111111111";
const pubkey = "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa";

function contentType(filePath) {
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".md": "text/markdown; charset=utf-8"
  }[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

async function createStaticServer(root) {
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
  return server;
}

async function loadPlaywright() {
  const playwrightPath = path.resolve(repoRoot, "../nostr-site/tooling/browser-smoke/node_modules/playwright/index.mjs");
  try {
    return await import(pathToFileURL(playwrightPath).href);
  } catch {
    return null;
  }
}

function captureRelevantConsoleErrors(page, bucket) {
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

async function seedSession(page) {
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
  await page.evaluate(({ secretKeyHex, pubkey }) => {
    localStorage.setItem(
      "truecost.v2.session",
      JSON.stringify({ username: "smoke-user", secretKeyHex, pubkey })
    );
    localStorage.setItem(
      "truecost.v2.public-state-snapshot",
      JSON.stringify({
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
      })
    );
  }, { secretKeyHex, pubkey });
}

test("admin workspace, submit autocomplete, and editor boot survive cached admin load", async (t) => {
  const playwright = await loadPlaywright();
  if (!playwright?.chromium) {
    t.skip("Playwright is not available in this workspace.");
    return;
  }

  const server = await createStaticServer(repoRoot);
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];

  page.on("pageerror", (error) => pageErrors.push(String(error)));
  captureRelevantConsoleErrors(page, consoleErrors);

  try {
    await seedSession(page);

    await page.goto(`http://127.0.0.1:${port}/admin.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-workspace-pane]", { timeout: 15000 });

    await page.goto(`http://127.0.0.1:${port}/submit.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-open-submission-modal=\"new\"]", { timeout: 15000 });
    await page.click("[data-open-submission-modal=\"new\"]");
    await page.waitForSelector("[data-submission-form]", { timeout: 15000 });

    const resultsClosedBeforeTyping = await page.evaluate(() => {
      const host = document.querySelector("[data-submit-suggested-entity-results]");
      return host instanceof HTMLElement ? host.getAttribute("data-open") !== "yes" : false;
    });

    await page.fill("[data-submit-suggested-entity-input]", "Test");
    await page.waitForFunction(
      () => document.querySelector("[data-submit-suggested-entity-results]")?.getAttribute("data-open") === "yes",
      { timeout: 5000 }
    );

    const attachedFieldMetrics = await page.evaluate(() => {
      const input = document.querySelector("[data-submit-suggested-entity-input]");
      const host = document.querySelector("[data-submit-suggested-entity-results]");
      const wrapper = input?.closest(".workspace-search");
      if (!(input instanceof HTMLElement) || !(host instanceof HTMLElement) || !(wrapper instanceof HTMLElement)) return null;
      const inputRect = input.getBoundingClientRect();
      const hostRect = host.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      return {
        inputBottom: inputRect.bottom,
        hostTop: hostRect.top,
        hostWidth: hostRect.width,
        wrapperWidth: wrapperRect.width,
        openHintVisible: host.textContent.includes("No existing entity matches")
      };
    });

    await page.press("[data-submit-suggested-entity-input]", "Enter");
    await page.waitForFunction(
      () => document.querySelector("[data-submit-suggested-entity-results]")?.getAttribute("data-open") !== "yes",
      { timeout: 5000 }
    );

    await page.focus("[data-submit-suggested-entity-input]");
    await page.waitForFunction(
      () => document.querySelector("[data-submit-suggested-entity-results]")?.getAttribute("data-open") === "yes",
      { timeout: 5000 }
    );
    await page.focus("[name=\"suggestedEntityNotes\"]");
    await page.waitForFunction(
      () => document.querySelector("[data-submit-suggested-entity-results]")?.getAttribute("data-open") !== "yes",
      { timeout: 5000 }
    );

    const checkboxState = await page.evaluate(() => {
      const label = document.querySelector(".checkbox--panel");
      const input = document.querySelector(".checkbox__input");
      const indicator = document.querySelector(".checkbox__indicator");
      if (!(label instanceof HTMLElement) || !(input instanceof HTMLInputElement) || !(indicator instanceof HTMLElement)) {
        return null;
      }
      label.click();
      return {
        checkedAfterClick: input.checked,
        indicatorPresent: indicator instanceof HTMLElement
      };
    });

    await seedSession(page);
    await page.goto(`http://127.0.0.1:${port}/editor.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-editor-form]", { timeout: 15000 });
    await page.waitForTimeout(2000);

    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(" | ")}`);
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(" | ")}`);
    assert.equal(resultsClosedBeforeTyping, true, "attached suggestions should stay closed until the field has input");
    assert.ok(attachedFieldMetrics, "attached field metrics should be available");
    assert.ok(attachedFieldMetrics.hostTop >= attachedFieldMetrics.inputBottom - 2, "attached suggestions should render below the input");
    assert.ok(attachedFieldMetrics.hostWidth <= attachedFieldMetrics.wrapperWidth + 2, "attached suggestions should stay within the field width");
    assert.equal(attachedFieldMetrics.openHintVisible, true, "attached dropdown should render its empty-state hint in place");
    assert.ok(checkboxState?.indicatorPresent, "consent checkbox should render a styled indicator");
    assert.equal(checkboxState?.checkedAfterClick, true, "consent checkbox should toggle from the panel control");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
