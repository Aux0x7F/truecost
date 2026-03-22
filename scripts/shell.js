import SITE from "./core/site-config.js";
import NAV_KEYS from "./core/nav-keys.js";
import { createImmediateSiteShell } from "./core/immediate-site-shell.js";
import { getSiteRuntimeClient } from "./core/runtime-client.js";
import { registerSiteServiceWorker } from "./core/service-worker.js";
import { createSiteAuthModalFeature } from "./features/site-auth-modal.js";
import { renderNavigationMarkup } from "./surfaces/navigation.js";

const GLOBAL_SHELL_KEY = "__truecostImmediateShell";
const GLOBAL_AUTH_KEY = "__truecostSiteAuthModal";

function mountImmediateShell() {
  window[GLOBAL_SHELL_KEY]?.destroy?.();
  window[GLOBAL_AUTH_KEY]?.destroy?.();
  const shell = createImmediateSiteShell({
    site: SITE,
    navKeys: NAV_KEYS,
    renderNavigationMarkup,
    sessionChangedEventName: "truecost:session-changed"
  });
  const authModal = createSiteAuthModalFeature({
    sessionChangedEventName: "truecost:session-changed"
  });
  window[GLOBAL_SHELL_KEY] = shell;
  window[GLOBAL_AUTH_KEY] = authModal;
  shell.mount();
  authModal.mount();
  void getSiteRuntimeClient().catch(() => null);
  registerSiteServiceWorker();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountImmediateShell, { once: true });
} else {
  mountImmediateShell();
}
