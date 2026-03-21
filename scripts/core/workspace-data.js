export function firstEventTag(event, key) {
  const hit = (event?.tags || []).find((tag) => Array.isArray(tag) && tag[0] === key);
  return hit ? String(hit[1] || "") : "";
}

export function normalizeDirectPubkey(value) {
  const clean = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(clean) ? clean : "";
}

export function findLocalUserCandidate(value, { users = [], normalizeUsername } = {}) {
  const raw = String(value || "").trim();
  const username = typeof normalizeUsername === "function" ? normalizeUsername(raw) : raw.toLowerCase();
  const pubkey = normalizeDirectPubkey(raw);
  const lowered = raw.toLowerCase();
  return (Array.isArray(users) ? users : []).find((user) =>
    (pubkey && user.pubkey === pubkey) ||
    (username && typeof normalizeUsername === "function" && normalizeUsername(user.username) === username) ||
    (username && typeof normalizeUsername === "function" && normalizeUsername(user.claimedUsername) === username) ||
    lowered === String(user.displayName || "").trim().toLowerCase()
  ) || null;
}

export function filterVisibleWorkspaceUsers({
  publicState,
  query = "",
  karmaBucket = "",
  role = "",
  resolveWorkspaceUserKarma = () => 0,
  karmaBucketMatches = () => true
} = {}) {
  const cleanQuery = String(query || "").trim().toLowerCase();
  const cleanKarmaBucket = String(karmaBucket || "").trim().toLowerCase();
  const cleanRole = String(role || "active").trim().toLowerCase();
  const isRemovedUser = (user) => {
    if (!user) return false;
    if (user.removed) return true;
    return String(user?.moderation?.action || "").trim().toLowerCase() === "removed";
  };
  const allUsers = Array.isArray(publicState?.users) ? publicState.users : [];
  const activeUsers = allUsers.filter((user) => !isRemovedUser(user));
  const removedUsers = [
    ...(Array.isArray(publicState?.removedUsers) ? publicState.removedUsers : []).map((user) => ({
      ...user,
      removed: true,
      isAdmin: false
    })),
    ...allUsers.filter((user) => isRemovedUser(user)).map((user) => ({
      ...user,
      removed: true
    }))
  ].filter((user, index, values) =>
    values.findIndex((candidate) => String(candidate?.pubkey || "").trim().toLowerCase() === String(user?.pubkey || "").trim().toLowerCase()) === index
  );
  const sourceUsers = cleanRole === "removed" ? removedUsers : activeUsers;
  return sourceUsers.filter((user) => {
    if (cleanRole === "admin" && (!user.isAdmin || isRemovedUser(user))) return false;
    if (cleanRole === "active" && isRemovedUser(user)) return false;
    if (cleanRole === "removed" && !isRemovedUser(user)) return false;
    const visible =
      user.isAdmin ||
      isRemovedUser(user) ||
      user.submissionCount > 0 ||
      user.commentCount > 0 ||
      user.moderation ||
      user.username ||
      user.claimedUsername ||
      user.usernameConflict ||
      String(user.bio || "").trim() ||
      (Array.isArray(user.socialLinks) && user.socialLinks.length) ||
      user.avatarUrl ||
      user.avatarBlob;
    if (!visible || !karmaBucketMatches(resolveWorkspaceUserKarma(user.pubkey), cleanKarmaBucket)) return false;
    if (!cleanQuery) return true;
    const haystacks = [user.displayName, user.username, user.claimedUsername, user.bio, user.pubkey]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    return haystacks.some((value) => value.includes(cleanQuery));
  });
}

export function buildWorkspaceUserStats({
  users = [],
  allComments = [],
  rawEvents = [],
  commentVoteKind,
  resolveWorkspaceUserKarma = () => 0,
  karmaBucketForScore = () => ""
} = {}) {
  const activePubkeys = new Set();
  for (const comment of Array.isArray(allComments) ? allComments : []) {
    if (comment?.author) activePubkeys.add(String(comment.author).trim().toLowerCase());
  }
  for (const event of Array.isArray(rawEvents) ? rawEvents : []) {
    if (Number(event?.kind) === Number(commentVoteKind) && event?.pubkey) {
      activePubkeys.add(String(event.pubkey).trim().toLowerCase());
    }
  }
  const karmaBuckets = {
    lt0: 0,
    "0-5": 0,
    "6-50": 0,
    "51-500": 0,
    gt500: 0
  };
  for (const user of Array.isArray(users) ? users : []) {
    const bucket = karmaBucketForScore(resolveWorkspaceUserKarma(user.pubkey));
    if (bucket) karmaBuckets[bucket] += 1;
  }
  return {
    total: users.length,
    active: users.filter((user) => activePubkeys.has(String(user.pubkey || "").trim().toLowerCase())).length,
    karmaBuckets
  };
}

