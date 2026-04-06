import { marked } from "marked";

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
import {
  normalizeImageAsset,
  normalizeImageAssets,
  resolveImageAssetUrl,
  serializeImageAssetForDraft
} from "./editor-image-assets.js";
import {
  createEmptyInvestigationBody,
  editorNodeNames,
  normalizeCitationAttrs,
  normalizeEntityTileAttrs,
  normalizeEntityRefAttrs,
  normalizeMultimediaAttrs,
  normalizeRelationshipRefAttrs
} from "./investigation-editor-schema.js";

const {
  multimedia: MULTIMEDIA_NODE_NAME,
  citation: CITATION_NODE_NAME,
  entityTile: ENTITY_TILE_NODE_NAME,
  entityRef: ENTITY_REF_NODE_NAME,
  relationshipRef: RELATIONSHIP_REF_NODE_NAME
} = editorNodeNames();

const CITATION_TOKEN_PATTERN = /\[\[CITE:([^[\]]+)\]\]/g;

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

export function emptyInvestigationBodyJson() {
  return createEmptyInvestigationBody();
}

export function normalizeInvestigationBodyJson(value) {
  const candidate = value && typeof value === "object" ? cloneValue(value) : createEmptyInvestigationBody();
  const type = String(candidate.type || "").trim().toLowerCase();
  if (type !== "doc") {
    return createEmptyInvestigationBody();
  }
  const content = Array.isArray(candidate.content) ? candidate.content : [];
  return {
    type: "doc",
    content: (content.length ? content : createEmptyInvestigationBody().content).map((entry) => normalizeInvestigationBodyContentNode(entry))
  };
}

export function markdownToInvestigationBodyJson(markdown = "") {
  return {
    type: "doc",
    content: markdownTokensToBodyNodes(marked.lexer(String(markdown || "").replace(/\r\n/g, "\n")))
  };
}

function normalizeInvestigationBodyContentNode(node = {}) {
  const type = String(node?.type || "").trim();
  if (type === "investigationImage") {
    return {
      type: MULTIMEDIA_NODE_NAME,
      attrs: normalizeMultimediaAttrs({
        ...(node?.attrs || {}),
        variant: "image",
        description: node?.attrs?.caption || ""
      })
    };
  }
  if (type === "investigationBanner") {
    return {
      type: MULTIMEDIA_NODE_NAME,
      attrs: normalizeMultimediaAttrs({
        ...(node?.attrs || {}),
        variant: "banner",
        text: node?.attrs?.body || node?.attrs?.text || "",
        assetId: node?.attrs?.imageAssetId || "",
        src: node?.attrs?.imageSrc || ""
      })
    };
  }
  if (type === "investigationCitation") {
    return {
      type: CITATION_NODE_NAME,
      attrs: normalizeCitationAttrs(node?.attrs || {})
    };
  }
  if (type === MULTIMEDIA_NODE_NAME) {
    return {
      ...node,
      attrs: normalizeMultimediaAttrs(node?.attrs || {})
    };
  }
  if (type === CITATION_NODE_NAME) {
    return {
      ...node,
      attrs: normalizeCitationAttrs(node?.attrs || {})
    };
  }
  if (type === ENTITY_TILE_NODE_NAME) {
    return {
      ...node,
      attrs: normalizeEntityTileAttrs(node?.attrs || {})
    };
  }
  if (type === ENTITY_REF_NODE_NAME) {
    return {
      ...node,
      attrs: normalizeEntityRefAttrs(node?.attrs || {})
    };
  }
  if (type === RELATIONSHIP_REF_NODE_NAME) {
    return {
      ...node,
      attrs: normalizeRelationshipRefAttrs(node?.attrs || {})
    };
  }
  if (Array.isArray(node?.content)) {
    return {
      ...node,
      content: node.content.map((entry) => normalizeInvestigationBodyContentNode(entry))
    };
  }
  return node;
}

export function structuredDocumentToBodyJson(document = {}) {
  const normalized = normalizeInvestigationStructuredDocument(document);
  const content = [];
  for (const block of normalized.blocks || []) {
    const nextBlock = normalizeInvestigationBlock(block);
    if (nextBlock.type === "multimedia") {
      content.push(multimediaBlockToEditorNode(nextBlock));
      continue;
    }
    if (nextBlock.type === "citation") {
      content.push({
        type: "paragraph",
        content: [citationBlockToEditorNode(nextBlock)]
      });
      continue;
    }
    if (nextBlock.type === "entity-tile") {
      content.push(entityTileBlockToEditorNode(nextBlock));
      continue;
    }
    if (nextBlock.type === "entity-ref") {
      content.push(entityRefBlockToEditorNode(nextBlock));
      continue;
    }
    if (nextBlock.type === "relationship-ref") {
      content.push(relationshipRefBlockToEditorNode(nextBlock));
      continue;
    }
    content.push(...markdownTokensToBodyNodes(marked.lexer(blockToMarkdown(nextBlock))));
  }
  return restoreCitationPlaceholdersInBodyJson(
    normalizeInvestigationBodyJson({
      type: "doc",
      content
    }),
    normalized.metadata?.citations
  );
}

export function editorDocumentFromInvestigationRecord(record = {}) {
  const structuredDocument = record?.structured_document
    ? normalizeInvestigationStructuredDocument(record.structured_document)
    : null;
  const title = String(record?.title || structuredDocument?.title || "").trim();
  const summary = String(record?.summary || structuredDocument?.summary || "").trim();
  const tags = normalizeStringArray(
    Array.isArray(record?.tags)
      ? record.tags
      : structuredDocument?.metadata?.tags
  );
  const relatedEntityRefs = normalizeStringArray(
    Array.isArray(record?.entity_refs)
      ? record.entity_refs
      : structuredDocument?.metadata?.entityRefs
  );
  const mediaAssets = normalizeImageAssets(
    Array.isArray(record?.media_assets)
      ? record.media_assets
      : structuredDocument?.metadata?.mediaAssets
  );
  const bodyJson = normalizeInvestigationBodyJson(
    record?.body_json ||
      record?.bodyJson ||
      (structuredDocument ? structuredDocumentToBodyJson(structuredDocument) : markdownToInvestigationBodyJson(record?.markdown || ""))
  );
  return {
    slug: cleanSlug(record?.slug || structuredDocument?.metadata?.slug || ""),
    title,
    date: String(record?.date || new Date().toISOString().slice(0, 10)).trim(),
    summary,
    tags,
    featured: Boolean(record?.featured),
    status: String(record?.status || "draft").trim().toLowerCase() || "draft",
    primaryEntity: String(relatedEntityRefs[0] || record?.primaryEntity || "").trim(),
    entityRefs: relatedEntityRefs.slice(1),
    relationshipCandidates: normalizeRelationshipCandidates(
      Array.isArray(record?.relationship_candidates)
        ? record.relationship_candidates
        : structuredDocument?.metadata?.relationshipCandidates
    ),
    citations: normalizeCitations(
      Array.isArray(record?.citations)
        ? record.citations
        : structuredDocument?.metadata?.citations
    ),
    mediaAssets,
    bodyJson,
    body_json: bodyJson,
    markdown: bodyJsonToMarkdown(bodyJson),
    structuredDocument: structuredDocument || buildStructuredInvestigationDocument({
      slug: record?.slug,
      title,
      summary,
      bodyJson,
      entityRefs: relatedEntityRefs,
      tags,
      mediaAssets
    })
  };
}

