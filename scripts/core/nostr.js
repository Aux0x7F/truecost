import SITE from "./site-config.js";
import {
  buildCommentThreadState,
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
import {
  clearPublicStateCacheStorage,
  isRecoverablePublicStateCacheError,
  repairPublicStateCacheStorage
} from "./public-state-cache.js";

const client = createNostrCmsClient(SITE);
const blobs = createBlobStoreApi(SITE, client);
const staticPages = createStaticPageOverlayApi(SITE);
const structuredUnits = createStructuredUnitOverlayApi(SITE);
let publicStatePromise = null;
let lastGoodPublicState = clonePublicState(readCachedPublicStateSafely());

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
  hydrateCachedPublicState,
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
export { buildCommentThreadState, sanitizeTrustedHtml, sanitizeUrl };
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
  repairStoredPublicStateCache();
  publicStatePromise = loadPublicStateWithCacheRecovery(force)
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
  const next = clonePublicState(readCachedPublicStateSafely());
  if (next && isUsablePublicState(next)) {
    lastGoodPublicState = clonePublicState(next);
  }
  return next;
}

export function rememberPublicState(publicState) {
  const normalized = normalizePublicState(publicState, lastGoodPublicState);
  if (isUsablePublicState(normalized)) {
    lastGoodPublicState = clonePublicState(normalized);
  }
  return clonePublicState(normalized);
}

export default {
  ...client,
  ...blobs,
  ...staticPages,
  ...structuredUnits,
  loadPublicState,
  rememberPublicState,
  warmPublicState,
  publicStateNeedsRepair
};

function readCachedPublicStateSafely() {
  repairStoredPublicStateCache();
  try {
    return client.getCachedPublicState?.() || null;
  } catch (error) {
    if (!isRecoverablePublicStateCacheError(error)) return null;
    clearStoredPublicStateCache();
    try {
      return client.getCachedPublicState?.() || null;
    } catch {
      return null;
    }
  }
}

async function loadPublicStateWithCacheRecovery(force = false) {
  try {
    return await client.loadPublicState(force);
  } catch (error) {
    if (!isRecoverablePublicStateCacheError(error)) throw error;
    clearStoredPublicStateCache();
    return client.loadPublicState(true);
  }
}

function repairStoredPublicStateCache() {
  if (typeof window === "undefined" || !window?.localStorage) return null;
  return repairPublicStateCacheStorage(window.localStorage, SITE.nostr.storageNamespace);
}

function clearStoredPublicStateCache() {
  if (typeof window === "undefined" || !window?.localStorage) return null;
  return clearPublicStateCacheStorage(window.localStorage, SITE.nostr.storageNamespace);
}
