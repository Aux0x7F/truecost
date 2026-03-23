import {
  STRUCTURED_IMAGE_PLACEMENTS,
  collectStructuredDocumentCitations,
  createStructuredDocument,
  extractStructuredDocumentEntityRefs,
  extractStructuredDocumentRelationshipCandidates,
  extractStructuredDocumentSearchText,
  normalizeDocumentBlock,
  normalizeStructuredDocument
} from "../../vendor/nostr-site-support.esm.js";
import { cleanSlug } from "./nostr.js";
import { escapeAttribute, escapeHtml } from "./text-utils.js";

const DEFAULT_IMAGE_DRAG = Object.freeze({ x: 0.5, y: 0.5 });
const DEFAULT_IMAGE_CROP = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });

const LEGACY_TO_STRUCTURED_PLACEMENT = Object.freeze({
  left: "float-left",
  right: "float-right",
  full: "full-width",
  "full-width": "full-width",
  center: "center",
  "fill-crop": "fill-crop"
});

const STRUCTURED_TO_LEGACY_PLACEMENT = Object.freeze({
  "float-left": "left",
  "float-right": "right",
  center: "center",
  "full-width": "full",
  "fill-crop": "fill-crop"
});

export const INVESTIGATION_IMAGE_PLACEMENTS = STRUCTURED_IMAGE_PLACEMENTS;

export function investigationDocumentId(value) {
  const slug = cleanSlug(value || "");
  return slug ? `investigation:${slug}` : "";
}

export function normalizeInvestigationImagePlacement(value, fallback = "full-width") {
  const cleanValue = String(value || "").trim().toLowerCase();
  const normalized = LEGACY_TO_STRUCTURED_PLACEMENT[cleanValue] || cleanValue;
  return STRUCTURED_IMAGE_PLACEMENTS.includes(normalized) ? normalized : fallback;
}

export function parseInvestigationImageTitleSpec(rawTitle = "") {
  const title = String(rawTitle || "").trim();
  if (!title) {
    return {
      placement: "full-width",
      caption: "",
      drag: { ...DEFAULT_IMAGE_DRAG },
      crop: { ...DEFAULT_IMAGE_CROP }
    };
  }

  const [metaSegment, ...captionSegments] = title.split("|");
  const caption = captionSegments.join("|").trim();
  const metadata = Object.fromEntries(
    String(metaSegment || "")
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [key, ...rest] = entry.split(":");
        return [String(key || "").trim().toLowerCase(), rest.join(":").trim()];
      })
      .filter(([key]) => Boolean(key))
  );

  const placement = normalizeInvestigationImagePlacement(
    metadata.placement || metadata.align || metadata.mode || "",
    "full-width"
  );

  return {
    placement,
    caption,
    drag: parseImageVector(metadata.drag, DEFAULT_IMAGE_DRAG),
    crop: parseImageCrop(metadata.crop, DEFAULT_IMAGE_CROP)
  };
}

export function stringifyInvestigationImageTitleSpec({
  placement = "full-width",
  caption = "",
  drag = DEFAULT_IMAGE_DRAG,
  crop = DEFAULT_IMAGE_CROP
} = {}) {
  const normalizedPlacement = normalizeInvestigationImagePlacement(placement, "full-width");
  const parts = [`placement:${normalizedPlacement}`];
  if (dragDiffers(drag)) {
    parts.push(`drag:${formatFraction(drag?.x, DEFAULT_IMAGE_DRAG.x)},${formatFraction(drag?.y, DEFAULT_IMAGE_DRAG.y)}`);
  }
  if (cropDiffers(crop)) {
    parts.push(
      `crop:${formatFraction(crop?.x, DEFAULT_IMAGE_CROP.x)},${formatFraction(crop?.y, DEFAULT_IMAGE_CROP.y)},${formatFraction(crop?.width, DEFAULT_IMAGE_CROP.width)},${formatFraction(crop?.height, DEFAULT_IMAGE_CROP.height)}`
    );
  }
  return String(caption || "").trim()
    ? `${parts.join(";")}|${String(caption || "").trim()}`
    : parts.join(";");
}

