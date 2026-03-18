export function renderPublicUserProfileModal(user, deps = {}) {
  if (!user) return "";
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const profileInitials = deps.profileInitials || ((value) => String(value || "").slice(0, 2).toUpperCase());
  const safeAvatarUrl = deps.safeAvatarUrl || ((value) => value);
  const safeSocialLinks = deps.safeSocialLinks || (() => []);
  const displayName = user.displayName || user.username || deps.shortKey?.(user.pubkey) || "Profile";
  const avatarUrl = safeAvatarUrl(user.avatarUrl || "");
  const socialLinks = safeSocialLinks(user);
  return `
    <div class="modal-backdrop" data-user-modal>
      <section class="modal-card user-profile-modal">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Profile</div>
            <h2>${escapeHtml(displayName)}</h2>
          </div>
          <button class="button-ghost" type="button" data-close-user-modal>Close</button>
        </div>
        <div class="user-profile-modal__hero">
          <div class="user-profile-modal__avatar-wrap">
            ${
              avatarUrl
                ? `<span class="user-profile-modal__avatar user-profile-modal__avatar--image"><img src="${escapeAttribute(avatarUrl)}" alt="${escapeAttribute(displayName)}"></span>`
                : `<span class="user-profile-modal__avatar">${escapeHtml(profileInitials(displayName))}</span>`
            }
          </div>
          <div class="user-profile-modal__copy">
            ${user.username ? `<strong>@${escapeHtml(user.username)}</strong>` : ""}
            <p>${escapeHtml(user.bio || "No bio added yet.")}</p>
          </div>
        </div>
        ${
          socialLinks.length
            ? `<div class="user-profile-modal__links">${socialLinks.map((link) => `<a class="text-link" href="${escapeAttribute(link)}" target="_blank" rel="noreferrer">${escapeHtml(link)}</a>`).join("")}</div>`
            : ""
        }
      </section>
    </div>
  `;
}
