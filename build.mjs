import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { minify as minifyHtml } from "html-minifier-terser";
import { renderPageHtml } from "./site-src/layout.mjs";
import { pageDefinitions, siteTemplate } from "./site-src/pages.mjs";
import { renderServiceWorker } from "./site-src/service-worker.mjs";
import { buildStylesBundle } from "./tooling/build-styles.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;
const dist = path.join(root, "dist");
const pageSourceRoot = path.join(root, "site-src", "main");
const buildVersion = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

await fs.mkdir(dist, { recursive: true });
await clearDirContents(dist);

await esbuild.build({
  entryPoints: [
    path.join(root, "scripts", "shell.js"),
    path.join(root, "scripts", "app.js"),
    path.join(root, "scripts", "admin.js"),
    path.join(root, "scripts", "submit.js"),
    path.join(root, "scripts", "editor.js")
  ],
  bundle: true,
  splitting: true,
  format: "esm",
  minify: true,
  outdir: path.join(dist, "scripts"),
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]"
});

const css = await buildStylesBundle();
const minifiedCss = await esbuild.transform(css, { loader: "css", minify: true });
await fs.writeFile(path.join(dist, "styles.css"), minifiedCss.code, "utf8");

for (const page of pageDefinitions) {
  const mainHtml = await fs.readFile(path.join(pageSourceRoot, page.mainSource), "utf8");
  const html = renderPageHtml({
    page,
    site: siteTemplate,
    mainHtml
  });
  const minified = await minifyHtml(html, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: false,
    minifyJS: false
  });
  await fs.writeFile(path.join(dist, page.fileName), minified, "utf8");
}

const fontAssets = await listRelativeFiles(path.join(root, "styles", "fonts"), root);
const vendorAssets = await listRelativeFiles(path.join(root, "vendor"), root);
const serviceWorkerSource = renderServiceWorker({
  cacheVersion: buildVersion,
  precacheUrls: [
    ...pageDefinitions.map((page) => `./${page.fileName}`),
    "./styles.css",
    "./favicon.svg",
    "./scripts/shell.js",
    "./scripts/app.js",
    "./scripts/admin.js",
    "./scripts/submit.js",
    "./scripts/editor.js",
    "./content/investigations/index.json",
    "./content/graph/wiki-seed.json",
    "./content/pages/guide.md",
    ...fontAssets,
    ...vendorAssets
  ],
  runtimeHtmlUrls: pageDefinitions.map((page) => `./${page.fileName}`),
  runtimeAssetPrefixes: ["./scripts/", "./styles/", "./vendor/", "./favicon.svg"],
  runtimeContentPrefixes: ["./content/"]
});
await fs.writeFile(path.join(dist, "service-worker.js"), serviceWorkerSource, "utf8");

await copyDir(path.join(root, "content"), path.join(dist, "content"));
await copyDir(path.join(root, "vendor"), path.join(dist, "vendor"));
await copyDir(path.join(root, "styles"), path.join(dist, "styles"));
await copyFile(path.join(root, "favicon.svg"), path.join(dist, "favicon.svg"));
await copyFile(path.join(root, ".nojekyll"), path.join(dist, ".nojekyll"));

async function copyDir(source, target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}

async function copyFile(source, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function clearDirContents(target) {
  const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    await fs.rm(path.join(target, entry.name), { recursive: true, force: true });
  }
}

async function listRelativeFiles(source, base) {
  try {
    const entries = await fs.readdir(source, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const from = path.join(source, entry.name);
      if (entry.isDirectory()) {
        files.push(...await listRelativeFiles(from, base));
        continue;
      }
      files.push(`./${path.relative(base, from).replaceAll(path.sep, "/")}`);
    }
    return files;
  } catch {
    return [];
  }
}
