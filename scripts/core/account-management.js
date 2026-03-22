import {
  expandCanonicalIdentityPubkeys,
  identityPubkeyIsCurrent,
  resolveCanonicalIdentityPubkey,
  resolveCurrentIdentityPubkey
} from "./public-state.js";
import {
  clearCachedSiteRuntimeChannel,
  clearCachedSiteRuntimeValue,
  getCachedSiteRuntimeValue,
  loadSiteRuntimeValue,
  readCachedSiteRuntimeValue,
  rememberCachedSiteRuntimeValue,
  rememberSiteRuntimeValue
} from "./runtime-local-state.js";
const ACCOUNT_HISTORY_CHANNEL = "accountHistory";
const accountHistoryUsernames = new Set();
let accountHistoryGeneration = 0;

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePubkey(value) {
  return String(value || "").trim().toLowerCase();
}

function accountHistoryRuntimeParams(usernameOrSession = "") {
  const username = normalizeUsername(
    typeof usernameOrSession === "string" ? usernameOrSession : usernameOrSession?.username
  );
  return username ? { username, __projectionScope: "global" } : null;
}

function writeNormalizedAccountHistory(entry = null, usernameOrSession = "") {
  const normalized = normalizeAccountHistoryEntry(entry, usernameOrSession);
  if (!normalized.username) return null;
  accountHistoryUsernames.add(normalized.username);
  rememberCachedSiteRuntimeValue(ACCOUNT_HISTORY_CHANNEL, accountHistoryRuntimeParams(normalized.username), normalized);
  return normalized;
}

export function normalizeAccountHistoryEntry(entry = null, usernameOrSession = "") {
  const username = normalizeUsername(
    typeof usernameOrSession === "string" ? usernameOrSession : usernameOrSession?.username
  );
  const source = entry && typeof entry === "object" ? entry : {};
  const knownPubkeys = [...new Set((Array.isArray(source.knownPubkeys) ? source.knownPubkeys : []).map(normalizePubkey).filter(Boolean))];
  const currentPubkey = normalizePubkey(source.currentPubkey);
  return {
    username,
    currentPubkey,
    knownPubkeys,
    updatedAt: Number(source.updatedAt || 0) || 0
  };
}

export function rememberCurrentAccountHistoryEntry(entry = null, session = null) {
  const current = normalizeAccountHistoryEntry(entry, session);
  const username = normalizeUsername(session?.username);
  const pubkey = normalizePubkey(session?.pubkey);
  if (!username || !pubkey) return current;
  return {
    ...current,
    username,
    currentPubkey: pubkey,
    knownPubkeys: [...new Set([...(current.knownPubkeys || []), pubkey])],
    updatedAt: Date.now()
  };
}

export function rememberAccountRotationHistoryEntry(entry = null, previousSession = null, nextSession = null) {
  const current = normalizeAccountHistoryEntry(entry, nextSession || previousSession);
  const username = normalizeUsername(nextSession?.username || previousSession?.username);
  const previousPubkey = normalizePubkey(previousSession?.pubkey);
  const nextPubkey = normalizePubkey(nextSession?.pubkey);
  if (!username || !previousPubkey || !nextPubkey) return current;
  return {
    ...current,
    username,
    currentPubkey: nextPubkey,
    knownPubkeys: [...new Set([...(current.knownPubkeys || []), previousPubkey, nextPubkey])],
    updatedAt: Date.now()
  };
}

export function resetStoredAccountHistory() {
  accountHistoryGeneration += 1;
  clearCachedSiteRuntimeChannel(ACCOUNT_HISTORY_CHANNEL);
  for (const username of accountHistoryUsernames) {
    clearCachedSiteRuntimeValue(ACCOUNT_HISTORY_CHANNEL, accountHistoryRuntimeParams(username));
  }
  accountHistoryUsernames.clear();
  return null;
}

export function readStoredAccountHistory(usernameOrSession = "") {
  const username = normalizeUsername(
    typeof usernameOrSession === "string" ? usernameOrSession : usernameOrSession?.username
  );
  if (!username) return null;
  const params = accountHistoryRuntimeParams(username);
  if (!params) return null;
  return normalizeAccountHistoryEntry(readCachedSiteRuntimeValue(ACCOUNT_HISTORY_CHANNEL, params) || null, username);
}

