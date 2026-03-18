const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric"
});

export function formatDate(value) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

export function formatDateTime(unixSeconds) {
  if (!unixSeconds) return "";
  const date = new Date(Number(unixSeconds) * 1000);
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function formatLocalTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function sortDateValue(item) {
  const createdAt = Number(item?.created_at || 0);
  if (createdAt) return createdAt * 1000;
  const candidate = Date.parse(String(item?.date || item?.updated_at || item?.published_at || ""));
  return Number.isFinite(candidate) ? candidate : 0;
}

export function buildArticleMetaLine(post) {
  const location = String(post?.location || "").trim();
  const date = post?.date ? formatDate(post.date) : "";
  return [location, date].filter(Boolean).join(" • ");
}
