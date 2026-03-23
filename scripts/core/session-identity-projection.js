import { createRuntimeProjectionStore } from "./runtime-projection-store.js";

export function createSessionIdentityProjectionStore({
  page = "site",
  shouldRefresh = () => true,
  refreshDelayMs = () => 0
} = {}) {
  return createRuntimeProjectionStore({
    channel: "sessionIdentity",
    createDigest: (value) => JSON.stringify({
      claimedUsername: String(value?.claimedUsername || ""),
      sessionPubkey: String(value?.sessionPubkey || ""),
      currentPubkey: String(value?.currentPubkey || ""),
      canonicalPubkey: String(value?.canonicalPubkey || ""),
      removed: Boolean(value?.removed),
      staleKey: Boolean(value?.staleKey),
      usernameConflict: Boolean(value?.usernameConflict),
      blocked: Boolean(value?.blocked)
    }),
    refreshDelayMs,
    shouldRefresh
  });
}

export default createSessionIdentityProjectionStore;
