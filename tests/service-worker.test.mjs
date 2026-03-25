import test from "node:test";
import assert from "node:assert/strict";

import { renderServiceWorker } from "../site-src/service-worker.mjs";

test("renderServiceWorker emits a versioned precache manifest", () => {
  const source = renderServiceWorker({
    cacheVersion: "20260320120000",
    precacheUrls: ["./index.html", "./styles.css"],
    runtimeHtmlUrls: ["./index.html"],
    runtimeAssetPrefixes: ["./scripts/"],
    runtimeContentPrefixes: ["./content/"]
  });

  assert.ok(source.includes("truecost-precache-${CACHE_VERSION}"));
  assert.ok(source.includes("\"./index.html\""));
  assert.ok(source.includes("\"./scripts/\""));
  assert.ok(source.includes("cacheFirst"));
});

test("renderServiceWorker disables caching on localhost", () => {
  const source = renderServiceWorker({
    cacheVersion: "20260320120000",
    precacheUrls: ["./index.html"],
    runtimeHtmlUrls: ["./index.html"],
    runtimeAssetPrefixes: ["./scripts/"],
    runtimeContentPrefixes: ["./content/"]
  });

  assert.ok(source.includes("LOCAL_DEVELOPMENT_HOSTS"));
  assert.ok(source.includes("CACHE_DISABLED"));
  assert.ok(source.includes("if (CACHE_DISABLED) return false;"));
});
