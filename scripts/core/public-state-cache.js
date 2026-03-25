export function publicStateSnapshotStorageKey(storageNamespace = "") {
  const prefix = String(storageNamespace || "nostr-site").trim();
  return `${prefix}.public-state-snapshot`;
}

export function publicEventCacheStorageKey(storageNamespace = "") {
  const prefix = String(storageNamespace || "nostr-site").trim();
  return `${prefix}.public-event-cache`;
}

export function sanitizeStoredPublicStateSnapshot(rawValue) {
  return sanitizeStoredJson(rawValue, sanitizeSnapshotPayload);
}

export function sanitizeStoredPublicEventCache(rawValue) {
  return sanitizeStoredJson(rawValue, sanitizeEventCachePayload);
}

export function repairPublicStateCacheStorage(storage, storageNamespace = "") {
  const snapshotKey = publicStateSnapshotStorageKey(storageNamespace);
  const eventCacheKey = publicEventCacheStorageKey(storageNamespace);
  const result = {
    repairedSnapshot: false,
    repairedEventCache: false,
    removedSnapshot: false,
    removedEventCache: false
  };
  const target = normalizeStorage(storage);
  if (!target) return result;

  const snapshotOutcome = rewriteStoredValue(target, snapshotKey, sanitizeStoredPublicStateSnapshot);
  result.repairedSnapshot = snapshotOutcome.repaired;
  result.removedSnapshot = snapshotOutcome.removed;

  const eventCacheOutcome = rewriteStoredValue(target, eventCacheKey, sanitizeStoredPublicEventCache);
  result.repairedEventCache = eventCacheOutcome.repaired;
  result.removedEventCache = eventCacheOutcome.removed;

  return result;
}

export function clearPublicStateCacheStorage(storage, storageNamespace = "") {
  const target = normalizeStorage(storage);
  if (!target) {
    return {
      clearedSnapshot: false,
      clearedEventCache: false
    };
  }
  const snapshotKey = publicStateSnapshotStorageKey(storageNamespace);
  const eventCacheKey = publicEventCacheStorageKey(storageNamespace);
  const clearedSnapshot = removeStoredKey(target, snapshotKey);
  const clearedEventCache = removeStoredKey(target, eventCacheKey);
  return {
    clearedSnapshot,
    clearedEventCache
  };
}

export function isRecoverablePublicStateCacheError(error) {
  const message = String(error?.message || error || "").trim().toLowerCase();
  if (!message) return false;
  return (
    message.includes("created_at") ||
    message.includes("cannot read properties of undefined") ||
    message.includes("can't access property") ||
    message.includes("unexpected end of json input")
  );
}

function rewriteStoredValue(storage, key, sanitizer) {
  const current = safeStorageGet(storage, key);
  if (current == null) {
    return {
      repaired: false,
      removed: false
    };
  }
  const outcome = sanitizer(current);
  if (!outcome.valid) {
    return {
      repaired: false,
      removed: removeStoredKey(storage, key)
    };
  }
  if (outcome.nextValue !== current) {
    safeStorageSet(storage, key, outcome.nextValue);
    return {
      repaired: true,
      removed: false
    };
  }
  return {
    repaired: false,
    removed: false
  };
}

function sanitizeStoredJson(rawValue, sanitizer) {
  const rawText = String(rawValue ?? "");
  try {
    const parsed = JSON.parse(rawText);
    const sanitized = sanitizer(parsed);
    return {
      valid: true,
      nextValue: JSON.stringify(sanitized)
    };
  } catch {
    return {
      valid: false,
      nextValue: null
    };
  }
}

function sanitizeSnapshotPayload(value) {
  return sanitizeValue(value, { parentKey: "" });
}

function sanitizeEventCachePayload(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => sanitizeStoredEvent(item))
    .filter(Boolean);
}

function sanitizeValue(value, { parentKey = "" } = {}) {
  if (Array.isArray(value)) {
    return sanitizeArrayValue(value, parentKey);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (value.__nostrSiteType === "Map" && Array.isArray(value.entries)) {
    const entries = value.entries
      .map((entry) => {
        if (!Array.isArray(entry) || entry.length !== 2) return null;
        return [
          sanitizeValue(entry[0], { parentKey: "" }),
          sanitizeValue(entry[1], { parentKey: "" })
        ];
      })
      .filter(Boolean);
    return {
      __nostrSiteType: "Map",
      entries
    };
  }
  const nextValue = {};
  for (const [key, entryValue] of Object.entries(value)) {
    const sanitizedEntry = sanitizeValue(entryValue, { parentKey: key });
    if (typeof sanitizedEntry === "undefined") continue;
    nextValue[key] = sanitizedEntry;
  }
  return nextValue;
}

function sanitizeArrayValue(values, parentKey) {
  const sanitized = [];
  for (const entry of values) {
    if (parentKey === "rawEvents") {
      const nextEvent = sanitizeStoredEvent(entry);
      if (!nextEvent) continue;
      sanitized.push(nextEvent);
      continue;
    }
    if (parentKey === "entries") {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      sanitized.push([
        sanitizeValue(entry[0], { parentKey: "" }),
        sanitizeValue(entry[1], { parentKey: "" })
      ]);
      continue;
    }
    if (entry == null) continue;
    const nextEntry = sanitizeValue(entry, { parentKey: "" });
    if (typeof nextEntry === "undefined") continue;
    sanitized.push(nextEntry);
  }
  return sanitized;
}

function sanitizeStoredEvent(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").trim();
  const pubkey = String(value.pubkey || "").trim().toLowerCase();
  const sig = String(value.sig || "").trim();
  const kind = Number(value.kind);
  const createdAt = Number(value.created_at);
  if (!id || !pubkey || !sig) return null;
  if (!Number.isFinite(kind) || !Number.isFinite(createdAt)) return null;
  return {
    id,
    pubkey,
    sig,
    kind: Math.floor(kind),
    created_at: Math.floor(createdAt),
    content: String(value.content || ""),
    tags: Array.isArray(value.tags)
      ? value.tags
        .filter(Array.isArray)
        .map((tag) => tag.map((item) => String(item || "")))
      : []
  };
}

function normalizeStorage(storage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.removeItem !== "function") {
    return null;
  }
  return storage;
}

function safeStorageGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStoredKey(storage, key) {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
