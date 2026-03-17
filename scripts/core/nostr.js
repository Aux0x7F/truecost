import SITE from "./site-config.js";
import {
  createBlobStoreApi,
  createDeterministicSessionApi,
  createNostrCmsClient,
  createStaticPageOverlayApi,
  createStructuredUnitOverlayApi,
  sanitizeTrustedHtml,
  sanitizeUrl
} from "../../vendor/nostr-site-support.esm.js";
import {
  clonePublicState,
  isUsablePublicState,
  normalizePublicState
} from "./public-state.js";

const client = createNostrCmsClient(SITE);
const blobs = createBlobStoreApi(SITE, client);
const staticPages = createStaticPageOverlayApi(SITE);
const structuredUnits = createStructuredUnitOverlayApi(SITE);
let publicStatePromise = null;
let lastGoodPublicState = clonePublicState(client.getCachedPublicState?.() || null);

export const {
  getEventTools,
  hasNostrTools,
  ensureEventToolsLoaded,
  shortKey,
  normalizeUsername,
  cleanSlug,
  deriveIdentity,
  generateSecretKeyHex,
  resolveSitePubkey,
  getCachedPublicState: getCachedPublicStateFromClient,
  publicStateNeedsRepair,
  requestPublicStateRepair,
  startPublicStateRepairPeer,
  stopPublicStateRepairPeer,
  publishTaggedJson,
  publishEncryptedJson,
  publishSubmission,
  publishSubmissionChat,
  publishAdminKeyShare,
  publishAdminKeyRequest,
  publishSiteKeyEvent,
  loadAdminKeyShares,
  loadAdminKeyShare,
  lookupUsers,
  loadUserSubmissions,
  loadInboxSubmissions,
  loadSubmissionThread
} = client;

export const {
  uploadPublicBlob,
  uploadEncryptedBlob,
  decryptUploadedBlob,
  ensureBlobAvailable,
  publishBlobRequest,
  waitForBlobFulfillment
} = blobs;

export { createDeterministicSessionApi };
export { sanitizeTrustedHtml, sanitizeUrl };
export const {
  connectPage: connectStaticPageOverlay,
  createRoomId: createStaticPageRoomId,
  ensureEventToolsLoaded: ensureStaticPageToolsLoaded,
} = staticPages;
export const {
  connectUnit: connectStructuredUnitOverlay,
  createRoomId: createStructuredUnitRoomId,
  ensureEventToolsLoaded: ensureStructuredUnitToolsLoaded,
} = structuredUnits;

export async function loadPublicState(force = false) {
  if (publicStatePromise) return publicStatePromise;
  publicStatePromise = client.loadPublicState(force)
    .then((publicState) => {
      const normalized = normalizePublicState(publicState, lastGoodPublicState);
      if (isUsablePublicState(normalized)) {
        lastGoodPublicState = clonePublicState(normalized);
      }
      return normalized;
    })
    .catch((error) => {
      if (lastGoodPublicState) return clonePublicState(lastGoodPublicState);
      throw error;
    })
    .finally(() => {
      publicStatePromise = null;
    });
  return publicStatePromise;
}

export function warmPublicState(force = false) {
  return loadPublicState(force).catch(() => clonePublicState(lastGoodPublicState));
}

export function getCachedPublicState() {
  const cached = clonePublicState(lastGoodPublicState);
  if (cached) return cached;
  const next = clonePublicState(getCachedPublicStateFromClient?.() || null);
  if (next && isUsablePublicState(next)) {
    lastGoodPublicState = clonePublicState(next);
  }
  return next;
}

export default {
  ...client,
  ...blobs,
  ...staticPages,
  ...structuredUnits,
  loadPublicState,
  warmPublicState,
  publicStateNeedsRepair
};
