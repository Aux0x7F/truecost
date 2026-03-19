import { escapeAttribute, escapeHtml } from "./text-utils.js";
import { sanitizeUrl } from "./nostr.js";

export function profileInitials(value) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Me";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}

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
