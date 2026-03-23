import {
  publicStateNeedsRepair,
  requestPublicStateRepair,
  startPublicStateRepairPeer
} from "./nostr.js";
import { normalizeAdminPubkeys } from "./public-state.js";
import { createRuntimeProjectionStore } from "./runtime-projection-store.js";

export function createPublicStateDigest(publicState) {
  const digest = {
    admins: normalizeAdminPubkeys(publicState).sort(),
    identityLinks: (publicState?.identityChain?.validLinks || []).map(
      (link) => `${link.old_pubkey || ""}:${link.new_pubkey || ""}`
    ),
    users: (publicState?.users || []).map(
      (user) =>
        [
          user.pubkey,
          user.isAdmin ? 1 : 0,
          user.commentCount || 0,
          user.submissionCount || 0,
          user.username || "",
          user.claimedUsername || "",
          user.usernameConflict ? 1 : 0,
          user.usernameOwnerPubkey || ""
        ].join(":")
    ),
    usernameCollisions: (publicState?.usernameCollisions || []).map(
      (entry) => `${entry.username}:${entry.owner_pubkey}:${(entry.claimant_pubkeys || []).join(",")}:${entry.conflict ? 1 : 0}`
    ),
    removedPubkeys: (publicState?.removedPubkeys || []).map((pubkey) => String(pubkey || "").trim().toLowerCase()),
    entities: (publicState?.approvedEntities || []).map(
      (entity) => `${entity.slug}:${entity.status || ""}:${entity.updated_at || entity.created_at || ""}`
    ),
    drafts: (publicState?.drafts || []).map(
      (draft) => `${draft.id || draft.slug}:${draft.status || ""}:${draft.created_at || ""}`
    ),
    comments: (publicState?.allComments || []).map(
      (comment) => `${comment.id}:${comment.visibility || "visible"}:${comment.created_at || ""}`
    ),
    keyRequests: (publicState?.pendingAdminKeyRequests || []).map(
      (request) => `${request.id}:${request.requester_pubkey}:${request.site_pubkey}`
    ),
    activeSite: publicState?.siteInfo?.activePubkey || ""
  };
  return JSON.stringify(digest);
}

export function createPublicStateProjectionStore({
  getSessionSecretKey = async () => "",
  page = "site",
  refreshDelayMs = () => 15000,
  shouldRefresh = () => true,
  repairCooldownMs = 45000,
  repairRefreshDelayMs = 2800,
  deps = {}
} = {}) {
  const projectionDeps = {};
  if (typeof deps.getCachedProjection === "function" || typeof deps.getCachedPublicState === "function") {
    projectionDeps.getCachedProjection = deps.getCachedProjection || deps.getCachedPublicState;
  }
  if (typeof deps.loadProjection === "function" || typeof deps.loadPublicState === "function") {
    projectionDeps.loadProjection = deps.loadProjection || deps.loadPublicState;
  }
  if (typeof deps.rememberProjection === "function" || typeof deps.rememberPublicState === "function") {
    projectionDeps.rememberProjection = deps.rememberProjection || deps.rememberPublicState;
  }
  if (typeof deps.subscribeProjection === "function" || typeof deps.subscribePublicState === "function") {
    projectionDeps.subscribeProjection = deps.subscribeProjection || deps.subscribePublicState;
  }
  if (typeof deps.setTimeout === "function") {
    projectionDeps.setTimeout = deps.setTimeout;
  }
  if (typeof deps.clearTimeout === "function") {
    projectionDeps.clearTimeout = deps.clearTimeout;
  }

  return createRuntimeProjectionStore({
    channel: "publicState",
    createDigest: createPublicStateDigest,
    getSessionSecretKey,
    page,
    refreshDelayMs,
    shouldRefresh,
    repair: {
      needsRepair: deps.publicStateNeedsRepair || publicStateNeedsRepair,
      requestRepair: deps.requestPublicStateRepair || requestPublicStateRepair,
      startPeer: deps.startPublicStateRepairPeer || startPublicStateRepairPeer,
      cooldownMs: repairCooldownMs,
      refreshDelayMs: repairRefreshDelayMs,
      buildPayload: (publicState, reason, resolvedPage) => ({
        reason,
        page: resolvedPage,
        knownEventCount: Array.isArray(publicState?.rawEvents) ? publicState.rawEvents.length : 0
      })
    },
    deps: projectionDeps
  });
}

export default createPublicStateProjectionStore;
