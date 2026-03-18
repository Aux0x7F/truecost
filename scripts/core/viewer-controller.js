import { normalizeAdminPubkeys } from "./public-state.js";

export function createViewerController({
  state,
  site,
  deriveIdentity,
  hasNostrTools
} = {}) {
  function primeFromSession(deriveWhenAvailable = false) {
    if (!state.session) {
      state.viewer = null;
      return null;
    }
    if (state.viewer?.pubkey) {
      if (!state.viewer.secretKeyHex && deriveWhenAvailable && hasNostrTools()) {
        try {
          state.viewer = deriveIdentity(state.session.secretKeyHex);
        } catch {
          return state.viewer;
        }
      }
      return state.viewer;
    }
    const sessionPubkey = String(state.session.pubkey || "").trim();
    if (sessionPubkey) {
      state.viewer = { pubkey: sessionPubkey };
    }
    if ((!state.viewer || !state.viewer.pubkey) && deriveWhenAvailable && hasNostrTools()) {
      try {
        state.viewer = deriveIdentity(state.session.secretKeyHex);
      } catch {
        state.viewer = state.viewer?.pubkey ? state.viewer : null;
      }
    }
    return state.viewer;
  }

  async function get() {
    if (state.viewer) return state.viewer;
    state.viewer = deriveIdentity(state.session.secretKeyHex);
    return state.viewer;
  }

  function sessionPubkey() {
    return String(primeFromSession(false)?.pubkey || "").trim();
  }

  function trustedPubkeys(publicState) {
    const admins = new Set(normalizeAdminPubkeys(publicState));
    const rootAdminPubkey = String(publicState?.rootAdminPubkey || site?.nostr?.rootAdminPubkey || "").trim();
    if (rootAdminPubkey) admins.add(rootAdminPubkey);
    return [...admins];
  }

  function canEdit(publicState) {
    if (!state.session) return false;
    const viewerPubkey = sessionPubkey();
    if (!viewerPubkey) return false;
    return trustedPubkeys(publicState).includes(viewerPubkey);
  }

  return {
    get,
    primeFromSession,
    sessionPubkey,
    trustedPubkeys,
    canEdit
  };
}
