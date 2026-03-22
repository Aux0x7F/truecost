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
  hydrateStoredSessions,
  resolveStoredSession,
  getStoredSession,
  saveSession,
  clearSession,
  repairSession,
  getStoredGuestSession,
  saveGuestSession,
  clearGuestSession,
  getOrCreateGuestSession,
  signInWithCredentials,
  rebroadcastAccount,
  rotateAccountCredentials,
  deriveSecretKeyHex
} = sessionApi;

export default sessionApi;
