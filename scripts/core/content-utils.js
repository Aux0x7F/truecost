export {
  enrichEntityReferences,
  collectEntityRefsFromText,
  splitTags,
  slugify,
  createUniqueSlug
} from "../../vendor/nostr-site-support.esm.js";

import {
  parseContentDocument as parseGenericContentDocument,
  buildDraftMarkdown as buildGenericDraftMarkdown
} from "../../vendor/nostr-site-support.esm.js";

const MARKERS = ["TCMETA", "CMSMETA"];

export function parseContentDocument(raw, fallback = {}) {
  return parseGenericContentDocument(raw, fallback, { markers: MARKERS });
}

export function buildDraftMarkdown(draft) {
  return buildGenericDraftMarkdown(draft, { marker: "TCMETA" });
}
