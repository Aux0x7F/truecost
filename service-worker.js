const CACHE_VERSION = "20260321062557";
const PRECACHE = `truecost-precache-${CACHE_VERSION}`;
const RUNTIME = `truecost-runtime-${CACHE_VERSION}`;
const PRECACHE_URLS = ["./about.html","./admin.html","./content/graph/wiki-seed.json","./content/investigations/index.json","./content/pages/guide.md","./editor.html","./favicon.svg","./get-involved.html","./graph.html","./guide.html","./index.html","./investigation.html","./investigations.html","./map.html","./merch.html","./scripts/admin.js","./scripts/app.js","./scripts/editor.js","./scripts/shell.js","./scripts/submit.js","./styles.css","./styles/fonts/IBM-Plex-Mono-OFL.txt","./styles/fonts/IBM-Plex-Sans-OFL.txt","./styles/fonts/README.md","./styles/fonts/Spectral-OFL.txt","./styles/fonts/ibm-plex-mono-400-latin.woff2","./styles/fonts/ibm-plex-mono-500-latin.woff2","./styles/fonts/ibm-plex-mono-600-latin.woff2","./styles/fonts/ibm-plex-sans-latin.woff2","./styles/fonts/spectral-500-latin.woff2","./styles/fonts/spectral-600-latin.woff2","./styles/fonts/spectral-700-latin.woff2","./submit.html","./vendor/easymde.min.css","./vendor/easymde.min.js","./vendor/event-tools-shim.js","./vendor/event-tools.bundle.js","./vendor/leaflet.css","./vendor/leaflet.js","./vendor/marked.min.js","./vendor/nostr-site-support.esm.js","./vendor/nostr-site-support.iife.js","./vendor/toastui-editor-all.min.js","./vendor/toastui-editor.min.css","./wiki.html"];
const RUNTIME_HTML_URLS = ["./about.html","./admin.html","./editor.html","./get-involved.html","./graph.html","./guide.html","./index.html","./investigation.html","./investigations.html","./map.html","./merch.html","./submit.html","./wiki.html"];
const RUNTIME_ASSET_PREFIXES = ["./favicon.svg","./scripts/","./styles/","./vendor/"];
const RUNTIME_CONTENT_PREFIXES = ["./content/"];

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
    RUNTIME_HTML_URLS.some((entry) => path.endsWith(entry.replace(/^\.\//, "/"))) ||
    RUNTIME_ASSET_PREFIXES.some((prefix) => path.startsWith(prefix.replace(/^\.\//, "/"))) ||
    RUNTIME_CONTENT_PREFIXES.some((prefix) => path.startsWith(prefix.replace(/^\.\//, "/")))
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
