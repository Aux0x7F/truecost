import SITE from "./site-config.js";
import { fetchJson, fetchText } from "./http.js";
import { parseContentDocument, slugify } from "./content-utils.js";
import { publicStateHasAdminPubkey } from "./public-state.js";
import { createEmptyGraphRecordState } from "./graph-records.js";
import {
  buildWorkspaceSiteKeyShare,
  findWorkspaceSiteKeyShare,
  mergeWorkspaceSiteKeyShares
} from "./workspace-site-key-records.js";
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

export async function loadContentPostsProjection() {
  return loadPublishedPosts();
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
  if (approvedEntities.length) return filterMappableEntities(approvedEntities);
  const graphProjection = await getProjectionValue("graph", {}, { preferFresh: false });
  return filterMappableEntities(Array.isArray(graphProjection?.graphState?.entities) ? graphProjection.graphState.entities : []);
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
  const getProjectionValue = createProjectionValueReader(host);
  const [publicState, siteKeyProjection] = await Promise.all([
    getProjectionValue("publicState", {}, { preferFresh: false }),
    getProjectionValue("workspaceSiteKeys", {}, { preferFresh: false })
  ]);
  const cleanSessionPubkey = String(session?.pubkey || "").trim().toLowerCase();
  const isAdmin = Boolean(
    cleanSessionPubkey &&
      (
        publicStateHasAdminPubkey(publicState, cleanSessionPubkey) ||
        cleanSessionPubkey === String(SITE.nostr.rootAdminPubkey || "").trim().toLowerCase()
      )
  );
  const activeSitePubkey = String(siteKeyProjection?.activeSitePubkey || publicState?.siteInfo?.activePubkey || "").trim().toLowerCase();
  const siteKeyShare = siteKeyProjection?.siteKeyShare || null;
  const pendingKeyRequest = (publicState?.pendingAdminKeyRequests || []).find(
    (request) =>
      String(request?.requester_pubkey || "").trim().toLowerCase() === cleanSessionPubkey &&
      String(request?.site_pubkey || "").trim().toLowerCase() === activeSitePubkey
  ) || null;
  return {
    session: session || null,
    publicState,
    isAdmin,
    activeSitePubkey,
    siteKeyShare,
    hasInboxAccess: Boolean(
      isAdmin &&
      activeSitePubkey &&
      String(siteKeyShare?.sitePubkey || "").trim().toLowerCase() === activeSitePubkey
    ),
    pendingKeyRequest
  };
}

export async function loadWorkspaceSiteKeysProjection({
  session,
  host,
  loadAdminKeyShares = async () => [],
  loadAdminKeyShare = async () => null,
  deriveIdentity = () => null
} = {}) {
  const getProjectionValue = createProjectionValueReader(host);
  const publicState = await getProjectionValue("publicState", {}, { preferFresh: false });
  const activeSitePubkey = String(publicState?.siteInfo?.activePubkey || "").trim().toLowerCase();
  if (!session?.secretKeyHex) {
    return {
      activeSitePubkey,
      siteKeyShare: null,
      siteKeyShares: []
    };
  }
  const remoteShares = typeof loadAdminKeyShares === "function"
    ? await loadAdminKeyShares(session.secretKeyHex).catch(() => [])
    : [];
  let mergedShares = mergeWorkspaceSiteKeyShares(
    (Array.isArray(remoteShares) ? remoteShares : [])
      .map((entry) => normalizeWorkspaceSiteKeyProjectionEntry(entry, deriveIdentity))
      .filter(Boolean),
    []
  );
  if (activeSitePubkey && !findWorkspaceSiteKeyShare(mergedShares, activeSitePubkey) && typeof loadAdminKeyShare === "function") {
    const currentShare = await loadAdminKeyShare(session.secretKeyHex, activeSitePubkey).catch(() => null);
    mergedShares = mergeWorkspaceSiteKeyShares(
      currentShare ? [normalizeWorkspaceSiteKeyProjectionEntry(currentShare, deriveIdentity)] : [],
      mergedShares
    );
  }
  return {
    activeSitePubkey,
    siteKeyShares: mergedShares,
    siteKeyShare: findWorkspaceSiteKeyShare(mergedShares, activeSitePubkey)
  };
}