export function buildStructuredInvestigationDocument({
  slug = "",
  title = "",
  summary = "",
  markdown = "",
  entityRefs = [],
  tags = [],
  relationshipCandidates = [],
  citations = []
} = {}) {
  const cleanId = cleanSlug(slug || title || "unsaved") || "unsaved";
  const blocks = markdownToStructuredBlocks(markdown);
  return normalizeStructuredDocument(
    createStructuredDocument({
      id: `investigation:${cleanId}`,
      kind: "investigation",
      title,
      summary,
      blocks,
      metadata: {
        slug: cleanId,
        tags,
        entityRefs,
        relationshipCandidates,
        citations
      }
    })
  );
}

export function deriveInvestigationStructuredArtifacts({
  slug = "",
  title = "",
  summary = "",
  markdown = "",
  entityRefs = [],
  tags = [],
  relationshipCandidates = [],
  citations = []
} = {}) {
  const structuredDocument = buildStructuredInvestigationDocument({
    slug,
    title,
    summary,
    markdown,
    entityRefs,
    tags,
    relationshipCandidates,
    citations
  });
  return {
    structuredDocument,
    searchText: extractStructuredDocumentSearchText(structuredDocument),
    entityRefs: extractStructuredDocumentEntityRefs(structuredDocument),
    relationshipCandidates: extractStructuredDocumentRelationshipCandidates(structuredDocument),
    citations: collectStructuredDocumentCitations(structuredDocument)
  };
}

export function editorDocumentFromInvestigationRecord(record = {}) {
  const entityRefs = Array.isArray(record?.entity_refs) ? record.entity_refs : [];
  const structuredDocument = record?.structured_document
    ? normalizeStructuredDocument(record.structured_document)
    : null;
  return {
    title: String(record?.title || structuredDocument?.title || "").trim(),
    date: String(record?.date || new Date().toISOString().slice(0, 10)).trim(),
    summary: String(record?.summary || structuredDocument?.summary || "").trim(),
    tags: Array.isArray(record?.tags)
      ? record.tags
      : Array.isArray(structuredDocument?.metadata?.tags)
        ? structuredDocument.metadata.tags
        : [],
    markdown: structuredDocument ? structuredDocumentToMarkdown(structuredDocument) : String(record?.markdown || "").trim(),
    primaryEntity: String(entityRefs[0] || record?.primaryEntity || "").trim(),
    entityRefs: entityRefs.slice(1),
    structuredDocument
  };
}

