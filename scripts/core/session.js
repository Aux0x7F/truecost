import SITE from "./site-config.js";
import {
  createDeterministicSessionApi,
  deriveIdentity,
  ensureEventToolsLoaded,
  normalizeUsername,
  publishTaggedJson
} from "./nostr.js";

const sessionApi = createDeterministicSessionApi(SITE, {
  deriveIdentity,
  ensureEventToolsLoaded,
  normalizeUsername,
  publishTaggedJson
});

export const {
  getStoredSession,
  saveSession,
  clearSession,
  getStoredGuestSession,
  saveGuestSession,
  clearGuestSession,
  getOrCreateGuestSession,
  signInWithCredentials,
  rebroadcastAccount,
  deriveSecretKeyHex
} = sessionApi;

export default sessionApi;
