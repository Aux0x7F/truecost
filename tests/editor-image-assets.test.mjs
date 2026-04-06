import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveInvestigationImageBakedPath,
  serializeImageAssetForDraft
} from "../scripts/core/editor-image-assets.js";

test("image assets derive deterministic bakedown paths for investigations", () => {
  const path = deriveInvestigationImageBakedPath("county-line", {
    blobSha256: "a".repeat(64),
    mimeType: "image/jpeg",
    name: "County Yard Camera"
  });

  assert.equal(
    path,
    `./content/investigation-assets/county-line/${"a".repeat(64)}.jpg`
  );
});

test("draft image asset serialization stamps baked path when one is missing", () => {
  const serialized = serializeImageAssetForDraft(
    {
      id: "img-local-1",
      name: "yard evidence",
      mimeType: "image/webp",
      publishUrl: "https://blossom.band/blob/123",
      blobSha256: "b".repeat(64)
    },
    { slug: "yard-audit" }
  );

  assert.equal(
    serialized.bakedPath,
    `./content/investigation-assets/yard-audit/${"b".repeat(64)}.webp`
  );
  assert.equal(serialized.publishUrl, "https://blossom.band/blob/123");
});

