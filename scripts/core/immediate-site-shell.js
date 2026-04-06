import { getCachedPublicState } from "./nostr.js";
import { publicStateHasAdminPubkey } from "./public-state.js";
import { clearSession, getStoredSession } from "./session.js";
import {
  disableLocalMockAdmin,
  getMockAdminSession,
  isLocalMockAdminEnabled,
  mergeLocalAdminPublicState
} from "./dev-local-admin.js";
import {
  closeProfileMenu,
  createNavigationUiState,
  toggleNotificationsPanel,
  toggleProfileMenu
} from "./navigation-state.js";

function escapeAttribute(value) {
  return String(value ?? "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeAvatarUrl(value) {
  return value;
}

export function createImmediateSiteShell({
  site,
  navKeys,
  renderNavigationMarkup,
  sessionChangedEventName = "truecost:session-changed",
  deps = {}
} = {}) {
  const runtime = {
    clearSession,
    getCachedPublicState,
    getStoredSession,
    publicStateHasAdminPubkey,
    ...deps
  };
  const navigationUi = createNavigationUiState();
  let bindings = null;

  function currentSession() {
    return runtime.getStoredSession();
  }

  function cachedPublicState() {
    try {
      return runtime.getCachedPublicState?.() || null;
    } catch {
      return null;
    }
  }

  function renderNavigation() {
    const nav = document.querySelector("[data-site-nav]");
    if (!(nav instanceof HTMLElement)) return;
    const mockAdminEnabled = isLocalMockAdminEnabled();
    const session = mockAdminEnabled ? getMockAdminSession() : currentSession();
    const sessionPubkey = String(session?.pubkey || "").trim().toLowerCase();
    const publicState = mockAdminEnabled ? mergeLocalAdminPublicState(cachedPublicState()) : cachedPublicState();
    const currentUser = sessionPubkey
      ? (publicState?.users || []).find((user) => String(user?.pubkey || "").trim().toLowerCase() === sessionPubkey) || null
      : null;
    nav.innerHTML = renderNavigationMarkup({
      page: document.body.dataset.page || "",
      navKeys,
      isLoggedIn: Boolean(session),
      isAdmin: Boolean(sessionPubkey && runtime.publicStateHasAdminPubkey(publicState, sessionPubkey)),
      currentUser,
      sessionUsername: session?.username || "",
      notifications: [],
      notificationsLoading: false,
      profileMenuOpen: navigationUi.profileMenuOpen,
      notificationsExpanded: navigationUi.notificationsExpanded,
      deps: {
        countUnreadNotifications: () => 0,
        escapeAttribute,
        escapeHtml,
        safeAvatarUrl
      }
    });
  }

  function mount() {
    if (bindings) return;
    renderNavigation();

    bindings = new AbortController();
    const { signal } = bindings;

    const toggle = document.querySelector("[data-nav-toggle]");
    const nav = document.querySelector("[data-site-nav]");
    if (!(nav instanceof HTMLElement)) return;

    const setNavigationOpen = (open) => {
      nav.classList.toggle("is-open", open);
      document.body.classList.toggle("is-nav-open", open);
      if (toggle instanceof HTMLElement) {
        toggle.classList.toggle("is-open", open);
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
        toggle.setAttribute("title", open ? "Close navigation" : "Open navigation");
      }
    };

    if (toggle instanceof HTMLElement) {
      toggle.innerHTML = `
        <span class="nav-toggle__bars" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
        <span class="sr-only">Open navigation</span>
      `;
      toggle.addEventListener(
        "click",
        () => setNavigationOpen(!nav.classList.contains("is-open")),
        { signal }
      );
    }

    document.addEventListener(
      "click",
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;

        const submenuToggle = target.closest("[data-submenu-toggle]");
        if (submenuToggle) {
          const group = submenuToggle.closest("[data-nav-group]");
          if (group) {
            const next = !group.classList.contains("is-open");
            for (const openGroup of document.querySelectorAll("[data-nav-group].is-open")) {
              if (openGroup !== group) openGroup.classList.remove("is-open");
            }
            group.classList.toggle("is-open", next);
          }
          return;
        }

        if (target.closest("[data-profile-toggle]")) {
          toggleProfileMenu(navigationUi);
          renderNavigation();
          return;
        }

        if (target.closest("[data-notification-toggle]")) {
          event.preventDefault();
          toggleNotificationsPanel(navigationUi, { count: 0, loading: false });
          renderNavigation();
          return;
        }

      if (target.closest("[data-signout]")) {
        event.preventDefault();
        if (isLocalMockAdminEnabled()) {
          disableLocalMockAdmin({ reload: true });
          return;
        }
        runtime.clearSession();
        closeProfileMenu(navigationUi);
          renderNavigation();
          window.dispatchEvent(new CustomEvent(sessionChangedEventName));
          window.location.reload();
          return;
        }

        for (const menu of document.querySelectorAll("[data-profile-menu].is-open")) {
          if (!menu.contains(target)) {
            closeProfileMenu(navigationUi);
            renderNavigation();
          }
        }

        for (const group of document.querySelectorAll("[data-nav-group].is-open")) {
          if (!group.contains(target)) group.classList.remove("is-open");
        }
      },
      { signal }
    );

    window.addEventListener(
      "resize",
      () => {
        if (window.innerWidth > 980) setNavigationOpen(false);
      },
      { signal }
    );

    window.addEventListener(
      sessionChangedEventName,
      () => {
        closeProfileMenu(navigationUi);
        renderNavigation();
      },
      { signal }
    );
  }

  function destroy() {
    if (!bindings) return;
    bindings.abort();
    bindings = null;
  }

  return {
    destroy,
    mount,
    renderNavigation
  };
}

export default createImmediateSiteShell;
