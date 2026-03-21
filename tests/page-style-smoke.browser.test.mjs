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

test("desktop public and workspace pages keep shared card layouts after stylesheet changes", async (t) => {
  const playwright = await loadPlaywright();
  if (!playwright?.chromium) {
    t.skip("Playwright is not available in this workspace.");
    return;
  }

  const { server, port } = await createStaticServer(repoRoot);
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  const page = await context.newPage();

  try {
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const homeMetrics = await page.evaluate(() => {
      const grid = document.querySelector("[data-home-investigations]");
      const gridRect = grid?.getBoundingClientRect();
      const cards = Array.from(grid?.children || []).slice(0, 2).map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      const style = grid ? getComputedStyle(grid) : null;
      return {
        display: style?.display || "",
        columns: style?.gridTemplateColumns || "",
        gridWidth: gridRect?.width || 0,
        cards
      };
    });

    assert.equal(homeMetrics.display, "grid");
    assert.ok(homeMetrics.columns.includes("px"), "home investigations should resolve desktop grid columns");
    assert.ok(homeMetrics.cards.length >= 1, "featured investigations should render at least one card");
    assert.ok(
      homeMetrics.cards[0].width < homeMetrics.gridWidth * 0.75,
      "desktop featured cards should not collapse into a single full-width column"
    );

    await page.goto(`http://127.0.0.1:${port}/map.html`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const mapNavMetrics = await page.evaluate(() => {
      const exploreGroup = document.querySelector('[data-nav-group].is-current');
      const mapLink = Array.from(document.querySelectorAll(".nav-group__panel a")).find((link) =>
        link.textContent?.trim() === "Map"
      );
      const panel = mapLink?.closest(".nav-group__panel");
      const panelStyle = panel ? getComputedStyle(panel) : null;
      return {
        currentGroupLabel: exploreGroup?.querySelector("[data-submenu-toggle]")?.textContent?.trim() || "",
        mapIsCurrent: mapLink?.classList.contains("is-current") || false,
        panelDisplay: panelStyle?.display || ""
      };
    });

    assert.equal(mapNavMetrics.currentGroupLabel, "Explore");
    assert.equal(mapNavMetrics.mapIsCurrent, true, "map nav item should be marked current on the map page");
    assert.equal(mapNavMetrics.panelDisplay, "none", "desktop nav groups should stay collapsed until opened");

    await page.getByRole("button", { name: "Explore" }).click();
    const expandedMapNavMetrics = await page.evaluate(() => {
      const mapLink = Array.from(document.querySelectorAll(".nav-group__panel a")).find((link) =>
        link.textContent?.trim() === "Map"
      );
      const panel = mapLink?.closest(".nav-group__panel");
      const panelStyle = panel ? getComputedStyle(panel) : null;
      return {
        mapIsCurrent: mapLink?.classList.contains("is-current") || false,
        panelDisplay: panelStyle?.display || ""
      };
    });

    assert.equal(expandedMapNavMetrics.mapIsCurrent, true, "map nav item should stay current when Explore opens");
    assert.equal(expandedMapNavMetrics.panelDisplay, "grid", "Explore should open when toggled");

    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Explore" }).click();
    const homeMapLinkState = await page.evaluate(() => {
      const mapLink = Array.from(document.querySelectorAll(".nav-group__panel a")).find((link) =>
        link.textContent?.trim() === "Map"
      );
      return {
        ariaDisabled: mapLink?.getAttribute("aria-disabled") || "",
        isDisabled: mapLink?.classList.contains("is-disabled") || false
      };
    });

    assert.equal(homeMapLinkState.ariaDisabled, "", "map should stay clickable before shared state finishes hydrating");
    assert.equal(homeMapLinkState.isDisabled, false, "map should not render as disabled in Explore");

    await seedAdminSession(page, { port, secretKeyHex, pubkey });
    await page.goto(`http://127.0.0.1:${port}/admin.html?tab=dashboard`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-workspace-pane]", { timeout: 15000 });
    await page.waitForFunction(
      () =>
        document.querySelector(".workspace-tab.is-current")?.textContent?.includes("Dashboard") &&
        document.querySelectorAll(".metric-card").length > 0,
      { timeout: 15000 }
    );
    const adminMetrics = await page.evaluate(() => {
      const statCard = document.querySelector(".workspace-grid .metric-card");
      const snapshotCard = document.querySelector("[data-request-snapshot]")?.closest(".surface-panel");
      if (!(statCard instanceof HTMLElement) || !(snapshotCard instanceof HTMLElement)) return null;
      const statStyle = getComputedStyle(statCard);
      const snapshotStyle = getComputedStyle(snapshotCard);
      return {
        statPaddingTop: statStyle.paddingTop,
        statPaddingLeft: statStyle.paddingLeft,
        snapshotPaddingTop: snapshotStyle.paddingTop,
        snapshotPaddingLeft: snapshotStyle.paddingLeft
      };
    });

    assert.ok(adminMetrics, "workspace cards should exist");
    assert.notEqual(adminMetrics.statPaddingTop, "0px", "workspace metric cards should keep internal padding");
    assert.notEqual(adminMetrics.statPaddingLeft, "0px", "workspace metric cards should keep internal padding");
    assert.notEqual(adminMetrics.snapshotPaddingTop, "0px", "workspace surface panels should keep internal padding");
    assert.notEqual(adminMetrics.snapshotPaddingLeft, "0px", "workspace surface panels should keep internal padding");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
