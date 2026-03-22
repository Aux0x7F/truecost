import SITE from "./site-config.js";
import { normalizeQuerySlug } from "./query-state.js";
import {
  buildSiteEvidenceGraph,
  loadGraphSeed
} from "./graph-wiki.js";
import {
  createEmptyGraphRecordState
} from "./graph-records.js";

export async function loadGraphDataset({
  fetchJson,
  postsStore,
  getPublicState,
  viewerController,
  getProjection
} = {}) {
  if (typeof getProjection === "function") {
    const projection = await getProjection("graph", {}, { preferFresh: false }).catch(() => null);
    const graphDataset = projection?.value ?? projection;
    if (graphDataset?.graphState) return graphDataset;
  }
  const publicState = await getPublicState();
  const viewerIsAdmin = Boolean(viewerController?.canEdit?.(publicState));
  const [posts, seed] = await Promise.all([
    postsStore?.load?.().catch(() => []) || [],
    loadGraphSeed(fetchJson, SITE.content.graphSeedPath)
  ]);
  const draftGraph = viewerIsAdmin ? createEmptyGraphRecordState() : createEmptyGraphRecordState();
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
