import test from "node:test";
import assert from "node:assert/strict";

import SITE from "../scripts/core/site-config.js";
import {
  createStaticServer,
  loadPlaywright,
  prepareBrowserContext,
  seedAdminSession
} from "./browser-test-utils.mjs";

const repoRoot = process.cwd();
const secretKeyHex = "1111111111111111111111111111111111111111111111111111111111111111";
const pubkey = String(SITE.nostr.rootAdminPubkey || "").trim().toLowerCase();

test("graph explorer and wiki pages render seeded graph content", async (t) => {
  const playwright = await loadPlaywright();
  if (!playwright?.chromium) {
    t.skip("Playwright is not available in this workspace.");
    return;
  }

  const { server, port } = await createStaticServer(repoRoot);
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    serviceWorkers: "block"
  });
  await prepareBrowserContext(context);
  const page = await context.newPage();

  try {
    await page.goto(`http://127.0.0.1:${port}/graph.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.querySelectorAll("[data-graph-node]").length >= 3,
      { timeout: 30000 }
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
    assert.ok(await page.getByRole("link", { name: "Wiki" }).count(), "Explore should include a Wiki link");

    await page.getByRole("button", { name: "Explore" }).click();
    const graphNavCollapsed = await page.evaluate(() => {
      const graphLink = Array.from(document.querySelectorAll(".nav-group__panel a")).find((link) =>
        link.textContent?.trim() === "Graph"
      );
      const panel = graphLink?.closest(".nav-group__panel");
      return panel ? getComputedStyle(panel).display : "";
    });
    assert.equal(graphNavCollapsed, "none", "Explore should collapse again when toggled from Graph");

    await page.goto(`http://127.0.0.1:${port}/wiki.html?entity=north-valley-processing-campus`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => (document.querySelector("[data-wiki-article]")?.textContent || "").includes("North Valley Processing Campus"),
      { timeout: 30000 }
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
      const wikiLink = Array.from(document.querySelectorAll(".nav-group__panel a")).find((link) =>
        link.textContent?.trim() === "Wiki"
      );
      const graphLink = Array.from(document.querySelectorAll(".nav-group__panel a")).find((link) =>
        link.textContent?.trim() === "Graph"
      );
      const panel = graphLink?.closest(".nav-group__panel");
      return {
        panelDisplay: panel ? getComputedStyle(panel).display : "",
        exploreIsCurrent: document.querySelector("[data-nav-group].is-current")?.querySelector("[data-submenu-toggle]")?.textContent?.trim() || "",
        graphIsCurrent: graphLink?.classList.contains("is-current") || false,
        wikiIsCurrent: wikiLink?.classList.contains("is-current") || false
      };
    });
    assert.equal(wikiNavMetrics.exploreIsCurrent, "Explore");
    assert.equal(wikiNavMetrics.panelDisplay, "none", "Wiki should keep Explore highlighted without forcing it open");
    assert.equal(wikiNavMetrics.graphIsCurrent, false, "Graph should not stay current on wiki pages");
    assert.equal(wikiNavMetrics.wikiIsCurrent, true, "Wiki should be the current Explore child on wiki pages");

    await page.goto(`http://127.0.0.1:${port}/wiki.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#wikiSearchInput", { timeout: 15000 });
    await page.locator("#wikiSearchInput").click();
    await page.locator("#wikiSearchInput").fill("north");
    const wikiSearchState = await page.evaluate(() => ({
      activeId: document.activeElement?.id || "",
      value: document.querySelector("#wikiSearchInput")?.value || "",
      articleText: document.querySelector("[data-wiki-article]")?.textContent || ""
    }));
    assert.equal(wikiSearchState.activeId, "wikiSearchInput", "wiki search should keep focus while typing");
    assert.equal(wikiSearchState.value, "north");
    assert.match(wikiSearchState.articleText, /North Valley/i);

    await page.goto(`http://127.0.0.1:${port}/graph.html?focus=animal-agriculture`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => (document.querySelector("[data-graph-rail]")?.textContent || "").includes("Animal Agriculture"),
      { timeout: 15000 }
    );
    await page.setViewportSize({ width: 1440, height: 720 });
    await page.evaluate(() => {
      const rail = document.querySelector("[data-graph-rail]");
      if (rail instanceof HTMLElement) {
        rail.style.maxHeight = "12rem";
      }
    });
    await page.evaluate(() => window.scrollTo(0, 180));
    await page.waitForFunction(() => window.scrollY >= 100, { timeout: 5000 });
    await page.locator("#graphSearchInput").click();
    await page.locator("#graphSearchInput").fill("north");
    await page.waitForFunction(
      () => document.querySelectorAll("[data-graph-search-suggestion]").length > 0,
      { timeout: 15000 }
    );
    const graphSearchState = await page.evaluate(() => ({
      activeId: document.activeElement?.id || "",
      value: document.querySelector("#graphSearchInput")?.value || "",
      suggestionCount: document.querySelectorAll("[data-graph-search-suggestion]").length
    }));
    assert.equal(graphSearchState.activeId, "graphSearchInput", "graph search should keep focus while typing");
    assert.equal(graphSearchState.value, "north");
    assert.ok(graphSearchState.suggestionCount > 0, "graph search should show autocomplete suggestions from the filtered graph");
    const graphWindowScrollBefore = await page.evaluate(() => window.scrollY);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      () => (document.querySelector("[data-graph-rail]")?.textContent || "").includes("North Valley Foods"),
      { timeout: 15000 }
    );
    await page.waitForTimeout(250);
    const focusMetrics = await page.evaluate(() => ({
      href: window.location.href,
      railText: document.querySelector("[data-graph-rail]")?.textContent || "",
      railScrollTop: document.querySelector("[data-graph-rail]")?.scrollTop || 0,
      windowScrollY: window.scrollY,
      inputValue: document.querySelector("#graphSearchInput")?.value || ""
    }));
    assert.match(focusMetrics.href, /focus=north-valley-foods/);
    assert.match(focusMetrics.railText, /North Valley Foods/);
    assert.match(focusMetrics.railText, /Clear filters/);
    assert.equal(focusMetrics.inputValue, "North Valley Foods");
    assert.ok(focusMetrics.railScrollTop > 0, "graph rail should scroll to the selected summary card");
    assert.ok(
      Math.abs(focusMetrics.windowScrollY - graphWindowScrollBefore) <= 2,
      "graph selection should scroll the rail without nudging the page"
    );

    await seedAdminSession(page, { port, secretKeyHex, pubkey });
    await page.goto(`http://127.0.0.1:${port}/graph.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-open-graph-entity-modal]", { timeout: 30000 });

    const adminRailText = await page.locator("[data-graph-rail]").textContent();
    assert.match(adminRailText || "", /Create entity/);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
