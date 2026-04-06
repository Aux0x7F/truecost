import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveInvestigationStructuredArtifacts,
  editorDocumentFromInvestigationRecord,
  parseInvestigationImageTitleSpec,
  renderStructuredInvestigationHtml,
  stringifyInvestigationImageTitleSpec,
  structuredDocumentToMarkdown
} from "../scripts/core/investigation-document.js";

test("investigation document artifacts preserve rich image placement metadata", () => {
  const markdown = [
    "## Heading",
    "",
    "Paragraph copy.",
    "",
    '![Yard](https://example.com/yard.jpg "placement:fill-crop;drag:0.25,0.75;crop:0.1,0.2,0.8,0.7|County yard")'
  ].join("\n");

  const artifacts = deriveInvestigationStructuredArtifacts({
    slug: "county-line",
    title: "County Line",
    summary: "Summary",
    markdown,
    entityRefs: ["county-line-logistics-yard"],
    tags: ["records"]
  });

  assert.equal(artifacts.structuredDocument.blocks[1].type, "multimedia");
  assert.equal(artifacts.structuredDocument.blocks[1].variant, "image");
  assert.equal(artifacts.structuredDocument.blocks[1].placement, "fill-crop");
  assert.deepEqual(artifacts.structuredDocument.blocks[1].drag, { x: 0.25, y: 0.75 });
  assert.deepEqual(artifacts.structuredDocument.blocks[1].crop, { x: 0.1, y: 0.2, width: 0.8, height: 0.7 });
  assert.deepEqual(artifacts.entityRefs, ["county-line-logistics-yard"]);
});

test("structured investigation documents round-trip through markdown-compatible records", () => {
  const title = stringifyInvestigationImageTitleSpec({
    placement: "float-left",
    caption: "Processor entrance",
    drag: { x: 0.4, y: 0.6 },
    crop: { x: 0, y: 0, width: 1, height: 1 }
  });
  const record = {
    title: "North Valley",
    summary: "Summary",
    date: "2026-03-21",
    tags: ["records"],
    entity_refs: ["north-valley", "county-line"],
    structured_document: {
      id: "investigation:north-valley",
      kind: "investigation",
      title: "North Valley",
      summary: "Summary",
      metadata: {
        slug: "north-valley",
        tags: ["records"],
        entityRefs: ["north-valley", "county-line"]
      },
      blocks: [
        { id: "md-1", type: "markdown", text: "## Heading\n\nParagraph" },
        { id: "img-1", type: "image", src: "https://example.com/image.jpg", alt: "Image", caption: "Processor entrance", placement: "float-left", drag: { x: 0.4, y: 0.6 }, crop: { x: 0, y: 0, width: 1, height: 1 } }
      ]
    }
  };

  const document = editorDocumentFromInvestigationRecord(record);
  assert.equal(document.primaryEntity, "north-valley");
  assert.deepEqual(document.entityRefs, ["county-line"]);
  assert.match(document.markdown, /placement:float-left/);
  assert.match(document.markdown, /Processor entrance/);

  const markdown = structuredDocumentToMarkdown(record.structured_document);
  assert.match(markdown, /## Heading/);
  assert.match(markdown, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("structured investigation artifacts preserve bakedown image paths for published output", () => {
  const artifacts = deriveInvestigationStructuredArtifacts({
    slug: "north-valley",
    title: "North Valley",
    summary: "Summary",
    bodyJson: {
      type: "doc",
      content: [
        {
          type: "investigationImage",
          attrs: {
            assetId: "img-1",
            src: "https://blossom.band/blob/abc",
            alt: "Facility",
            caption: "North Valley exterior",
            placement: "full-width"
          }
        }
      ]
    },
    mediaAssets: [
      {
        id: "img-1",
        name: "north valley exterior",
        mimeType: "image/png",
        publishUrl: "https://blossom.band/blob/abc",
        blobSha256: "c".repeat(64)
      }
    ]
  });

  assert.equal(
    artifacts.structuredDocument.metadata.mediaAssets[0].bakedPath,
    `./content/investigation-assets/north-valley/${"c".repeat(64)}.png`
  );

  const html = renderStructuredInvestigationHtml(artifacts.structuredDocument, {
    renderMarkedHtml: (markdown) => markdown
  });
  assert.match(
    html,
    new RegExp(`content/investigation-assets/north-valley/${"c".repeat(64)}\\.png`)
  );
});

test("structured investigation renderer keeps markdown blocks and richer article image classes", () => {
  const html = renderStructuredInvestigationHtml(
    {
      id: "investigation:test",
      kind: "investigation",
      blocks: [
        { id: "md-1", type: "markdown", text: "## Heading\n\nParagraph" },
        { id: "img-1", type: "image", src: "https://example.com/image.jpg", alt: "Image", caption: "Caption", placement: "center", drag: { x: 0.3, y: 0.7 }, crop: { x: 0, y: 0, width: 1, height: 1 } }
      ]
    },
    {
      renderMarkedHtml: (markdown) => `<section class="rendered-markdown">${markdown}</section>`
    }
  );

  assert.match(html, /rendered-markdown/);
  assert.match(html, /article-image--center/);
  assert.match(html, /data-article-image-placement="center"/);
});

test("image title parser supports legacy and current placement formats", () => {
  assert.equal(parseInvestigationImageTitleSpec("align:right|Caption").placement, "float-right");
  assert.equal(parseInvestigationImageTitleSpec("placement:full-width|Caption").placement, "full-width");
});
