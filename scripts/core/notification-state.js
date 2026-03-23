import { createRuntimeProjectionStore } from "./runtime-projection-store.js";
import { getSiteRuntimeClient } from "./runtime-client.js";

async function defaultLoadDismissedIds(pubkey, { dismissedParams, loadDismissedProjection } = {}) {
  if (!pubkey || typeof dismissedParams !== "function" || typeof loadDismissedProjection !== "function") return [];
  const params = dismissedParams(pubkey);
  if (!params) return [];
  try {
    const current = await loadDismissedProjection("dismissedNotifications", params, {
      reason: "notification-dismissed-load",
      preferFresh: false
    });
    if (Array.isArray(current)) {
      return current.map((value) => String(value || "").trim()).filter(Boolean);
    }
    const legacy = await loadDismissedProjection("notificationDismissedIds", params, {
      reason: "notification-dismissed-legacy-load",
      preferFresh: false
    });
    return Array.isArray(legacy)
      ? legacy.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

async function defaultSaveDismissedIds(pubkey, ids, { dismissedParams, rememberDismissedProjection } = {}) {
  if (!pubkey || typeof dismissedParams !== "function" || typeof rememberDismissedProjection !== "function") return;
  const params = dismissedParams(pubkey);
  if (!params) return;
  await rememberDismissedProjection(
    "dismissedNotifications",
    params,
    [...ids],
    { source: "notification-dismissed-ids" }
  );
}

async function defaultLoadDismissedProjection(channel = "", params = {}, options = {}) {
  const runtimeClient = await getSiteRuntimeClient().catch(() => null);
  if (!runtimeClient) return null;
  const projection = await runtimeClient.getProjection(channel, params, options).catch(() => null);
  return projection?.value ?? null;
}

async function defaultRememberDismissedProjection(channel = "", params = {}, value = null, meta = {}) {
  const runtimeClient = await getSiteRuntimeClient().catch(() => null);
  if (!runtimeClient) return null;
  const projection = await runtimeClient.rememberProjection(channel, params, value, meta).catch(() => null);
  return projection?.value ?? null;
}

function dedupeNotificationItems(items) {
  const seen = new Set();
  const list = [];
  for (const item of Array.isArray(items) ? items : []) {
    const id = String(item?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    list.push(item);
  }
  return list;
}

export function countNotificationItems(items) {
  return Array.isArray(items) ? items.length : 0;
}

export function createNotificationState({
  storageNamespace = "site",
  onChange = () => {},
  getSession = () => null,
  getViewerPubkey = () => "",
  getPublicState = async () => null,
  buildNotifications = null,
  getCachedProjection = null,
  loadProjection = null,
  rememberProjection = null,
  subscribeProjection = null,
  loadDismissedProjection = defaultLoadDismissedProjection,
  rememberDismissedProjection = defaultRememberDismissedProjection,
  loadDismissedIds = defaultLoadDismissedIds,
  saveDismissedIds = defaultSaveDismissedIds
} = {}) {
  let items = [];
  let loading = false;
  const dismissedCache = new Map();
  const dismissedLoads = new Map();

  function emit() {
    onChange({ items: items.slice(), loading });
  }

  function dismissedParams(pubkey) {
    const cleanPubkey = String(pubkey || "").trim();
    return cleanPubkey
      ? { viewerPubkey: cleanPubkey, __projectionScope: "global" }
      : null;
  }

  async function ensureDismissedIds(pubkey = getViewerPubkey()) {
    const cleanPubkey = String(pubkey || "").trim();
    if (!cleanPubkey) return new Set();
    if (dismissedCache.has(cleanPubkey)) {
      return new Set(dismissedCache.get(cleanPubkey));
    }
    if (!dismissedLoads.has(cleanPubkey)) {
      dismissedLoads.set(
        cleanPubkey,
        Promise.resolve(
          loadDismissedIds(cleanPubkey, {
            dismissedParams,
            loadDismissedProjection,
            storageNamespace
          })
        )
          .then((value) => new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean)))
          .catch(() => new Set())
          .finally(() => {
            dismissedLoads.delete(cleanPubkey);
          })
      );
    }
    const dismissed = await dismissedLoads.get(cleanPubkey);
    dismissedCache.set(cleanPubkey, new Set(dismissed));
    return new Set(dismissed);
  }

  function currentDismissedIds(pubkey = getViewerPubkey()) {
    const cleanPubkey = String(pubkey || "").trim();
    return new Set(dismissedCache.get(cleanPubkey) || []);
  }

  function persistDismissed(pubkey, ids) {
    const cleanPubkey = String(pubkey || "").trim();
    if (!cleanPubkey) return;
    dismissedCache.set(cleanPubkey, new Set(ids));
    void Promise.resolve(
      saveDismissedIds(cleanPubkey, [...ids], {
        dismissedParams,
        rememberDismissedProjection,
        storageNamespace
      })
    ).catch(() => null);
  }

  function projectionEnvelope(itemsValue = [], status = "ready") {
    return {
      value: {
        items: dedupeNotificationItems(itemsValue).slice(0, 12)
      },
      status,
      digest: createNotificationDigest(itemsValue),
      updatedAt: Date.now(),
      meta: {}
    };
  }

  async function loadLocalNotifications(force = false) {
    const session = getSession();
    const viewerPubkey = String(getViewerPubkey() || "").trim();
    if (!session || !viewerPubkey || typeof buildNotifications !== "function") {
      return { items: [] };
    }
    const source = await getPublicState(force);
    const next = await buildNotifications({
      publicState: source,
      force,
      viewer: {
        pubkey: viewerPubkey
      },
      viewerPubkey,
      sessionSecretKeyHex: String(session?.secretKeyHex || "").trim()
    });
    const dismissed = await ensureDismissedIds(viewerPubkey);
    return {
      items: dedupeNotificationItems(next)
        .filter((item) => !dismissed.has(String(item?.id || "").trim()))
        .slice(0, 12)
    };
  }

  const useLocalProjectionFallback = Boolean(
    typeof buildNotifications === "function" &&
      typeof getCachedProjection !== "function" &&
      typeof loadProjection !== "function" &&
      typeof rememberProjection !== "function" &&
      typeof subscribeProjection !== "function"
  );

  const notificationProjection = createRuntimeProjectionStore({
    channel: "notifications",
    createDigest: (value) => createNotificationDigest(value?.items || []),
    refreshDelayMs: () => 0,
    shouldRefresh: () => Boolean(getSession() && getViewerPubkey()),
    deps: {
      ...(typeof getCachedProjection === "function"
        ? {
            getCachedProjection: () => getCachedProjection("notifications", {})
          }
        : {}),
      ...(typeof loadProjection === "function"
        ? {
            loadProjection: (force = false, reason = "notifications") =>
              loadProjection("notifications", {}, { preferFresh: Boolean(force), reason })
          }
        : {}),
      ...(typeof rememberProjection === "function"
        ? {
            rememberProjection: (value, meta = {}) =>
              createNormalizedEnvelope(
                rememberProjection("notifications", {}, value, meta),
                value
              )
          }
        : {}),
      ...(typeof subscribeProjection === "function"
        ? {
            subscribeProjection: (listener, options = {}) =>
              subscribeProjection("notifications", {}, listener, options)
          }
        : {}),
      ...(useLocalProjectionFallback
        ? {
            getCachedProjection: () => projectionEnvelope(items, loading ? "loading" : "ready"),
            loadProjection: async (force = false) => loadLocalNotifications(force),
            rememberProjection: (value, meta = {}) => createNormalizedEnvelope(value, value, meta),
            subscribeProjection: async () => () => {}
          }
        : {})
    }
  });

  function applyEnvelope(envelope = null) {
    const nextItems = dedupeNotificationItems(envelope?.value?.items || []).slice(0, 12);
    items = nextItems;
    loading = ["loading", "stale"].includes(String(envelope?.status || ""));
    emit();
    return items;
  }

  notificationProjection.subscribe(({ envelope }) => {
    applyEnvelope(envelope);
  }, { emitCurrent: true });

  return {
    get items() {
      return items;
    },
    get loading() {
      return loading;
    },
    reset() {
      items = [];
      loading = false;
      emit();
    },
    async hydrate({ force = false } = {}) {
      const session = getSession();
      const viewerPubkey = String(getViewerPubkey() || "").trim();
      if (!session || !viewerPubkey) {
        items = [];
        loading = false;
        emit();
        return items;
      }
      const result = await notificationProjection.hydrate({
        force: Boolean(force),
        reason: force ? "notification-force" : "notification-hydrate",
        requestRepair: false
      });
      return applyEnvelope(result?.envelope || notificationProjection.envelope);
    },
    dismiss(id) {
      const viewerPubkey = String(getViewerPubkey() || "").trim();
      const clean = String(id || "").trim();
      if (!viewerPubkey || !clean) return;
      const dismissed = currentDismissedIds(viewerPubkey);
      dismissed.add(clean);
      persistDismissed(viewerPubkey, dismissed);
      const nextItems = items.filter((item) => String(item?.id || "").trim() !== clean);
      notificationProjection.remember({ items: nextItems }, {
        notify: true,
        reason: "notification-dismiss"
      });
      void notificationProjection.sync({
        force: true,
        reason: "notification-dismiss-sync"
      });
    },
    clear() {
      const viewerPubkey = String(getViewerPubkey() || "").trim();
      if (!viewerPubkey || !items.length) return;
      const dismissed = currentDismissedIds(viewerPubkey);
      for (const item of items) {
        const clean = String(item?.id || "").trim();
        if (clean) dismissed.add(clean);
      }
      persistDismissed(viewerPubkey, dismissed);
      notificationProjection.remember({ items: [] }, {
        notify: true,
        reason: "notification-clear"
      });
      void notificationProjection.sync({
        force: true,
        reason: "notification-clear-sync"
      });
    },
    stop() {
      notificationProjection.stop();
    }
  };
}

function createNotificationDigest(items) {
  return JSON.stringify(
    (Array.isArray(items) ? items : []).map((item) => [
      String(item?.id || "").trim(),
      Number(item?.createdAt || 0) || 0,
      String(item?.href || "").trim()
    ])
  );
}

function createNormalizedEnvelope(envelope, fallbackValue, meta = {}) {
  if (envelope && typeof envelope === "object" && "value" in envelope) {
    return envelope;
  }
  const value = envelope && typeof envelope === "object" && !Array.isArray(envelope)
    ? envelope
    : fallbackValue ?? { items: [] };
  return {
    value,
    status: Array.isArray(value?.items) ? "ready" : "idle",
    digest: createNotificationDigest(value?.items || []),
    updatedAt: Date.now(),
    meta: {
      ...meta
    }
  };
}
