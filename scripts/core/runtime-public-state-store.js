import {
  publicStateNeedsRepair,
  requestPublicStateRepair,
  startPublicStateRepairPeer
} from "./nostr.js";
import { getCachedSiteRuntimeProjection, getSiteRuntimeClient } from "./runtime-client.js";
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

export function createRuntimePublicStateStore({
  getSessionSecretKey = async () => "",
  page = "site",
  refreshDelayMs = () => 15000,
  shouldRefresh = () => true,
  repairCooldownMs = 45000,
  repairRefreshDelayMs = 2800,
  deps = {}
} = {}) {
  const runtime = {
    getCachedPublicState: () => normalizeStoreEnvelope(getCachedSiteRuntimeProjection("publicState", {})),
    loadPublicState: async (force = false, reason = "runtime-public-state") => {
      const runtimeClient = await getSiteRuntimeClient();
      return normalizeStoreEnvelope(force
        ? await runtimeClient.refreshProjection("publicState", {}, { reason })
        : await runtimeClient.getProjection("publicState", {}, { preferFresh: false, reason }));
    },
    rememberPublicState: (nextValue, meta = {}) => {
      const source = String(meta?.source || "local-remember").trim() || "local-remember";
      const envelope = createStoreEnvelope(nextValue, { source });
      void getSiteRuntimeClient()
        .then((runtimeClient) => runtimeClient.rememberProjection("publicState", {}, nextValue, { source }))
        .catch(() => null);
      return envelope;
    },
    subscribePublicState: async (listener, options = {}) => {
      if (typeof listener !== "function") return () => {};
      const runtimeClient = await getSiteRuntimeClient();
      return runtimeClient.subscribeProjection("publicState", {}, listener, {
        emitCurrent: options?.emitCurrent !== false,
        refresh: options?.refresh !== false,
        reason: options?.reason || "runtime-public-state-store-source"
      });
    },
    publicStateNeedsRepair,
    requestPublicStateRepair,
    startPublicStateRepairPeer,
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (timerId) => window.clearTimeout(timerId),
    ...deps
  };
  const listeners = new Set();
  const initialEnvelope = normalizeStoreEnvelope(runtime.getCachedPublicState() || null);
  const state = {
    envelope: initialEnvelope,
    value: initialEnvelope?.value || null,
    digest: initialEnvelope?.digest || createPublicStateDigest(initialEnvelope?.value || null),
    status: initialEnvelope?.status || "idle",
    updatedAt: initialEnvelope?.updatedAt || 0,
    refreshTimer: 0,
    refreshInFlight: false,
    repairPeerStarted: false,
    repairInFlight: false,
    repairRequestedAt: 0,
    sourceSubscribed: false,
    sourceSubscriptionPromise: null,
    sourceUnsubscribe: null
  };

  function applyEnvelope(envelope = null) {
    const normalizedEnvelope = normalizeStoreEnvelope(envelope);
    state.envelope = normalizedEnvelope;
    state.value = normalizedEnvelope?.value || null;
    state.digest = normalizedEnvelope?.digest || createPublicStateDigest(normalizedEnvelope?.value || null);
    state.status = String(normalizedEnvelope?.status || "idle");
    state.updatedAt = Number(normalizedEnvelope?.updatedAt || 0) || 0;
  }

  function notify(reason, previousValue, previousDigest, previousStatus, changed, meta = {}) {
    const snapshot = {
      envelope: state.envelope,
      value: state.value,
      digest: state.digest,
      status: state.status,
      updatedAt: state.updatedAt,
      previousValue,
      previousDigest,
      previousStatus,
      changed,
      valueChanged: state.digest !== previousDigest,
      statusChanged: state.status !== previousStatus,
      reason,
      meta
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
        void hydrate({ force: true, reason: `${reason || "repair"}-followup`, requestRepair: false });
      }, repairRefreshDelayMs);
      return true;
    } catch {
      return false;
    } finally {
      state.repairInFlight = false;
    }
  }

  async function ensureSourceSubscription() {
    if (state.sourceSubscribed || state.sourceSubscriptionPromise) return;
    state.sourceSubscriptionPromise = Promise.resolve(
      runtime.subscribePublicState(
        (nextEnvelope, meta = {}) => {
          const previousValue = state.value;
          const previousDigest = state.digest;
          const previousStatus = state.status;
          applyEnvelope(nextEnvelope);
          const changed = state.digest !== previousDigest || state.status !== previousStatus;
          if (changed || !previousValue) {
            notify("source", previousValue, previousDigest, previousStatus, changed, meta);
          }
        },
        {
          emitCurrent: false,
          refresh: true,
          reason: "runtime-public-state-store-source"
        }
      )
    )
      .then((unsubscribe) => {
        state.sourceUnsubscribe = typeof unsubscribe === "function" ? unsubscribe : null;
        state.sourceSubscribed = true;
      })
      .catch(() => null)
      .finally(() => {
        state.sourceSubscriptionPromise = null;
      });
    await state.sourceSubscriptionPromise;
  }

  async function hydrate({ force = false, reason = "hydrate", requestRepair = true } = {}) {
    await ensureRepairPeer().catch(() => null);
    await ensureSourceSubscription().catch(() => null);
    const previousValue = state.value;
    const previousDigest = state.digest;
    const previousStatus = state.status;
    const nextEnvelope = await runtime.loadPublicState(force, reason);
    applyEnvelope(nextEnvelope);
    const changed = state.digest !== previousDigest || state.status !== previousStatus;
    if (requestRepair) {
      void maybeRequestRepair(state.value, reason);
    }
    if (changed || !previousValue) {
      notify(reason, previousValue, previousDigest, previousStatus, changed);
    }
    return {
      envelope: state.envelope,
      value: state.value,
      digest: state.digest,
      status: state.status,
      updatedAt: state.updatedAt,
      changed
    };
  }

  async function sync({ force = true, reason = "sync" } = {}) {
    if (state.refreshInFlight) {
      return {
        envelope: state.envelope,
        value: state.value,
        digest: state.digest,
        status: state.status,
        updatedAt: state.updatedAt,
        changed: false
      };
    }
    if (!shouldRefresh()) {
      clearRefresh();
      return {
        envelope: state.envelope,
        value: state.value,
        digest: state.digest,
        status: state.status,
        updatedAt: state.updatedAt,
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
    const previousStatus = state.status;
    applyEnvelope(runtime.rememberPublicState(nextValue, {
      source: reason
    }));
    const changed = state.digest !== previousDigest || state.status !== previousStatus;
    if (shouldNotify && changed) {
      notify(reason, previousValue, previousDigest, previousStatus, changed);
    }
    return state.value;
  }

  function subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    void ensureSourceSubscription().catch(() => null);
    if (emitCurrent && state.value) {
      listener({
        envelope: state.envelope,
        value: state.value,
        digest: state.digest,
        status: state.status,
        updatedAt: state.updatedAt,
        previousValue: null,
        previousDigest: "",
        previousStatus: "idle",
        changed: false,
        valueChanged: false,
        statusChanged: false,
        reason: "current",
        meta: {}
      });
    }
    return () => {
      listeners.delete(listener);
    };
  }

  function stop() {
    clearRefresh();
    state.sourceUnsubscribe?.();
    state.sourceUnsubscribe = null;
    state.sourceSubscribed = false;
  }

  return {
    get value() {
      return state.value;
    },
    get envelope() {
      return state.envelope;
    },
    get digest() {
      return state.digest;
    },
    get status() {
      return state.status;
    },
    get updatedAt() {
      return state.updatedAt;
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

function createStoreEnvelope(value, {
  status = value ? "ready" : "idle",
  digest = "",
  updatedAt = Date.now(),
  source = "runtime-public-state",
  ...meta
} = {}) {
  const nextValue = value || null;
  const nextUpdatedAt = Number(updatedAt || Date.now()) || Date.now();
  return {
    value: nextValue,
    status: normalizeStatus(status, nextValue),
    digest: String(digest || createPublicStateDigest(nextValue)),
    updatedAt: nextUpdatedAt,
    meta: {
      source,
      updatedAt: nextUpdatedAt,
      ...meta
    }
  };
}

function normalizeStoreEnvelope(envelope = null) {
  if (envelope && typeof envelope === "object" && "value" in envelope && ("status" in envelope || "digest" in envelope || "updatedAt" in envelope)) {
    return {
      value: envelope.value ?? null,
      status: String(envelope.status || "idle"),
      digest: String(envelope.digest || createPublicStateDigest(envelope.value ?? null)),
      updatedAt: Number(envelope.updatedAt || envelope.meta?.updatedAt || 0) || 0,
      meta: envelope.meta && typeof envelope.meta === "object" ? { ...envelope.meta } : {}
    };
  }
  return {
    value: envelope || null,
    status: envelope ? "ready" : "idle",
    digest: createPublicStateDigest(envelope || null),
    updatedAt: Date.now(),
    meta: {}
  };
}

function normalizeStatus(status, value) {
  const cleanStatus = String(status || "").trim().toLowerCase();
  if (["idle", "loading", "ready", "stale", "degraded", "error"].includes(cleanStatus)) {
    return cleanStatus;
  }
  return value ? "ready" : "idle";
}

export default createRuntimePublicStateStore;
