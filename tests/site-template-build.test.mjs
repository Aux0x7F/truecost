import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderPageHtml } from "../site-src/layout.mjs";
import { pageDefinitions, siteTemplate } from "../site-src/pages.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const pageSourceRoot = path.join(root, "site-src", "main");
const legacyRootPages = [
  "index.html",
  "about.html",
  "investigations.html",
  "investigation.html",
  "map.html",
  "graph.html",
  "wiki.html",
  "guide.html",
  "submit.html",
  "admin.html",
  "editor.html",
  "get-involved.html",
  "merch.html"
];

test("page definitions point at existing template sources", async () => {
  for (const page of pageDefinitions) {
    await fs.access(path.join(pageSourceRoot, page.mainSource));
    assert.ok(page.bakedown, `${page.fileName} should declare bakedown metadata`);
    assert.ok(Array.isArray(page.bakedown.interactiveMounts), `${page.fileName} should list interactive mounts`);
  }
});

test("renderPageHtml uses page definitions as the source of truth", async () => {
  const mapPage = pageDefinitions.find((page) => page.fileName === "map.html");
  assert.ok(mapPage);
  const mainHtml = await fs.readFile(path.join(pageSourceRoot, mapPage.mainSource), "utf8");
  const rendered = renderPageHtml({
    page: mapPage,
    site: siteTemplate,
    mainHtml,
    inlineStyles: "body{background:#fff}"
  });

  assert.match(rendered, /<body data-page="map">/);
  assert.match(rendered, /vendor\/leaflet\.css/);
  assert.match(rendered, /vendor\/leaflet\.js/);
  assert.match(rendered, /data-map-canvas/);
  assert.match(rendered, /scripts\/app\.js/);
  assert.match(rendered, /data-inline-styles/);
  assert.doesNotMatch(rendered, /<section class="hero">/);
  assert.doesNotMatch(rendered, /section--page-intro/);
});

test("investigation pages that render preview maps include leaflet assets", async () => {
  for (const fileName of ["investigations.html", "investigation.html"]) {
    const page = pageDefinitions.find((entry) => entry.fileName === fileName);
    assert.ok(page, `${fileName} should exist in page definitions`);
    const mainHtml = await fs.readFile(path.join(pageSourceRoot, page.mainSource), "utf8");
    const rendered = renderPageHtml({
      page,
      site: siteTemplate,
      mainHtml,
      inlineStyles: "body{background:#fff}"
    });

    assert.match(rendered, /vendor\/leaflet\.css/, `${fileName} should include leaflet styles for preview maps`);
    assert.match(rendered, /vendor\/leaflet\.js/, `${fileName} should include leaflet scripts for preview maps`);
  }
});

test("legacy root html pages are removed and generated output lives under dist", async () => {
  for (const fileName of legacyRootPages) {
    await assert.rejects(fs.access(path.join(root, fileName)));
    await fs.access(path.join(root, "dist", fileName));
  }
});

test("interactive explore pages render without intro shells above the main surface", async () => {
  for (const fileName of ["investigations.html", "map.html", "graph.html", "wiki.html"]) {
    const page = pageDefinitions.find((entry) => entry.fileName === fileName);
    assert.ok(page, `${fileName} should exist in page definitions`);
    const mainHtml = await fs.readFile(path.join(pageSourceRoot, page.mainSource), "utf8");
    const rendered = renderPageHtml({
      page,
      site: siteTemplate,
      mainHtml,
      inlineStyles: "body{background:#fff}"
    });

    assert.doesNotMatch(mainHtml, /<section class="hero">/, `${fileName} source should not carry a hero shell`);
    assert.doesNotMatch(mainHtml, /section--page-intro/, `${fileName} source should not carry a page intro shell`);
    assert.doesNotMatch(rendered, /<section class="hero">/, `${fileName} output should not render a hero shell`);
    assert.doesNotMatch(rendered, /section--page-intro/, `${fileName} output should not render a page intro shell`);
  }
});