export async function hydrateStoredAccountHistory(usernameOrSession = "", { preferFresh = false } = {}) {
  const params = accountHistoryRuntimeParams(usernameOrSession);
  if (!params) return null;
  const cachedEntry = await getCachedSiteRuntimeValue(ACCOUNT_HISTORY_CHANNEL, params);
  if (cachedEntry) {
    return writeNormalizedAccountHistory(cachedEntry, usernameOrSession);
  }
  if (!preferFresh && readStoredAccountHistory(usernameOrSession)) {
    return readStoredAccountHistory(usernameOrSession);
  }
  const loadedEntry = await loadSiteRuntimeValue(ACCOUNT_HISTORY_CHANNEL, params);
  if (!loadedEntry) return readStoredAccountHistory(usernameOrSession);
  return writeNormalizedAccountHistory(loadedEntry, usernameOrSession);
}

export function sessionMatchesStoredCurrentKey(session = null) {
  const history = readStoredAccountHistory(session);
  const sessionPubkey = normalizePubkey(session?.pubkey);
  return Boolean(history?.currentPubkey && sessionPubkey && history.currentPubkey === sessionPubkey);
}

export function storedAccountHistoryIncludesPubkey(usernameOrSession = "", pubkey = "") {
  const history = readStoredAccountHistory(usernameOrSession);
  const cleanPubkey = normalizePubkey(pubkey);
  return Boolean(cleanPubkey && history?.knownPubkeys?.includes(cleanPubkey));
}

function writeStoredAccountHistory(usernameOrSession, updater) {
  const username = normalizeUsername(
    typeof usernameOrSession === "string" ? usernameOrSession : usernameOrSession?.username
  );
  if (!username || typeof updater !== "function") return null;
  const current = readStoredAccountHistory(username) || {
    username,
    currentPubkey: "",
    knownPubkeys: [],
    updatedAt: 0
  };
  const next = updater(current);
  if (!next) return current;
  const normalized = {
    username,
    currentPubkey: normalizePubkey(next.currentPubkey),
    knownPubkeys: [...new Set((Array.isArray(next.knownPubkeys) ? next.knownPubkeys : []).map(normalizePubkey).filter(Boolean))],
    updatedAt: Date.now()
  };
  accountHistoryUsernames.add(username);
  rememberCachedSiteRuntimeValue(ACCOUNT_HISTORY_CHANNEL, accountHistoryRuntimeParams(username), normalized);
  return normalizeAccountHistoryEntry(normalized, username);
}

export function rememberCurrentAccountSession(session = null) {
  const username = normalizeUsername(session?.username);
  const pubkey = normalizePubkey(session?.pubkey);
  if (!username || !pubkey) return null;
  const next = writeStoredAccountHistory(username, (current) => rememberCurrentAccountHistoryEntry(current, session));
  if (next) {
    persistAccountHistoryProjection(username, next, "account-history-current");
  }
  return next;
}

export function rememberAccountRotation(previousSession = null, nextSession = null) {
  const username = normalizeUsername(nextSession?.username || previousSession?.username);
  const previousPubkey = normalizePubkey(previousSession?.pubkey);
  const nextPubkey = normalizePubkey(nextSession?.pubkey);
  if (!username || !previousPubkey || !nextPubkey) return null;
  const next = writeStoredAccountHistory(
    username,
    (current) => rememberAccountRotationHistoryEntry(current, previousSession, nextSession)
  );
  if (next) {
    persistAccountHistoryProjection(username, next, "account-history-rotation");
  }
  return next;
}

export function resolveStaleSessionFromHistory(session = null, accountHistory = null) {
  const username = normalizeUsername(session?.username);
  const pubkey = normalizePubkey(session?.pubkey);
  if (!username || !pubkey) return null;
  const history = accountHistory
    ? normalizeAccountHistoryEntry(accountHistory, username)
    : readStoredAccountHistory(username);
  if (!history?.currentPubkey || history.currentPubkey === pubkey) return null;
  if (!history.knownPubkeys.includes(pubkey)) return null;
  return {
    claimedUsername: username,
    sessionPubkey: pubkey,
    canonicalPubkey: history.knownPubkeys[0] || pubkey,
    currentPubkey: history.currentPubkey,
    identityMemberPubkeys: history.knownPubkeys
  };
}

