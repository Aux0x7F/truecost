import { cleanSlug } from "./nostr.js";

export const STATIC_PAGE_META = Object.freeze({
  home: { title: "Home page", path: "./index.html" },
  investigations: { title: "Investigations page", path: "./investigations.html" },
  investigation: { title: "Investigation page", path: "./investigation.html" },
  guide: { title: "Guide page", path: "./guide.html" },
  submit: { title: "Submit page", path: "./submit.html" },
  "get-involved": { title: "Get involved page", path: "./get-involved.html" },
  about: { title: "About page", path: "./about.html" },
  merch: { title: "Merch page", path: "./merch.html" },
  map: { title: "Map page", path: "./map.html" },
  workspace: { title: "Workspace page", path: "./admin.html" },
  editor: { title: "Editor page", path: "./editor.html" }
});

export const STATIC_EDITABLE_PAGES = new Set(Object.keys(STATIC_PAGE_META));

export function normalizeDraftStatus(status) {
  return String(status || "").trim().toLowerCase();
}

export function isPageDraft(draft) {
  return String(draft?.content_type || "").trim().toLowerCase() === "page" &&
    STATIC_EDITABLE_PAGES.has(cleanSlug(draft?.page_id || ""));
}

export function pageDrafts(drafts) {
  return (Array.isArray(drafts) ? drafts : []).filter((draft) => isPageDraft(draft));
}

export function investigationDrafts(drafts) {
  return (Array.isArray(drafts) ? drafts : []).filter((draft) => !isPageDraft(draft));
}

export function staticPageMeta(pageId) {
  return STATIC_PAGE_META[cleanSlug(pageId || "")] || { title: "Static page", path: "./index.html" };
}

export function staticPageDraftSlug(pageId) {
  return `page-${cleanSlug(pageId || "")}`;
}

export function staticPageSummary(content) {
  const plainText = Object.values(content || {})
    .map((value) => stripHtml(String(value || "")).trim())
    .filter(Boolean);
  return trimText(plainText.find((value) => value.length > 40) || plainText.join(" "), 180);
}

export function buildStaticPageDraftPayload(pageId, content, authorPubkey = "") {
  const cleanPageId = cleanSlug(pageId || "");
  const meta = staticPageMeta(cleanPageId);
  const titleKey = cleanPageId === "home" ? "home.hero.title" : `${cleanPageId}.hero.title`;
  const ledeKey = cleanPageId === "home" ? "home.hero.lede" : `${cleanPageId}.hero.lede`;
  const title = stripHtml(content?.[titleKey] || meta.title) || meta.title;
  const summary = stripHtml(content?.[ledeKey] || staticPageSummary(content));
  return {
    slug: staticPageDraftSlug(cleanPageId),
    content_type: "page",
    page_id: cleanPageId,
    page_path: meta.path,
    title,
    summary: summary || `${meta.title} update`,
    status: "candidate",
    date: new Date().toISOString().slice(0, 10),
    markdown: "",
    tags: [],
    entity_refs: [],
    page_content: clonePageContent(content),
    author_pubkey: String(authorPubkey || "").trim().toLowerCase()
  };
}

export function findPageDraftPreview(publicState, pageId, draftSlug) {
  const cleanPageId = cleanSlug(pageId || "");
  return pageDrafts(publicState?.drafts || []).find(
    (draft) => draft.slug === draftSlug && cleanSlug(draft.page_id || "") === cleanPageId
  ) || null;
}

export function latestApprovedPageDraft(publicState, pageId) {
  const cleanPageId = cleanSlug(pageId || "");
  const history = publicState?.draftHistoryBySlug?.get?.(staticPageDraftSlug(cleanPageId)) || [];
  return history.find(
    (draft) => isPageDraft(draft) &&
      cleanSlug(draft.page_id || "") === cleanPageId &&
      normalizeDraftStatus(draft.status) === "approved"
  ) || null;
}

export function pageDraftHref(draft, statusOverride = "") {
  const pageId = cleanSlug(draft?.page_id || "");
  const meta = staticPageMeta(pageId);
  const status = normalizeDraftStatus(statusOverride || draft?.status);
  if (["revision", "approved", "denied"].includes(status)) return meta.path;
  return `${meta.path}?draft=${encodeURIComponent(draft.slug)}`;
}

export function pageDraftActionLabel(draft, statusOverride = "") {
  const status = normalizeDraftStatus(statusOverride || draft?.status);
  return ["revision", "approved", "denied"].includes(status) ? "Open page" : "Open preview";
}

export function pageDraftLabel(draft) {
  return staticPageMeta(draft?.page_id || "").title;
}

export function draftReviewAction(draft) {
  const tag = Array.isArray(draft?._event?.tags)
    ? draft._event.tags.find((item) => Array.isArray(item) && item[0] === "review")
    : null;
  return String(tag?.[1] || "").trim().toLowerCase();
}

export function draftOwnerPubkey(draft) {
  const revisions = Array.isArray(draft?.revisions) ? draft.revisions : [];
  const oldest = revisions.length ? revisions[revisions.length - 1] : null;
  return String(oldest?.author || draft?.author || "").trim().toLowerCase();
}

export function draftStatusLabel(status, reviewAction = "") {
  const clean = normalizeDraftStatus(status);
  const action = String(reviewAction || "").trim().toLowerCase();
  if (["candidate", "review", "submitted"].includes(clean)) return "Submitted";
  if (clean === "approved") return "Approved";
  if (clean === "revision" || action === "revise") return "Revision requested";
  if (clean === "denied" || action === "deny") return "Denied";
  return "Draft";
}

export function draftToInvestigationPreview(draft) {
  const reviewAction = draftReviewAction(draft);
  return {
    ...draft,
    body: draft.markdown || "",
    body_html: draft.body_html || "",
    structured_document: draft.structured_document || null,
    search_text: draft.search_text || "",
    relationship_candidates: Array.isArray(draft.relationship_candidates) ? draft.relationship_candidates : [],
    citations: Array.isArray(draft.citations) ? draft.citations : [],
    statusLabel: draftStatusLabel(draft.status, reviewAction),
    status: draft.status || "candidate",
    date: draft.date || "",
    records: [],
    tags: Array.isArray(draft.tags) ? draft.tags : [],
    title: draft.title || "Untitled investigation",
    summary: draft.summary || "No summary added yet.",
    location: draft.location || "Draft location pending"
  };
}

export function reviewStatusForAction(action) {
  if (action === "approve") return "approved";
  if (action === "deny") return "denied";
  if (action === "revise") return "revision";
  return "candidate";
}

export function reviewActionMessage(action, draft = null) {
  if (isPageDraft(draft)) {
    if (action === "approve") return "Page update approved for publish.";
    if (action === "deny") return "Page update denied.";
    return "Revision requested on this page update.";
  }
  if (action === "approve") return "Investigation approved for publish.";
  if (action === "deny") return "Investigation denied.";
  return "Revision requested.";
}

export function clonePageContent(content) {
  return JSON.parse(JSON.stringify(content || {}));
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function trimText(value, length) {
  const text = String(value || "").trim();
  if (!text || text.length <= length) return text;
  return `${text.slice(0, Math.max(0, length - 1)).trimEnd()}…`;
}
