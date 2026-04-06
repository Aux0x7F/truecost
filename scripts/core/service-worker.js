const LOCAL_DEVELOPMENT_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalDevelopmentHost(hostname = "") {
  const normalized = String(hostname || "").trim().toLowerCase();
  return LOCAL_DEVELOPMENT_HOSTS.has(normalized) || normalized.endsWith(".localhost");
}

export async function cleanupLocalSiteServiceWorker({
  serviceWorker = globalThis.navigator?.serviceWorker,
  cachesApi = globalThis.caches,
  cachePrefix = "truecost-"
} = {}) {
  const registrations = await serviceWorker?.getRegistrations?.().catch(() => []) || [];
  await Promise.all(
    registrations.map((registration) => registration?.unregister?.().catch(() => false))
  );

  const cacheKeys = await cachesApi?.keys?.().catch(() => []) || [];
  const matchingCacheKeys = cacheKeys.filter((key) => String(key || "").startsWith(cachePrefix));
  await Promise.all(
    matchingCacheKeys.map((key) => cachesApi.delete(key).catch(() => false))
  );

  return {
    unregistered: registrations.length,
    clearedCaches: matchingCacheKeys.length
  };
}

export function registerSiteServiceWorker({
  scriptUrl = "./service-worker.js",
  scope = "./",
  cachePrefix = "truecost-"
} = {}) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;

  const isLocalDevelopment = isLocalDevelopmentHost(window.location.hostname);
  if (!window.isSecureContext && !isLocalDevelopment) {
    return null;
  }

  if (isLocalDevelopment) {
    void cleanupLocalSiteServiceWorker({
      serviceWorker: navigator.serviceWorker,
      cachesApi: window.caches,
      cachePrefix
    });
    return null;
  }

  return window.addEventListener("load", () => {
    void navigator.serviceWorker.register(scriptUrl, { scope }).catch(() => null);
  }, { once: true });
}

export default registerSiteServiceWorker;
