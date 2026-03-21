import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { minify as minifyHtml } from "html-minifier-terser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = __dirname;
const dist = path.join(root, "dist");

await import("./tooling/build-styles.mjs");

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

const htmlFiles = [
  "index.html",
  "investigations.html",
  "investigation.html",
  "guide.html",
  "submit.html",
  "admin.html",
  "map.html",
  "graph.html",
  "wiki.html",
  "editor.html",
  "get-involved.html",
  "about.html",
  "merch.html"
];

const scriptEntries = ["shell.js", "app.js", "admin.js", "submit.js", "editor.js"];

for (const entry of scriptEntries) {
  await esbuild.build({
    entryPoints: [path.join(root, "scripts", entry)],
    bundle: true,
    format: "esm",
    minify: true,
    outfile: path.join(dist, "scripts", entry)
  });
}

const css = await fs.readFile(path.join(root, "styles.css"), "utf8");
const minifiedCss = await esbuild.transform(css, { loader: "css", minify: true });
await fs.writeFile(path.join(dist, "styles.css"), minifiedCss.code, "utf8");

for (const file of htmlFiles) {
  const html = await fs.readFile(path.join(root, file), "utf8");
  const minified = await minifyHtml(html, {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: false,
    minifyJS: false
  });
  await fs.writeFile(path.join(dist, file), minified, "utf8");
}

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
