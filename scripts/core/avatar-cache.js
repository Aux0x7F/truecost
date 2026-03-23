export function createAvatarCacheRefresher({
  resolveSecretKey = async () => "",
  ensureBlobAvailable
} = {}) {
  async function refreshAvatarFromCache(target) {
    try {
      const secretKeyHex = await resolveSecretKey();
      if (!secretKeyHex) throw new Error("No avatar cache signer available.");
      const reference = {
        sha256: target.dataset.avatarSha || "",
        url: target.dataset.avatarUrl || target.currentSrc || target.src,
        access: "public",
        cipher: "none",
        type: target.dataset.avatarType || "image/jpeg",
        name: target.dataset.avatarName || "avatar"
      };
      await ensureBlobAvailable(secretKeyHex, reference);
      const src = reference.url;
      target.src = `${src}${src.includes("?") ? "&" : "?"}refresh=${Date.now()}`;
    } catch {
      target.dataset.refreshing = "no";
    }
  }

  return {
    refreshAvatarFromCache
  };
}

export default createAvatarCacheRefresher;
