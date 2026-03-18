function defaultReadStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function defaultWriteStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return;
  }
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
  readStorage = defaultReadStorage,
  writeStorage = defaultWriteStorage
} = {}) {
  let items = [];
  let loading = false;

  function emit() {
    onChange({ items: items.slice(), loading });
  }

  function dismissedKey(pubkey) {
    return `${storageNamespace}.notifications.dismissed.${pubkey}`;
  }

  function dismissedIds(pubkey = getViewerPubkey()) {
    if (!pubkey) return new Set();
    try {
      const raw = readStorage(dismissedKey(pubkey));
      const parsed = raw ? JSON.parse(raw) : [];
      return new Set(
        (Array.isArray(parsed) ? parsed : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      );
    } catch {
      return new Set();
    }
  }

  function persistDismissed(pubkey, ids) {
    if (!pubkey) return;
    writeStorage(dismissedKey(pubkey), JSON.stringify([...ids]));
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
        const dismissed = dismissedIds(viewerPubkey);
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
      const dismissed = dismissedIds(viewerPubkey);
      dismissed.add(clean);
      persistDismissed(viewerPubkey, dismissed);
      items = items.filter((item) => String(item?.id || "").trim() !== clean);
      emit();
    },
    clear() {
      const viewerPubkey = getViewerPubkey();
      if (!viewerPubkey || !items.length) return;
      const dismissed = dismissedIds(viewerPubkey);
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
