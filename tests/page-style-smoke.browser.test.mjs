import test from "node:test";
import assert from "node:assert/strict";

import {
  createStaticServer,
  loadPlaywright,
  prepareBrowserContext,
  seedAdminSession,
  seedLegacyAdminSession
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1600 },
    serviceWorkers: "block"
  });
  await prepareBrowserContext(context);
  const page = await context.newPage();

  try {
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.querySelectorAll("[data-site-nav] a, [data-site-nav] button[data-submenu-toggle]").length > 0,
      { timeout: 5000 }
    );
    const initialNavLinks = await page.evaluate(() =>
      document.querySelectorAll("[data-site-nav] a, [data-site-nav] button[data-submenu-toggle]").length
    );
    assert.ok(initialNavLinks > 0, "public shell should render navigation links by DOMContentLoaded");
    await page.getByRole("button", { name: "Explore" }).click();
    await page.waitForFunction(() => {
      const panel = document.querySelector('[data-nav-group].is-open .nav-group__panel');
      return panel ? getComputedStyle(panel).display === "grid" : false;
    }, { timeout: 5000 });
    const earlyExploreDisplay = await page.evaluate(() => {
      const panel = document.querySelector('[data-nav-group].is-open .nav-group__panel');
      return panel ? getComputedStyle(panel).display : "";
    });
    assert.equal(earlyExploreDisplay, "grid", "public shell should be interactive before background hydrate completes");
    await page.waitForFunction(
      () => document.querySelectorAll("[data-archive-summary] .hero-summary__item").length >= 4,
      { timeout: 15000 }
    );
    const hydratedExploreState = await page.evaluate(() => {
      const group = document.querySelector('[data-nav-group-key="explore"]');
      const panel = group?.querySelector(".nav-group__panel");
      const toggle = group?.querySelector("[data-submenu-toggle]");
      return {
        isOpen: group?.classList.contains("is-open") || false,
        panelDisplay: panel ? getComputedStyle(panel).display : "",
        focusStayedOnToggle: document.activeElement === toggle
      };
    });
    assert.equal(hydratedExploreState.isOpen, true, "archive summary hydration should not collapse the open nav group");
    assert.equal(hydratedExploreState.panelDisplay, "grid", "archive summary hydration should preserve the open Explore panel");
    assert.equal(hydratedExploreState.focusStayedOnToggle, true, "archive summary hydration should preserve nav toggle focus");
    await page.getByRole("button", { name: "Create or log in" }).click();
    await page.waitForSelector("[data-auth-modal]", { timeout: 5000 });
    const authModalMetrics = await page.evaluate(() => ({
      hasForm: Boolean(document.querySelector("[data-auth-form]")),
      minLength:
        document.querySelector('[data-auth-form] input[name=\"password\"]')?.getAttribute("minlength") || ""
    }));
    assert.equal(authModalMetrics.hasForm, true, "global auth modal should open from the public shell");
    assert.equal(authModalMetrics.minLength, "8", "global auth modal should enforce password minimums");
    await page.click("[data-auth-close]");

    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
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

    await page.goto(`http://127.0.0.1:${port}/about.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.querySelectorAll("[data-archive-summary] .hero-summary__item").length >= 4,
      { timeout: 15000 }
    );
    const aboutSummaryMetrics = await page.evaluate(() => ({
      count: document.querySelectorAll("[data-archive-summary] .hero-summary__item").length,
      text: document.querySelector("[data-archive-summary]")?.textContent || ""
    }));
    assert.equal(aboutSummaryMetrics.count, 4, "about Dive in summary should hydrate archive stats");
    assert.match(aboutSummaryMetrics.text, /Tracked entities/);
    assert.match(aboutSummaryMetrics.text, /Archive tags/);

    await page.goto(`http://127.0.0.1:${port}/investigations.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-filter-input="tag"]', { timeout: 15000 });
    await page.locator('[data-filter-input="tag"]').click();
    await page.locator('[data-filter-input="tag"]').fill("pl");
    await page.waitForTimeout(400);
    await page.waitForFunction(
      () => document.querySelectorAll('[data-filter-results="tag"] [data-filter-suggestion="tag"]').length > 0,
      { timeout: 15000 }
    );
    const filterSuggestionMetrics = await page.evaluate(() => {
      const dropdown = document.querySelector('[data-filter-results="tag"] .picker-results--dropdown');
      return {
        suggestionCount: document.querySelectorAll('[data-filter-results="tag"] [data-filter-suggestion="tag"]').length,
        display: dropdown ? getComputedStyle(dropdown).display : "",
        open: dropdown?.getAttribute("data-open") || ""
      };
    });
    assert.ok(filterSuggestionMetrics.suggestionCount > 0, "investigation tag suggestions should render");
    assert.notEqual(filterSuggestionMetrics.display, "none", "investigation tag suggestions should be visible");
    assert.equal(filterSuggestionMetrics.open, "yes");

    await page.goto(`http://127.0.0.1:${port}/map.html`, { waitUntil: "domcontentloaded" });
    await page.setViewportSize({ width: 1440, height: 720 });
    await page.waitForFunction(
      () =>
        document.querySelectorAll("[data-entity-card]").length >= 1 ||
        Boolean(document.querySelector("[data-map-canvas] .map-empty")),
      { timeout: 15000 }
    );
    await page.waitForFunction(() => document.querySelectorAll("[data-entity-card]").length >= 1, { timeout: 15000 });
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
        panelDisplay: panelStyle?.display || "",
        hasLeaflet: Boolean(document.querySelector(".leaflet-container")),
        hasHero: Boolean(document.querySelector("section.hero")),
        hasPageIntro: Boolean(document.querySelector(".section--page-intro"))
      };
    });

    assert.equal(mapNavMetrics.currentGroupLabel, "Explore");
    assert.equal(mapNavMetrics.mapIsCurrent, true, "map nav item should be marked current on the map page");
    assert.equal(mapNavMetrics.panelDisplay, "none", "desktop nav groups should stay collapsed until opened");
    assert.equal(mapNavMetrics.hasLeaflet, true, "map page should still initialize the map shell");
    assert.equal(mapNavMetrics.hasHero, false, "map page should not render a hero shell");
    assert.equal(mapNavMetrics.hasPageIntro, false, "map page should not render a top page intro shell");

    await page.evaluate(() => window.scrollTo(0, 180));
    await page.waitForFunction(() => Math.abs(window.scrollY - 180) <= 2, { timeout: 5000 });
    const mapWindowScrollBefore = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => {
      const marker = document.querySelectorAll(".leaflet-interactive")[1];
      marker?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(
      () => Boolean(document.querySelector("[data-map-list] .entity-card--focus")),
      { timeout: 15000 }
    );
    await page.waitForTimeout(250);
    const mapScrollMetrics = await page.evaluate(() => {
      const list = document.querySelector("[data-map-list]");
      const focusedCard = document.querySelector("[data-map-list] .entity-card--focus");
      return {
        windowScrollY: window.scrollY,
        listScrollTop: list?.scrollTop || 0,
        listCanScroll: (list?.scrollHeight || 0) > (list?.clientHeight || 0) + 1,
        hasFocusedCard: Boolean(focusedCard)
      };
    });
    assert.ok(
      Math.abs(mapScrollMetrics.windowScrollY - mapWindowScrollBefore) <= 2,
      "map marker focus should not nudge the page"
    );
    assert.equal(mapScrollMetrics.hasFocusedCard, true, "map marker focus should highlight a matching entity card");

    await page.goto(`http://127.0.0.1:${port}/investigations.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-filter-input="tag"]', { timeout: 15000 });
    const investigationsLayoutMetrics = await page.evaluate(() => ({
      hasHero: Boolean(document.querySelector("section.hero")),
      hasPageIntro: Boolean(document.querySelector(".section--page-intro"))
    }));
    assert.equal(investigationsLayoutMetrics.hasHero, false, "investigations page should not render a hero shell");
    assert.equal(investigationsLayoutMetrics.hasPageIntro, false, "investigations page should not render a top page intro shell");

    await page.goto(`http://127.0.0.1:${port}/map.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () =>
        Boolean(document.querySelector(".leaflet-container")) ||
        Boolean(document.querySelector("[data-map-canvas] .map-empty")),
      { timeout: 15000 }
    );
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

    await page.goto(`http://127.0.0.1:${port}/graph.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll("[data-graph-node]").length >= 3, { timeout: 15000 });
    const graphLayoutMetrics = await page.evaluate(() => ({
      hasHero: Boolean(document.querySelector("section.hero")),
      hasPageIntro: Boolean(document.querySelector(".section--page-intro"))
    }));
    assert.equal(graphLayoutMetrics.hasHero, false, "graph page should not render a hero shell");
    assert.equal(graphLayoutMetrics.hasPageIntro, false, "graph page should not render a top page intro shell");

    await page.goto(`http://127.0.0.1:${port}/wiki.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#wikiSearchInput", { timeout: 15000 });
    const wikiLayoutMetrics = await page.evaluate(() => ({
      hasHero: Boolean(document.querySelector("section.hero")),
      hasPageIntro: Boolean(document.querySelector(".section--page-intro"))
    }));
    assert.equal(wikiLayoutMetrics.hasHero, false, "wiki page should not render a hero shell");
    assert.equal(wikiLayoutMetrics.hasPageIntro, false, "wiki page should not render a top page intro shell");

    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
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
    await page.goto(`http://127.0.0.1:${port}/admin.html?tab=dashboard`, { waitUntil: "domcontentloaded" });
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
        snapshotPaddingLeft: snapshotStyle.paddingLeft,
        hasHero: Boolean(document.querySelector("section.hero")),
        hasPageIntro: Boolean(document.querySelector(".section--page-intro"))
      };
    });

    assert.ok(adminMetrics, "workspace cards should exist");
    assert.notEqual(adminMetrics.statPaddingTop, "0px", "workspace metric cards should keep internal padding");
    assert.notEqual(adminMetrics.statPaddingLeft, "0px", "workspace metric cards should keep internal padding");
    assert.notEqual(adminMetrics.snapshotPaddingTop, "0px", "workspace surface panels should keep internal padding");
    assert.notEqual(adminMetrics.snapshotPaddingLeft, "0px", "workspace surface panels should keep internal padding");
    assert.equal(adminMetrics.hasHero, false, "workspace page should not render a hero shell");
    assert.equal(adminMetrics.hasPageIntro, true, "workspace page should keep its admin page intro shell");

    await page.getByRole("button", { name: "User Management" }).click();
    await page.waitForTimeout(200);
    const userFilterMetrics = await page.evaluate(() => {
      const karma = document.querySelector("[data-user-filter-karma]");
      const role = document.querySelector("[data-user-filter-role]");
      const karmaLabel = karma?.closest("label");
      const roleLabel = role?.closest("label");
      const karmaRect = karmaLabel?.getBoundingClientRect();
      const roleRect = roleLabel?.getBoundingClientRect();
      return {
        karmaLabel: karmaLabel?.textContent?.trim() || "",
        roleLabel: roleLabel?.textContent?.trim() || "",
        roleValue: role instanceof HTMLSelectElement ? role.value : "",
        sameRow: Boolean(karmaRect && roleRect && Math.abs(karmaRect.top - roleRect.top) < 6),
        widthDelta: karmaRect && roleRect ? Math.abs(karmaRect.width - roleRect.width) : 999
      };
    });

    assert.match(userFilterMetrics.karmaLabel, /Karma/);
    assert.match(userFilterMetrics.roleLabel, /Role/);
    assert.equal(userFilterMetrics.roleValue, "active", "role filtering should default to active users");
    assert.equal(userFilterMetrics.sameRow, true, "karma and role controls should share the same row");
    assert.ok(userFilterMetrics.widthDelta < 8, "karma and role controls should share the available width evenly");

    await seedLegacyAdminSession(page, {
      port,
      secretKeyHex,
      username: "smoke-user",
      adminPubkey: pubkey
    });
    await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
    await page.click("[data-profile-toggle]");
    const legacyProfileMenuLabel = await page.evaluate(() =>
      document.querySelector(".profile-menu__panel a")?.textContent?.trim() || ""
    );
    assert.equal(legacyProfileMenuLabel, "Admin", "legacy admin sessions should still render the admin menu label");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
