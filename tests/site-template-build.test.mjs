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
    mainHtml
  });

  assert.match(rendered, /<body data-page="map">/);
  assert.match(rendered, /vendor\/leaflet\.css/);
  assert.match(rendered, /vendor\/leaflet\.js/);
  assert.match(rendered, /data-map-canvas/);
  assert.match(rendered, /scripts\/app\.js/);
});

test("legacy root html pages are removed and generated output lives under dist", async () => {
  for (const fileName of legacyRootPages) {
    await assert.rejects(fs.access(path.join(root, fileName)));
    await fs.access(path.join(root, "dist", fileName));
  }
});
