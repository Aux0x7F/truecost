import {
  buildEvidenceGraph,
  buildEntityWikiView,
  filterEvidenceGraph,
  findGraphNodeMatches
} from "../../vendor/nostr-site-support.esm.js";
import { investigationDrafts, draftToInvestigationPreview } from "./page-drafts.js";

export {
  buildEvidenceGraph,
  buildEntityWikiView,
  filterEvidenceGraph,
  findGraphNodeMatches
};

export async function loadGraphSeed(fetchJson, path) {
  if (typeof fetchJson !== "function" || !String(path || "").trim()) return emptySeed();
  try {
    const payload = await fetchJson(path);
    return normalizeSeed(payload);
  } catch {
    return emptySeed();
  }
}

export function buildSiteEvidenceGraph({
  publicState = null,
  posts = [],
  seed = null,
  draftGraph = null,
  viewerIsAdmin = false
} = {}) {
  const normalizedSeed = normalizeSeed(seed);
  const approvedEntities = Array.isArray(publicState?.approvedEntities) ? publicState.approvedEntities : [];
  const approvedRelationships = Array.isArray(publicState?.relationships)
    ? publicState.relationships
    : Array.isArray(publicState?.approvedRelationships)
      ? publicState.approvedRelationships
      : [];
  const draftRelationships = Array.isArray(publicState?.draftRelationships) ? publicState.draftRelationships : [];
  const localDraftEntities = Array.isArray(draftGraph?.entities) ? draftGraph.entities : [];
  const localDraftRelationships = Array.isArray(draftGraph?.relationships) ? draftGraph.relationships : [];
  const draftInvestigations = viewerIsAdmin
    ? investigationDrafts(publicState?.drafts || []).map((draft) => draftToInvestigationPreview(draft))
    : [];
  const entities = mergeEntities([
    ...normalizedSeed.entities,
    ...approvedEntities,
    ...(viewerIsAdmin ? localDraftEntities : [])
  ]);

  return buildEvidenceGraph({
    entities,
    relationships: [...normalizedSeed.relationships, ...approvedRelationships],
    draftRelationships: [
      ...(viewerIsAdmin ? normalizedSeed.draft_relationships : []),
      ...(viewerIsAdmin ? draftRelationships : []),
      ...(viewerIsAdmin ? localDraftRelationships : [])
    ],
    draftInvestigations,
    investigations: Array.isArray(posts) ? posts : [],
    viewerIsAdmin
  });
}

export function graphInvestigationHref(slug = "") {
  const clean = String(slug || "").trim();
  return clean ? `./investigation.html?slug=${encodeURIComponent(clean)}` : "./investigations.html";
}

export function graphEntityHref(slug = "") {
  const clean = String(slug || "").trim();
  return clean ? `./wiki.html?entity=${encodeURIComponent(clean)}` : "./wiki.html";
}

export function graphEntityInvestigationsHref(slug = "") {
  const clean = String(slug || "").trim();
  return clean ? `./investigations.html?entity=${encodeURIComponent(clean)}` : "./investigations.html";
}

export function graphEntityExplorerHref(slug = "") {
  const clean = String(slug || "").trim();
  return clean ? `./graph.html?focus=${encodeURIComponent(clean)}` : "./graph.html";
}

function emptySeed() {
  return {
    entities: [],
    relationships: [],
    draft_relationships: []
  };
}

function normalizeSeed(seed) {
  if (!seed || typeof seed !== "object") return emptySeed();
  return {
    entities: Array.isArray(seed.entities) ? seed.entities : [],
    relationships: Array.isArray(seed.relationships) ? seed.relationships : [],
    draft_relationships: Array.isArray(seed.draft_relationships) ? seed.draft_relationships : []
  };
}

function mergeEntities(values) {
  const merged = new Map();
  for (const entity of Array.isArray(values) ? values : []) {
    const slug = String(entity?.slug || "").trim().toLowerCase();
    if (!slug) continue;
    const existing = merged.get(slug);
    merged.set(slug, existing ? mergeEntity(existing, entity) : { ...entity });
  }
  return [...merged.values()];
}

function mergeEntity(previousEntity, nextEntity) {
  return {
    ...previousEntity,
    ...nextEntity,
    aliases: dedupe([...(Array.isArray(previousEntity?.aliases) ? previousEntity.aliases : []), ...(Array.isArray(nextEntity?.aliases) ? nextEntity.aliases : [])]),
    taxonomy: dedupe([...(Array.isArray(previousEntity?.taxonomy) ? previousEntity.taxonomy : []), ...(Array.isArray(nextEntity?.taxonomy) ? nextEntity.taxonomy : [])]),
    quickFacts: dedupeQuickFacts([...(Array.isArray(previousEntity?.quickFacts) ? previousEntity.quickFacts : []), ...(Array.isArray(nextEntity?.quickFacts) ? nextEntity.quickFacts : [])]),
    body: String(nextEntity?.body || "").trim() || String(previousEntity?.body || "").trim(),
    summary: String(nextEntity?.summary || "").trim() || String(previousEntity?.summary || "").trim()
  };
}

function dedupe(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function dedupeQuickFacts(values) {
  const seen = new Set();
  const results = [];
  for (const item of Array.isArray(values) ? values : []) {
    const label = String(item?.label || "").trim();
    const value = String(item?.value || "").trim();
    const key = `${label}:${value}`.toLowerCase();
    if (!label || !value || seen.has(key)) continue;
    seen.add(key);
    results.push({ label, value });
  }
  return results;
}
