import {
  expandCanonicalIdentityPubkeys,
  identityPubkeyIsCurrent,
  resolveCanonicalIdentityPubkey,
  resolveCurrentIdentityPubkey
} from "./public-state.js";

const ACCOUNT_HISTORY_STORAGE_KEY = "truecost.v2.account-history";

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizePubkey(value) {
  return String(value || "").trim().toLowerCase();
}

function loadAccountHistoryStore() {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCOUNT_HISTORY_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveAccountHistoryStore(nextValue) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(ACCOUNT_HISTORY_STORAGE_KEY, JSON.stringify(nextValue && typeof nextValue === "object" ? nextValue : {}));
  } catch {
    return;
  }
}

export function readStoredAccountHistory(usernameOrSession = "") {
  const username = normalizeUsername(
    typeof usernameOrSession === "string" ? usernameOrSession : usernameOrSession?.username
  );
  if (!username) return null;
  const entry = loadAccountHistoryStore()[username];
  if (!entry || typeof entry !== "object") return null;
  const knownPubkeys = [...new Set((Array.isArray(entry.knownPubkeys) ? entry.knownPubkeys : []).map(normalizePubkey).filter(Boolean))];
  const currentPubkey = normalizePubkey(entry.currentPubkey);
  return {
    username,
    currentPubkey,
    knownPubkeys,
    updatedAt: Number(entry.updatedAt || 0) || 0
  };
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
  const store = loadAccountHistoryStore();
  const current = readStoredAccountHistory(username) || {
    username,
    currentPubkey: "",
    knownPubkeys: [],
    updatedAt: 0
  };
  const next = updater(current);
  if (!next) return current;
  store[username] = {
    username,
    currentPubkey: normalizePubkey(next.currentPubkey),
    knownPubkeys: [...new Set((Array.isArray(next.knownPubkeys) ? next.knownPubkeys : []).map(normalizePubkey).filter(Boolean))],
    updatedAt: Date.now()
  };
  saveAccountHistoryStore(store);
  return readStoredAccountHistory(username);
}

export function rememberCurrentAccountSession(session = null) {
  const username = normalizeUsername(session?.username);
  const pubkey = normalizePubkey(session?.pubkey);
  if (!username || !pubkey) return null;
  return writeStoredAccountHistory(username, (current) => ({
    ...current,
    currentPubkey: pubkey,
    knownPubkeys: [...new Set([...(current.knownPubkeys || []), pubkey])]
  }));
}

export function rememberAccountRotation(previousSession = null, nextSession = null) {
  const username = normalizeUsername(nextSession?.username || previousSession?.username);
  const previousPubkey = normalizePubkey(previousSession?.pubkey);
  const nextPubkey = normalizePubkey(nextSession?.pubkey);
  if (!username || !previousPubkey || !nextPubkey) return null;
  return writeStoredAccountHistory(username, (current) => ({
    ...current,
    currentPubkey: nextPubkey,
    knownPubkeys: [...new Set([...(current.knownPubkeys || []), previousPubkey, nextPubkey])]
  }));
}

export function resolveStaleSessionFromHistory(session = null) {
  const username = normalizeUsername(session?.username);
  const pubkey = normalizePubkey(session?.pubkey);
  if (!username || !pubkey) return null;
  const history = readStoredAccountHistory(username);
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

export function rotationReusesIdentityKey(publicState, session = null, nextPubkey = "") {
  const identityState = resolveSessionIdentityState(publicState, session);
  const cleanNextPubkey = normalizePubkey(nextPubkey);
  if (!cleanNextPubkey) return false;
  if (identityState.identityMemberPubkeys.includes(cleanNextPubkey)) return true;
  const history = readStoredAccountHistory(session);
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
