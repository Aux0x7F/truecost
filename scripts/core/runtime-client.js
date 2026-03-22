import SITE from "./site-config.js";
import {
  createSharedRuntimeClient
} from "../../vendor/nostr-site-support.esm.js";
import { getCachedPublicState, hydrateCachedPublicState } from "./nostr.js";
import { clearSession, getStoredSession, resolveStoredSession, saveSession } from "./session.js";
import { createSiteRuntimeHost } from "./site-runtime-host.js";

let runtimeClientPromise = null;
let runtimeClientRef = null;
const cachedProjectionEnvelopes = new Map();
const RUNTIME_PUBLIC_STATE_BOOTSTRAP_KEY = `${SITE.nostr.storageNamespace}.runtime-public-state-bootstrap`;
const RUNTIME_GLOBAL_PROJECTION_BOOTSTRAP_KEY = `${SITE.nostr.storageNamespace}.runtime-global-projection-bootstrap`;

export function getCachedSiteRuntimeProjection(channel = "", params = {}) {
  return cachedProjectionEnvelopes.get(projectionCacheKey(channel, params)) ||
    readBootstrapProjection(channel, params);
}

export function rememberCachedSiteRuntimeProjection(channel = "", params = {}, envelope = null) {
  return rememberCachedProjection(channel, params, envelope);
}

export function clearCachedSiteRuntimeProjection(channel = "", params = {}) {
  cachedProjectionEnvelopes.delete(projectionCacheKey(channel, params));
  clearBootstrapProjection(channel, params);
}

export function clearCachedSiteRuntimeChannel(channel = "") {
  const prefix = `${String(channel || "").trim()}:`;
  for (const key of [...cachedProjectionEnvelopes.keys()]) {
    if (key.startsWith(prefix)) {
      cachedProjectionEnvelopes.delete(key);
    }
  }
  clearBootstrapChannel(prefix);
}

export function createSiteRuntimeClient({
  workerUrl = "./site-runtime-worker.js",
  workerName = `${SITE.nostr.appTag}-runtime`,
  seedSession = null,
  hostFactory = null,
  sharedWorkerFactory = null,
  onSessionChanged = null
} = {}) {
  const resolvedHostFactory = typeof hostFactory === "function"
    ? hostFactory
    : () => createSiteRuntimeHost();
  const resolvedSharedWorkerFactory = typeof sharedWorkerFactory === "function"
    ? sharedWorkerFactory
    : () => {
        if (globalThis.__TRUECOST_DISABLE_SHARED_WORKER__) return null;
        if (typeof SharedWorker === "function" && workerUrl) {
          return new SharedWorker(workerUrl, { name: workerName });
        }
        return null;
      };
  const client = createSharedRuntimeClient({
    workerUrl,
    workerName,
    seedSession,
    seedProjections: async () => {
      await hydrateCachedPublicState().catch(() => null);
      const cachedPublicState = getCachedPublicState();
      if (cachedPublicState) {
        rememberCachedProjection("publicState", {}, {
          value: cachedPublicState,
          status: "ready",
          digest: JSON.stringify(cachedPublicState),
          updatedAt: Date.now(),
          meta: { source: "cached-public-state" }
        });
      }
      return cachedPublicState
        ? [{
            channel: "publicState",
            params: {},
            value: cachedPublicState,
            meta: { source: "cached-public-state" }
          }]
        : [];
    },
    hostFactory: resolvedHostFactory,
    sharedWorkerFactory: resolvedSharedWorkerFactory,
    persistSession: saveSession,
    clearPersistedSession: clearSession,
    onSessionChanged
  });
  return wrapRuntimeClient(client);
}

export async function getSiteRuntimeClient() {
  if (!runtimeClientPromise) {
    runtimeClientPromise = (async () => {
      const stored = await resolveStoredSession({
        persistSession: true
      }).catch(() => getStoredSession());
      runtimeClientRef = createSiteRuntimeClient({
        seedSession: stored,
        onSessionChanged: (session) => {
          window.dispatchEvent(
            new CustomEvent("truecost:session-changed", {
              detail: {
                session
              }
            })
          );
        }
      });
      if (stored) {
        await runtimeClientRef.seedSession(stored, { force: false }).catch(() => null);
      }
      return runtimeClientRef;
    })();
  }
  return runtimeClientPromise;
}

export default getSiteRuntimeClient;

