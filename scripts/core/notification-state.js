import {
  loadSiteRuntimeValue,
  rememberSiteRuntimeValue
} from "./runtime-local-state.js";

async function defaultLoadDismissedIds(pubkey, { dismissedParams, loadDismissedProjection } = {}) {
  if (!pubkey || typeof dismissedParams !== "function" || typeof loadDismissedProjection !== "function") return [];
  try {
    const stored = await loadDismissedProjection("notificationDismissedIds", dismissedParams(pubkey), {
      reason: "notification-dismissed-load",
      preferFresh: false
    });
    return Array.isArray(stored)
      ? stored.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

async function defaultSaveDismissedIds(pubkey, ids, { dismissedParams, rememberDismissedProjection } = {}) {
  if (!pubkey || typeof dismissedParams !== "function" || typeof rememberDismissedProjection !== "function") return;
  await rememberDismissedProjection(
    "notificationDismissedIds",
    dismissedParams(pubkey),
    [...ids],
    { source: "notification-dismissed-ids" }
  );
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
  buildNotifications = async () => [],
  loadDismissedProjection = loadSiteRuntimeValue,
  rememberDismissedProjection = rememberSiteRuntimeValue,
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
    async hydrate({ publicState = null, force = false } = {}) {
      const session = getSession();
      const viewerPubkey = getViewerPubkey();
      if (!session || !viewerPubkey) {
        items = [];
        loading = false;
        emit();
        return items;
      }
      loading = true;
      emit();
      try {
        const source = publicState ?? (await getPublicState(force));
        const next = await buildNotifications({ publicState: source, force, viewerPubkey });
        const dismissed = await ensureDismissedIds(viewerPubkey);
        items = dedupeNotificationItems(next)
          .filter((item) => !dismissed.has(String(item?.id || "").trim()))
          .slice(0, 12);
      } catch {
        items = [];
      } finally {
        loading = false;
        emit();
      }
      return items;
    },
    dismiss(id) {
      const viewerPubkey = getViewerPubkey();
      const clean = String(id || "").trim();
      if (!viewerPubkey || !clean) return;
      const dismissed = currentDismissedIds(viewerPubkey);
      dismissed.add(clean);
      persistDismissed(viewerPubkey, dismissed);
      items = items.filter((item) => String(item?.id || "").trim() !== clean);
      emit();
    },
    clear() {
      const viewerPubkey = getViewerPubkey();
      if (!viewerPubkey || !items.length) return;
      const dismissed = currentDismissedIds(viewerPubkey);
      for (const item of items) {
        const clean = String(item?.id || "").trim();
        if (clean) dismissed.add(clean);
      }
      persistDismissed(viewerPubkey, dismissed);
      items = [];
      emit();
    }
  };
}