export async function loadWorkspaceInboxProjection({
  session,
  host,
  loadInboxSubmissions = async () => []
} = {}) {
  const getProjectionValue = createProjectionValueReader(host);
  const [publicState, access, siteKeys] = await Promise.all([
    getProjectionValue("publicState", {}, { preferFresh: false }),
    getProjectionValue("workspaceAccess", {}, { preferFresh: false }),
    getProjectionValue("workspaceSiteKeys", {}, { preferFresh: false })
  ]);
  const cleanSessionPubkey = String(session?.pubkey || "").trim().toLowerCase();
  const isAdmin = Boolean(
    cleanSessionPubkey &&
      (
        publicStateHasAdminPubkey(publicState, cleanSessionPubkey) ||
        cleanSessionPubkey === String(SITE.nostr.rootAdminPubkey || "").trim().toLowerCase()
      )
  );
  if (!session?.secretKeyHex || !isAdmin || !access?.hasInboxAccess) {
    return {
      activeSitePubkey: String(siteKeys?.activeSitePubkey || "").trim().toLowerCase(),
      submissions: []
    };
  }
  const submissions = typeof loadInboxSubmissions === "function"
    ? await loadInboxSubmissions(siteKeys?.siteKeyShares || []).catch(() => [])
    : [];
  return {
    activeSitePubkey: String(siteKeys?.activeSitePubkey || "").trim().toLowerCase(),
    submissions: Array.isArray(submissions) ? submissions : []
  };
}

export async function loadNotificationsProjection({
  session,
  host,
  buildNotifications = async () => []
} = {}) {
  const cleanViewerPubkey = String(session?.pubkey || "").trim().toLowerCase();
  const sessionSecretKeyHex = String(session?.secretKeyHex || "").trim();
  if (!cleanViewerPubkey || !sessionSecretKeyHex) {
    return { items: [] };
  }

  const getProjectionValue = createProjectionValueReader(host);
  const [publicState, dismissedIds] = await Promise.all([
    getProjectionValue("publicState", {}, { preferFresh: false }),
    getProjectionValue(
      "dismissedNotifications",
      { viewerPubkey: cleanViewerPubkey, __projectionScope: "global" },
      { preferFresh: false }
    )
  ]);

  const nextItems = await buildNotifications({
    publicState,
    viewer: {
      pubkey: cleanViewerPubkey
    },
    sessionSecretKeyHex
  });
  const dismissed = new Set(
    (Array.isArray(dismissedIds) ? dismissedIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );

  return {
    items: dedupeNotifications(nextItems)
      .filter((item) => !dismissed.has(String(item?.id || "").trim()))
      .slice(0, 12)
  };
}

export default {
  loadCommentsProjection,
  loadContentPostsProjection,
  loadGraphProjection,
  loadMapEntitiesProjection,
  loadNotificationsProjection,
  loadPublishedPosts,
  loadRuntimeGraphSeed,
  loadWorkspaceInboxProjection,
  loadWorkspaceSiteKeysProjection,
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

function dedupeNotifications(items) {
  const seen = new Set();
  const list = [];
  for (const item of Array.isArray(items) ? items : []) {
    const id = String(item?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    list.push(item);
  }
  return list;
}

function normalizeWorkspaceSiteKeyProjectionEntry(entry, deriveIdentity) {
  if (!entry) return null;
  if (entry.siteSecretKeyHex || entry.site_secret_key_hex) {
    return buildWorkspaceSiteKeyShare(entry.siteSecretKeyHex || entry.site_secret_key_hex || "", entry, deriveIdentity);
  }
  if (entry.sitePubkey || entry.site_pubkey) {
    return {
      siteSecretKeyHex: String(entry.siteSecretKeyHex || entry.site_secret_key_hex || "").trim().toLowerCase(),
      sitePubkey: String(entry.sitePubkey || entry.site_pubkey || "").trim().toLowerCase(),
      senderPubkey: String(entry.senderPubkey || entry.sender_pubkey || "").trim().toLowerCase(),
      sharedAt: String(entry.sharedAt || entry.shared_at || "").trim(),
      event: entry.event || null
    };
  }
  return null;
}

function filterMappableEntities(entities = []) {
  return (Array.isArray(entities) ? entities : []).filter(
    (entity) => Number.isFinite(entity?.lat) && Number.isFinite(entity?.lng)
  );
}