function wrapRuntimeClient(client) {
  return {
    ...client,
    async getProjection(channel = "", params = {}, options = {}) {
      return rememberCachedProjection(channel, params, await client.getProjection(channel, params, options));
    },
    async refreshProjection(channel = "", params = {}, options = {}) {
      return rememberCachedProjection(channel, params, await client.refreshProjection(channel, params, options));
    },
    async rememberProjection(channel = "", params = {}, value = null, meta = {}) {
      return rememberCachedProjection(channel, params, await client.rememberProjection(channel, params, value, meta));
    },
    subscribeProjection(channel = "", params = {}, listener = () => {}, options = {}) {
      return client.subscribeProjection(channel, params, (envelope, meta = {}) => {
        const cachedEnvelope = rememberCachedProjection(channel, params, envelope);
        listener(cachedEnvelope, meta);
      }, options);
    },
    getCachedProjection(channel = "", params = {}) {
      return cachedProjectionEnvelopes.get(projectionCacheKey(channel, params)) || null;
    }
  };
}

function rememberCachedProjection(channel = "", params = {}, envelope = null) {
  const normalized = normalizeProjectionEnvelope(envelope);
  cachedProjectionEnvelopes.set(projectionCacheKey(channel, params), normalized);
  writeBootstrapProjection(channel, params, normalized);
  return normalized;
}

function projectionCacheKey(channel = "", params = {}) {
  return `${String(channel || "").trim()}:${JSON.stringify(params && typeof params === "object" ? params : {})}`;
}

function normalizeProjectionEnvelope(envelope = null) {
  if (envelope && typeof envelope === "object" && "value" in envelope && ("status" in envelope || "digest" in envelope || "updatedAt" in envelope)) {
    const updatedAt = Number(envelope.updatedAt || envelope.meta?.updatedAt || Date.now()) || Date.now();
    return {
      value: envelope.value ?? null,
      status: String(envelope.status || (envelope.value ? "ready" : "idle")),
      digest: String(envelope.digest || JSON.stringify(envelope.value ?? null)),
      updatedAt,
      meta: {
        ...(envelope.meta && typeof envelope.meta === "object" ? envelope.meta : {}),
        updatedAt
      }
    };
  }
  const updatedAt = Date.now();
  return {
    value: envelope ?? null,
    status: envelope ? "ready" : "idle",
    digest: JSON.stringify(envelope ?? null),
    updatedAt,
    meta: { updatedAt }
  };
}

