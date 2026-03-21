import test from "node:test";
import assert from "node:assert/strict";

import {
  createStaticServer,
  loadPlaywright,
  seedAdminSession
} from "./browser-test-utils.mjs";

const repoRoot = process.cwd();
const secretKeyHex = "1111111111111111111111111111111111111111111111111111111111111111";
const pubkey = "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa";

test("graph explorer and wiki pages render seeded graph content", async (t) => {
  const playwright = await loadPlaywright();
  if (!playwright?.chromium) {
    t.skip("Playwright is not available in this workspace.");
    return;
  }

  const { server, port } = await createStaticServer(repoRoot);
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();

  try {
    await page.goto(`http://127.0.0.1:${port}/graph.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => document.querySelectorAll("[data-graph-node]").length >= 3,
      { timeout: 15000 }
    );

    const graphMetrics = await page.evaluate(() => ({
      nodeCount: document.querySelectorAll("[data-graph-node]").length,
      railText: document.querySelector("[data-graph-rail]")?.textContent || "",
      explorePanelDisplay: getComputedStyle(document.querySelector(".nav-group__panel")).display
    }));

    assert.ok(graphMetrics.nodeCount >= 3, "graph page should render seeded nodes");
    assert.match(graphMetrics.railText, /Current node/);
    assert.equal(graphMetrics.explorePanelDisplay, "none", "Explore should not stay open just because Graph is current");

    await page.getByRole("button", { name: "Explore" }).click();
    const graphNavExpanded = await page.evaluate(() => {
      const graphLink = Array.from(document.querySelectorAll(".nav-group__panel a")).find((link) =>
        link.textContent?.trim() === "Graph"
      );
      const panel = graphLink?.closest(".nav-group__panel");
      return {
        panelDisplay: panel ? getComputedStyle(panel).display : "",
        graphIsCurrent: graphLink?.classList.contains("is-current") || false
      };
    });
    assert.equal(graphNavExpanded.panelDisplay, "grid");
    assert.equal(graphNavExpanded.graphIsCurrent, true);

    await page.getByRole("button", { name: "Explore" }).click();
    const graphNavCollapsed = await page.evaluate(() => {
      const graphLink = Array.from(document.querySelectorAll(".nav-group__panel a")).find((link) =>
        link.textContent?.trim() === "Graph"
      );
      const panel = graphLink?.closest(".nav-group__panel");
      return panel ? getComputedStyle(panel).display : "";
    });
    assert.equal(graphNavCollapsed, "none", "Explore should collapse again when toggled from Graph");

    await page.goto(`http://127.0.0.1:${port}/wiki.html?entity=north-valley-processing-campus`, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => (document.querySelector("[data-wiki-article]")?.textContent || "").includes("North Valley Processing Campus"),
      { timeout: 15000 }
    );
    const wikiMetrics = await page.evaluate(() => ({
      articleText: document.querySelector("[data-wiki-article]")?.textContent || "",
      railText: document.querySelector("[data-wiki-rail]")?.textContent || ""
    }));

    assert.match(wikiMetrics.articleText, /North Valley Processing Campus/);
    assert.match(wikiMetrics.railText, /Relationships/);
    assert.match(wikiMetrics.railText, /Related investigations/);
    assert.match(wikiMetrics.railText, /Open in graph/);

    const wikiNavMetrics = await page.evaluate(() => {
      const graphLink = Array.from(document.querySelectorAll(".nav-group__panel a")).find((link) =>
        link.textContent?.trim() === "Graph"
      );
      const panel = graphLink?.closest(".nav-group__panel");
      return {
        panelDisplay: panel ? getComputedStyle(panel).display : "",
        exploreIsCurrent: document.querySelector("[data-nav-group].is-current")?.querySelector("[data-submenu-toggle]")?.textContent?.trim() || ""
      };
    });
    assert.equal(wikiNavMetrics.exploreIsCurrent, "Explore");
    assert.equal(wikiNavMetrics.panelDisplay, "none", "Wiki should keep Explore highlighted without forcing it open");

    await seedAdminSession(page, { port, secretKeyHex, pubkey });
    await page.goto(`http://127.0.0.1:${port}/graph.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => (document.querySelector("[data-graph-rail]")?.textContent || "").includes("Create entity"),
      { timeout: 15000 }
    );

    const adminRailText = await page.locator("[data-graph-rail]").textContent();
    assert.match(adminRailText || "", /Create entity/);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
