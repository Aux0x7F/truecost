export function createRequestSigner({
  state,
  site,
  ensureEventToolsLoaded,
  getOrCreateGuestSession,
  ensureBlobAvailable,
  publishTaggedJson
} = {}) {
  async function getSecretKey() {
    if (state.session?.secretKeyHex) return state.session.secretKeyHex;
    if (state.guestSession?.secretKeyHex) return state.guestSession.secretKeyHex;
    await ensureEventToolsLoaded();
    state.guestSession = await getOrCreateGuestSession().catch(() => null);
    return state.guestSession?.secretKeyHex || "";
  }

  async function publishVisitPulse() {
    try {
      const secretKeyHex = await getSecretKey();
      if (!secretKeyHex || !site?.nostr?.kinds?.visitPulse) return;
      const day = new Date().toISOString().slice(0, 10);
      const markerKey = `${site.nostr.storageNamespace}.visitPulse.${day}`;
      if (window.localStorage.getItem(markerKey)) return;
      await publishTaggedJson({
        kind: site.nostr.kinds.visitPulse,
        secretKeyHex,
        tags: [
          ["t", site.nostr.appTag],
          ["k", document.body.dataset.page || "site"]
        ],
        content: {
          day,
          page: document.body.dataset.page || "site"
        }
      });
      window.localStorage.setItem(markerKey, String(Date.now()));
    } catch {
      return;
    }
  }

  async function refreshAvatarFromCache(target) {
    try {
      const secretKeyHex = await getSecretKey();
      if (!secretKeyHex) throw new Error("No request signer available.");
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
    getSecretKey,
    publishVisitPulse,
    refreshAvatarFromCache
  };
}
