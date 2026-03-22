import {
  createStructuredDocument,
  normalizeStructuredDocument
} from "../../vendor/nostr-site-support.esm.js";
import { cleanSlug } from "./nostr.js";
import {
  clonePageContent,
  staticPageDraftSlug,
  staticPageMeta,
  staticPageSummary
} from "./page-drafts.js";

export function staticPageDocumentId(pageId = "") {
  const cleanPageId = cleanSlug(pageId || "");
  return cleanPageId ? `static-page:${cleanPageId}` : "";
}

export function buildStaticPageDocument({
  pageId = "",
  content = {},
  savedAt = 0
} = {}) {
  const cleanPageId = cleanSlug(pageId || "");
  const meta = staticPageMeta(cleanPageId);
  const pageContent = clonePageContent(content);
  return createStructuredDocument({
    id: staticPageDocumentId(cleanPageId),
    kind: "static-page",
    title: meta.title,
    summary: staticPageSummary(pageContent),
    metadata: {
      slug: staticPageDraftSlug(cleanPageId),
      pageId: cleanPageId,
      savedAt: Number(savedAt || 0) || 0,
      pageContent
    }
  });
}

export function extractStaticPageSnapshot(value = null, fallbackPageId = "") {
  const document = normalizeStructuredDocument(value?.document || value || {});
  const pageId = cleanSlug(document?.metadata?.pageId || fallbackPageId);
  const content = clonePageContent(document?.metadata?.pageContent || {});
  const savedAt = Number(document?.metadata?.savedAt || 0) || 0;
  if (!pageId || !Object.keys(content).length) return null;
  return {
    pageId,
    savedAt,
    content
  };
}

export default {
  buildStaticPageDocument,
  extractStaticPageSnapshot,
  staticPageDocumentId
};
