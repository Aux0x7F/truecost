export function workspaceSiteKeyShareCacheKey(storageNamespace, viewerPubkey = "") {
  const cleanViewerPubkey = String(viewerPubkey || "").trim().toLowerCase();
  return cleanViewerPubkey ? `${storageNamespace}.admin-site-shares.${cleanViewerPubkey}` : "";
}

export function workspaceInboxCacheKey(storageNamespace, viewerPubkey = "", sitePubkey = "") {
  const cleanViewerPubkey = String(viewerPubkey || "").trim().toLowerCase();
  const cleanSitePubkey = String(sitePubkey || "").trim().toLowerCase();
  return cleanViewerPubkey && cleanSitePubkey
    ? `${storageNamespace}.workspace-inbox.${cleanViewerPubkey}.${cleanSitePubkey}`
    : "";
}

export function loadCachedWorkspaceSiteKeyShares({
  storageNamespace = "",
  viewerPubkey = "",
  deriveIdentity
} = {}) {
  const cacheKey = workspaceSiteKeyShareCacheKey(storageNamespace, viewerPubkey);
  if (!cacheKey || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(cacheKey);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => buildWorkspaceSiteKeyShare(entry?.siteSecretKeyHex || entry?.site_secret_key_hex || "", entry || {}, deriveIdentity))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function persistCachedWorkspaceSiteKeyShares({
  storageNamespace = "",
  viewerPubkey = "",
  shares = []
} = {}) {
  const cacheKey = workspaceSiteKeyShareCacheKey(storageNamespace, viewerPubkey);
  if (!cacheKey || typeof window === "undefined") return;
  const serialized = mergeWorkspaceSiteKeyShares(shares, []).map((share) => ({
    siteSecretKeyHex: share.siteSecretKeyHex,
    sitePubkey: share.sitePubkey,
    senderPubkey: share.senderPubkey || "",
    sharedAt: share.sharedAt || ""
  }));
  window.localStorage.setItem(cacheKey, JSON.stringify(serialized));
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

export function loadCachedWorkspaceInboxSubmissions({
  storageNamespace = "",
  viewerPubkey = "",
  sitePubkey = ""
} = {}) {
  const cacheKey = workspaceInboxCacheKey(storageNamespace, viewerPubkey, sitePubkey);
  if (!cacheKey || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(cacheKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistCachedWorkspaceInboxSubmissions({
  storageNamespace = "",
  viewerPubkey = "",
  sitePubkey = "",
  submissions = []
} = {}) {
  const cacheKey = workspaceInboxCacheKey(storageNamespace, viewerPubkey, sitePubkey);
  if (!cacheKey || typeof window === "undefined") return;
  window.localStorage.setItem(cacheKey, JSON.stringify(Array.isArray(submissions) ? submissions : []));
}

export function clearCachedWorkspaceInboxSubmissions({
  storageNamespace = "",
  viewerPubkey = "",
  sitePubkey = ""
} = {}) {
  const cacheKey = workspaceInboxCacheKey(storageNamespace, viewerPubkey, sitePubkey);
  if (!cacheKey || typeof window === "undefined") return;
  window.localStorage.removeItem(cacheKey);
}
