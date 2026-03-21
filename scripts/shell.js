import SITE from "./core/site-config.js";
import NAV_KEYS from "./core/nav-keys.js";
import { createImmediateSiteShell } from "./core/immediate-site-shell.js";
import { renderNavigationMarkup } from "./surfaces/navigation.js";

const GLOBAL_SHELL_KEY = "__truecostImmediateShell";

function mountImmediateShell() {
  window[GLOBAL_SHELL_KEY]?.destroy?.();
  const shell = createImmediateSiteShell({
    site: SITE,
    navKeys: NAV_KEYS,
    renderNavigationMarkup,
    sessionChangedEventName: "truecost:session-changed"
  });
  window[GLOBAL_SHELL_KEY] = shell;
  shell.mount();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountImmediateShell, { once: true });
} else {
  mountImmediateShell();
}