export function resolveSessionIdentityState(publicState, session = null) {
  const claimedUsername = normalizeUsername(session?.username);
  const sessionPubkey = normalizePubkey(session?.pubkey);
  const canonicalPubkey = resolveCanonicalIdentityPubkey(publicState, sessionPubkey);
  const currentPubkey = resolveCurrentIdentityPubkey(publicState, sessionPubkey);
  const identityMemberPubkeys = expandCanonicalIdentityPubkeys(publicState, sessionPubkey);
  const hasIdentity = Boolean(sessionPubkey);
  const isCurrentKey = hasIdentity ? identityPubkeyIsCurrent(publicState, sessionPubkey) || currentPubkey === sessionPubkey : false;
  const isRotatedIdentity = Boolean(
    hasIdentity &&
      canonicalPubkey &&
      currentPubkey &&
      (canonicalPubkey !== currentPubkey || identityMemberPubkeys.length > 1)
  );
  const isStaleKey = Boolean(hasIdentity && currentPubkey && currentPubkey !== sessionPubkey);

  return {
    claimedUsername,
    sessionPubkey,
    canonicalPubkey: canonicalPubkey || sessionPubkey,
    currentPubkey: currentPubkey || sessionPubkey,
    identityMemberPubkeys,
    hasIdentity,
    isCurrentKey,
    isRotatedIdentity,
    isStaleKey
  };
}

export function sessionUsesCurrentIdentityKey(publicState, session = null) {
  return resolveSessionIdentityState(publicState, session).isCurrentKey;
}

export function resolveStaleSessionAccount(publicState, session = null) {
  const identityState = resolveSessionIdentityState(publicState, session);
  if (identityState.isStaleKey) {
    return {
      claimedUsername: identityState.claimedUsername,
      sessionPubkey: identityState.sessionPubkey,
      canonicalPubkey: identityState.canonicalPubkey,
      currentPubkey: identityState.currentPubkey,
      identityMemberPubkeys: identityState.identityMemberPubkeys
    };
  }
  return resolveStaleSessionFromHistory(session);
}

export function buildStaleSessionMessage({ claimedUsername = "", currentContext = "use this account" } = {}) {
  const cleanUsername = normalizeUsername(claimedUsername);
  const usernameLabel = cleanUsername ? `@${cleanUsername}` : "This account";
  return `${usernameLabel} is using an older password for this account. This session cannot ${currentContext}. Sign out and log in with the current password.`;
}

export function rotationReusesIdentityKey(publicState, session = null, nextPubkey = "", accountHistory = null) {
  const identityState = resolveSessionIdentityState(publicState, session);
  const cleanNextPubkey = normalizePubkey(nextPubkey);
  if (!cleanNextPubkey) return false;
  if (identityState.identityMemberPubkeys.includes(cleanNextPubkey)) return true;
  const history = accountHistory
    ? normalizeAccountHistoryEntry(accountHistory, session)
    : readStoredAccountHistory(session);
  return Boolean(history?.knownPubkeys?.includes(cleanNextPubkey));
}

export function buildPasswordReuseMessage({ claimedUsername = "" } = {}) {
  const cleanUsername = normalizeUsername(claimedUsername);
  const usernameLabel = cleanUsername ? `@${cleanUsername}` : "This account";
  return `${usernameLabel} must use a password that has not been used before for this account.`;
}

export function createPasswordReuseError({ claimedUsername = "", message = "" } = {}) {
  const error = new Error(String(message || "").trim() || buildPasswordReuseMessage({ claimedUsername }));
  error.code = "PASSWORD_REUSE";
  error.claimedUsername = normalizeUsername(claimedUsername);
  return error;
}

export function isPasswordReuseError(error) {
  return String(error?.code || "").trim().toUpperCase() === "PASSWORD_REUSE";
}

export function createStaleSessionError({ claimedUsername = "", message = "", currentContext = "use this account" } = {}) {
  const error = new Error(String(message || "").trim() || buildStaleSessionMessage({ claimedUsername, currentContext }));
  error.code = "STALE_ACCOUNT_KEY";
  error.claimedUsername = normalizeUsername(claimedUsername);
  return error;
}

export function isStaleSessionError(error) {
  return String(error?.code || "").trim().toUpperCase() === "STALE_ACCOUNT_KEY";
}

function persistAccountHistoryProjection(username = "", entry = null, source = "") {
  const params = accountHistoryRuntimeParams(username);
  if (!params || !entry) return;
  const generation = accountHistoryGeneration;
  void Promise.resolve()
    .then(() => {
      if (generation !== accountHistoryGeneration) return null;
      return rememberSiteRuntimeValue(ACCOUNT_HISTORY_CHANNEL, params, entry, {
        source
      });
    })
    .catch(() => null);
}
