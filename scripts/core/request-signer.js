import {
  loadSiteRuntimeValue,
  rememberSiteRuntimeValue
} from "./runtime-local-state.js";

export function createRequestSigner({
  state,
  site,
  ensureEventToolsLoaded,
  getOrCreateGuestSession,
  ensureBlobAvailable,
  publishTaggedJson,
  loadVisitPulseMarker = loadSiteRuntimeValue,
  rememberVisitPulseMarker = rememberSiteRuntimeValue
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
      const marker = await loadVisitPulseMarker("visitPulseMarker", { day }, {
        reason: "visit-pulse-check",
        preferFresh: false
      }).catch(() => null);
      if (marker) return;
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
      await rememberVisitPulseMarker("visitPulseMarker", { day }, {
        page: document.body.dataset.page || "site",
        recordedAt: Date.now()
      }, {
        source: "visit-pulse"
      });
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
