import { clearSession } from "../core/session.js";
import { getSiteRuntimeClient } from "../core/runtime-client.js";
import {
  clampNotificationsPanel,
  closeProfileMenu,
  keepProfileMenuOpen,
  toggleNotificationsPanel,
  toggleProfileMenu
} from "../core/navigation-state.js";
import { countNotificationItems } from "../core/notification-state.js";
import { safeAvatarUrl, safeUserSocialLinks } from "../core/profile-markup.js";
import { escapeAttribute, escapeHtml } from "../core/text-utils.js";
import { renderPublicUserProfileModal } from "../surfaces/profile-overlays.js";
import { profileInitials, renderNavigationMarkup } from "../surfaces/navigation.js";

export function createSiteShellFeature({
  site,
  state,
  navKeys,
  notificationState,
  viewerController,
  refreshAvatarFromCache,
  onSignedOut
} = {}) {
  function mount() {
    initExternalLinks();
    bindGlobalSiteInteractions();
    initNavigation();
  }

  function openUserProfileModal(pubkey) {
    const cleanPubkey = String(pubkey || "").trim().toLowerCase();
    if (!cleanPubkey) return;
    state.userProfileModalPubkey = cleanPubkey;
    renderGlobalOverlays();
  }

  function closeUserProfileModal() {
    state.userProfileModalPubkey = "";
    renderGlobalOverlays();
  }

  function closeProfileMenus() {
    closeProfileMenu(state.navigationUi);
    renderNavigation();
  }

  function renderNavigation() {
    if (state?.isSigningOut) return;
    const nav = document.querySelector("[data-site-nav]");
    if (!(nav instanceof HTMLElement)) return;
    hydrateNavigationUiFromDom(nav, state.navigationUi);
    const preservedFocus = captureNavigationFocus(nav);

    const page = document.body.dataset.page || "";
    const isLoggedIn = Boolean(state.session);
    const viewerPubkey = String(viewerController.resolvedSessionPubkey?.({ deriveWhenAvailable: true }) || viewerController.sessionPubkey() || "").trim();
    const currentUser = isLoggedIn && viewerPubkey
      ? state.publicState?.users?.find((user) => user.pubkey === viewerPubkey) || null
      : null;
    const isAdmin = Boolean(isLoggedIn && viewerController.canEdit(state.publicState));
    const notifications = isLoggedIn ? notificationState.items.slice(0, 8) : [];
    const unreadCount = isLoggedIn ? countNotificationItems(notifications) : 0;
    const notificationsExpanded = clampNotificationsPanel(state.navigationUi, {
      count: unreadCount,
      loading: notificationState.loading
    });
    const markup = renderNavigationMarkup({
      page,
      navKeys,
      isLoggedIn,
      isAdmin,
      currentUser,
      sessionUsername: state.session?.username || "",
      notifications,
      notificationsLoading: notificationState.loading,
      profileMenuOpen: state.navigationUi.profileMenuOpen,
      notificationsExpanded,
      openGroupKey: state.navigationUi.openGroupKey,
      deps: {
        countUnreadNotifications: countNotificationItems,
        escapeAttribute,
        escapeHtml,
        safeAvatarUrl
      }
    });
    if (nav.innerHTML !== markup) {
      nav.innerHTML = markup;
      restoreNavigationFocus(nav, preservedFocus);
    }
    renderGlobalOverlays();
  }

  function renderGlobalOverlays() {
    const root = ensureGlobalOverlayRoot();
    const user = state.userProfileModalPubkey
      ? (state.publicState?.users || []).find((item) => item.pubkey === state.userProfileModalPubkey) || null
      : null;
    root.innerHTML = renderPublicUserProfileModal(user, {
      escapeAttribute,
      escapeHtml,
      profileInitials,
      safeAvatarUrl,
      safeSocialLinks: safeUserSocialLinks,
      shortKey: (value) => String(value || "").trim().slice(0, 12)
    });
  }

  function initExternalLinks() {
    const donate = document.querySelector("[data-donate-link]");
    if (donate instanceof HTMLAnchorElement) donate.href = site.donateUrl;
    const merch = document.querySelector("[data-merch-link]");
    if (merch instanceof HTMLAnchorElement) merch.href = site.merchUrl;
    const youtube = document.querySelector("[data-youtube-link]");
    if (youtube instanceof HTMLAnchorElement) youtube.href = site.youtubeUrl;
    for (const link of document.querySelectorAll("[data-contact-email]")) {
      if (!(link instanceof HTMLAnchorElement)) continue;
      link.href = `mailto:${site.contactEmail}`;
      if (!link.textContent.trim()) link.textContent = site.contactEmail;
    }
  }

  function bindGlobalSiteInteractions() {
    document.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const userTrigger = target.closest("[data-open-user]");
      if (userTrigger instanceof HTMLElement) {
        event.preventDefault();
        openUserProfileModal(userTrigger.getAttribute("data-open-user") || "");
        return;
      }

      if (target.matches("[data-user-modal]") || target.closest("[data-close-user-modal]")) {
        event.preventDefault();
        closeUserProfileModal();
      }
    });

    document.addEventListener(
      "error",
      (event) => {
        const target = event.target;
        if (!(target instanceof HTMLImageElement) || !target.matches("[data-avatar-sha]")) return;
        if (target.dataset.refreshing === "yes") return;
        target.dataset.refreshing = "yes";
        void refreshAvatarFromCache(target);
      },
      true
    );
  }

  function initNavigation() {
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

    renderNavigation();

    if (toggle instanceof HTMLElement) {
      toggle.innerHTML = `
        <span class="nav-toggle__bars" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
        <span class="sr-only">Open navigation</span>
      `;
      toggle.addEventListener("click", () => {
        setNavigationOpen(!nav.classList.contains("is-open"));
      });
    }

    window.addEventListener("resize", () => {
      if (window.innerWidth > 980) setNavigationOpen(false);
    });

    document.addEventListener("click", (event) => {
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
          state.navigationUi.openGroupKey = next ? groupKey : "";
        }
        return;
      }

      if (target.closest("[data-profile-toggle]")) {
        toggleProfileMenu(state.navigationUi);
        renderNavigation();
        return;
      }

      if (target.closest("[data-notification-toggle]")) {
        event.preventDefault();
        toggleNotificationsPanel(state.navigationUi, {
          count: countNotificationItems(notificationState.items),
          loading: notificationState.loading
        });
        renderNavigation();
        return;
      }

      if (target.closest("[data-clear-notifications]")) {
        event.preventDefault();
        notificationState.clear();
        keepProfileMenuOpen(state.navigationUi);
        clampNotificationsPanel(state.navigationUi, { count: 0, loading: false });
        renderNavigation();
        return;
      }

      const notificationLink = target.closest("[data-notification-link]");
      if (notificationLink) {
        notificationState.dismiss(notificationLink.getAttribute("data-notification-link") || "");
        clampNotificationsPanel(state.navigationUi, {
          count: countNotificationItems(notificationState.items),
          loading: notificationState.loading
        });
        return;
      }

      if (target.closest("[data-signout]")) {
        event.preventDefault();
        if (state.isSigningOut) return;
        state.isSigningOut = true;
        void getSiteRuntimeClient()
          .then((runtimeClient) => runtimeClient.signOut())
          .catch(() => {
            clearSession();
          })
          .finally(() => {
            state.session = null;
            state.viewer = null;
            setNavigationOpen(false);
            onSignedOut?.();
            window.location.reload();
          });
        return;
      }

      for (const menu of document.querySelectorAll("[data-profile-menu].is-open")) {
        if (!menu.contains(target)) {
          closeProfileMenu(state.navigationUi);
          renderNavigation();
        }
      }
      for (const group of document.querySelectorAll("[data-nav-group].is-open")) {
        if (!group.contains(target)) {
          group.classList.remove("is-open");
          if (state.navigationUi.openGroupKey === String(group.getAttribute("data-nav-group-key") || "").trim()) {
            state.navigationUi.openGroupKey = "";
          }
        }
      }
    });
  }

  function ensureGlobalOverlayRoot() {
    let root = document.querySelector("[data-global-overlay-root]");
    if (root instanceof HTMLElement) return root;
    root = document.createElement("div");
    root.setAttribute("data-global-overlay-root", "");
    document.body.append(root);
    return root;
  }

  return {
    closeProfileMenus,
    closeUserProfileModal,
    mount,
    openUserProfileModal,
    renderNavigation,
    renderGlobalOverlays
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

function hydrateNavigationUiFromDom(nav, navigationUi) {
  if (!(nav instanceof HTMLElement) || !navigationUi || navigationUi.openGroupKey) return;
  const openGroup = nav.querySelector("[data-nav-group].is-open");
  if (!(openGroup instanceof HTMLElement)) return;
  navigationUi.openGroupKey = String(openGroup.getAttribute("data-nav-group-key") || "").trim();
}
