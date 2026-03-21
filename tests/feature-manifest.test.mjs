import test from "node:test";
import assert from "node:assert/strict";

import { createFeatureManifest } from "../scripts/core/feature-manifest.js";

test("feature manifest caches loaded features", async () => {
  let loadCount = 0;
  const manifest = createFeatureManifest({
    sample: async () => {
      loadCount += 1;
      return { ok: true };
    }
  }, {
    schedule(task) {
      task();
    }
  });

  const first = await manifest.load("sample");
  const second = await manifest.load("sample");

  assert.deepEqual(first, { ok: true });
  assert.equal(second, first);
  assert.equal(loadCount, 1);
});

test("feature manifest preloads known features without throwing on unknown keys", async () => {
  let preloadCount = 0;
  const manifest = createFeatureManifest({
    first: async () => {
      preloadCount += 1;
      return { key: "first" };
    }
  }, {
    schedule(task) {
      task();
    }
  });

  manifest.preload(["first", "missing"]);
  await manifest.load("first");
  assert.equal(preloadCount, 1);
});
