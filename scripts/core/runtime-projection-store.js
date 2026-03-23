import { getCachedSiteRuntimeProjection, getSiteRuntimeClient } from "./runtime-client.js";

export function createRuntimeProjectionStore({
  channel = "",
  params = {},
  createDigest = defaultDigest,
  getSessionSecretKey = async () => "",
  page = "site",
  refreshDelayMs = () => 15000,
  shouldRefresh = () => true,
  repair = {},
  deps = {}
} = {}) {
  const cleanChannel = String(channel || "").trim();
  if (!cleanChannel) {
    throw new Error("createRuntimeProjectionStore requires a projection channel.");
  }

  const repairConfig = {
    cooldownMs: Number(repair?.cooldownMs || 45000) || 45000,
    refreshDelayMs: Number(repair?.refreshDelayMs || 2800) || 2800,
    needsRepair: typeof repair?.needsRepair === "function" ? repair.needsRepair : () => false,
    requestRepair: typeof repair?.requestRepair === "function" ? repair.requestRepair : async () => {},
    startPeer: typeof repair?.startPeer === "function" ? repair.startPeer : async () => {},
    buildPayload: typeof repair?.buildPayload === "function"
      ? repair.buildPayload
      : (value, reason, resolvedPage) => ({ reason, page: resolvedPage }),
    enabled: Boolean(
      repair?.enabled ??
        (typeof repair?.needsRepair === "function" &&
          typeof repair?.requestRepair === "function" &&
          typeof repair?.startPeer === "function")
    )
  };

  const runtime = {
    getCachedProjection: () => normalizeStoreEnvelope(getCachedSiteRuntimeProjection(cleanChannel, params), { createDigest }),
    loadProjection: async (force = false, reason = `runtime-${cleanChannel}`) => {
      const runtimeClient = await getSiteRuntimeClient();
      return normalizeStoreEnvelope(
        force
          ? await runtimeClient.refreshProjection(cleanChannel, params, { reason })
          : await runtimeClient.getProjection(cleanChannel, params, { preferFresh: false, reason }),
        { createDigest }
      );
    },
    rememberProjection: (nextValue, meta = {}) => {
      const source = String(meta?.source || "local-remember").trim() || "local-remember";
      const envelope = createStoreEnvelope(nextValue, {
        createDigest,
        source
      });
      void getSiteRuntimeClient()
        .then((runtimeClient) => runtimeClient.rememberProjection(cleanChannel, params, nextValue, { source }))
        .catch(() => null);
      return envelope;
    },
    subscribeProjection: async (listener, options = {}) => {
      if (typeof listener !== "function") return () => {};
      const runtimeClient = await getSiteRuntimeClient();
      return runtimeClient.subscribeProjection(cleanChannel, params, listener, {
        emitCurrent: options?.emitCurrent !== false,
        refresh: options?.refresh !== false,
        reason: options?.reason || `runtime-projection-store:${cleanChannel}`
      });
    },
    needsRepair: repairConfig.needsRepair,
    requestRepair: repairConfig.requestRepair,
    startRepairPeer: repairConfig.startPeer,
    buildRepairPayload: repairConfig.buildPayload,
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: (timerId) => window.clearTimeout(timerId),
    ...deps
  };

  const listeners = new Set();
  const initialEnvelope = normalizeStoreEnvelope(runtime.getCachedProjection() || null, { createDigest });
  const state = {
    envelope: initialEnvelope,
    value: initialEnvelope?.value || null,
    digest: initialEnvelope?.digest || createDigest(initialEnvelope?.value || null),
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
    const normalizedEnvelope = normalizeStoreEnvelope(envelope, { createDigest });
    state.envelope = normalizedEnvelope;
    state.value = normalizedEnvelope?.value || null;
    state.digest = normalizedEnvelope?.digest || createDigest(normalizedEnvelope?.value || null);
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
    if (!repairConfig.enabled || state.repairPeerStarted) return;
    await runtime.startRepairPeer();
    state.repairPeerStarted = true;
  }

  async function maybeRequestRepair(value, reason = "") {
    if (!repairConfig.enabled || !runtime.needsRepair(value) || state.repairInFlight) return false;
    const now = Date.now();
    if (now - state.repairRequestedAt < repairConfig.cooldownMs) return false;
    const secretKeyHex = await getSessionSecretKey().catch(() => "");
    if (!secretKeyHex) return false;
    const resolvedPage = typeof page === "function" ? page() : page;
    state.repairInFlight = true;
    state.repairRequestedAt = now;
    try {
      await runtime.requestRepair(
        secretKeyHex,
        runtime.buildRepairPayload(value, reason, resolvedPage)
      );
      runtime.setTimeout(() => {
        void hydrate({ force: true, reason: `${reason || "repair"}-followup`, requestRepair: false });
      }, repairConfig.refreshDelayMs);
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
      runtime.subscribeProjection(
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
          reason: `runtime-projection-store:${cleanChannel}:source`
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
    const nextEnvelope = await runtime.loadProjection(force, reason);
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
    applyEnvelope(runtime.rememberProjection(nextValue, { source: reason }));
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

export function normalizeStoreEnvelope(envelope = null, { createDigest = defaultDigest } = {}) {
  if (envelope && typeof envelope === "object" && "value" in envelope && ("status" in envelope || "digest" in envelope || "updatedAt" in envelope)) {
    return {
      value: envelope.value ?? null,
      status: String(envelope.status || "idle"),
      digest: String(envelope.digest || createDigest(envelope.value ?? null)),
      updatedAt: Number(envelope.updatedAt || envelope.meta?.updatedAt || 0) || 0,
      meta: envelope.meta && typeof envelope.meta === "object" ? { ...envelope.meta } : {}
    };
  }
  return {
    value: envelope || null,
    status: envelope ? "ready" : "idle",
    digest: createDigest(envelope || null),
    updatedAt: Date.now(),
    meta: {}
  };
}

function createStoreEnvelope(value, {
  createDigest = defaultDigest,
  status = value ? "ready" : "idle",
  digest = "",
  updatedAt = Date.now(),
  source = "runtime-projection",
  ...meta
} = {}) {
  const nextValue = value || null;
  const nextUpdatedAt = Number(updatedAt || Date.now()) || Date.now();
  return {
    value: nextValue,
    status: normalizeStatus(status, nextValue),
    digest: String(digest || createDigest(nextValue)),
    updatedAt: nextUpdatedAt,
    meta: {
      source,
      updatedAt: nextUpdatedAt,
      ...meta
    }
  };
}

function normalizeStatus(status, value) {
  const cleanStatus = String(status || "").trim().toLowerCase();
  if (["idle", "loading", "ready", "stale", "degraded", "error"].includes(cleanStatus)) {
    return cleanStatus;
  }
  return value ? "ready" : "idle";
}

function defaultDigest(value) {
  return JSON.stringify(value ?? null);
}

export default createRuntimeProjectionStore;