export function structuredDocumentToMarkdown(document = {}) {
  const normalized = normalizeStructuredDocument(document);
  return normalized.blocks
    .map((block) => blockToMarkdown(block))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function renderStructuredInvestigationHtml(document = {}, deps = {}) {
  const normalized = normalizeStructuredDocument(document);
  const renderMarkedHtml = deps.renderMarkedHtml || ((value) => escapeHtml(value));
  const sanitizeTrustedHtml = deps.sanitizeTrustedHtml || ((value) => String(value || ""));
  return normalized.blocks
    .map((block) => renderStructuredBlock(block, { renderMarkedHtml, sanitizeTrustedHtml }))
    .join("\n");
}

function markdownToStructuredBlocks(markdown = "") {
  const source = String(markdown || "").replace(/\r\n/g, "\n").trim();
  if (!source) return [];

  const blocks = [];
  const lines = source.split("\n");
  let currentMarkdown = [];
  let blockIndex = 0;

  function flushMarkdownBlock() {
    const text = currentMarkdown.join("\n").trim();
    if (!text) {
      currentMarkdown = [];
      return;
    }
    blocks.push({
      id: `md-${++blockIndex}`,
      type: "markdown",
      text
    });
    currentMarkdown = [];
  }

  for (const line of lines) {
    const imageMatch = String(line || "").trim().match(/^!\[([^\]]*)\]\((\S+?)(?:\s+"([^"]*)")?\)$/);
    if (!imageMatch) {
      currentMarkdown.push(line);
      continue;
    }
    flushMarkdownBlock();
    const [, alt = "", src = "", rawTitle = ""] = imageMatch;
    const spec = parseInvestigationImageTitleSpec(rawTitle);
    blocks.push(normalizeDocumentBlock({
      id: `img-${++blockIndex}`,
      type: "image",
      src,
      alt,
      caption: spec.caption,
      placement: spec.placement,
      drag: spec.drag,
      crop: spec.crop
    }));
  }

  flushMarkdownBlock();
  return blocks;
}

function blockToMarkdown(block = {}) {
  const normalized = normalizeDocumentBlock(block);
  if (normalized.type === "image") {
    const title = stringifyInvestigationImageTitleSpec({
      placement: normalized.placement,
      caption: normalized.caption,
      drag: normalized.drag,
      crop: normalized.crop
    });
    return `![${escapeMarkdownText(normalized.alt)}](${normalized.src} "${escapeMarkdownTitle(title)}")`;
  }
  if (normalized.type === "markdown") {
    return normalized.text;
  }
  if (normalized.type === "heading") {
    return `## ${normalized.text}`;
  }
  if (normalized.type === "quote") {
    return String(normalized.text || "")
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (normalized.type === "list") {
    return String(normalized.text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `- ${line}`)
      .join("\n");
  }
  if (normalized.type === "citation") {
    const label = normalized.title || normalized.href || "Citation";
    return normalized.href ? `[${label}](${normalized.href})` : label;
  }
  if (normalized.type === "entity-ref") {
    return normalized.label || normalized.entity;
  }
  if (normalized.type === "relationship-ref") {
    return normalized.label || `${normalized.source} ${normalized.relationshipType} ${normalized.target}`;
  }
  return normalized.text || "";
}

function renderStructuredBlock(block = {}, deps = {}) {
  const normalized = normalizeDocumentBlock(block);
  if (normalized.type === "image") {
    return renderInvestigationImageFigure(normalized);
  }
  if (normalized.type === "markdown") {
    return deps.renderMarkedHtml(
      normalized.text,
      {
        breaks: false,
        articleImages: true
      },
      deps.sanitizeTrustedHtml
    );
  }
  if (normalized.type === "entity-ref") {
    return `<p class="doc-entity-ref" data-entity-ref="${escapeAttribute(normalized.entity)}">${escapeHtml(normalized.label || normalized.entity)}</p>`;
  }
  if (normalized.type === "relationship-ref") {
    return `<p class="doc-relationship-ref" data-relationship-source="${escapeAttribute(normalized.source)}" data-relationship-target="${escapeAttribute(normalized.target)}" data-relationship-type="${escapeAttribute(normalized.relationshipType)}">${escapeHtml(normalized.label || `${normalized.source} ${normalized.relationshipType} ${normalized.target}`)}</p>`;
  }
  if (normalized.type === "citation") {
    const title = escapeHtml(normalized.title || normalized.href || "Citation");
    return `<p class="doc-citation"><a href="${escapeAttribute(normalized.href)}">${title}</a></p>`;
  }
  if (normalized.type === "heading") {
    return `<h2>${escapeHtml(normalized.text)}</h2>`;
  }
  if (normalized.type === "quote") {
    return `<blockquote>${escapeHtml(normalized.text)}</blockquote>`;
  }
  if (normalized.type === "list") {
    const items = String(normalized.text || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  }
  return `<p>${escapeHtml(normalized.text || "")}</p>`;
}

function renderInvestigationImageFigure(block = {}) {
  const normalized = normalizeDocumentBlock(block);
  const placement = normalizeInvestigationImagePlacement(normalized.placement, "full-width");
  const legacyPlacement = STRUCTURED_TO_LEGACY_PLACEMENT[placement] || "full";
  const focusX = formatFraction(normalized.drag?.x, DEFAULT_IMAGE_DRAG.x);
  const focusY = formatFraction(normalized.drag?.y, DEFAULT_IMAGE_DRAG.y);
  const crop = normalized.crop || DEFAULT_IMAGE_CROP;
  return `
    <figure
      class="article-image article-image--${escapeAttribute(legacyPlacement)} article-image--${escapeAttribute(placement)}"
      data-article-image-placement="${escapeAttribute(placement)}"
      style="--image-focus-x:${escapeAttribute(focusX)};--image-focus-y:${escapeAttribute(focusY)};--image-crop-x:${escapeAttribute(formatFraction(crop.x, DEFAULT_IMAGE_CROP.x))};--image-crop-y:${escapeAttribute(formatFraction(crop.y, DEFAULT_IMAGE_CROP.y))};--image-crop-width:${escapeAttribute(formatFraction(crop.width, DEFAULT_IMAGE_CROP.width))};--image-crop-height:${escapeAttribute(formatFraction(crop.height, DEFAULT_IMAGE_CROP.height))};"
    >
      <div class="article-image__frame">
        <img src="${escapeAttribute(normalized.src)}" alt="${escapeAttribute(normalized.alt)}" loading="lazy" decoding="async">
      </div>
      ${normalized.caption ? `<figcaption>${escapeHtml(normalized.caption)}</figcaption>` : ""}
    </figure>
  `.trim();
}

function parseImageVector(value, fallback) {
  const clean = String(value || "").trim();
  const [x, y] = clean.split(",").map((item) => Number(item));
  return {
    x: Number.isFinite(x) ? clampFraction(x) : fallback.x,
    y: Number.isFinite(y) ? clampFraction(y) : fallback.y
  };
}

function parseImageCrop(value, fallback) {
  const clean = String(value || "").trim();
  const [x, y, width, height] = clean.split(",").map((item) => Number(item));
  return {
    x: Number.isFinite(x) ? clampFraction(x) : fallback.x,
    y: Number.isFinite(y) ? clampFraction(y) : fallback.y,
    width: Number.isFinite(width) ? clampFraction(width) : fallback.width,
    height: Number.isFinite(height) ? clampFraction(height) : fallback.height
  };
}

function dragDiffers(value = {}) {
  const drag = parseImageVector(`${value?.x},${value?.y}`, DEFAULT_IMAGE_DRAG);
  return drag.x !== DEFAULT_IMAGE_DRAG.x || drag.y !== DEFAULT_IMAGE_DRAG.y;
}

function cropDiffers(value = {}) {
  const crop = parseImageCrop(`${value?.x},${value?.y},${value?.width},${value?.height}`, DEFAULT_IMAGE_CROP);
  return crop.x !== DEFAULT_IMAGE_CROP.x ||
    crop.y !== DEFAULT_IMAGE_CROP.y ||
    crop.width !== DEFAULT_IMAGE_CROP.width ||
    crop.height !== DEFAULT_IMAGE_CROP.height;
}

function clampFraction(value) {
  return Math.max(0, Math.min(1, Number(value)));
}

function formatFraction(value, fallback = 0) {
  const numeric = Number.isFinite(Number(value)) ? clampFraction(Number(value)) : fallback;
  return numeric.toFixed(3).replace(/0+$/g, "").replace(/\.$/, "") || "0";
}

function escapeMarkdownText(value) {
  return String(value || "").replace(/[[\]\\]/g, "\\$&");
}

function escapeMarkdownTitle(value) {
  return String(value || "").replace(/["\\]/g, "\\$&");
}

export default {
  INVESTIGATION_IMAGE_PLACEMENTS,
  buildStructuredInvestigationDocument,
  deriveInvestigationStructuredArtifacts,
  editorDocumentFromInvestigationRecord,
  normalizeInvestigationImagePlacement,
  parseInvestigationImageTitleSpec,
  renderStructuredInvestigationHtml,
  stringifyInvestigationImageTitleSpec,
  structuredDocumentToMarkdown
};
