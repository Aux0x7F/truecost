export function registerSiteServiceWorker({
  scriptUrl = "./service-worker.js",
  scope = "./"
} = {}) {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  if (!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
    return null;
  }
  return window.addEventListener("load", () => {
    void navigator.serviceWorker.register(scriptUrl, { scope }).catch(() => null);
  }, { once: true });
}

export default registerSiteServiceWorker;
