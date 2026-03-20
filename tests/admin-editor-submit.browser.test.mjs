import test from "node:test";
import assert from "node:assert/strict";

import {
  captureRelevantConsoleErrors,
  createStaticServer,
  loadPlaywright,
  seedAdminSession,
  seedKnownUsernameOwner,
  seedConflictedUsernameSession
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

    await page.click('[data-workspace-tab="profile"]');
    await page.click("[data-open-password-rotation]");
    await page.waitForSelector("[data-password-rotation-form]", { timeout: 15000 });
    await page.fill('[data-password-rotation-form] [name="password"]', "observer-pass-1");
    await page.fill('[data-password-rotation-form] [name="confirmPassword"]', "observer-pass-1");
    await page.evaluate(() => {
      document.querySelector('[data-workspace-tab="dashboard"]')?.click();
    });
    const passwordDraftState = await page.evaluate(() => ({
      password: document.querySelector('[data-password-rotation-form] [name="password"]')?.value || "",
      confirmPassword: document.querySelector('[data-password-rotation-form] [name="confirmPassword"]')?.value || "",
      modalOpen: Boolean(document.querySelector("[data-password-rotation-form]"))
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
    assert.deepEqual(passwordDraftState, {
      password: "observer-pass-1",
      confirmPassword: "observer-pass-1",
      modalOpen: true
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

test("conflicting username sessions are blocked across workspace, submit, and comments", async (t) => {
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

  const relevantPageErrors = () =>
    pageErrors.filter((text) => !String(text || "").includes("_leaflet_pos"));

  try {
    await seedConflictedUsernameSession(page, {
      port,
      secretKeyHex,
      pubkey: "6".repeat(64),
      claimedUsername: "aux",
      ownerPubkey: pubkey
    });

    await page.goto(`http://127.0.0.1:${port}/admin.html`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-workspace-pane]", { timeout: 15000 });
    const workspaceWarning = await page.locator("[data-workspace-pane]").textContent();

    await page.goto(`http://127.0.0.1:${port}/submit.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.body.textContent.includes("Username conflict"),
      { timeout: 15000 }
    );
    const submitConflictState = await page.evaluate(() => ({
      bodyText: document.body.textContent || "",
      hasAddSubmission: Boolean(document.querySelector('[data-open-submission-modal="new"]'))
    }));

    await page.goto(
      `http://127.0.0.1:${port}/investigation.html?slug=2026-03-09-placeholder-turnstile`,
      { waitUntil: "domcontentloaded" }
    );
    await page.waitForSelector("[data-comment-panel]", { timeout: 15000 });
    await page.waitForFunction(
      () => document.querySelector("[data-comment-panel]")?.textContent.includes("comment from this account"),
      { timeout: 15000 }
    );
    const commentConflictState = await page.evaluate(() => ({
      panelText: document.querySelector("[data-comment-panel]")?.textContent || "",
      hasCommentList: Boolean(document.querySelector(".comment-list")),
      hasComposer: Boolean(document.querySelector('[data-comment-form="root"]')),
      hasReplyButton: Boolean(document.querySelector("[data-reply-comment]")),
      hasVoteButton: Boolean(document.querySelector("[data-comment-vote]"))
    }));

    assert.deepEqual(relevantPageErrors(), [], `page errors: ${relevantPageErrors().join(" | ")}`);
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(" | ")}`);
    assert.match(workspaceWarning || "", /Username conflict/);
    assert.match(workspaceWarning || "", /Choose a different username/);
    assert.match(submitConflictState.bodyText, /Username conflict/);
    assert.match(submitConflictState.bodyText, /Submissions and encrypted chat are disabled/);
    assert.equal(submitConflictState.hasAddSubmission, false, "conflicted sessions should not offer submission actions");
    assert.match(commentConflictState.panelText, /already claimed by another identity/);
    assert.equal(commentConflictState.hasCommentList, false, "conflicted sessions should not render the comment list");
    assert.equal(commentConflictState.hasComposer, false, "conflicted sessions should not render the root comment composer");
    assert.equal(commentConflictState.hasReplyButton, false, "conflicted sessions should not offer reply controls");
    assert.equal(commentConflictState.hasVoteButton, false, "conflicted sessions should not offer vote controls");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("login form rejects a taken username before persisting a session", async (t) => {
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
    await seedKnownUsernameOwner(page, { port, username: "aux", ownerPubkey: pubkey });

    await page.goto(`http://127.0.0.1:${port}/admin.html?tab=login`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-login-form]", { timeout: 15000 });
    assert.equal(await page.locator("[data-workspace-tab]").count(), 0, "logged-out workspace should not render a fake login tab");
    await page.fill('[data-login-form] [name="username"]', "aux");
    await page.fill('[data-login-form] [name="password"]', "different-password");
    await page.click("[data-login-submit]");
    await page.waitForFunction(
      () => document.querySelector("[data-workspace-status]")?.textContent.includes("already exists and your password did not match"),
      { timeout: 15000 }
    );
    await page.click("[data-append-next-available-username]");
    await page.waitForFunction(() => {
      const value = document.querySelector('[data-login-form] [name="username"]')?.value || "";
      return /^aux\d+$/.test(value) && value !== "aux";
    }, { timeout: 15000 });

    const loginState = await page.evaluate(() => ({
      statusText: document.querySelector("[data-workspace-status]")?.textContent || "",
      usernameValue: document.querySelector('[data-login-form] [name="username"]')?.value || "",
      storedSession: localStorage.getItem("truecost.v2.session") || ""
    }));

    assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join(" | ")}`);
    assert.deepEqual(consoleErrors, [], `console errors: ${consoleErrors.join(" | ")}`);
    assert.match(loginState.usernameValue, /^aux\d+$/);
    assert.notEqual(loginState.usernameValue, "aux");
    assert.match(loginState.statusText, new RegExp(`Try @${loginState.usernameValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.equal(loginState.storedSession, "", "taken usernames should not persist a new session");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