export function buildStructuredInvestigationDocument({
  slug = "",
  title = "",
  summary = "",
  markdown = "",
  bodyJson = null,
  entityRefs = [],
  tags = [],
  relationshipCandidates = [],
  citations = [],
  mediaAssets = []
} = {}) {
  const cleanId = cleanSlug(slug || title || "unsaved") || "unsaved";
  const normalizedBodyJson = bodyJson
    ? normalizeInvestigationBodyJson(bodyJson)
    : markdownToInvestigationBodyJson(markdown);
  const blocks = bodyJsonToStructuredBlocks(normalizedBodyJson);
  const baseDocument = normalizeStructuredDocument(
    createStructuredDocument({
      id: `investigation:${cleanId}`,
      kind: "investigation",
      title,
      summary,
      blocks,
      metadata: {
        slug: cleanId,
        tags: normalizeStringArray(tags),
        entityRefs: normalizeStringArray(entityRefs),
        relationshipCandidates: normalizeRelationshipCandidates(relationshipCandidates),
        citations: normalizeCitations(citations),
        mediaAssets: normalizeImageAssets(mediaAssets).map((asset) => serializeImageAssetForDraft(asset, { slug: cleanId }))
      }
    })
  );
  const document = normalizeInvestigationStructuredDocument({
    ...baseDocument,
    blocks
  });
  document.metadata = document.metadata || {};
  document.metadata.tags = normalizeStringArray(document.metadata.tags);
  document.metadata.entityRefs = dedupeStrings([
    ...normalizeStringArray(document.metadata.entityRefs),
    ...extractStructuredDocumentEntityRefs(document)
  ]);
  document.metadata.relationshipCandidates = normalizeRelationshipCandidates(
    document.metadata.relationshipCandidates.length
      ? document.metadata.relationshipCandidates
      : extractStructuredDocumentRelationshipCandidates(document)
  );
  document.metadata.citations = normalizeCitations(
    document.metadata.citations.length
      ? document.metadata.citations
      : collectStructuredDocumentCitations(document)
  );
  document.metadata.mediaAssets = normalizeImageAssets(document.metadata.mediaAssets).map((asset) =>
    serializeImageAssetForDraft(asset, { slug: cleanId })
  );
  return normalizeInvestigationStructuredDocument(document);
}

export function deriveInvestigationStructuredArtifacts({
  slug = "",
  title = "",
  summary = "",
  markdown = "",
  bodyJson = null,
  entityRefs = [],
  tags = [],
  relationshipCandidates = [],
  citations = [],
  mediaAssets = []
} = {}) {
  const structuredDocument = buildStructuredInvestigationDocument({
    slug,
    title,
    summary,
    markdown,
    bodyJson,
    entityRefs,
    tags,
    relationshipCandidates,
    citations,
    mediaAssets
  });
  return {
    structuredDocument,
    markdown: bodyJsonToMarkdown(bodyJson || structuredDocumentToBodyJson(structuredDocument)),
    bodyJson: normalizeInvestigationBodyJson(bodyJson || structuredDocumentToBodyJson(structuredDocument)),
    searchText: extractStructuredDocumentSearchText(structuredDocument),
    entityRefs: extractStructuredDocumentEntityRefs(structuredDocument),
    relationshipCandidates: extractStructuredDocumentRelationshipCandidates(structuredDocument),
    citations: collectStructuredDocumentCitations(structuredDocument)
  };
}

