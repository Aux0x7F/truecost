import SITE from "./site-config.js";
import { normalizeQuerySlug } from "./query-state.js";
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
  return normalizeQuerySlug(new URLSearchParams(search).get("focus") || "");
}

export function requestedWikiEntity(search = window.location.search) {
  return normalizeQuerySlug(new URLSearchParams(search).get("entity") || "");
}
