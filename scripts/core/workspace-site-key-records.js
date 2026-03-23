export function mergeWorkspaceSiteKeyShares(primary, secondary) {
  const merged = new Map();
  for (const share of [
    ...(Array.isArray(primary) ? primary : []),
    ...(Array.isArray(secondary) ? secondary : [])
  ]) {
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

export default {
  buildWorkspaceSiteKeyShare,
  findWorkspaceSiteKeyShare,
  mergeWorkspaceSiteKeyShares,
  normalizeWorkspaceSiteKeyShare
};
