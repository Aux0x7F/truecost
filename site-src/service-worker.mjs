function escapeJsString(value = "") {
  return JSON.stringify(String(value));
}

export function renderServiceWorker({
  cacheVersion,
  precacheUrls = [],
  runtimeHtmlUrls = [],
  runtimeAssetPrefixes = [],
  runtimeContentPrefixes = []
} = {}) {
  const normalizedPrecacheUrls = Array.from(new Set(precacheUrls)).sort();
  const normalizedHtmlUrls = Array.from(new Set(runtimeHtmlUrls)).sort();
  const normalizedAssetPrefixes = Array.from(new Set(runtimeAssetPrefixes)).sort();
  const normalizedContentPrefixes = Array.from(new Set(runtimeContentPrefixes)).sort();

  return `const CACHE_VERSION = ${escapeJsString(cacheVersion)};
const PRECACHE = \`truecost-precache-\${CACHE_VERSION}\`;
const RUNTIME = \`truecost-runtime-\${CACHE_VERSION}\`;
const PRECACHE_URLS = ${JSON.stringify(normalizedPrecacheUrls)};
const RUNTIME_HTML_URLS = ${JSON.stringify(normalizedHtmlUrls)};
const RUNTIME_ASSET_PREFIXES = ${JSON.stringify(normalizedAssetPrefixes)};
const RUNTIME_CONTENT_PREFIXES = ${JSON.stringify(normalizedContentPrefixes)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("truecost-") && key !== PRECACHE && key !== RUNTIME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function shouldHandle(requestUrl) {
  if (requestUrl.origin !== self.location.origin) return false;
  const path = requestUrl.pathname || "/";
  return (
    RUNTIME_HTML_URLS.some((entry) => path.endsWith(entry.replace(/^\\.\\//, "/"))) ||
    RUNTIME_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix.replace(/^\\.\\//, "/"))) ||
    RUNTIME_CONTENT_PREFIXES.some((prefix) => path.startsWith(prefix.replace(/^\\.\\//, "/")))
  );
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    void fetch(request).then((response) => {
      if (response && response.ok) {
        caches.open(RUNTIME).then((cache) => cache.put(request, response.clone()));
      }
    }).catch(() => null);
    return cached;
  }

  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(RUNTIME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const requestUrl = new URL(request.url);
  if (!shouldHandle(requestUrl)) return;
  event.respondWith(cacheFirst(request));
});
`;
}

export default renderServiceWorker;
