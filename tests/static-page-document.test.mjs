import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStaticPageDocument,
  extractStaticPageSnapshot,
  staticPageDocumentId
} from "../scripts/core/static-page-document.js";

test("static page documents preserve keyed page content in structured metadata", () => {
  const document = buildStaticPageDocument({
    pageId: "about",
    savedAt: 123,
    content: {
      "about.hero.title": "<strong>About</strong>",
      "about.hero.lede": "<p>Built for people first.</p>"
    }
  });

  assert.equal(document.id, "static-page:about");
  assert.equal(document.kind, "static-page");
  assert.equal(document.metadata.pageId, "about");
  assert.equal(document.metadata.savedAt, 123);
  assert.deepEqual(document.metadata.pageContent, {
    "about.hero.title": "<strong>About</strong>",
    "about.hero.lede": "<p>Built for people first.</p>"
  });
});

test("extractStaticPageSnapshot restores saved content from structured page documents", () => {
  const snapshot = extractStaticPageSnapshot({
    document: buildStaticPageDocument({
      pageId: "guide",
      savedAt: 456,
      content: {
        "guide.hero.title": "<strong>Guide</strong>"
      }
    })
  });

  assert.deepEqual(snapshot, {
    pageId: "guide",
    savedAt: 456,
    content: {
      "guide.hero.title": "<strong>Guide</strong>"
    }
  });
  assert.equal(staticPageDocumentId("guide"), "static-page:guide");
});
