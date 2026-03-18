import test from "node:test";
import assert from "node:assert/strict";

import {
  buildStaticPageDraftPayload,
  draftOwnerPubkey,
  draftToInvestigationPreview,
  pageDraftActionLabel,
  pageDraftHref,
  reviewActionMessage
} from "../scripts/core/page-drafts.js";

test("draftOwnerPubkey resolves the oldest revision author first", () => {
  const draft = {
    author: "fallback",
    revisions: [
      { author: "latest" },
      { author: "oldest" }
    ]
  };

  assert.equal(draftOwnerPubkey(draft), "oldest");
});

test("draftToInvestigationPreview fills investigation-facing defaults", () => {
  const preview = draftToInvestigationPreview({
    slug: "draft-1",
    markdown: "# Body",
    status: "candidate"
  });

  assert.equal(preview.body, "# Body");
  assert.equal(preview.title, "Untitled investigation");
  assert.equal(preview.summary, "No summary added yet.");
  assert.equal(preview.location, "Draft location pending");
  assert.deepEqual(preview.records, []);
});

test("page draft helpers map preview and review targets consistently", () => {
  const payload = buildStaticPageDraftPayload("about", {
    "about.hero.title": "<strong>About</strong>",
    "about.hero.lede": "<p>Updated lede</p>"
  });

  assert.equal(payload.page_path, "./about.html");
  assert.equal(pageDraftHref(payload), "./about.html?draft=page-about");
  assert.equal(pageDraftHref(payload, "approved"), "./about.html");
  assert.equal(pageDraftActionLabel(payload, "approved"), "Open page");
});

test("reviewActionMessage returns public-facing page and investigation review copy", () => {
  assert.equal(
    reviewActionMessage("approve", { content_type: "page", page_id: "home" }),
    "Page update approved for publish."
  );
  assert.equal(
    reviewActionMessage("deny", { content_type: "markdown", title: "Case" }),
    "Investigation denied."
  );
});
