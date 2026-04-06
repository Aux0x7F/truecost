import SITE from "./site-config.js";

const LOCAL_DEVELOPMENT_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const MOCK_ADMIN_STORAGE_KEY = `${SITE.nostr.storageNamespace}.mock-admin-ui`;
const MOCK_ADMIN_EVENT = "truecost:mock-admin-changed";
const MOCK_ADMIN_SECRET_KEY_HEX = "1111111111111111111111111111111111111111111111111111111111111111";
const MOCK_ADMIN_PUBKEY = "4f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa";

let helpersInstalled = false;

export function isLocalDevelopmentHost(hostname = "") {
  const normalized = String(hostname || "").trim().toLowerCase();
  return Boolean(
    normalized &&
      (LOCAL_DEVELOPMENT_HOSTS.has(normalized) || normalized.endsWith(".localhost"))
  );
}

export function isLocalMockAdminEnabled() {
  if (typeof window === "undefined") return false;
  if (!isLocalDevelopmentHost(window.location.hostname)) return false;
  try {
    return window.localStorage?.getItem?.(MOCK_ADMIN_STORAGE_KEY) === "yes";
  } catch {
    return false;
  }
}

export function getMockAdminSession() {
  return {
    username: "localadmin",
    secretKeyHex: MOCK_ADMIN_SECRET_KEY_HEX,
    pubkey: MOCK_ADMIN_PUBKEY,
    mockAdmin: true
  };
}

export function getMockAdminUser() {
  return {
    pubkey: MOCK_ADMIN_PUBKEY,
    username: "localadmin",
    claimedUsername: "localadmin",
    displayName: "Local Admin",
    isAdmin: true,
    socialLinks: [],
    bio: "",
    commentCount: 0,
    submissionCount: 0
  };
}

export function getMockAdminSessionIdentity() {
  const session = getMockAdminSession();
  return {
    session,
    sessionPubkey: session.pubkey,
    claimedUsername: session.username,
    currentPubkey: session.pubkey,
    canonicalPubkey: session.pubkey,
    removed: false,
    blocked: false,
    staleKey: false,
    usernameConflict: false,
    allowedActions: {
      profile: true,
      comments: true,
      submissions: true,
      admin: true,
      publish: false
    },
    mockAdmin: true
  };
}

export function mergeLocalAdminPublicState(publicState = null, {
  includeDemoContent = true
} = {}) {
  const baseState = publicState && typeof publicState === "object"
    ? structuredClone(publicState)
    : {};
  const mockUser = getMockAdminUser();
  const users = Array.isArray(baseState.users) ? [...baseState.users] : [];
  const existingIndex = users.findIndex(
    (user) => String(user?.pubkey || "").trim().toLowerCase() === MOCK_ADMIN_PUBKEY
  );
  if (existingIndex >= 0) {
    users[existingIndex] = {
      ...users[existingIndex],
      ...mockUser
    };
  } else {
    users.unshift(mockUser);
  }

  const approvedEntities = Array.isArray(baseState.approvedEntities)
    ? baseState.approvedEntities
    : [];
  const entities = Array.isArray(baseState.entities)
    ? baseState.entities
    : [];
  const seededEntities = includeDemoContent && !approvedEntities.length && !entities.length
    ? [createMockEntity()]
    : [];
  const nextApprovedEntities = approvedEntities.length ? approvedEntities : seededEntities;
  const nextEntities = entities.length ? entities : seededEntities;
  const drafts = Array.isArray(baseState.drafts) ? baseState.drafts : [];
  const allComments = Array.isArray(baseState.allComments) ? baseState.allComments : [];
  const comments = Array.isArray(baseState.comments) ? baseState.comments : [];
  const rawEvents = Array.isArray(baseState.rawEvents) && baseState.rawEvents.length
    ? baseState.rawEvents
    : [createMockEvent()];

  return {
    ...baseState,
    connected: false,
    admins: [...new Set([
      ...(Array.isArray(baseState.admins) ? baseState.admins : []),
      MOCK_ADMIN_PUBKEY
    ])],
    rootAdminPubkey: String(baseState.rootAdminPubkey || MOCK_ADMIN_PUBKEY).trim().toLowerCase(),
    users,
    entities: nextEntities,
    approvedEntities: nextApprovedEntities,
    drafts,
    allComments,
    comments,
    metrics: {
      ...(baseState.metrics && typeof baseState.metrics === "object" ? baseState.metrics : {}),
      userCount: users.length,
      adminCount: 1,
      entityCount: nextEntities.length,
      approvedEntityCount: nextApprovedEntities.length,
      draftCount: drafts.length,
      commentCount: comments.length,
      hiddenCommentCount: Math.max(0, allComments.length - comments.length)
    },
    rawEvents,
    syncInfo: {
      connected: false,
      remoteEventCount: 0,
      cachedEventCount: rawEvents.length,
      mergedEventCount: rawEvents.length
    },
    mockAdmin: true
  };
}

