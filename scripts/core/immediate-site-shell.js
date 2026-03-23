import { publicStateHasAdminPubkey } from "./public-state.js";
import { clearSession, getStoredSession } from "./session.js";
import { getCachedSiteRuntimeProjection, getSiteRuntimeClient } from "./runtime-client.js";
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
  sessionChangedEventName = "truecost:session-changed"
} = {}) {
  const navigationUi = createNavigationUiState();
  const rootAdminPubkey = String(site?.nostr?.rootAdminPubkey || "").trim().toLowerCase();
  let bindings = null;
  let signingOut = false;

  function currentSession() {
    return getStoredSession();
  }

  function currentPublicState() {
    return getCachedSiteRuntimeProjection("publicState", {})?.value || null;
  }

  function renderNavigation() {
    if (signingOut) return;
    const nav = document.querySelector("[data-site-nav]");
    if (!(nav instanceof HTMLElement)) return;
    const preservedFocus = captureNavigationFocus(nav);
    const session = currentSession();
    const sessionPubkey = String(session?.pubkey || "").trim().toLowerCase();
    const publicState = currentPublicState();
    const currentUser = sessionPubkey
      ? (publicState?.users || []).find((user) => String(user?.pubkey || "").trim().toLowerCase() === sessionPubkey) || null
      : null;
    const markup = renderNavigationMarkup({
      page: document.body.dataset.page || "",
      navKeys,
      isLoggedIn: Boolean(session),
      isAdmin: Boolean(
        sessionPubkey &&
          (publicStateHasAdminPubkey(publicState, sessionPubkey) ||
            (rootAdminPubkey && sessionPubkey === rootAdminPubkey))
      ),
      currentUser,
      sessionUsername: session?.username || "",
      notifications: [],
      notificationsLoading: false,
      profileMenuOpen: navigationUi.profileMenuOpen,
      notificationsExpanded: navigationUi.notificationsExpanded,
      openGroupKey: navigationUi.openGroupKey,
      deps: {
        countUnreadNotifications: () => 0,
        escapeAttribute,
        escapeHtml,
        safeAvatarUrl
      }
    });
    if (nav.innerHTML !== markup) {
      nav.innerHTML = markup;
      restoreNavigationFocus(nav, preservedFocus);
    }
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
            const groupKey = String(group.getAttribute("data-nav-group-key") || "").trim();
            const next = !group.classList.contains("is-open");
            for (const openGroup of document.querySelectorAll("[data-nav-group].is-open")) {
              if (openGroup !== group) openGroup.classList.remove("is-open");
            }
            group.classList.toggle("is-open", next);
            navigationUi.openGroupKey = next ? groupKey : "";
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
          if (signingOut) return;
          signingOut = true;
          void getSiteRuntimeClient()
            .then((runtimeClient) => runtimeClient.signOut())
            .catch(() => {
              clearSession();
            })
            .finally(() => {
              closeProfileMenu(navigationUi);
              window.location.reload();
            });
          return;
        }

        for (const menu of document.querySelectorAll("[data-profile-menu].is-open")) {
          if (!menu.contains(target)) {
            closeProfileMenu(navigationUi);
            renderNavigation();
          }
        }

        for (const group of document.querySelectorAll("[data-nav-group].is-open")) {
          if (!group.contains(target)) {
            group.classList.remove("is-open");
            if (navigationUi.openGroupKey === String(group.getAttribute("data-nav-group-key") || "").trim()) {
              navigationUi.openGroupKey = "";
            }
          }
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

function captureNavigationFocus(nav) {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !nav.contains(active)) return null;
  if (active.matches("[data-submenu-toggle]")) {
    const group = active.closest("[data-nav-group]");
    return {
      type: "submenu-toggle",
      groupKey: String(group?.getAttribute("data-nav-group-key") || "").trim()
    };
  }
  if (active.matches("[data-profile-toggle]")) return { type: "profile-toggle" };
  if (active.matches("[data-notification-toggle]")) return { type: "notification-toggle" };
  return null;
}

function restoreNavigationFocus(nav, preservedFocus) {
  if (!preservedFocus?.type) return;
  let nextFocus = null;
  if (preservedFocus.type === "submenu-toggle" && preservedFocus.groupKey) {
    nextFocus = nav.querySelector(
      `[data-nav-group-key="${CSS.escape(preservedFocus.groupKey)}"] [data-submenu-toggle]`
    );
  } else if (preservedFocus.type === "profile-toggle") {
    nextFocus = nav.querySelector("[data-profile-toggle]");
  } else if (preservedFocus.type === "notification-toggle") {
    nextFocus = nav.querySelector("[data-notification-toggle]");
  }
  if (nextFocus instanceof HTMLElement) {
    nextFocus.focus({ preventScroll: true });
  }
}

export default createImmediateSiteShell;
