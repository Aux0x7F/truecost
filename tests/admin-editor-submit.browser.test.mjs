import test from "node:test";
import assert from "node:assert/strict";

import {
  captureRelevantConsoleErrors,
  createStaticServer,
  loadPlaywright,
  seedAdminSession
} from "./browser-test-utils.mjs";

const repoRoot = process.cwd();
const secretKeyHex = "1111111111111111111111111111111111111111111111111111111111111111";
const pubkey = "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa";

test("admin workspace, submit autocomplete, and editor boot survive cached admin load", async (t) => {
  const playwright = await loadPlaywright();
  if (!playwright?.chromium) {
    t.skip("Playwright is not available in this workspace.");
    return;
  }

  const { server, port } = await createStaticServer(repoRoot);
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];

  page.on("pageerror", (error) => pageErrors.push(String(error)));
  captureRelevantConsoleErrors(page, consoleErrors);

  try {
    await seedAdminSession(page, { port, secretKeyHex, pubkey });

    await page.goto(`http://127.0.0.1:${port}/admin.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-workspace-pane]", { timeout: 15000 });
    await page.waitForFunction(
      () => document.querySelector('[data-workspace-tab="dashboard"]')?.classList.contains("is-current"),
      { timeout: 1500 }
    );
    const cachedWorkspaceState = await page.evaluate(() => ({
      activeTab: document.querySelector("[data-workspace-tab].is-current")?.getAttribute("data-workspace-tab") || "",
      hasDashboardPane: document.querySelector("[data-request-snapshot]") instanceof HTMLElement,
      hasAdminTabs: Boolean(
        document.querySelector('[data-workspace-tab="users"]') &&
        document.querySelector('[data-workspace-tab="submissions"]')
      )
    }));

    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
    const navMarkup = await page.locator("[data-site-nav]").innerHTML();

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

    await seedAdminSession(page, { port, secretKeyHex, pubkey });
    await page.goto(`http://127.0.0.1:${port}/editor.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-editor-form]", { timeout: 15000 });
    await page.waitForTimeout(2000);

    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(" | ")}`);
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(" | ")}`);
    assert.deepEqual(cachedWorkspaceState, {
      activeTab: "dashboard",
      hasDashboardPane: true,
      hasAdminTabs: true
    });
    assert.match(navMarkup, /Explore/);
    assert.match(navMarkup, /Investigations/);
    assert.match(navMarkup, /Map/);
    assert.match(navMarkup, /Create Investigation/);
    assert.equal(resultsClosedBeforeTyping, true, "attached suggestions should stay closed until the field has input");
    assert.ok(attachedFieldMetrics, "attached field metrics should be available");
    assert.ok(attachedFieldMetrics.hostTop >= attachedFieldMetrics.inputBottom - 2, "attached suggestions should render below the input");
    assert.ok(attachedFieldMetrics.hostWidth <= attachedFieldMetrics.wrapperWidth + 2, "attached suggestions should stay within the field width");
    assert.equal(attachedFieldMetrics.openHintVisible, true, "attached dropdown should render its empty-state hint in place");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
