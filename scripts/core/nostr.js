import SITE from "./site-config.js";
import { createBlobStoreApi, createDeterministicSessionApi, createNostrCmsClient } from "../../vendor/nostr-site-support.esm.js";

const client = createNostrCmsClient(SITE);
const blobs = createBlobStoreApi(SITE, client);

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
  loadPublicState,
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

export default {
  ...client,
  ...blobs
};