export function filterVisibleWorkspaceEntities({
  publicState,
  filters = {},
  resolveWorkspaceUser = () => null
} = {}) {
  const query = String(filters.query || "").trim().toLowerCase();
  const status = String(filters.status || "").trim().toLowerCase();
  const location = String(filters.location || "").trim().toLowerCase();
  const authorQuery = String(filters.author || "").trim().toLowerCase();
  return (publicState?.entities || []).filter((entity) => {
    if (status && String(entity?.status || "").trim().toLowerCase() !== status) return false;
    if (query) {
      const haystack = [entity?.name, entity?.slug, entity?.type, ...(Array.isArray(entity?.aliases) ? entity.aliases : [])]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean);
      if (!haystack.some((value) => value.includes(query))) return false;
    }
    if (location) {
      const locationValue = String(entity?.location || "").trim().toLowerCase();
      if (!locationValue.includes(location)) return false;
    }
    if (authorQuery) {
      const author = resolveWorkspaceUser(entity?.author || "");
      const authorValues = [author?.displayName, author?.username, entity?.author]
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean);
      if (!authorValues.some((value) => value.includes(authorQuery))) return false;
    }
    return true;
  });
}

export function deriveSubmissionReviewState({
  item,
  rawEvents = [],
  viewerPubkey = "",
  submissionStatusKind,
  safeJson = () => null
} = {}) {
  const submissionId = String(item?.id || "").trim();
  const statusEvents = (Array.isArray(rawEvents) ? rawEvents : [])
    .filter((event) => Number(event?.kind) === Number(submissionStatusKind))
    .filter((event) => firstEventTag(event, "d") === submissionId)
    .sort((left, right) => {
      const leftTime = Number(left?.created_at || 0);
      const rightTime = Number(right?.created_at || 0);
      if (leftTime !== rightTime) return leftTime - rightTime;
      return String(left?.id || "").localeCompare(String(right?.id || ""));
    });
  const confirmedBy = new Set();
  const viewedBy = new Set();
  let deleted = false;
  for (const event of statusEvents) {
    const payload = safeJson(event.content);
    const status = String(payload?.status || "").trim().toLowerCase();
    const author = String(event?.pubkey || "").trim().toLowerCase();
    if (!status || !author) continue;
    if (status === "confirmed") confirmedBy.add(author);
    if (status === "unconfirmed") confirmedBy.delete(author);
    if (status === "viewed") viewedBy.add(author);
    if (status === "unviewed") viewedBy.delete(author);
    if (status === "deleted") deleted = true;
  }
  const cleanViewerPubkey = String(viewerPubkey || "").trim().toLowerCase();
  return {
    confirmedBy,
    viewedBy,
    deleted,
    confirmCount: confirmedBy.size,
    viewedCount: viewedBy.size,
    viewerConfirmed: cleanViewerPubkey ? confirmedBy.has(cleanViewerPubkey) : false,
    viewerViewed: cleanViewerPubkey ? viewedBy.has(cleanViewerPubkey) : false
  };
}

