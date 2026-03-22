import {
  clearSiteRuntimeValue,
  loadSiteRuntimeValue,
  rememberSiteRuntimeValue
} from "./runtime-local-state.js";

export function workspaceSiteKeyShareCacheKey(_storageNamespace, viewerPubkey = "") {
  const cleanViewerPubkey = String(viewerPubkey || "").trim().toLowerCase();
  return cleanViewerPubkey ? `workspaceSiteKeyShares:${cleanViewerPubkey}` : "";
}

export function workspaceInboxCacheKey(_storageNamespace, viewerPubkey = "", sitePubkey = "") {
  const cleanViewerPubkey = String(viewerPubkey || "").trim().toLowerCase();
  const cleanSitePubkey = String(sitePubkey || "").trim().toLowerCase();
  return cleanViewerPubkey && cleanSitePubkey
    ? `workspaceInboxSubmissions:${cleanViewerPubkey}:${cleanSitePubkey}`
    : "";
}

function workspaceSiteKeyShareParams(viewerPubkey = "") {
  const cleanViewerPubkey = String(viewerPubkey || "").trim().toLowerCase();
  return cleanViewerPubkey ? { viewerPubkey: cleanViewerPubkey } : null;
}

function workspaceInboxParams(viewerPubkey = "", sitePubkey = "") {
  const cleanViewerPubkey = String(viewerPubkey || "").trim().toLowerCase();
  const cleanSitePubkey = String(sitePubkey || "").trim().toLowerCase();
  return cleanViewerPubkey && cleanSitePubkey
    ? { viewerPubkey: cleanViewerPubkey, sitePubkey: cleanSitePubkey }
    : null;
}

export async function loadCachedWorkspaceSiteKeyShares({
  storageNamespace = "",
  viewerPubkey = "",
  deriveIdentity
} = {}) {
  const cacheParams = workspaceSiteKeyShareParams(viewerPubkey);
  if (!cacheParams) return [];
  try {
    const parsed = await loadSiteRuntimeValue("workspaceSiteKeyShares", cacheParams, {
      reason: "workspace-cache-load",
      preferFresh: false
    });
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => buildWorkspaceSiteKeyShare(entry?.siteSecretKeyHex || entry?.site_secret_key_hex || "", entry || {}, deriveIdentity))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function persistCachedWorkspaceSiteKeyShares({
  storageNamespace = "",
  viewerPubkey = "",
  shares = []
} = {}) {
  const cacheParams = workspaceSiteKeyShareParams(viewerPubkey);
  if (!cacheParams) return;
  const serialized = mergeWorkspaceSiteKeyShares(shares, []).map((share) => ({
    siteSecretKeyHex: share.siteSecretKeyHex,
    sitePubkey: share.sitePubkey,
    senderPubkey: share.senderPubkey || "",
    sharedAt: share.sharedAt || ""
  }));
  await rememberSiteRuntimeValue("workspaceSiteKeyShares", cacheParams, serialized, {
    source: "workspace-site-key-cache"
  });
}

export function mergeWorkspaceSiteKeyShares(primary, secondary) {
  const merged = new Map();
  for (const share of [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]) {
    const normalized = normalizeWorkspaceSiteKeyShare(share);
    if (!normalized || merged.has(normalized.sitePubkey)) continue;
    merged.set(normalized.sitePubkey, normalized);
  }
  return [...merged.values()];
}

export function normalizeWorkspaceSiteKeyShare(share, deriveIdentity) {
  if (!share) return null;
  if (typeof share === "string") return buildWorkspaceSiteKeyShare(share, {}, deriveIdentity);
  return buildWorkspaceSiteKeyShare(share.siteSecretKeyHex || share.site_secret_key_hex || "", share, deriveIdentity);
}

export function buildWorkspaceSiteKeyShare(siteSecretKeyHex, meta = {}, deriveIdentity) {
  const cleanSecretKeyHex = String(siteSecretKeyHex || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleanSecretKeyHex) || typeof deriveIdentity !== "function") return null;
  let identity;
  try {
    identity = deriveIdentity(cleanSecretKeyHex);
  } catch {
    return null;
  }
  return {
    siteSecretKeyHex: cleanSecretKeyHex,
    sitePubkey: String(identity?.pubkey || "").trim().toLowerCase(),
    senderPubkey: String(meta.senderPubkey || meta.sender_pubkey || meta.shared_by || "").trim().toLowerCase(),
    sharedAt: String(meta.sharedAt || meta.shared_at || "").trim(),
    event: meta.event || null
  };
}

export function findWorkspaceSiteKeyShare(shares, sitePubkey = "") {
  const cleanSitePubkey = String(sitePubkey || "").trim().toLowerCase();
  if (!cleanSitePubkey) return (Array.isArray(shares) ? shares : [])[0] || null;
  return (Array.isArray(shares) ? shares : []).find((share) => share.sitePubkey === cleanSitePubkey) || null;
}

export async function loadCachedWorkspaceInboxSubmissions({
  storageNamespace = "",
  viewerPubkey = "",
  sitePubkey = ""
} = {}) {
  const cacheParams = workspaceInboxParams(viewerPubkey, sitePubkey);
  if (!cacheParams) return [];
  try {
    const parsed = await loadSiteRuntimeValue("workspaceInboxSubmissions", cacheParams, {
      reason: "workspace-cache-load",
      preferFresh: false
    });
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function persistCachedWorkspaceInboxSubmissions({
  storageNamespace = "",
  viewerPubkey = "",
  sitePubkey = "",
  submissions = []
} = {}) {
  const cacheParams = workspaceInboxParams(viewerPubkey, sitePubkey);
  if (!cacheParams) return;
  await rememberSiteRuntimeValue("workspaceInboxSubmissions", cacheParams, Array.isArray(submissions) ? submissions : [], {
    source: "workspace-inbox-cache"
  });
}

export async function clearCachedWorkspaceInboxSubmissions({
  storageNamespace = "",
  viewerPubkey = "",
  sitePubkey = ""
} = {}) {
  const cacheParams = workspaceInboxParams(viewerPubkey, sitePubkey);
  if (!cacheParams) return;
  await clearSiteRuntimeValue("workspaceInboxSubmissions", cacheParams, {
    source: "workspace-inbox-cache-clear"
  });
}
