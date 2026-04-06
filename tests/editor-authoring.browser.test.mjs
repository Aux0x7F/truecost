import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import {
  captureRelevantConsoleErrors,
  createStaticServer,
  loadPlaywright
} from "./browser-test-utils.mjs";

const repoRoot = process.cwd();

test("editor mounts, saves a local snapshot, and restores structured draft content after reload", async (t) => {
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
  await page.addInitScript(() => {
    window.localStorage.setItem("truecost.v2.mock-admin-ui", "yes");
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/editor.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-editor-layout]", { timeout: 60000 });
    await page.waitForSelector("[data-editor-surface] .ProseMirror", { timeout: 60000 });

    await page.fill('[name="title"]', "County Yard payroll trail");
    await page.fill('[name="summary"]', "A quick summary for the investigation shell.");
    await page.locator("[data-editor-surface] .ProseMirror").click();
    await page.keyboard.type("The county yard kept appearing in reimbursement logs.");

    await page.locator('[data-editor-open-panel="citation"]').click();
    await page.locator("[data-editor-citation-add]").click();
    await page.waitForSelector('[name="citationTitle"]', { timeout: 5000, state: "attached" });
    await page.fill('[name="citationTitle"]', "Budget memo");
    await page.fill('[name="citationHref"]', "https://example.com/memo");
    await page.fill('[name="citationNote"]', "Filed under March invoices.");
    await page.locator("[data-editor-citation-save]").click();
    await page.waitForFunction(
      () => {
        const rail = document.querySelector("[data-editor-rail] .editor-live-citations--rail");
        const entry = rail?.querySelector("[data-editor-citation-row]");
        const insert = rail?.querySelector("[data-editor-citation-insert]");
        return Boolean(rail && entry?.textContent?.includes("Budget memo") && insert);
      },
      null,
      { timeout: 5000 }
    );
    await page.waitForSelector("[data-editor-citation-insert]", { timeout: 5000, state: "attached" });
    await page.locator('[data-editor-citation-insert]').click();
    await page.waitForFunction(
      () => document.querySelector("[data-editor-citations-tile]")?.textContent?.includes("Budget memo"),
      null,
      { timeout: 5000 }
    );

    await page.locator('[data-editor-open-panel="document"]').evaluate((button) => button.click());
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll(".editor-history-stub__item")).some((item) => item.textContent?.includes("Auto-saved")),
      null,
      { timeout: 10000 }
    );
    await page.waitForFunction(
      () => {
        const title = document.querySelector('[name="title"]')?.value || "";
        const surface = document.querySelector("[data-editor-surface]")?.textContent || "";
        const citations = document.querySelector("[data-editor-citations-tile]")?.textContent || "";
        return title === "County Yard payroll trail" &&
          surface.includes("The county yard kept appearing in reimbursement logs.") &&
          citations.includes("Budget memo");
      },
      null,
      { timeout: 5000 }
    );
    await page.waitForFunction(
      () => /UI-only mock mode/i.test(document.querySelector("[data-editor-save-status]")?.textContent || ""),
      null,
      { timeout: 10000 }
    );

    const beforeReload = await page.evaluate(() => ({
      url: location.href,
      previewHref: document.querySelector("[data-editor-preview]")?.getAttribute("href") || "",
      saveStatus: document.querySelector("[data-editor-save-status]")?.textContent?.trim() || "",
      mockNotice: document.querySelector(".editor-header__mode")?.textContent?.trim() || "",
      submitDisabled: document.querySelector("[data-editor-submit]")?.getAttribute("aria-disabled") || "",
      title: document.querySelector('[name="title"]')?.value || "",
      summary: document.querySelector('[name="summary"]')?.value || "",
      surfaceText: document.querySelector("[data-editor-surface]")?.textContent || "",
      citationsText: document.querySelector("[data-editor-citations-tile]")?.textContent || "",
      citationsMarkup: document.querySelector("[data-editor-citations-tile] .editor-live-citations")?.outerHTML || "",
      snapshotText: document.querySelector(".editor-history-stub__item")?.textContent || ""
    }));

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-editor-layout]", { timeout: 60000 });
    await page.waitForSelector("[data-editor-surface] .ProseMirror", { timeout: 60000 });
    await page.waitForFunction(
      () => {
        const title = document.querySelector('[name="title"]')?.value || "";
        const surface = document.querySelector("[data-editor-surface]")?.textContent || "";
        const citations = document.querySelector("[data-editor-citations-tile]")?.textContent || "";
        const history = Array.from(document.querySelectorAll(".editor-history-stub__item")).some((item) => item.textContent?.includes("Auto-saved"));
        return title === "County Yard payroll trail" && citations.includes("Budget memo") && history && surface.includes("The county yard kept appearing in reimbursement logs.");
      },
      null,
      { timeout: 10000 }
    );

    const afterReload = await page.evaluate(() => ({
      url: location.href,
      mockNotice: document.querySelector(".editor-header__mode")?.textContent?.trim() || "",
      title: document.querySelector('[name="title"]')?.value || "",
      summary: document.querySelector('[name="summary"]')?.value || "",
      surfaceText: document.querySelector("[data-editor-surface]")?.textContent || "",
      citationsText: document.querySelector("[data-editor-citations-tile]")?.textContent || "",
      citationsMarkup: document.querySelector("[data-editor-citations-tile] .editor-live-citations")?.outerHTML || "",
      snapshotText: document.querySelector(".editor-history-stub__item")?.textContent || ""
    }));

    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(" | ")}`);
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(" | ")}`);
    assert.match(beforeReload.url, /editor\.html\?slug=county-yard-payroll-trail/);
    assert.equal(beforeReload.previewHref, "./investigation.html?draft=county-yard-payroll-trail");
    assert.match(beforeReload.saveStatus, /UI-only mock mode/i);
    assert.match(beforeReload.mockNotice, /UI-only mock mode/i);
    assert.equal(beforeReload.submitDisabled, "true");
    assert.equal(beforeReload.title, "County Yard payroll trail");
    assert.equal(beforeReload.summary, "A quick summary for the investigation shell.");
    assert.match(beforeReload.surfaceText, /The county yard kept appearing in reimbursement logs\./);
    assert.match(beforeReload.citationsText, /Budget memo/);
    assert.match(beforeReload.citationsMarkup, /editor-live-citations/);
    assert.match(beforeReload.citationsMarkup, /editor-citation-1/);
    assert.match(beforeReload.snapshotText, /Auto-saved/);
    assert.equal(afterReload.url, beforeReload.url);
    assert.match(afterReload.mockNotice, /UI-only mock mode/i);
    assert.equal(afterReload.title, beforeReload.title);
    assert.equal(afterReload.summary, beforeReload.summary);
    assert.match(afterReload.surfaceText, /The county yard kept appearing in reimbursement logs\./);
    assert.match(afterReload.citationsText, /Budget memo/);
    assert.match(afterReload.citationsMarkup, /editor-live-citations/);
    assert.match(afterReload.snapshotText, /Auto-saved/);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("wrapped-content authoring supports banner without image, image-to-captioned multimedia, and entity snap placement", async (t) => {
  const playwright = await loadPlaywright();
  if (!playwright?.chromium) {
    t.skip("Playwright is not available in this workspace.");
    return;
  }

  const fixturePath = path.join(repoRoot, "tests", ".tmp-editor-image.png");
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5z8AAAAASUVORK5CYII=";
  await fs.writeFile(fixturePath, Buffer.from(png, "base64"));

  const { server, port } = await createStaticServer(repoRoot);
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];

  page.on("pageerror", (error) => pageErrors.push(String(error)));
  captureRelevantConsoleErrors(page, consoleErrors);
  await page.addInitScript(() => {
    window.localStorage.setItem("truecost.v2.mock-admin-ui", "yes");
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/editor.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-editor-layout]", { timeout: 60000 });
    await page.waitForSelector("[data-editor-surface] .ProseMirror", { timeout: 60000 });

    await page.locator('[data-editor-command="toggle-wrapped-menu"]').click();
    const wrappedKinds = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-editor-wrapped-kind]")).map((node) =>
        node.getAttribute("data-editor-wrapped-kind")
      )
    );
    assert.deepEqual(wrappedKinds, ["image", "banner", "entityTile"]);

    await page.locator('[data-editor-wrapped-kind="banner"]').evaluate((button) => button.click());
    await page.waitForSelector("[data-editor-banner-create]", { timeout: 5000 });
    await page.locator("[data-editor-banner-create]").click();
    await page.waitForSelector('[name="mediaVariant"]', { timeout: 5000 });
    await page.fill('[name="mediaTitle"]', "Payroll trail");
    await page.fill('[name="mediaText"]', "Records point to repeated reimbursement anomalies.");
    await page.locator("[data-editor-multimedia-save]").click();
    await page.waitForSelector("[data-editor-banner-insert]", { timeout: 5000 });
    await page.locator("[data-editor-banner-insert]").first().click();
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("[data-template-multimedia]"))
        .some((node) => node.getAttribute("data-variant") === "banner" && !node.querySelector("img")),
      null,
      { timeout: 5000 }
    );
    await page.waitForFunction(
      () => document.querySelectorAll('[data-template-multimedia][data-variant="banner"] [data-editor-resize-handle]').length === 2,
      null,
      { timeout: 5000 }
    );
    const bannerBox = await page.locator('[data-template-multimedia][data-variant="banner"]').boundingBox();
    const composeSurface = await page.locator("[data-editor-surface] .ProseMirror").boundingBox();
    if (!bannerBox || !composeSurface) {
      throw new Error("Expected the inserted banner and editor surface.");
    }
    await page.locator('[data-editor-open-panel="document"]').click();
    await page.locator('[data-template-multimedia][data-variant="banner"]').click();
    await page.waitForSelector('[name="mediaVariant"]', { timeout: 5000 });
    await page.waitForFunction(
      () => document.querySelector('[name="mediaVariant"]')?.value === "banner",
      null,
      { timeout: 5000 }
    );
    await page.waitForSelector('[data-editor-media-placement="full-width"]', { timeout: 5000 });
    const beforeBannerTitleStyle = await page.locator('[data-template-multimedia][data-variant="banner"] .editor-media-card__text-box--title').getAttribute("style");
    const beforePreviewStyle = await page.locator('[data-editor-media-preview-text-box="title"]').getAttribute("style");
    const previewMoveHandle = await page.locator('[data-editor-media-preview-text-box-handle="title:move"]').boundingBox();
    if (!previewMoveHandle) {
      throw new Error("Expected the banner preview title handle.");
    }
    await page.mouse.move(previewMoveHandle.x + previewMoveHandle.width / 2, previewMoveHandle.y + previewMoveHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(previewMoveHandle.x + previewMoveHandle.width / 2 + 28, previewMoveHandle.y + previewMoveHandle.height / 2 + 12, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(
      (beforeStyle) => document.querySelector('[data-editor-media-preview-text-box="title"]')?.getAttribute("style") !== beforeStyle,
      beforePreviewStyle,
      { timeout: 5000 }
    );
    await page.waitForFunction(
      (beforeStyle) => document.querySelector('[data-template-multimedia][data-variant="banner"] .editor-media-card__text-box--title')?.getAttribute("style") !== beforeStyle,
      beforeBannerTitleStyle,
      { timeout: 5000 }
    );
    await page.mouse.click(
      composeSurface.x + 48,
      Math.min(composeSurface.y + composeSurface.height - 24, bannerBox.y + bannerBox.height + 40)
    );

    await page.locator('[data-editor-command="toggle-wrapped-menu"]').click();
    await page.locator('[data-editor-wrapped-kind="image"]').evaluate((button) => button.click());
    await page.locator("[data-editor-image-file]").setInputFiles(fixturePath);
    await page.waitForSelector("[data-editor-multimedia-save]", { timeout: 5000 });
    await page.selectOption('[name="imageAspectPreset"]', "1:1");
    await page.waitForFunction(
      () => {
        const preview = document.querySelector('[data-editor-media-preview="image"]');
        return Boolean(preview) && /^1(?:\\.0+)?$/.test((preview.style.getPropertyValue("--editor-media-aspect") || "").trim());
      },
      null,
      { timeout: 5000 }
    );
    await page.locator('[data-editor-image-transform="rotate-90"]').click();
    await page.waitForFunction(
      () => {
        const preview = document.querySelector('[data-editor-media-preview="image"]');
        return Boolean(preview) && (preview.style.getPropertyValue("--editor-media-rotation") || "").trim() === "0.25turn";
      },
      null,
      { timeout: 5000 }
    );
    await page.locator('[data-editor-image-transform="flip-horizontal"]').click();
    await page.waitForFunction(
      () => {
        const preview = document.querySelector('[data-editor-media-preview="image"]');
        return Boolean(preview) && (preview.style.getPropertyValue("--editor-media-flip-x") || "").trim() === "-1";
      },
      null,
      { timeout: 5000 }
    );
    await page.locator("[data-editor-multimedia-save]").click();
    await page.waitForFunction(
      () => !document.querySelector("[data-editor-multimedia-save]"),
      null,
      { timeout: 5000 }
    );
    await page.waitForFunction(
      () => !document.querySelector('[data-template-multimedia][data-variant="image"]'),
      null,
      { timeout: 5000 }
    );
    await page.waitForSelector("[data-editor-image-insert]", { timeout: 5000 });
    await page.locator("[data-editor-image-insert]").first().click();
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("[data-template-multimedia]"))
        .some((node) => node.getAttribute("data-variant") === "image" && Boolean(node.querySelector("img"))),
      null,
      { timeout: 5000 }
    );
    let insertedImageStyle = "";
    const insertedImageStyleDeadline = Date.now() + 5000;
    while (Date.now() < insertedImageStyleDeadline) {
      insertedImageStyle = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-template-multimedia][data-variant="image"]'))
          .map((node) => node.getAttribute("style") || "")
          .find((style) => /--editor-media-rotation:\s*0\.25turn/.test(style) && /--editor-media-flip-x:\s*-1/.test(style)) || ""
      );
      if (insertedImageStyle) break;
      await page.waitForTimeout(100);
    }
    assert.match(insertedImageStyle, /--editor-media-rotation:\s*0\.25turn/);
    assert.match(insertedImageStyle, /--editor-media-flip-x:\s*-1/);

    const imageNode = page.locator('[data-template-multimedia][data-variant="image"]').last();
    await imageNode.scrollIntoViewIfNeeded();
    const surface = await page.locator("[data-editor-surface] .ProseMirror").boundingBox();
    const imageBox = await imageNode.boundingBox();
    if (!surface || !imageBox) {
      throw new Error("Expected an inserted image-backed multimedia block.");
    }
    await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(surface.x + 8, imageBox.y + imageBox.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(
      () => document.querySelector('[data-template-multimedia][data-variant="image"]')?.getAttribute("data-placement") === "float-left",
      null,
      { timeout: 5000 }
    );
    await page.waitForFunction(
      () => /--editor-media-width:\s*0\.33/.test(document.querySelector('[data-template-multimedia][data-variant="image"]')?.getAttribute("style") || ""),
      null,
      { timeout: 5000 }
    );

    await imageNode.click();
    await page.waitForSelector('[name="mediaVariant"]', { timeout: 5000 });
    await page.selectOption('[name="mediaVariant"]', "captioned_image");
    await page.waitForSelector('[name="mediaTitle"]', { timeout: 5000 });
    await page.fill('[name="mediaTitle"]', "County yard");
    await page.fill('[name="mediaText"]', "Caption copy");
    await page.locator('[data-editor-media-placement="full-width"]').click();
    await page.locator("[data-editor-multimedia-save]").click();
    await page.waitForFunction(
      () => {
        const node = document.querySelector('[data-template-multimedia][data-variant="captioned_image"]');
        return Boolean(node?.querySelector('[data-editor-media-text-region="caption"]')) &&
          node?.getAttribute("data-placement") === "full-width";
      },
      null,
      { timeout: 5000 }
    );

    await page.locator('[data-editor-command="toggle-wrapped-menu"]').click();
    await page.locator('[data-editor-wrapped-kind="entityTile"]').evaluate((button) => button.click());
    await page.waitForSelector('[name="entityTileSearch"]', { timeout: 5000 });
    await page.fill('[name="entityTileSearch"]', "County");
    await page.waitForSelector("[data-editor-entity-tile-pick]", { timeout: 5000 });
    await page.locator("[data-editor-entity-tile-pick]").first().click();
    await page.waitForSelector("[data-investigation-entity-tile]", { timeout: 5000 });
    await page.waitForFunction(
      () => document.querySelectorAll("[data-investigation-entity-tile] [data-editor-entity-resize-handle]").length === 2,
      null,
      { timeout: 5000 }
    );

    await page.locator("[data-investigation-entity-tile]").scrollIntoViewIfNeeded();
    const entityBox = await page.locator("[data-investigation-entity-tile]").boundingBox();
    if (!entityBox) {
      throw new Error("Expected an inserted entity tile.");
    }
    await page.mouse.move(entityBox.x + entityBox.width / 2, entityBox.y + entityBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(surface.x + 8, entityBox.y + entityBox.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(
      () => document.querySelector("[data-investigation-entity-tile]")?.getAttribute("data-placement") === "float-left",
      null,
      { timeout: 5000 }
    );
    await page.waitForFunction(
      () => /--editor-media-width:\s*0\.33/.test(document.querySelector("[data-investigation-entity-tile]")?.getAttribute("style") || ""),
      null,
      { timeout: 5000 }
    );
    await page.locator('[data-editor-open-panel="document"]').click();
    await page.locator("[data-investigation-entity-tile]").click();
    await page.waitForSelector('[name="entityTileSearch"]', { timeout: 5000 });
    await page.waitForSelector('[data-editor-entity-placement="float-right"]', { timeout: 5000 });
    await page.locator('[data-editor-entity-placement="float-right"]').click();
    await page.waitForFunction(
      () => document.querySelector("[data-investigation-entity-tile]")?.getAttribute("data-placement") === "float-right",
      null,
      { timeout: 5000 }
    );

    const finalState = await page.evaluate(() => ({
      bannerCount: Array.from(document.querySelectorAll('[data-template-multimedia][data-variant="banner"]')).length,
      captionedCount: Array.from(document.querySelectorAll('[data-template-multimedia][data-variant="captioned_image"]')).length,
      entityPlacement: document.querySelector("[data-investigation-entity-tile]")?.getAttribute("data-placement") || "",
      entityWidth: document.querySelector("[data-investigation-entity-tile]")?.getAttribute("style") || "",
      captionText: document.querySelector('[data-template-multimedia][data-variant="captioned_image"] [data-editor-media-text-region="caption"]')?.textContent || ""
    }));

    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(" | ")}`);
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(" | ")}`);
    assert.equal(finalState.bannerCount, 1);
    assert.equal(finalState.captionedCount, 1);
    assert.equal(finalState.entityPlacement, "float-right");
    assert.match(finalState.entityWidth, /0\.33/);
    assert.match(finalState.captionText, /County yard/);
    assert.match(finalState.captionText, /Caption copy/);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(fixturePath, { force: true });
  }
});