export function parseSubmissionFilterTokens(value) {
  return String(value || "")
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

export function applySubmissionFilterSuggestion(rawValue, token) {
  const parts = String(rawValue || "").split(",");
  if (!parts.length) return `${token}, `;
  parts[parts.length - 1] = ` ${token}`;
  return `${parts.map((part) => part.trim()).filter(Boolean).join(", ")}, `;
}

export function buildSubmissionFilterSuggestions({
  query = "",
  items = [],
  resolveWorkspaceUser = () => null,
  resolveEntityDisplayValue = (value) => String(value || "")
} = {}) {
  const segment = String(query || "").split(",").pop()?.trim().toLowerCase() || "";
  if (!segment) return [];
  const suggestionPool = [
    "status:confirmed",
    "status:unconfirmed",
    "status:viewed",
    "status:unviewed",
    ...buildSubmissionFilterValues("user", items, (item) => {
      const author = resolveWorkspaceUser(item.author);
      return [author?.username, author?.displayName];
    }),
    ...buildSubmissionFilterValues("type", items, (item) => {
      const attachment = item.latest?.payload?.attachment || {};
      return [attachment.type, String(attachment.name || "").split(".").pop()];
    }),
    ...buildSubmissionFilterValues("location", items, (item) => [item.latest?.payload?.location]),
    ...buildSubmissionFilterValues("entity", items, (item) => [
      ...(Array.isArray(item.latest?.payload?.entity_refs) ? item.latest.payload.entity_refs.map(resolveEntityDisplayValue) : []),
      item.latest?.payload?.suggested_entity?.name
    ])
  ];
  const deduped = [...new Set(suggestionPool.map((value) => String(value || "").trim()).filter(Boolean))];
  return deduped.filter((value) => !segment || value.toLowerCase().includes(segment)).slice(0, 8);
}

export function filterInboxSubmissions({
  items = [],
  query = "",
  rawEvents = [],
  viewerPubkey = "",
  submissionStatusKind,
  safeJson = () => null,
  resolveWorkspaceUser = () => null,
  resolveEntityDisplayValue = (value) => String(value || "")
} = {}) {
  const tokens = parseSubmissionFilterTokens(query);
  const base = (Array.isArray(items) ? items : []).filter(
    (item) => !deriveSubmissionReviewState({ item, rawEvents, viewerPubkey, submissionStatusKind, safeJson }).deleted
  );
  if (!tokens.length) return base;
  return base.filter((item) => {
    const latest = item.latest?.payload || {};
    const reviewState = deriveSubmissionReviewState({
      item,
      rawEvents,
      viewerPubkey,
      submissionStatusKind,
      safeJson
    });
    const author = resolveWorkspaceUser(item.author);
    const entityValues = [
      ...(Array.isArray(latest.entity_refs) ? latest.entity_refs.map(resolveEntityDisplayValue) : []),
      latest.suggested_entity?.name,
      latest.suggested_entity?.location
    ]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    const attachmentType = [
      String(latest.attachment?.type || "").trim().toLowerCase(),
      String(latest.attachment?.name || "").trim().toLowerCase().split(".").pop()
    ].filter(Boolean);
    const authorValues = [author?.displayName, author?.username]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    const textHaystack = [latest.subject, latest.details, latest.location, ...entityValues, ...authorValues, ...attachmentType]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean);
    return tokens.every((token) => submissionTokenMatches(token, reviewState, textHaystack, attachmentType, authorValues, entityValues, latest));
  });
}

export function buildEntityLocationFilterValues(entities = [], dedupeStrings = (values) => values) {
  return dedupeStrings(
    (Array.isArray(entities) ? entities : []).flatMap((entity) => {
      const raw = String(entity?.location || "").trim();
      if (!raw) return [];
      const parts = raw.split(",").map((value) => value.trim()).filter(Boolean);
      if (!parts.length) return [];
      if (parts.length === 1) return parts;
      return parts.filter((value, index) => index > 0 || /county/i.test(value));
    })
  )
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function buildSubmissionFilterValues(prefix, items, project) {
  return (Array.isArray(items) ? items : []).flatMap((item) =>
    (Array.isArray(project(item)) ? project(item) : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map((value) => `${prefix}:${value}`)
  );
}

function submissionTokenMatches(token, reviewState, textHaystack, attachmentType, authorValues, entityValues, latest) {
  const [rawKey, ...rawValueParts] = token.split(":");
  const key = rawValueParts.length ? rawKey.trim() : "";
  const value = rawValueParts.join(":").trim();
  if (key === "status") {
    if (value === "confirmed") return reviewState.confirmCount > 0;
    if (value === "unconfirmed") return reviewState.confirmCount === 0;
    if (value === "viewed") return reviewState.viewedCount > 0;
    if (value === "unviewed") return reviewState.viewedCount === 0;
  }
  if (key === "type") return attachmentType.some((entry) => entry.includes(value));
  if (key === "user") return authorValues.some((entry) => entry.includes(value));
  if (key === "location") return String(latest.location || "").trim().toLowerCase().includes(value);
  if (key === "entity") return entityValues.some((entry) => entry.includes(value));
  return textHaystack.some((entry) => entry.includes(token));
}
