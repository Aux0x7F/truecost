import {
  ensureEventToolsLoaded,
  getCachedPublicState,
  loadPublicState,
  publicStateNeedsRepair,
  rememberPublicState,
  requestPublicStateRepair,
  startPublicStateRepairPeer
} from "./nostr.js";
import { normalizeAdminPubkeys } from "./public-state.js";

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

export function createPublicStateStore({
  getSessionSecretKey = async () => "",
  page = "site",
  refreshDelayMs = () => 15000,
  shouldRefresh = () => true,
  repairCooldownMs = 45000,
  repairRefreshDelayMs = 2800,
  deps = {}
} = {}) {
  const runtime = {
    ensureEventToolsLoaded,
    getCachedPublicState,
    loadPublicState,
    publicStateNeedsRepair,
    rememberPublicState,
    requestPublicStateRepair,
    startPublicStateRepairPeer,
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (timerId) => window.clearTimeout(timerId),
    ...deps
  };
  const listeners = new Set();
  const state = {
    value: runtime.getCachedPublicState() || null,
    digest: createPublicStateDigest(runtime.getCachedPublicState() || null),
    refreshTimer: 0,
    refreshInFlight: false,
    repairPeerStarted: false,
    repairInFlight: false,
    repairRequestedAt: 0
  };

  function notify(reason, previousValue, previousDigest, changed) {
    const snapshot = {
      value: state.value,
      digest: state.digest,
      previousValue,
      previousDigest,
      changed,
      reason
    };
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {
        continue;
      }
    }
  }

  function clearRefresh() {
    if (state.refreshTimer) {
      runtime.clearTimeout(state.refreshTimer);
      state.refreshTimer = 0;
    }
  }

  async function ensureRepairPeer() {
    if (state.repairPeerStarted) return;
    await runtime.startPublicStateRepairPeer();
    state.repairPeerStarted = true;
  }

  async function maybeRequestRepair(publicState, reason = "") {
    if (!runtime.publicStateNeedsRepair(publicState) || state.repairInFlight) return false;
    const now = Date.now();
    if (now - state.repairRequestedAt < repairCooldownMs) return false;
    const secretKeyHex = await getSessionSecretKey().catch(() => "");
    if (!secretKeyHex) return false;
    state.repairInFlight = true;
    state.repairRequestedAt = now;
    try {
      await runtime.requestPublicStateRepair(secretKeyHex, {
        reason,
        page: typeof page === "function" ? page() : page,
        knownEventCount: Array.isArray(publicState?.rawEvents) ? publicState.rawEvents.length : 0
      });
      runtime.setTimeout(() => {
        void hydrate({ force: true, reason: `${reason || "repair"}-followup` });
      }, repairRefreshDelayMs);
      return true;
    } finally {
      state.repairInFlight = false;
    }
  }

  async function hydrate({ force = false, reason = "hydrate", requestRepair = true } = {}) {
    await runtime.ensureEventToolsLoaded();
    await ensureRepairPeer().catch(() => null);
    const previousValue = state.value;
    const previousDigest = state.digest;
    const nextValue = await runtime.loadPublicState(force);
    state.value = nextValue;
    state.digest = createPublicStateDigest(nextValue);
    const changed = state.digest !== previousDigest;
    if (requestRepair) {
      void maybeRequestRepair(nextValue, reason);
    }
    if (changed || !previousValue) {
      notify(reason, previousValue, previousDigest, changed);
    }
    return {
      value: state.value,
      digest: state.digest,
      changed
    };
  }

  async function sync({ force = true, reason = "sync" } = {}) {
    if (state.refreshInFlight) {
      return {
        value: state.value,
        digest: state.digest,
        changed: false
      };
    }
    if (!shouldRefresh()) {
      clearRefresh();
      return {
        value: state.value,
        digest: state.digest,
        changed: false
      };
    }
    state.refreshInFlight = true;
    try {
      return await hydrate({ force, reason });
    } finally {
      state.refreshInFlight = false;
      schedule();
    }
  }

  function schedule(delay = Number(refreshDelayMs?.() || 0) || 0) {
    clearRefresh();
    if (!shouldRefresh() || delay <= 0) return 0;
    state.refreshTimer = runtime.setTimeout(() => {
      void sync({ force: true, reason: "scheduled-sync" });
    }, delay);
    return state.refreshTimer;
  }

  function remember(nextValue, { notify: shouldNotify = false, reason = "remember" } = {}) {
    const previousValue = state.value;
    const previousDigest = state.digest;
    state.value = runtime.rememberPublicState(nextValue);
    state.digest = createPublicStateDigest(state.value);
    const changed = state.digest !== previousDigest;
    if (shouldNotify && changed) {
      notify(reason, previousValue, previousDigest, changed);
    }
    return state.value;
  }

  function subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    if (emitCurrent && state.value) {
      listener({
        value: state.value,
        digest: state.digest,
        previousValue: null,
        previousDigest: "",
        changed: false,
        reason: "current"
      });
    }
    return () => {
      listeners.delete(listener);
    };
  }

  function stop() {
    clearRefresh();
  }

  return {
    get value() {
      return state.value;
    },
    get digest() {
      return state.digest;
    },
    clearRefresh,
    ensureRepairPeer,
    hydrate,
    maybeRequestRepair,
    remember,
    schedule,
    stop,
    subscribe,
    sync
  };
}
