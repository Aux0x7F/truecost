import SITE from "./site-config.js";
import {
  buildSiteEvidenceGraph,
  loadGraphSeed
} from "./graph-wiki.js";
import {
  loadGraphDraftState
} from "./graph-drafts.js";

export async function loadGraphDataset({
  fetchJson,
  postsStore,
  getPublicState,
  viewerController
} = {}) {
  const publicState = await getPublicState();
  const viewerIsAdmin = Boolean(viewerController?.canEdit?.(publicState));
  const [posts, seed] = await Promise.all([
    postsStore?.load?.().catch(() => []) || [],
    loadGraphSeed(fetchJson, SITE.content.graphSeedPath)
  ]);
  const draftGraph = viewerIsAdmin ? loadGraphDraftState(SITE.nostr.storageNamespace) : { entities: [], relationships: [] };
  return {
    viewerIsAdmin,
    publicState,
    posts,
    seed,
    draftGraph,
    graphState: buildSiteEvidenceGraph({
      publicState,
      posts,
      seed,
      draftGraph,
      viewerIsAdmin
    })
  };
}

export function requestedGraphFocus(search = window.location.search) {
  return cleanQuerySlug(new URLSearchParams(search).get("focus") || "");
}

export function requestedWikiEntity(search = window.location.search) {
  return cleanQuerySlug(new URLSearchParams(search).get("entity") || "");
}

function cleanQuerySlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