test("toolbar menus anchor below the ribbon and quote/list commands toggle off cleanly", async (t) => {
  const playwright = await loadPlaywright();
  if (!playwright?.chromium) {
    t.skip("Playwright is not available in this workspace.");
    return;
  }

  const { server, port } = await createStaticServer(repoRoot);
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];

  page.on("pageerror", (error) => pageErrors.push(String(error)));
  captureRelevantConsoleErrors(page, consoleErrors);
  await page.addInitScript(() => {
    window.localStorage.setItem("truecost.v2.mock-admin-ui", "yes");
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/editor.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-editor-layout]", { timeout: 60000 });
    await page.waitForSelector("[data-editor-surface] .ProseMirror", { timeout: 60000 });

    await page.locator("[data-editor-surface] .ProseMirror").click();
    await page.keyboard.type("Quoted paragraph");

    await page.locator('[data-editor-command="toggle-format-menu"]').click();
    await page.waitForSelector("[data-editor-format-menu]", { timeout: 5000 });
    const formatGeometry = await page.evaluate(() => {
      const menu = document.querySelector("[data-editor-format-menu]")?.getBoundingClientRect();
      const button = document.querySelector('[data-editor-command="toggle-format-menu"]')?.getBoundingClientRect();
      const ribbon = document.querySelector("[data-editor-ribbon]")?.getBoundingClientRect();
      return menu && button && ribbon
        ? {
            menuTop: menu.top,
            menuBottom: menu.bottom,
            buttonBottom: button.bottom,
            ribbonBottom: ribbon.bottom
          }
        : null;
    });
    assert.ok(formatGeometry, "Expected the format menu geometry.");
    assert.ok(formatGeometry.menuTop >= formatGeometry.buttonBottom - 1, "Format menu should open below its button.");
    assert.ok(formatGeometry.menuBottom > formatGeometry.ribbonBottom + 8, "Format menu should escape the ribbon instead of scrolling inside it.");
    await page.locator('[data-editor-command="toggle-format-menu"]').click();

    await page.locator('[data-editor-command="toggle-wrapped-menu"]').click();
    await page.waitForSelector("[data-editor-wrapped-menu]", { timeout: 5000 });
    const wrappedGeometry = await page.evaluate(() => {
      const menu = document.querySelector("[data-editor-wrapped-menu]")?.getBoundingClientRect();
      const button = document.querySelector('[data-editor-command="toggle-wrapped-menu"]')?.getBoundingClientRect();
      const ribbon = document.querySelector("[data-editor-ribbon]")?.getBoundingClientRect();
      return menu && button && ribbon
        ? {
            menuTop: menu.top,
            menuBottom: menu.bottom,
            buttonBottom: button.bottom,
            menuRight: menu.right,
            buttonRight: button.right,
            ribbonBottom: ribbon.bottom
          }
        : null;
    });
    assert.ok(wrappedGeometry, "Expected the wrapped-content menu geometry.");
    assert.ok(wrappedGeometry.menuTop >= wrappedGeometry.buttonBottom - 1, "Wrapped-content menu should open below its button.");
    assert.ok(wrappedGeometry.menuBottom > wrappedGeometry.ribbonBottom + 8, "Wrapped-content menu should escape the ribbon instead of pinning inside it.");
    assert.ok(Math.abs(wrappedGeometry.menuRight - wrappedGeometry.buttonRight) < 80, "Wrapped-content menu should stay anchored to its trigger instead of the viewport corner.");
    await page.locator('[data-editor-command="toggle-wrapped-menu"]').click();

    await page.locator('[data-editor-command="blockquote"]').click();
    await page.waitForFunction(() => Boolean(document.querySelector(".ProseMirror blockquote")), null, { timeout: 5000 });
    await page.locator('[data-editor-command="blockquote"]').click();
    await page.waitForFunction(() => !document.querySelector(".ProseMirror blockquote"), null, { timeout: 5000 });

    await page.keyboard.press("Enter");
    await page.locator('[data-editor-command="bullet-list"]').click();
    await page.keyboard.type("Bullet item");
    await page.locator('[data-editor-command="bullet-list"]').click();
    await page.waitForFunction(() => !document.querySelector(".ProseMirror ul"), null, { timeout: 5000 });

    await page.locator('[data-editor-command="ordered-list"]').click();
    await page.keyboard.type("Ordered item");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second");
    await page.keyboard.press("Home");
    await page.keyboard.press("Backspace");
    await page.waitForFunction(
      () => {
        const orderedItems = document.querySelectorAll(".ProseMirror ol li").length;
        const paragraphs = Array.from(document.querySelectorAll(".ProseMirror p"));
        return orderedItems === 1 && paragraphs.some((node) => node.textContent?.includes("Second"));
      },
      null,
      { timeout: 5000 }
    );

    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(" | ")}`);
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(" | ")}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
