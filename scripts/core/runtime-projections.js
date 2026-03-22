import SITE from "./site-config.js";
import { fetchJson, fetchText } from "./http.js";
import { parseContentDocument, slugify } from "./content-utils.js";
import { publicStateHasAdminPubkey } from "./public-state.js";
import { createEmptyGraphRecordState } from "./graph-records.js";
import {
  buildEntityWikiView,
  buildSiteEvidenceGraph,
  loadGraphSeed
} from "./graph-wiki.js";

let postsPromise = null;
let graphSeedPromise = null;

export async function loadPublishedPosts() {
  if (!postsPromise) {
    postsPromise = fetchJson("./content/investigations/index.json")
      .then((data) => Promise.all((Array.isArray(data?.files) ? data.files : []).map(async (file) => {
        const text = await fetchText(`./content/investigations/${file}`);
        const parsed = parseContentDocument(text, {
          file,
          slug: slugify(file.replace(/\.md$/i, ""))
        });
        return {
          ...parsed.meta,
          file,
          slug: parsed.meta.slug || slugify(file.replace(/\.md$/i, "")),
          body: parsed.body
        };
      })))
      .then((posts) =>
        posts
          .filter(Boolean)
          .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")))
      );
  }
  return postsPromise;
}

export async function loadRuntimeGraphSeed() {
  if (!graphSeedPromise) {
    graphSeedPromise = loadGraphSeed(fetchJson, SITE.content.graphSeedPath);
  }
  return graphSeedPromise;
}

export async function loadGraphProjection({ session, host } = {}) {
  const getProjectionValue = createProjectionValueReader(host);
  const [publicState, posts, seed, draftGraph] = await Promise.all([
    getProjectionValue("publicState", {}, { preferFresh: false }),
    loadPublishedPosts(),
    loadRuntimeGraphSeed(),
    getProjectionValue("graphDraft", {}, { preferFresh: false })
  ]);
  const cleanSessionPubkey = String(session?.pubkey || "").trim().toLowerCase();
  const viewerIsAdmin = Boolean(
    cleanSessionPubkey &&
      (
        publicStateHasAdminPubkey(publicState, cleanSessionPubkey) ||
        cleanSessionPubkey === String(SITE.nostr.rootAdminPubkey || "").trim().toLowerCase()
      )
  );
  const graphState = buildSiteEvidenceGraph({
    publicState,
    posts,
    seed,
    draftGraph: viewerIsAdmin ? draftGraph : null,
    viewerIsAdmin
  });
  return {
    viewerIsAdmin,
    publicState,
    posts,
    seed,
    draftGraph: viewerIsAdmin
      ? draftGraph || createEmptyGraphRecordState()
      : createEmptyGraphRecordState(),
    graphState
  };
}

export async function loadWikiEntityProjection({ params, host } = {}) {
  const graphProjection = await createProjectionValueReader(host)("graph", {}, { preferFresh: false });
  const entity = String(params?.entity || "").trim().toLowerCase();
  return {
    entity,
    wikiView: entity && graphProjection?.graphState
      ? buildEntityWikiView(graphProjection.graphState, entity)
      : null,
    graphProjection
  };
}

export async function loadMapEntitiesProjection({ host } = {}) {
  const getProjectionValue = createProjectionValueReader(host);
  const publicState = await getProjectionValue("publicState", {}, { preferFresh: false });
  const approvedEntities = Array.isArray(publicState?.approvedEntities) ? publicState.approvedEntities : [];
  if (approvedEntities.length) return approvedEntities;
  const graphProjection = await getProjectionValue("graph", {}, { preferFresh: false });
  return Array.isArray(graphProjection?.graphState?.entities) ? graphProjection.graphState.entities : [];
}

export async function loadCommentsProjection({ params, host } = {}) {
  const publicState = await createProjectionValueReader(host)("publicState", {}, { preferFresh: false });
  const postSlug = String(params?.postSlug || "").trim().toLowerCase();
  if (!postSlug) {
    return {
      allComments: Array.isArray(publicState?.allComments) ? publicState.allComments : [],
      comments: Array.isArray(publicState?.comments) ? publicState.comments : []
    };
  }
  return {
    postSlug,
    comments: (publicState?.commentsByPost?.get?.(postSlug) || []).slice(),
    threads: (publicState?.commentThreadsByPost?.get?.(postSlug) || []).slice(),
    orphans: (publicState?.commentOrphansByPost?.get?.(postSlug) || []).slice()
  };
}

export async function loadWorkspaceProjection({ session, host } = {}) {
  const publicState = await createProjectionValueReader(host)("publicState", {}, { preferFresh: false });
  const cleanSessionPubkey = String(session?.pubkey || "").trim().toLowerCase();
  return {
    session: session || null,
    publicState,
    isAdmin: Boolean(
      cleanSessionPubkey &&
        (
          publicStateHasAdminPubkey(publicState, cleanSessionPubkey) ||
          cleanSessionPubkey === String(SITE.nostr.rootAdminPubkey || "").trim().toLowerCase()
        )
    )
  };
}

export default {
  loadCommentsProjection,
  loadGraphProjection,
  loadMapEntitiesProjection,
  loadPublishedPosts,
  loadRuntimeGraphSeed,
  loadWikiEntityProjection,
  loadWorkspaceProjection
};

function createProjectionValueReader(host = {}) {
  if (typeof host?.getProjectionValue === "function") {
    return (channel, params = {}, options = {}) => host.getProjectionValue(channel, params, options);
  }
  return async (channel, params = {}, options = {}) => {
    const projection = await host.getProjection(channel, params, options);
    return projection?.value ?? projection ?? null;
  };
}
