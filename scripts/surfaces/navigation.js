export function navLinkClass(page, navKeys, key, disabled = false) {
  const parts = ["nav-link"];
  if (navKeys[key]?.includes(page)) parts.push("is-current");
  if (disabled) parts.push("is-disabled");
  return parts.join(" ");
}

export function profileInitials(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Me";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}

export function profileBadgeMarkup(user, sessionUsername, deps = {}) {
  const safeAvatarUrl = deps.safeAvatarUrl || ((value) => value);
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const avatarUrl = safeAvatarUrl(user?.avatarUrl || "");
  if (avatarUrl) {
    const label = user?.displayName || user?.username || "Profile";
    const blob = user?.avatarBlob;
    const blobAttrs = blob?.sha256
      ? ` data-avatar-sha="${escapeAttribute(blob.sha256)}" data-avatar-url="${escapeAttribute(blob.url || avatarUrl)}" data-avatar-type="${escapeAttribute(blob.type || "")}" data-avatar-name="${escapeAttribute(blob.name || "")}"`
      : "";
    return `<img src="${escapeAttribute(avatarUrl)}" alt="${escapeAttribute(label)}"${blobAttrs}>`;
  }
  if (!sessionUsername) return "Create/Login";
  return escapeHtml(profileInitials(user?.displayName || sessionUsername));
}

export function renderNotificationItem(item, deps = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  return `
    <a class="profile-menu__notice-item" href="${escapeAttribute(item.href)}" data-notification-link="${escapeAttribute(item.id)}">
      <span class="profile-menu__notice-label">${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail || "")}</span>
    </a>
  `;
}

export function renderNavigationMarkup({
  page = "",
  navKeys = {},
  isLoggedIn = false,
  isAdmin = false,
  currentUser = null,
  sessionUsername = "",
  notifications = [],
  notificationsLoading = false,
  profileMenuOpen = false,
  notificationsExpanded = false,
  mapEnabled = true,
  deps = {}
} = {}) {
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const countUnreadNotifications = deps.countUnreadNotifications || ((items) => Array.isArray(items) ? items.length : 0);
  const safeAvatarUrl = deps.safeAvatarUrl || ((value) => value);
  const unreadCount = isLoggedIn ? countUnreadNotifications(notifications) : 0;
  const expanded = unreadCount || notificationsLoading ? notificationsExpanded : false;
  const profileMarkup = isLoggedIn
    ? `
      <div class="profile-menu ${navKeys.workspace?.includes(page) ? "is-current" : ""} ${profileMenuOpen ? "is-open" : ""}" data-profile-menu>
        <button class="profile-menu__toggle ${safeAvatarUrl(currentUser?.avatarUrl || "") ? "has-avatar" : ""}" type="button" data-profile-toggle aria-label="${isAdmin ? "Admin" : "Profile"}">
          <span class="profile-menu__badge ${safeAvatarUrl(currentUser?.avatarUrl || "") ? "has-avatar" : ""}">${profileBadgeMarkup(currentUser, sessionUsername, deps)}</span>
          ${unreadCount ? `<span class="profile-menu__notice">${Math.min(unreadCount, 9)}${unreadCount > 9 ? "+" : ""}</span>` : ""}
        </button>
        <div class="profile-menu__panel">
          <div class="profile-menu__section">
            <button class="profile-menu__notification-toggle ${expanded ? "is-open" : ""}" type="button" data-notification-toggle>
              <span class="profile-menu__notification-toggle-copy">
                <strong>Notifications</strong>
                <span>${
                  notificationsLoading
                    ? "Looking up updates"
                    : unreadCount
                      ? `${unreadCount} item${unreadCount === 1 ? "" : "s"} waiting`
                      : "No new updates"
                }</span>
              </span>
              ${unreadCount ? `<span class="profile-menu__inline-badge">${Math.min(unreadCount, 9)}${unreadCount > 9 ? "+" : ""}</span>` : `<span class="profile-menu__inline-badge is-muted">0</span>`}
            </button>
            ${
              expanded
                ? `
                  <div class="profile-menu__notification-shell">
                    ${
                      notificationsLoading
                        ? `<div class="loading-state" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span>Looking up notifications...</span></div>`
                        : notifications.length
                          ? `
                            <div class="profile-menu__notifications">
                              ${notifications.map((item) => renderNotificationItem(item, deps)).join("")}
                            </div>
                            <button class="profile-menu__clear" type="button" data-clear-notifications>Clear notifications</button>
                          `
                          : `<div class="profile-menu__notification-empty">No notifications right now.</div>`
                    }
                  </div>
                `
                : ""
            }
          </div>
          <a href="./admin.html?tab=${isAdmin ? "dashboard" : "profile"}">${isAdmin ? "Admin" : "Profile"}</a>
          <button type="button" data-signout>Sign out</button>
        </div>
      </div>
    `
    : `<a class="profile-cta" href="./admin.html?tab=login" aria-label="Create or log in">Create/Login</a>`;

  return `
    <a class="${navLinkClass(page, navKeys, "home")}" href="./index.html">Home</a>
    <div class="nav-group ${navKeys.explore?.includes(page) ? "is-current" : ""}" data-nav-group>
      <button class="nav-group__toggle" type="button" data-submenu-toggle>
        Explore
      </button>
      <div class="nav-group__panel">
        <a class="${navLinkClass(page, navKeys, "investigations")}" href="./investigations.html">Investigations</a>
        <a class="${navLinkClass(page, navKeys, "map", !mapEnabled && !navKeys.map?.includes(page))}" href="./map.html" ${!mapEnabled && !navKeys.map?.includes(page) ? 'aria-disabled="true"' : ""}>Map</a>
        <a class="${navLinkClass(page, navKeys, "graph")}" href="./graph.html">Graph</a>
        ${isAdmin ? `<a class="nav-link" href="./editor.html">Create Investigation</a>` : ""}
      </div>
    </div>
    <div class="nav-group ${navKeys["get-involved"]?.includes(page) ? "is-current" : ""}" data-nav-group>
      <button class="nav-group__toggle" type="button" data-submenu-toggle>
        Get Involved
      </button>
      <div class="nav-group__panel">
        <a class="${navLinkClass(page, navKeys, "get-involved")}" href="./get-involved.html">Get Involved</a>
        <a class="${navLinkClass(page, navKeys, "guide")}" href="./guide.html">Guide</a>
        <a class="${navLinkClass(page, navKeys, "submit")}" href="./submit.html">Submit</a>
      </div>
    </div>
    <a class="${navLinkClass(page, navKeys, "about")}" href="./about.html">About</a>
    <a class="${navLinkClass(page, navKeys, "merch")}" href="./merch.html">Merch</a>
    ${profileMarkup}
  `;
}
