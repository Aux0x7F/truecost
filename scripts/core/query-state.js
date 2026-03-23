export function createQueryState({
  getHref = () => window.location.href,
  getSearch = () => window.location.search,
  replaceUrl = (url) => history.replaceState({}, "", url),
  addPopstateListener = (listener) => window.addEventListener("popstate", listener),
  removePopstateListener = (listener) => window.removeEventListener("popstate", listener)
} = {}) {
  let snapshot = readQuerySnapshot(getSearch());
  const listeners = new Set();
  let bound = false;

  function ensureBound() {
    if (bound) return;
    bound = true;
    addPopstateListener(handlePopstate);
  }

  function handlePopstate() {
    refreshFromLocation();
  }

  function get(name, normalize = normalizeQueryValue) {
    const key = normalizeQueryName(name);
    if (!key) return "";
    return normalize(snapshot[key] || "");
  }

  function getSnapshot(normalizers = {}) {
    const next = {};
    const keys = new Set([...Object.keys(snapshot), ...Object.keys(normalizers || {})]);
    for (const key of keys) {
      next[key] = get(key, normalizers[key] || normalizeQueryValue);
    }
    return next;
  }

  function subscribe(keys, listener, { immediate = true, normalizers = {} } = {}) {
    ensureBound();
    const watchedKeys = normalizeWatchedKeys(keys);
    const entry = {
      watchedKeys,
      normalizers,
      listener,
      selection: buildSelection(snapshot, watchedKeys, normalizers)
    };
    listeners.add(entry);
    if (immediate) {
      listener({ ...entry.selection }, getSnapshot(normalizers));
    }
    return () => {
      listeners.delete(entry);
      if (!listeners.size && bound) {
        removePopstateListener(handlePopstate);
        bound = false;
      }
    };
  }

  function set(name, value, { normalize = normalizeQueryValue } = {}) {
    const key = normalizeQueryName(name);
    if (!key) return false;
    return update({ [key]: value }, { normalizers: { [key]: normalize } });
  }

  function update(values = {}, { normalizers = {} } = {}) {
    const url = new URL(getHref());
    let changed = false;
    for (const [name, rawValue] of Object.entries(values || {})) {
      const key = normalizeQueryName(name);
      if (!key) continue;
      const normalize = normalizers[key] || normalizeQueryValue;
      const nextValue = normalize(rawValue);
      const previousValue = normalize(url.searchParams.get(key) || "");
      if (nextValue) {
        if (previousValue !== nextValue) {
          url.searchParams.set(key, nextValue);
          changed = true;
        }
      } else if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    if (!changed) return false;
    replaceUrl(url);
    refreshFromLocation();
    return true;
  }

  function refreshFromLocation() {
    const nextSnapshot = readQuerySnapshot(getSearch());
    if (shallowEqual(snapshot, nextSnapshot)) return false;
    snapshot = nextSnapshot;
    notify();
    return true;
  }

  function notify() {
    for (const entry of listeners) {
      const nextSelection = buildSelection(snapshot, entry.watchedKeys, entry.normalizers);
      if (shallowEqual(entry.selection, nextSelection)) continue;
      entry.selection = nextSelection;
      entry.listener({ ...nextSelection }, getSnapshot(entry.normalizers));
    }
  }

  function destroy() {
    listeners.clear();
    if (bound) {
      removePopstateListener(handlePopstate);
      bound = false;
    }
  }

  return {
    destroy,
    get,
    getSnapshot,
    refreshFromLocation,
    set,
    subscribe,
    update
  };
}

export function normalizeQueryName(value) {
  return String(value || "").trim();
}

export function normalizeQueryValue(value) {
  return String(value || "").trim();
}

export function normalizeQuerySlug(value) {
  return normalizeQueryValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readQuerySnapshot(search = "") {
  const params = new URLSearchParams(search || "");
  const next = {};
  for (const [key, value] of params.entries()) {
    next[normalizeQueryName(key)] = String(value || "");
  }
  return next;
}

function normalizeWatchedKeys(keys) {
  if (Array.isArray(keys)) return keys.map(normalizeQueryName).filter(Boolean);
  const cleanKey = normalizeQueryName(keys);
  return cleanKey ? [cleanKey] : [];
}

function buildSelection(snapshot, keys, normalizers = {}) {
  const selection = {};
  for (const key of normalizeWatchedKeys(keys)) {
    const normalize = normalizers[key] || normalizeQueryValue;
    selection[key] = normalize(snapshot[key] || "");
  }
  return selection;
}

function shallowEqual(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}
