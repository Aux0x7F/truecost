import { escapeAttribute, escapeHtml } from "./text-utils.js";
import { sanitizeUrl } from "./nostr.js";

export function safeAvatarUrl(value) {
  return sanitizeUrl(value, "src");
}

export function safeUserSocialLinks(user) {
  return (Array.isArray(user?.socialLinks) ? user.socialLinks : [])
    .map((link) => sanitizeUrl(link, "href"))
    .filter(Boolean);
}

export function renderAvatarBadge(user, fallbackLabel, className, profileInitials) {
  const label = user?.displayName || user?.username || fallbackLabel || "Profile";
  const avatarUrl = safeAvatarUrl(user?.avatarUrl || "");
  if (avatarUrl) {
    const blob = user.avatarBlob;
    const blobAttrs = blob?.sha256
      ? ` data-avatar-sha="${escapeAttribute(blob.sha256)}" data-avatar-url="${escapeAttribute(blob.url || avatarUrl)}" data-avatar-type="${escapeAttribute(blob.type || "")}" data-avatar-name="${escapeAttribute(blob.name || "")}"`
      : "";
    return `<span class="${className} ${className}--image"><img src="${escapeAttribute(avatarUrl)}" alt="${escapeAttribute(label)}"${blobAttrs}></span>`;
  }
  return `<span class="${className}">${escapeHtml(profileInitials(label))}</span>`;
}
