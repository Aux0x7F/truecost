import {
  expandCanonicalIdentityPubkeys,
  normalizeAdminPubkeys,
  publicStateHasAdminPubkey
} from "./public-state.js";

export function createViewerController({
  state,
  site,
  deriveIdentity,
  hasNostrTools,
  persistSession = null
} = {}) {
  function rememberSessionPubkey(pubkey = "") {
    const cleanPubkey = String(pubkey || "").trim().toLowerCase();
    if (!state.session || !cleanPubkey) return;
    if (String(state.session.pubkey || "").trim().toLowerCase() === cleanPubkey) return;
    state.session = {
      ...state.session,
      pubkey: cleanPubkey
    };
    if (typeof persistSession === "function") {
      persistSession(state.session);
    }
  }

  function primeFromSession(deriveWhenAvailable = false) {
    if (!state.session) {
      state.viewer = null;
      return null;
    }
    if (state.viewer?.pubkey) {
      rememberSessionPubkey(state.viewer.pubkey);
      if (!state.viewer.secretKeyHex && deriveWhenAvailable && hasNostrTools()) {
        try {
          state.viewer = deriveIdentity(state.session.secretKeyHex);
          rememberSessionPubkey(state.viewer?.pubkey);
        } catch {
          return state.viewer;
        }
      }
      return state.viewer;
    }
    const sessionPubkey = String(state.session.pubkey || "").trim();
    if (sessionPubkey) {
      state.viewer = { pubkey: sessionPubkey };
      rememberSessionPubkey(sessionPubkey);
    }
    if ((!state.viewer || !state.viewer.pubkey) && deriveWhenAvailable && hasNostrTools()) {
      try {
        state.viewer = deriveIdentity(state.session.secretKeyHex);
        rememberSessionPubkey(state.viewer?.pubkey);
      } catch {
        state.viewer = state.viewer?.pubkey ? state.viewer : null;
      }
    }
    return state.viewer;
  }

  async function get() {
    if (state.viewer) return state.viewer;
    state.viewer = deriveIdentity(state.session.secretKeyHex);
    rememberSessionPubkey(state.viewer?.pubkey);
    return state.viewer;
  }

  function sessionPubkey() {
    return String(primeFromSession(false)?.pubkey || "").trim();
  }

  function trustedPubkeys(publicState) {
    const admins = new Set(normalizeAdminPubkeys(publicState));
    const rootAdminPubkey = String(publicState?.rootAdminPubkey || site?.nostr?.rootAdminPubkey || "").trim();
    if (rootAdminPubkey) admins.add(rootAdminPubkey);
    return [...new Set(
      [...admins].flatMap((pubkey) => expandCanonicalIdentityPubkeys(publicState, pubkey))
    )];
  }

  function canEdit(publicState) {
    if (!state.session) return false;
    const viewerPubkey = sessionPubkey();
    if (!viewerPubkey) return false;
    return publicStateHasAdminPubkey(publicState, viewerPubkey);
  }

  return {
    get,
    primeFromSession,
    sessionPubkey,
    trustedPubkeys,
    canEdit
  };
}