export function bodyJsonToMarkdown(bodyJson = {}) {
  const normalized = normalizeInvestigationBodyJson(bodyJson);
  return (normalized.content || [])
    .map((node, index) => nodeToMarkdown(node, { index }))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function structuredDocumentToMarkdown(document = {}) {
  const normalized = normalizeInvestigationStructuredDocument(document);
  return normalized.blocks
    .map((block) => blockToMarkdown(block))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function renderStructuredInvestigationHtml(document = {}, deps = {}) {
  const normalized = normalizeInvestigationStructuredDocument(document);
  const renderMarkedHtml = deps.renderMarkedHtml || ((value) => escapeHtml(value));
  const sanitizeTrustedHtml = deps.sanitizeTrustedHtml || ((value) => String(value || ""));
  const assetMap = buildMediaAssetMap(normalized.metadata?.mediaAssets || []);
  const citations = normalizeCitations(
    normalized.metadata?.citations?.length
      ? normalized.metadata.citations
      : collectStructuredDocumentCitations(normalized)
  );
  const citationContext = createCitationContext(citations);
  const hasLegacyCitationBlocks = normalized.blocks.some((block) => normalizeInvestigationBlock(block).type === "citation");
  const bodyHtml = normalized.blocks
    .map((block) => renderStructuredBlock(block, { renderMarkedHtml, sanitizeTrustedHtml, assetMap, citationContext }))
    .join("\n");
  return citations.length && !hasLegacyCitationBlocks
    ? `${bodyHtml}\n${renderCitationTile(citations)}`
    : bodyHtml;
}

export function bodyJsonToStructuredBlocks(bodyJson = {}) {
  const normalized = normalizeInvestigationBodyJson(bodyJson);
  const blocks = [];
  let markdownSegments = [];
  let blockIndex = 0;

  const flushMarkdown = () => {
    const text = markdownSegments
      .filter(Boolean)
      .join("\n\n")
      .trim();
    markdownSegments = [];
    if (!text) return;
    blocks.push(normalizeDocumentBlock({
      id: `md-${++blockIndex}`,
      type: "markdown",
      text
    }));
  };

  for (const node of normalized.content || []) {
    const type = String(node?.type || "").trim();
    if (type === MULTIMEDIA_NODE_NAME) {
      flushMarkdown();
      const attrs = normalizeMultimediaAttrs(node?.attrs || {});
      blocks.push(normalizeInvestigationBlock({
        id: `media-${++blockIndex}`,
        type: "multimedia",
        variant: attrs.variant,
        assetId: attrs.assetId,
        src: attrs.src,
        alt: attrs.alt,
        description: attrs.description,
        placement: attrs.placement,
        width: attrs.widthRatio,
        drag: { x: attrs.focusX, y: attrs.focusY },
        crop: {
          x: attrs.cropX,
          y: attrs.cropY,
          width: attrs.cropWidth,
          height: attrs.cropHeight
        },
        rotationQuarterTurns: attrs.rotationQuarterTurns,
        flipX: attrs.flipX,
        flipY: attrs.flipY,
        title: attrs.title,
        text: attrs.text,
        backgroundColor: attrs.backgroundColor,
        textColor: attrs.textColor,
        overlayColor: attrs.overlayColor,
        titleScale: attrs.titleScale,
        textScale: attrs.textScale,
        titleBox: attrs.titleBox,
        textBox: attrs.textBox
      }));
      continue;
    }
    if (type === CITATION_NODE_NAME) {
      const markdown = nodeToMarkdown(node, { index: blockIndex });
      if (markdown) markdownSegments.push(markdown);
      continue;
    }
    if (type === ENTITY_TILE_NODE_NAME) {
      flushMarkdown();
      const attrs = normalizeEntityTileAttrs(node?.attrs || {});
      blocks.push(normalizeInvestigationBlock({
        id: `entity-tile-${++blockIndex}`,
        type: "entity-tile",
        text: attrs.summary,
        entity: attrs.entity,
        label: attrs.label,
        summary: attrs.summary,
        meta: attrs.meta,
        href: attrs.href,
        displayStyle: attrs.displayStyle
      }));
      continue;
    }
    if (type === ENTITY_REF_NODE_NAME) {
      flushMarkdown();
      const attrs = normalizeEntityRefAttrs(node?.attrs || {});
      blocks.push(normalizeInvestigationBlock({
        id: `entity-${++blockIndex}`,
        type: "entity-ref",
        entity: attrs.entity,
        label: attrs.label
      }));
      continue;
    }
    if (type === RELATIONSHIP_REF_NODE_NAME) {
      flushMarkdown();
      const attrs = normalizeRelationshipRefAttrs(node?.attrs || {});
      blocks.push(normalizeInvestigationBlock({
        id: `rel-${++blockIndex}`,
        type: "relationship-ref",
        source: attrs.source,
        target: attrs.target,
        relationshipType: attrs.relationshipType,
        label: attrs.label
      }));
      continue;
    }
    const markdown = nodeToMarkdown(node, { index: blockIndex });
    if (markdown) markdownSegments.push(markdown);
  }

  flushMarkdown();
  return blocks;
}

function markdownTokensToBodyNodes(tokens = [], options = {}) {
  const nodes = [];
  for (const token of Array.isArray(tokens) ? tokens : []) {
    const type = String(token?.type || "").trim().toLowerCase();
    if (!type || type === "space") continue;
    if (type === "heading") {
      nodes.push({
        type: "heading",
        attrs: { level: clampHeadingLevel(token.depth) },
        content: inlineTokensToContent(token.tokens || [{ type: "text", text: token.text || "" }])
      });
      continue;
    }
    if (type === "paragraph") {
      const paragraphNode = paragraphTokenToNode(token);
      if (paragraphNode) nodes.push(paragraphNode);
      continue;
    }
    if (type === "text") {
      nodes.push({
        type: "paragraph",
        content: inlineTokensToContent(token.tokens || [{ type: "text", text: token.text || token.raw || "" }])
      });
      continue;
    }
    if (type === "blockquote") {
      nodes.push({
        type: "blockquote",
        content: ensureBlockNodes(markdownTokensToBodyNodes(token.tokens || [], { ...options, inBlockquote: true }))
      });
      continue;
    }
    if (type === "list") {
      nodes.push({
        type: token.ordered ? "orderedList" : "bulletList",
        attrs: token.ordered && Number.isFinite(Number(token.start)) ? { start: Number(token.start) } : null,
        content: (Array.isArray(token.items) ? token.items : []).map((item) => ({
          type: "listItem",
          content: ensureBlockNodes(markdownTokensToBodyNodes(item.tokens || [{ type: "text", text: item.text || "" }], { ...options, inListItem: true }))
        }))
      });
      continue;
    }
    if (type === "hr") {
      nodes.push({ type: "horizontalRule" });
      continue;
    }
    if (type === "code") {
      nodes.push({
        type: "codeBlock",
        attrs: token.lang ? { language: token.lang } : null,
        content: token.text ? [{ type: "text", text: String(token.text) }] : []
      });
      continue;
    }
    if (type === "image") {
      nodes.push(imageTokenToNode(token));
      continue;
    }
    if (token?.raw || token?.text) {
      nodes.push({
        type: "paragraph",
        content: inlineTokensToContent([{ type: "text", text: token.text || token.raw || "" }])
      });
    }
  }
  return nodes.length ? nodes : createEmptyInvestigationBody().content;
}

function paragraphTokenToNode(token = {}) {
  const meaningfulTokens = (Array.isArray(token.tokens) ? token.tokens : [])
    .filter((entry) => entry && String(entry.type || "").trim().toLowerCase() !== "space");
  if (meaningfulTokens.length === 1 && String(meaningfulTokens[0]?.type || "").trim().toLowerCase() === "image") {
    return imageTokenToNode(meaningfulTokens[0]);
  }
  return {
    type: "paragraph",
    content: inlineTokensToContent(meaningfulTokens.length ? meaningfulTokens : [{ type: "text", text: token.text || "" }])
  };
}

function imageTokenToNode(token = {}) {
  const spec = parseInvestigationImageTitleSpec(token.title || "");
  const attrs = normalizeMultimediaAttrs({
    variant: "image",
    src: token.href || token.src || "",
    alt: token.text || token.alt || "",
    description: spec.caption,
    placement: spec.placement,
    focusX: spec.drag.x,
    focusY: spec.drag.y,
    cropX: spec.crop.x,
    cropY: spec.crop.y,
    cropWidth: spec.crop.width,
    cropHeight: spec.crop.height
  });
  return {
    type: MULTIMEDIA_NODE_NAME,
    attrs
  };
}

function multimediaBlockToEditorNode(block = {}) {
  return {
    type: MULTIMEDIA_NODE_NAME,
    attrs: normalizeMultimediaAttrs({
      variant: block.variant,
      assetId: block.assetId,
      src: block.src,
      alt: block.alt,
      description: block.description,
      placement: block.placement,
      widthRatio: block.width,
      focusX: block.drag?.x,
      focusY: block.drag?.y,
      cropX: block.crop?.x,
      cropY: block.crop?.y,
      cropWidth: block.crop?.width,
      cropHeight: block.crop?.height,
      rotationQuarterTurns: block.rotationQuarterTurns,
      flipX: block.flipX,
      flipY: block.flipY,
      title: block.title,
      text: block.text,
      backgroundColor: block.backgroundColor,
      textColor: block.textColor,
      overlayColor: block.overlayColor,
      titleScale: block.titleScale,
      textScale: block.textScale,
      titleBox: block.titleBox,
      textBox: block.textBox
    })
  };
}

function citationBlockToEditorNode(block = {}) {
  return {
    type: CITATION_NODE_NAME,
    attrs: normalizeCitationAttrs({
      id: block.id,
      number: block.number,
      href: block.href,
      title: block.title,
      note: block.note,
      author: block.author,
      source: block.source,
      publisher: block.publisher,
      publishedAt: block.publishedAt,
      page: block.page,
      archiveHref: block.archiveHref,
      accessedAt: block.accessedAt
    })
  };
}

function entityTileBlockToEditorNode(block = {}) {
  return {
    type: ENTITY_TILE_NODE_NAME,
    attrs: normalizeEntityTileAttrs({
      entity: block.entity,
      label: block.label,
      summary: block.summary || block.text,
      meta: block.meta,
      href: block.href,
      displayStyle: block.displayStyle,
      placement: block.placement,
      widthRatio: block.width
    })
  };
}

function entityRefBlockToEditorNode(block = {}) {
  return {
    type: ENTITY_REF_NODE_NAME,
    attrs: normalizeEntityRefAttrs({
      entity: block.entity,
      label: block.label
    })
  };
}

function relationshipRefBlockToEditorNode(block = {}) {
  return {
    type: RELATIONSHIP_REF_NODE_NAME,
    attrs: normalizeRelationshipRefAttrs({
      source: block.source,
      target: block.target,
      relationshipType: block.relationshipType || block.type,
      label: block.label
    })
  };
}

function inlineTokensToContent(tokens = [], activeMarks = []) {
  const content = [];
  for (const token of Array.isArray(tokens) ? tokens : []) {
    const type = String(token?.type || "").trim().toLowerCase();
    if (!type) continue;
    if (type === "text" || type === "escape") {
      pushTextNode(content, String(token.text || token.raw || ""), activeMarks);
      continue;
    }
    if (type === "br") {
      content.push({ type: "hardBreak" });
      continue;
    }
    if (type === "codespan") {
      pushTextNode(content, String(token.text || ""), [...activeMarks, { type: "code" }]);
      continue;
    }
    if (type === "strong") {
      content.push(...inlineTokensToContent(token.tokens || [{ type: "text", text: token.text || "" }], [...activeMarks, { type: "bold" }]));
      continue;
    }
    if (type === "em") {
      content.push(...inlineTokensToContent(token.tokens || [{ type: "text", text: token.text || "" }], [...activeMarks, { type: "italic" }]));
      continue;
    }
    if (type === "del") {
      content.push(...inlineTokensToContent(token.tokens || [{ type: "text", text: token.text || "" }], [...activeMarks, { type: "strike" }]));
      continue;
    }
    if (type === "link") {
      content.push(...inlineTokensToContent(
        token.tokens || [{ type: "text", text: token.text || token.href || "" }],
        [...activeMarks, { type: "link", attrs: { href: String(token.href || "").trim() } }]
      ));
      continue;
    }
    if (type === "image") {
      pushTextNode(content, String(token.text || token.alt || token.href || "Image"), activeMarks);
      continue;
    }
    if (token?.text || token?.raw) {
      pushTextNode(content, String(token.text || token.raw || ""), activeMarks);
    }
  }
  return mergeAdjacentTextNodes(content);
}

function pushTextNode(content, text, marks = []) {
  const cleanText = String(text || "");
  if (!cleanText) return;
  content.push({
    type: "text",
    text: cleanText,
    ...(marks.length ? { marks: dedupeMarks(marks) } : {})
  });
}

function mergeAdjacentTextNodes(content = []) {
  const merged = [];
  for (const node of content) {
    const previous = merged[merged.length - 1];
    if (node?.type === "text" && previous?.type === "text" && sameMarks(previous.marks, node.marks)) {
      previous.text = `${previous.text || ""}${node.text || ""}`;
      continue;
    }
    merged.push(node);
  }
  return merged;
}

function dedupeMarks(marks = []) {
  const seen = new Set();
  return marks.filter((mark) => {
    const signature = JSON.stringify(mark || {});
    if (!signature || seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function sameMarks(left = [], right = []) {
  return JSON.stringify(left || []) === JSON.stringify(right || []);
}

function ensureBlockNodes(nodes = []) {
  const filtered = (Array.isArray(nodes) ? nodes : []).filter(Boolean);
  return filtered.length ? filtered : [{ type: "paragraph" }];
}

function nodeToMarkdown(node = {}, context = {}) {
  const type = String(node?.type || "").trim();
  if (!type) return "";
  if (type === "paragraph") {
    return serializeInlineMarkdown(node.content || []);
  }
  if (type === "heading") {
    const level = clampHeadingLevel(node?.attrs?.level || 2);
    return `${"#".repeat(level)} ${serializeInlineMarkdown(node.content || [])}`.trim();
  }
  if (type === "bulletList") {
    return serializeListMarkdown(node, false);
  }
  if (type === "orderedList") {
    return serializeListMarkdown(node, true);
  }
  if (type === "blockquote") {
    const inner = (Array.isArray(node.content) ? node.content : [])
      .map((child) => nodeToMarkdown(child, context))
      .filter(Boolean)
      .join("\n\n");
    return inner
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }
  if (type === "horizontalRule") {
    return "---";
  }
  if (type === "codeBlock") {
    const language = String(node?.attrs?.language || "").trim();
    const text = serializeCodeBlock(node.content || []);
    return `\`\`\`${language}\n${text}\n\`\`\``.trim();
  }
  if (type === MULTIMEDIA_NODE_NAME) {
    const attrs = normalizeMultimediaAttrs(node?.attrs || {});
    const title = stringifyInvestigationImageTitleSpec({
      placement: attrs.placement,
      caption: attrs.description,
      drag: { x: attrs.focusX, y: attrs.focusY },
      crop: {
        x: attrs.cropX,
        y: attrs.cropY,
        width: attrs.cropWidth,
        height: attrs.cropHeight
      }
    });
    return attrs.src
      ? `![${escapeMarkdownText(attrs.alt)}](${attrs.src} "${escapeMarkdownTitle(title)}")`
      : [attrs.title, attrs.text, attrs.description, attrs.alt].filter(Boolean).join("\n\n") || "Image";
  }
  if (type === CITATION_NODE_NAME) {
    return serializeCitationToken(node?.attrs || {});
  }
  if (type === ENTITY_TILE_NODE_NAME) {
    const attrs = normalizeEntityTileAttrs(node?.attrs || {});
    return [attrs.label || attrs.entity, attrs.summary].filter(Boolean).join(" — ");
  }
  if (type === ENTITY_REF_NODE_NAME) {
    const attrs = normalizeEntityRefAttrs(node?.attrs || {});
    return attrs.label || attrs.entity;
  }
  if (type === RELATIONSHIP_REF_NODE_NAME) {
    const attrs = normalizeRelationshipRefAttrs(node?.attrs || {});
    return attrs.label || `${attrs.source} ${attrs.relationshipType} ${attrs.target}`.trim();
  }
  return "";
}

function serializeInlineMarkdown(content = []) {
  return (Array.isArray(content) ? content : [])
    .map((node) => inlineNodeToMarkdown(node))
    .join("")
    .trim();
}

function inlineNodeToMarkdown(node = {}) {
  const type = String(node?.type || "").trim();
  if (type === "hardBreak") return "  \n";
  if (type === CITATION_NODE_NAME) return serializeCitationToken(node?.attrs || {});
  if (type !== "text") return "";
  let text = String(node.text || "");
  for (const mark of Array.isArray(node.marks) ? node.marks : []) {
    const markType = String(mark?.type || "").trim();
    if (markType === "code") {
      text = `\`${text}\``;
      continue;
    }
    if (markType === "bold") {
      text = `**${text}**`;
      continue;
    }
    if (markType === "italic") {
      text = `*${text}*`;
      continue;
    }
    if (markType === "strike") {
      text = `~~${text}~~`;
      continue;
    }
    if (markType === "link") {
      const href = String(mark?.attrs?.href || "").trim();
      text = href ? `[${text}](${href})` : text;
    }
  }
  return text;
}

function serializeListMarkdown(node = {}, ordered = false) {
  const items = Array.isArray(node.content) ? node.content : [];
  return items
    .map((item, index) => {
      const marker = ordered ? `${index + Number(node?.attrs?.start || 1)}.` : "-";
      const body = (Array.isArray(item?.content) ? item.content : [])
        .map((child) => nodeToMarkdown(child))
        .filter(Boolean)
        .join("\n\n");
      return body
        .split("\n")
        .map((line, lineIndex) => (lineIndex === 0 ? `${marker} ${line}` : `  ${line}`))
        .join("\n");
    })
    .join("\n");
}

function serializeCodeBlock(content = []) {
  return (Array.isArray(content) ? content : [])
    .map((node) => {
      if (String(node?.type || "") === "text") return String(node.text || "");
      if (String(node?.type || "") === "hardBreak") return "\n";
      return "";
    })
    .join("");
}

function blockToMarkdown(block = {}) {
  const normalized = normalizeInvestigationBlock(block);
  if (normalized.type === "multimedia") {
    const title = stringifyInvestigationImageTitleSpec({
      placement: normalized.placement,
      caption: normalized.description,
      drag: normalized.drag,
      crop: normalized.crop
    });
    return normalized.src
      ? `![${escapeMarkdownText(normalized.alt)}](${normalized.src} "${escapeMarkdownTitle(title)}")`
      : [normalized.title, normalized.text, normalized.description, normalized.alt].filter(Boolean).join("\n\n") || "Image";
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
      .map((line, index) => normalized.ordered ? `${index + 1}. ${line}` : `- ${line}`)
      .join("\n");
  }
  if (normalized.type === "citation") {
    return serializeCitationToken(normalized);
  }
  if (normalized.type === "entity-tile") {
    return [normalized.label || normalized.entity, normalized.summary || normalized.text].filter(Boolean).join(" — ");
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
  const normalized = normalizeInvestigationBlock(block);
  if (normalized.type === "multimedia") {
    return renderMultimediaBlock(normalized, deps.assetMap);
  }
  if (normalized.type === "image") {
    return renderInvestigationImageFigure(normalized, deps.assetMap);
  }
  if (normalized.type === "markdown") {
    return replaceCitationTokensWithHtml(
      deps.renderMarkedHtml(
      normalized.text,
      {
        breaks: false,
        articleImages: true
      },
      deps.sanitizeTrustedHtml
      ),
      deps.citationContext
    );
  }
  if (normalized.type === "entity-tile") {
    return renderEntityTileBlock(normalized);
  }
  if (normalized.type === "entity-ref") {
    return `<p class="doc-entity-ref" data-entity-ref="${escapeAttribute(normalized.entity)}">${escapeHtml(normalized.label || normalized.entity)}</p>`;
  }
  if (normalized.type === "relationship-ref") {
    return `<p class="doc-relationship-ref" data-relationship-source="${escapeAttribute(normalized.source)}" data-relationship-target="${escapeAttribute(normalized.target)}" data-relationship-type="${escapeAttribute(normalized.relationshipType)}">${escapeHtml(normalized.label || `${normalized.source} ${normalized.relationshipType} ${normalized.target}`)}</p>`;
  }
  if (normalized.type === "citation") {
    const title = escapeHtml(normalized.title || normalized.href || "Citation");
    const page = normalized.page ? `<span class="doc-citation__page">${escapeHtml(normalized.page)}</span>` : "";
    const note = normalized.note ? `<span class="doc-citation__note">${escapeHtml(normalized.note)}</span>` : "";
    return `<p class="doc-citation"><a href="${escapeAttribute(normalized.href)}">${title}</a>${page}${note}</p>`;
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
    return normalized.ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
  }
  return `<p>${escapeHtml(normalized.text || "")}</p>`;
}

function renderMultimediaBlock(block = {}, assetMap = new Map()) {
  const normalized = normalizeInvestigationBlock(block);
  const asset = normalized.assetId ? assetMap.get(normalized.assetId) || null : null;
  const resolvedSrc = resolveImageAssetUrl({
    ...(asset || {}),
    publishUrl: normalized.src || asset?.publishUrl || "",
    bakedPath: asset?.bakedPath || ""
  }, { preferBaked: true }) || normalized.src;
  const placement = normalizeInvestigationImagePlacement(normalized.placement, normalized.variant === "banner" ? "full-width" : "center");
  const legacyPlacement = STRUCTURED_TO_LEGACY_PLACEMENT[placement] || "full";
  const focusX = formatFraction(normalized.drag?.x, DEFAULT_IMAGE_DRAG.x);
  const focusY = formatFraction(normalized.drag?.y, DEFAULT_IMAGE_DRAG.y);
  const crop = normalized.crop || DEFAULT_IMAGE_CROP;
  const mediaImage = resolvedSrc
    ? `<div class="article-multimedia__frame"><img src="${escapeAttribute(resolvedSrc)}" alt="${escapeAttribute(normalized.alt)}" loading="lazy" decoding="async"></div>`
    : "";
  const sharedStyle = `--image-focus-x:${escapeAttribute(focusX)};--image-focus-y:${escapeAttribute(focusY)};--image-crop-x:${escapeAttribute(formatFraction(crop.x, DEFAULT_IMAGE_CROP.x))};--image-crop-y:${escapeAttribute(formatFraction(crop.y, DEFAULT_IMAGE_CROP.y))};--image-crop-width:${escapeAttribute(formatFraction(crop.width, DEFAULT_IMAGE_CROP.width))};--image-crop-height:${escapeAttribute(formatFraction(crop.height, DEFAULT_IMAGE_CROP.height))};--article-multimedia-width:${escapeAttribute(formatFraction(normalized.width, 1))};--banner-background:${escapeAttribute(normalized.backgroundColor || "#8f2017")};--banner-foreground:${escapeAttribute(normalized.textColor || "#fff7ef")};--banner-overlay:${escapeAttribute(normalized.overlayColor || "rgba(0,0,0,0.38)")};`;
  if (normalized.variant === "banner") {
    return `
      <section class="article-banner article-banner--${escapeAttribute(placement)}" data-article-banner-variant="banner" style="${sharedStyle}">
        ${mediaImage}
        <div class="article-banner__overlay"></div>
        <div class="article-banner__content">
          ${normalized.title ? `<strong class="article-banner__title">${escapeHtml(normalized.title)}</strong>` : ""}
          ${normalized.text ? `<p class="article-banner__body">${escapeHtml(normalized.text)}</p>` : ""}
        </div>
      </section>
    `.trim();
  }
  if (normalized.variant === "captioned_image") {
    return `
      <figure class="article-image article-image--captioned article-image--${escapeAttribute(legacyPlacement)} article-image--${escapeAttribute(placement)}" data-article-image-placement="${escapeAttribute(placement)}" data-asset-id="${escapeAttribute(normalized.assetId || "")}" style="${sharedStyle}">
        ${mediaImage}
        <figcaption class="article-image__caption article-image__caption--rich">
          ${normalized.title ? `<strong>${escapeHtml(normalized.title)}</strong>` : ""}
          ${normalized.text ? `<p>${escapeHtml(normalized.text)}</p>` : ""}
        </figcaption>
      </figure>
    `.trim();
  }
  return `
    <figure class="article-image article-image--${escapeAttribute(legacyPlacement)} article-image--${escapeAttribute(placement)}" data-article-image-placement="${escapeAttribute(placement)}" data-asset-id="${escapeAttribute(normalized.assetId || "")}" style="${sharedStyle}">
      ${mediaImage}
    </figure>
  `.trim();
}

function renderInvestigationImageFigure(block = {}, assetMap = new Map()) {
  const normalized = normalizeInvestigationBlock(block);
  const asset = normalized.assetId ? assetMap.get(normalized.assetId) || null : null;
  const resolvedSrc = resolveImageAssetUrl({
    ...(asset || {}),
    publishUrl: normalized.src || asset?.publishUrl || "",
    bakedPath: asset?.bakedPath || ""
  }, { preferBaked: true }) || normalized.src;
  const placement = normalizeInvestigationImagePlacement(normalized.placement, "full-width");
  const legacyPlacement = STRUCTURED_TO_LEGACY_PLACEMENT[placement] || "full";
  const focusX = formatFraction(normalized.drag?.x, DEFAULT_IMAGE_DRAG.x);
  const focusY = formatFraction(normalized.drag?.y, DEFAULT_IMAGE_DRAG.y);
  const crop = normalized.crop || DEFAULT_IMAGE_CROP;
  return `
    <figure
      class="article-image article-image--${escapeAttribute(legacyPlacement)} article-image--${escapeAttribute(placement)}"
      data-article-image-placement="${escapeAttribute(placement)}"
      data-asset-id="${escapeAttribute(normalized.assetId || "")}"
      style="--image-focus-x:${escapeAttribute(focusX)};--image-focus-y:${escapeAttribute(focusY)};--image-crop-x:${escapeAttribute(formatFraction(crop.x, DEFAULT_IMAGE_CROP.x))};--image-crop-y:${escapeAttribute(formatFraction(crop.y, DEFAULT_IMAGE_CROP.y))};--image-crop-width:${escapeAttribute(formatFraction(crop.width, DEFAULT_IMAGE_CROP.width))};--image-crop-height:${escapeAttribute(formatFraction(crop.height, DEFAULT_IMAGE_CROP.height))};"
    >
      <div class="article-image__frame">
        <img src="${escapeAttribute(resolvedSrc)}" alt="${escapeAttribute(normalized.alt)}" loading="lazy" decoding="async">
      </div>
      ${normalized.caption ? `<figcaption>${escapeHtml(normalized.caption)}</figcaption>` : ""}
    </figure>
  `.trim();
}

function renderBannerBlock(block = {}, assetMap = new Map()) {
  const normalized = normalizeInvestigationBlock(block);
  const asset = normalized.imageAssetId ? assetMap.get(normalized.imageAssetId) || null : null;
  const imageSrc = normalized.imageSrc || resolveImageAssetUrl(asset, { preferBaked: true }) || "";
  return `
    <section
      class="article-banner article-banner--${escapeAttribute(normalized.theme || "ember")}"
      style="--banner-background:${escapeAttribute(normalized.backgroundColor)};--banner-foreground:${escapeAttribute(normalized.textColor)};"
    >
      ${imageSrc ? `<div class="article-banner__media"><img src="${escapeAttribute(imageSrc)}" alt="${escapeAttribute(normalized.title || "Banner image")}" loading="lazy" decoding="async"></div>` : ""}
      <div class="article-banner__content">
        ${normalized.title ? `<strong class="article-banner__title">${escapeHtml(normalized.title)}</strong>` : ""}
        ${normalized.text ? `<p class="article-banner__body">${escapeHtml(normalized.text)}</p>` : ""}
      </div>
    </section>
  `.trim();
}

function renderEntityTileBlock(block = {}) {
  const normalized = normalizeInvestigationBlock(block);
  return `
    <article class="doc-entity-tile doc-entity-tile--${escapeAttribute(normalized.placement || "center")}" data-entity-ref="${escapeAttribute(normalized.entity)}" style="--article-multimedia-width:${escapeAttribute(formatFraction(normalized.width, 0.46))};">
      <div class="doc-entity-tile__eyebrow">Entity</div>
      <strong>${escapeHtml(normalized.label || normalized.entity || "Entity")}</strong>
      ${normalized.meta ? `<span class="doc-entity-tile__meta">${escapeHtml(normalized.meta)}</span>` : ""}
      ${normalized.summary ? `<p>${escapeHtml(normalized.summary)}</p>` : ""}
      ${normalized.href ? `<a href="${escapeAttribute(normalized.href)}" target="_blank" rel="noreferrer noopener">Open wiki</a>` : ""}
    </article>
  `.trim();
}

function normalizeInvestigationStructuredDocument(document = {}) {
  const normalized = normalizeStructuredDocument(document);
  const sourceBlocks = Array.isArray(document?.blocks) ? document.blocks : [];
  const slug = cleanSlug(
    document?.metadata?.slug ||
    normalized.metadata?.slug ||
    String(normalized.id || "").split(":").slice(-1)[0] ||
    ""
  );
  return {
    ...normalized,
    metadata: {
      ...(normalized.metadata || {}),
      mediaAssets: normalizeImageAssets(document?.metadata?.mediaAssets || normalized.metadata?.mediaAssets).map((asset) =>
        serializeImageAssetForDraft(asset, { slug })
      )
    },
    blocks: (Array.isArray(normalized.blocks) ? normalized.blocks : []).map((block, index) =>
      normalizeInvestigationBlock({
        ...(sourceBlocks[index] && typeof sourceBlocks[index] === "object" ? sourceBlocks[index] : {}),
        ...(block && typeof block === "object" ? block : {})
      })
    )
  };
}

function normalizeInvestigationBlock(block = {}) {
  const normalized = normalizeDocumentBlock(block);
  const merged = {
    ...(block && typeof block === "object" ? cloneValue(block) : {}),
    ...(normalized && typeof normalized === "object" ? normalized : {})
  };
  const type = String(merged.type || "").trim().toLowerCase();
  if (type === "image" || type === "banner" || type === "multimedia") {
    const attrs = normalizeMultimediaAttrs({
      variant: type === "banner" ? "banner" : (type === "image" ? "image" : merged.variant),
      assetId: merged.assetId ?? merged.imageAssetId,
      src: merged.src ?? merged.imageSrc,
      alt: merged.alt,
      description: merged.description ?? merged.caption,
      placement: merged.placement,
      widthRatio: merged.width,
      focusX: merged.drag?.x ?? merged.focusX,
      focusY: merged.drag?.y ?? merged.focusY,
      cropX: merged.crop?.x ?? merged.cropX,
      cropY: merged.crop?.y ?? merged.cropY,
      cropWidth: merged.crop?.width ?? merged.cropWidth,
      cropHeight: merged.crop?.height ?? merged.cropHeight,
      rotationQuarterTurns: merged.rotationQuarterTurns,
      flipX: merged.flipX,
      flipY: merged.flipY,
      title: merged.title,
      text: merged.text ?? merged.body,
      backgroundColor: merged.backgroundColor,
      textColor: merged.textColor,
      overlayColor: merged.overlayColor,
      titleScale: merged.titleScale,
      textScale: merged.textScale,
      titleBox: merged.titleBox,
      textBox: merged.textBox
    });
    return {
      id: String(merged.id || "").trim() || normalized.id,
      type: "multimedia",
      variant: attrs.variant,
      assetId: attrs.assetId,
      src: attrs.src,
      alt: attrs.alt,
      description: attrs.description,
      placement: attrs.placement,
      width: attrs.widthRatio,
      drag: { x: attrs.focusX, y: attrs.focusY },
      crop: {
        x: attrs.cropX,
        y: attrs.cropY,
        width: attrs.cropWidth,
        height: attrs.cropHeight
      },
      rotationQuarterTurns: attrs.rotationQuarterTurns,
      flipX: attrs.flipX,
      flipY: attrs.flipY,
      title: attrs.title,
      text: attrs.text,
      backgroundColor: attrs.backgroundColor,
      textColor: attrs.textColor,
      overlayColor: attrs.overlayColor,
      titleScale: attrs.titleScale,
      textScale: attrs.textScale,
      titleBox: attrs.titleBox,
      textBox: attrs.textBox
    };
  }
  if (type === "entity-tile") {
    const attrs = normalizeEntityTileAttrs(merged);
    return {
      id: String(merged.id || "").trim() || normalized.id,
      type: "entity-tile",
      text: attrs.summary,
      entity: attrs.entity,
      label: attrs.label,
      summary: attrs.summary,
      meta: attrs.meta,
      href: attrs.href,
      displayStyle: attrs.displayStyle,
      placement: attrs.placement,
      width: attrs.widthRatio
    };
  }
  if (type === "entity-ref") {
    const attrs = normalizeEntityRefAttrs(merged);
    return {
      id: String(merged.id || "").trim() || normalized.id,
      type: "entity-ref",
      text: attrs.label || attrs.entity,
      entity: attrs.entity,
      label: attrs.label
    };
  }
  if (type === "citation") {
    const attrs = normalizeCitationAttrs(merged);
    return {
      id: String(merged.id || "").trim() || normalized.id,
      type: "citation",
      text: attrs.note || attrs.title || attrs.href,
      number: attrs.number,
      href: attrs.href,
      title: attrs.title,
      note: attrs.note,
      author: attrs.author,
      source: attrs.source,
      publisher: attrs.publisher,
      publishedAt: attrs.publishedAt,
      page: attrs.page,
      archiveHref: attrs.archiveHref,
      accessedAt: attrs.accessedAt
    };
  }
  if (type === "relationship-ref") {
    const attrs = normalizeRelationshipRefAttrs(merged);
    return {
      id: String(merged.id || "").trim() || normalized.id,
      type: "relationship-ref",
      text: attrs.label || `${attrs.source} ${attrs.relationshipType} ${attrs.target}`.trim(),
      source: attrs.source,
      target: attrs.target,
      relationshipType: attrs.relationshipType,
      label: attrs.label
    };
  }
  return normalized;
}

function buildMediaAssetMap(values = []) {
  return new Map(normalizeImageAssets(values).map((asset) => [asset.id, normalizeImageAsset(asset)]));
}

function normalizeStringArray(values = []) {
  return dedupeStrings(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
}

function normalizeRelationshipCandidates(values = []) {
  return dedupeRelationshipCandidates(
    (Array.isArray(values) ? values : [])
      .map((value) => value && typeof value === "object" ? {
        source: String(value.source || "").trim().toLowerCase(),
        target: String(value.target || "").trim().toLowerCase(),
        type: String(value.type || value.relationshipType || "").trim().toLowerCase(),
        label: String(value.label || "").trim()
      } : null)
      .filter((value) => value?.source && value?.target && value?.type)
  );
}

function normalizeCitations(values = []) {
  return dedupeCitations(
    (Array.isArray(values) ? values : [])
      .map((value) => {
        if (!value) return null;
        if (typeof value === "string") {
          const href = String(value || "").trim();
          return href ? normalizeCitationAttrs({ href }) : null;
        }
        return normalizeCitationAttrs(value);
      })
      .filter((value) =>
        value?.id ||
        value?.href ||
        value?.title ||
        value?.note ||
        value?.author ||
        value?.source ||
        value?.publisher ||
        value?.publishedAt ||
        value?.page ||
        value?.archiveHref ||
        value?.accessedAt
      )
  );
}

function dedupeStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function dedupeRelationshipCandidates(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const key = `${value.source}:${value.type}:${value.target}:${value.label || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dedupeCitations(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const key = value.id || `${value.href}:${value.title || ""}:${value.note || ""}:${value.page || ""}:${value.author || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function serializeCitationToken(attrs = {}) {
  const citation = normalizeCitationAttrs(attrs);
  const tokenId = String(citation.id || "").trim();
  if (!tokenId) {
    return citation.title || citation.href || "Citation";
  }
  return `[[CITE:${tokenId}]]`;
}

function restoreCitationPlaceholdersInBodyJson(bodyJson = {}, citations = []) {
  const normalizedBody = normalizeInvestigationBodyJson(bodyJson);
  const citationMap = createCitationMap(citations);
  if (!citationMap.size) return normalizedBody;
  return {
    ...normalizedBody,
    content: normalizedBody.content.map((node) => restoreCitationPlaceholdersInNode(node, citationMap))
  };
}

function restoreCitationPlaceholdersInNode(node = {}, citationMap = new Map()) {
  if (!node || typeof node !== "object") return node;
  const type = String(node.type || "").trim();
  if (type === "paragraph" || type === "heading") {
    return {
      ...node,
      content: inflateCitationTokensInContent(node.content || [], citationMap)
    };
  }
  if (Array.isArray(node.content)) {
    return {
      ...node,
      content: node.content.map((child) => restoreCitationPlaceholdersInNode(child, citationMap))
    };
  }
  return node;
}

function inflateCitationTokensInContent(content = [], citationMap = new Map()) {
  const nextContent = [];
  for (const node of Array.isArray(content) ? content : []) {
    if (String(node?.type || "").trim() !== "text") {
      nextContent.push(node);
      continue;
    }
    const text = String(node.text || "");
    let lastIndex = 0;
    let matched = false;
    CITATION_TOKEN_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(CITATION_TOKEN_PATTERN)) {
      matched = true;
      const [token, tokenId] = match;
      const startIndex = match.index ?? 0;
      if (startIndex > lastIndex) {
        nextContent.push({
          ...node,
          text: text.slice(lastIndex, startIndex)
        });
      }
      const citation = citationMap.get(String(tokenId || "").trim()) || normalizeCitationAttrs({ id: tokenId });
      nextContent.push({
        type: CITATION_NODE_NAME,
        attrs: citation
      });
      lastIndex = startIndex + token.length;
    }
    if (!matched) {
      nextContent.push(node);
      continue;
    }
    if (lastIndex < text.length) {
      nextContent.push({
        ...node,
        text: text.slice(lastIndex)
      });
    }
  }
  return mergeAdjacentTextNodes(nextContent.filter((entry) => {
    if (String(entry?.type || "").trim() !== "text") return true;
    return Boolean(String(entry.text || ""));
  }));
}

function createCitationMap(citations = []) {
  const map = new Map();
  normalizeCitations(citations).forEach((citation, index) => {
    if (!citation.id) return;
    map.set(citation.id, {
      ...citation,
      number: citation.number || index + 1
    });
  });
  return map;
}

function createCitationContext(citations = []) {
  const items = normalizeCitations(citations);
  return {
    citations: items,
    byId: createCitationMap(items)
  };
}

function replaceCitationTokensWithHtml(html = "", citationContext = null) {
  const source = String(html || "");
  const citationMap = citationContext?.byId instanceof Map ? citationContext.byId : new Map();
  if (!citationMap.size || !source.includes("[[CITE:")) return source;
  return source.replace(CITATION_TOKEN_PATTERN, (_match, tokenId) => {
    const citation = citationMap.get(String(tokenId || "").trim()) || normalizeCitationAttrs({ id: tokenId });
    const number = citation.number || 1;
    const title = escapeAttribute(citation.title || citation.href || `Citation ${number}`);
    return `<sup class="editor-inline-citation"><a href="#editor-citation-${number}" title="${title}" rel="noreferrer noopener">${number}</a></sup>`;
  });
}

function renderCitationTile(citations = []) {
  const items = normalizeCitations(citations);
  if (!items.length) return "";
  return `
    <section class="editor-live-citations">
      <h3>Citations</h3>
      <ol>
        ${items.map((citation, index) => `
          <li id="editor-citation-${citation.number || index + 1}">
            <a href="${escapeAttribute(citation.href || "#")}">${escapeHtml(citation.title || citation.href || `Citation ${citation.number || index + 1}`)}</a>
            ${citation.page ? `<span>, ${escapeHtml(citation.page)}</span>` : ""}
          </li>
        `).join("")}
      </ol>
    </section>
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

function clampHeadingLevel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 2;
  return Math.max(1, Math.min(6, Math.round(number)));
}

function escapeMarkdownText(value) {
  return String(value || "").replace(/[[\]\\]/g, "\\$&");
}

function escapeMarkdownTitle(value) {
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

export default {
  INVESTIGATION_IMAGE_PLACEMENTS,
  bodyJsonToMarkdown,
  bodyJsonToStructuredBlocks,
  buildStructuredInvestigationDocument,
  deriveInvestigationStructuredArtifacts,
  editorDocumentFromInvestigationRecord,
  emptyInvestigationBodyJson,
  investigationDocumentId,
  markdownToInvestigationBodyJson,
  normalizeInvestigationBodyJson,
  normalizeInvestigationImagePlacement,
  parseInvestigationImageTitleSpec,
  renderStructuredInvestigationHtml,
  stringifyInvestigationImageTitleSpec,
  structuredDocumentToBodyJson,
  structuredDocumentToMarkdown
};