function readBootstrapProjection(channel = "", params = {}) {
  if (isBootstrapProjectionTarget(channel, params)) {
    try {
      const raw = globalThis.localStorage?.getItem?.(RUNTIME_PUBLIC_STATE_BOOTSTRAP_KEY) || "";
      if (!raw) return null;
      return normalizeProjectionEnvelope(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (!isGlobalBootstrapProjectionTarget(params)) return null;
  try {
    const raw = globalThis.localStorage?.getItem?.(RUNTIME_GLOBAL_PROJECTION_BOOTSTRAP_KEY) || "";
    if (!raw) return null;
    const entries = JSON.parse(raw);
    return normalizeProjectionEnvelope(entries?.[projectionCacheKey(channel, params)] || null);
  } catch {
    return null;
  }
}

function writeBootstrapProjection(channel = "", params = {}, envelope = null) {
  if (isBootstrapProjectionTarget(channel, params)) {
    try {
      const storage = globalThis.localStorage;
      if (!storage?.setItem) return;
      if (!envelope?.value) {
        storage.removeItem?.(RUNTIME_PUBLIC_STATE_BOOTSTRAP_KEY);
        return;
      }
      storage.setItem(
        RUNTIME_PUBLIC_STATE_BOOTSTRAP_KEY,
        JSON.stringify(createBootstrapProjectionEnvelope(envelope))
      );
    } catch {
      return;
    }
    return;
  }
  if (!isGlobalBootstrapProjectionTarget(params)) return;
  try {
    const storage = globalThis.localStorage;
    if (!storage?.setItem) return;
    const key = projectionCacheKey(channel, params);
    const nextEntries = readGlobalBootstrapEntries();
    if (envelope?.value === null || typeof envelope?.value === "undefined") {
      delete nextEntries[key];
    } else {
      nextEntries[key] = createGenericBootstrapProjectionEnvelope(envelope);
    }
    if (!Object.keys(nextEntries).length) {
      storage.removeItem?.(RUNTIME_GLOBAL_PROJECTION_BOOTSTRAP_KEY);
      return;
    }
    storage.setItem(
      RUNTIME_GLOBAL_PROJECTION_BOOTSTRAP_KEY,
      JSON.stringify(nextEntries)
    );
  } catch {
    return;
  }
}

function isBootstrapProjectionTarget(channel = "", params = {}) {
  return String(channel || "").trim() === "publicState" &&
    JSON.stringify(params && typeof params === "object" ? params : {}) === "{}";
}

function isGlobalBootstrapProjectionTarget(params = {}) {
  return String(params?.__projectionScope || "").trim().toLowerCase() === "global";
}

function clearBootstrapProjection(channel = "", params = {}) {
  if (isBootstrapProjectionTarget(channel, params)) {
    try {
      globalThis.localStorage?.removeItem?.(RUNTIME_PUBLIC_STATE_BOOTSTRAP_KEY);
    } catch {
      return;
    }
    return;
  }
  if (!isGlobalBootstrapProjectionTarget(params)) return;
  try {
    const storage = globalThis.localStorage;
    if (!storage?.setItem) return;
    const key = projectionCacheKey(channel, params);
    const nextEntries = readGlobalBootstrapEntries();
    delete nextEntries[key];
    if (!Object.keys(nextEntries).length) {
      storage.removeItem?.(RUNTIME_GLOBAL_PROJECTION_BOOTSTRAP_KEY);
      return;
    }
    storage.setItem(
      RUNTIME_GLOBAL_PROJECTION_BOOTSTRAP_KEY,
      JSON.stringify(nextEntries)
    );
  } catch {
    return;
  }
}

function clearBootstrapChannel(prefix = "") {
  if (!prefix) return;
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    if ("publicState:{}".startsWith(prefix)) {
      storage.removeItem?.(RUNTIME_PUBLIC_STATE_BOOTSTRAP_KEY);
    }
    const nextEntries = readGlobalBootstrapEntries();
    let changed = false;
    for (const key of Object.keys(nextEntries)) {
      if (!key.startsWith(prefix)) continue;
      delete nextEntries[key];
      changed = true;
    }
    if (!changed) return;
    if (!Object.keys(nextEntries).length) {
      storage.removeItem?.(RUNTIME_GLOBAL_PROJECTION_BOOTSTRAP_KEY);
      return;
    }
    storage.setItem(
      RUNTIME_GLOBAL_PROJECTION_BOOTSTRAP_KEY,
      JSON.stringify(nextEntries)
    );
  } catch {
    return;
  }
}

function createBootstrapProjectionEnvelope(envelope = null) {
  const normalized = normalizeProjectionEnvelope(envelope);
  const value = normalized?.value && typeof normalized.value === "object"
    ? {
        admins: Array.isArray(normalized.value.admins) ? [...normalized.value.admins] : [],
        rootAdminPubkey: String(normalized.value.rootAdminPubkey || "").trim(),
        users: Array.isArray(normalized.value.users)
          ? normalized.value.users.map((user) => ({
              pubkey: String(user?.pubkey || "").trim(),
              username: String(user?.username || "").trim(),
              displayName: String(user?.displayName || "").trim(),
              avatarUrl: String(user?.avatarUrl || "").trim()
            }))
          : []
      }
    : null;
  return {
    value,
    status: normalized.status,
    digest: normalized.digest,
    updatedAt: normalized.updatedAt,
    meta: {
      ...(normalized.meta && typeof normalized.meta === "object" ? normalized.meta : {}),
      source: "runtime-bootstrap"
    }
  };
}

function createGenericBootstrapProjectionEnvelope(envelope = null) {
  const normalized = normalizeProjectionEnvelope(envelope);
  return {
    value: normalized.value ?? null,
    status: normalized.status,
    digest: normalized.digest,
    updatedAt: normalized.updatedAt,
    meta: {
      ...(normalized.meta && typeof normalized.meta === "object" ? normalized.meta : {}),
      source: "runtime-bootstrap"
    }
  };
}

function readGlobalBootstrapEntries() {
  try {
    const raw = globalThis.localStorage?.getItem?.(RUNTIME_GLOBAL_PROJECTION_BOOTSTRAP_KEY) || "";
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