export function createMockWorkspaceSeed() {
  const publicState = mergeLocalAdminPublicState(null);
  return {
    session: getMockAdminSession(),
    sessionIdentity: getMockAdminSessionIdentity(),
    publicState,
    publishedPosts: createMockPublishedPosts(),
    staticSlugs: ["county-yard-payroll-trail", "north-valley-processing-campus"],
    inboxSubmissions: [],
    dashboardStatus: "Local mock admin mode is active. Privileged writes are disabled.",
    userDirectStatus: "Mock mode is UI-only.",
    mockMode: true,
    mockModeMessage: "Local mock admin mode is active. This is UI-only and privileged writes are disabled."
  };
}

export function createMockPublishedPosts() {
  return [
    {
      slug: "county-yard-payroll-trail",
      title: "County Yard payroll trail",
      summary: "Mock post for admin UI testing.",
      date: "2026-03-20",
      location: "Phoenix, Arizona",
      status: "published"
    },
    {
      slug: "north-valley-processing-campus",
      title: "North Valley Processing Campus",
      summary: "Second mock post for the posts rail.",
      date: "2026-03-18",
      location: "Phoenix, Arizona",
      status: "published"
    }
  ];
}

export function disableLocalMockAdmin({ reload = true } = {}) {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage?.removeItem?.(MOCK_ADMIN_STORAGE_KEY);
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent(MOCK_ADMIN_EVENT, { detail: { enabled: false } }));
  if (reload) window.location.reload();
  return true;
}

export function enableLocalMockAdmin({ reload = true } = {}) {
  if (typeof window === "undefined") return false;
  if (!isLocalDevelopmentHost(window.location.hostname)) return false;
  try {
    window.localStorage?.setItem?.(MOCK_ADMIN_STORAGE_KEY, "yes");
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent(MOCK_ADMIN_EVENT, { detail: { enabled: true } }));
  if (reload) window.location.reload();
  return true;
}

export function toggleLocalMockAdmin({ reload = true } = {}) {
  return isLocalMockAdminEnabled()
    ? disableLocalMockAdmin({ reload })
    : enableLocalMockAdmin({ reload });
}

export function installLocalDevelopmentHelpers() {
  if (helpersInstalled) return globalThis.__truecostDev || null;
  if (typeof window === "undefined") return null;
  if (!isLocalDevelopmentHost(window.location.hostname)) return null;
  helpersInstalled = true;

  const api = {
    enableMockAdmin: (options = {}) => enableLocalMockAdmin(options),
    disableMockAdmin: (options = {}) => disableLocalMockAdmin(options),
    toggleMockAdmin: (options = {}) => toggleLocalMockAdmin(options),
    status() {
      return {
        enabled: isLocalMockAdminEnabled(),
        session: getMockAdminSession(),
        sessionIdentity: getMockAdminSessionIdentity()
      };
    }
  };

  window.__truecostDev = api;
  window.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey && event.altKey && String(event.key || "").toLowerCase() === "a")) return;
    event.preventDefault();
    void toggleLocalMockAdmin({ reload: true });
  });
  return api;
}

function createMockEntity() {
  return {
    slug: "county-yard",
    name: "County Yard",
    location: "Phoenix, Arizona",
    status: "approved",
    type: "facility",
    lat: 33.4484,
    lng: -112.074,
    notes: "Mock facility for local admin UI testing."
  };
}

function createMockEvent() {
  return {
    id: "cached:mock-admin",
    pubkey: MOCK_ADMIN_PUBKEY,
    sig: "mock-admin",
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    content: "",
    tags: []
  };
}

export default installLocalDevelopmentHelpers;
