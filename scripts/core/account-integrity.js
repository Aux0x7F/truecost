import {
  expandCanonicalIdentityPubkeys,
  identityPubkeysMatch
} from "./public-state.js";
import {
  buildPasswordReuseMessage,
  buildStaleSessionMessage,
  createPasswordReuseError,
  isPasswordReuseError,
  createStaleSessionError,
  isStaleSessionError,
  readStoredAccountHistory,
  resolveSessionIdentityState,
  rotationReusesIdentityKey,
  resolveStaleSessionAccount
} from "./account-management.js";
import {
  clearCachedSiteRuntimeChannel,
  clearCachedSiteRuntimeValue,
  clearSiteRuntimeValue,
  getCachedSiteRuntimeValue,
  loadSiteRuntimeValue,
  readCachedSiteRuntimeValue,
  rememberCachedSiteRuntimeValue,
  rememberSiteRuntimeValue
} from "./runtime-local-state.js";

export {
  buildPasswordReuseMessage,
  buildStaleSessionMessage,
  createPasswordReuseError,
  isPasswordReuseError,
  createStaleSessionError,
  isStaleSessionError,
  readStoredAccountHistory,
  rotationReusesIdentityKey,
  resolveStaleSessionAccount
} from "./account-management.js";

const USERNAME_INTEGRITY_CHANNEL = "usernameIntegrity";
const sessionIntegrityKeys = new Set();
let sessionIntegrityGeneration = 0;

export function normalizeClaimedUsername(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizePubkey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function sessionIntegrityCacheKey(session = null) {
  const claimedUsername = normalizeClaimedUsername(session?.username);
  const pubkey = normalizePubkey(session?.pubkey);
  return claimedUsername && pubkey ? `${claimedUsername}:${pubkey}` : "";
}

function sessionIntegrityRuntimeParams(session = null) {
  const claimedUsername = normalizeClaimedUsername(session?.username);
  const pubkey = normalizePubkey(session?.pubkey);
  return claimedUsername && pubkey ? { username: claimedUsername, pubkey, __projectionScope: "global" } : null;
}

export function resetCachedSessionUsernameIntegrityStore() {
  sessionIntegrityGeneration += 1;
  clearCachedSiteRuntimeChannel(USERNAME_INTEGRITY_CHANNEL);
  for (const key of sessionIntegrityKeys) {
    const [claimedUsername, pubkey] = String(key || "").split(":");
    clearCachedSiteRuntimeValue(USERNAME_INTEGRITY_CHANNEL, {
      username: claimedUsername,
      pubkey,
      __projectionScope: "global"
    });
  }
  sessionIntegrityKeys.clear();
}

export function readCachedSessionUsernameIntegrity(session = null) {
  const key = sessionIntegrityCacheKey(session);
  if (!key) return null;
  const entry = readCachedSiteRuntimeValue(USERNAME_INTEGRITY_CHANNEL, sessionIntegrityRuntimeParams(session)) || null;
  if (!entry || typeof entry !== "object") return null;
  return {
    conflict: Boolean(entry.conflict),
    claimedUsername: normalizeClaimedUsername(entry.claimedUsername || session?.username),
    ownerPubkey: normalizePubkey(entry.ownerPubkey),
    checkedAt: Number(entry.checkedAt || 0) || 0,
    source: String(entry.source || "cache").trim().toLowerCase() || "cache"
  };
}

export async function hydrateCachedSessionUsernameIntegrity(session = null, { preferFresh = false } = {}) {
  const key = sessionIntegrityCacheKey(session);
  const params = sessionIntegrityRuntimeParams(session);
  if (!key || !params) return null;
  const cachedEntry = await getCachedSiteRuntimeValue(USERNAME_INTEGRITY_CHANNEL, params);
  if (cachedEntry && typeof cachedEntry === "object") {
    rememberSessionUsernameIntegrity(session, cachedEntry);
    return readCachedSessionUsernameIntegrity(session);
  }
  if (!preferFresh && readCachedSessionUsernameIntegrity(session)) {
    return readCachedSessionUsernameIntegrity(session);
  }
  const loadedEntry = await loadSiteRuntimeValue(USERNAME_INTEGRITY_CHANNEL, params);
  if (!loadedEntry || typeof loadedEntry !== "object") return readCachedSessionUsernameIntegrity(session);
  rememberSessionUsernameIntegrity(session, loadedEntry);
  return readCachedSessionUsernameIntegrity(session);
}

export function rememberSessionUsernameIntegrity(session = null, integrity = {}) {
  const key = sessionIntegrityCacheKey(session);
  if (!key) return integrity;
  const nextEntry = {
    conflict: Boolean(integrity?.conflict),
    claimedUsername: normalizeClaimedUsername(integrity?.claimedUsername || session?.username),
    ownerPubkey: normalizePubkey(integrity?.ownerPubkey),
    checkedAt: Date.now(),
    source: String(integrity?.source || "cache").trim().toLowerCase() || "cache"
  };
  sessionIntegrityKeys.add(key);
  rememberCachedSiteRuntimeValue(USERNAME_INTEGRITY_CHANNEL, sessionIntegrityRuntimeParams(session), nextEntry);
  const params = sessionIntegrityRuntimeParams(session);
  if (params) {
    persistSessionIntegrityProjection(params, nextEntry, "username-integrity");
  }
  return integrity;
}

export function clearCachedSessionUsernameIntegrity(session = null) {
  const key = sessionIntegrityCacheKey(session);
  if (!key) return;
  sessionIntegrityKeys.delete(key);
  clearCachedSiteRuntimeValue(USERNAME_INTEGRITY_CHANNEL, sessionIntegrityRuntimeParams(session));
  const params = sessionIntegrityRuntimeParams(session);
  if (params) {
    const generation = sessionIntegrityGeneration;
    void Promise.resolve()
      .then(() => {
        if (generation !== sessionIntegrityGeneration) return null;
        return clearSiteRuntimeValue(USERNAME_INTEGRITY_CHANNEL, params, {
          source: "username-integrity-clear"
        });
      })
      .catch(() => null);
  }
}

function buildResolvedIntegrity({ conflict = false, claimedUsername = "", ownerPubkey = "", user = null, source = "state" } = {}) {
  return {
    conflict: Boolean(conflict),
    removed: false,
    claimedUsername: normalizeClaimedUsername(claimedUsername),
    ownerPubkey: normalizePubkey(ownerPubkey),
    user,
    source
  };
}

function currentSessionHistoryTrustsOwner(session = null, ownerPubkey = "") {
  const cleanSessionPubkey = normalizePubkey(session?.pubkey);
  const cleanOwnerPubkey = normalizePubkey(ownerPubkey);
  const history = readStoredAccountHistory(session);
  if (!cleanSessionPubkey || !cleanOwnerPubkey || !history?.currentPubkey) return false;
  if (history.currentPubkey !== cleanSessionPubkey) return false;
  return Array.isArray(history.knownPubkeys) && history.knownPubkeys.includes(cleanOwnerPubkey);
}

function buildRemovedIntegrity({ claimedUsername = "", ownerPubkey = "", user = null, source = "state" } = {}) {
  return {
    conflict: false,
    removed: true,
    claimedUsername: normalizeClaimedUsername(claimedUsername),
    ownerPubkey: normalizePubkey(ownerPubkey),
    user,
    source
  };
}

export function resolveUsernameRegistryEntry(publicState, username = "") {
  const cleanUsername = normalizeClaimedUsername(username);
  if (!cleanUsername) return null;
  const registry = Array.isArray(publicState?.usernameRegistry) ? publicState.usernameRegistry : [];
  const direct = registry.find((entry) => normalizeClaimedUsername(entry?.username) === cleanUsername) || null;
  if (direct) return direct;
  const owner = (publicState?.users || []).find(
    (user) => normalizeClaimedUsername(user?.username) === cleanUsername && !userHasUsernameConflict(user)
  );
  if (!owner) return null;
  return {
    username: cleanUsername,
    owner_pubkey: String(owner.pubkey || "").trim().toLowerCase(),
    owner_source: "derived",
    owner_created_at: 0,
    claimant_pubkeys: [String(owner.pubkey || "").trim().toLowerCase()],
    conflict: false
  };
}

export function resolveClaimedUsername(user = null, session = null) {
  const claimed =
    normalizeClaimedUsername(user?.claimedUsername) ||
    normalizeClaimedUsername(user?.username) ||
    normalizeClaimedUsername(session?.username);
  return claimed;
}

export function userHasUsernameConflict(user = null) {
  return Boolean(user?.usernameConflict);
}

export function resolveSessionUser(publicState, session = null) {
  const cleanPubkey = normalizePubkey(session?.pubkey);
  if (!cleanPubkey) return null;
  return (
    (publicState?.users || []).find((user) => identityPubkeysMatch(publicState, user?.pubkey, cleanPubkey)) || null
  );
}

function publicStateHasRemovedPubkey(publicState, pubkey = "") {
  const pubkeys = expandCanonicalIdentityPubkeys(publicState, pubkey);
  if (!pubkeys.length) return false;
  const removed = (Array.isArray(publicState?.removedPubkeys) ? publicState.removedPubkeys : []).map(normalizePubkey);
  return pubkeys.some((candidate) => removed.includes(candidate));
}

function publicStateHasTrustedRemovalState(publicState) {
  if (!publicState || typeof publicState !== "object") return false;
  if (publicState.connected) return true;
  const remoteEventCount = Number(publicState?.syncInfo?.remoteEventCount || 0) || 0;
  return remoteEventCount > 0;
}

function resolveRemovedSessionUser(publicState, session = null) {
  const cleanPubkey = normalizePubkey(session?.pubkey);
  if (!cleanPubkey) return null;
  return (
    (Array.isArray(publicState?.removedUsers) ? publicState.removedUsers : []).find(
      (user) => identityPubkeysMatch(publicState, user?.pubkey, cleanPubkey)
    ) || null
  );
}

export function resolveRemovedSessionAccount(publicState, session = null) {
  const cleanPubkey = normalizePubkey(session?.pubkey);
  if (!cleanPubkey) return null;
  if (!publicStateHasTrustedRemovalState(publicState)) return null;
  const removedUser = resolveRemovedSessionUser(publicState, session);
  if (removedUser) return removedUser;
  if (!publicStateHasRemovedPubkey(publicState, cleanPubkey)) return null;
  const claimedUsername = normalizeClaimedUsername(session?.username);
  return {
    pubkey: cleanPubkey,
    claimedUsername,
    username: claimedUsername,
    removed: true
  };
}

export function sessionHasRemovedAccount(publicState, session = null) {
  return Boolean(resolveRemovedSessionAccount(publicState, session));
}

function resolveSessionUsernameConflictFromState(publicState, session = null) {
  const user = resolveSessionUser(publicState, session);
  const claimedUsername = resolveClaimedUsername(user, session);
  if (!claimedUsername) {
    return buildResolvedIntegrity({ conflict: false, claimedUsername: "", ownerPubkey: "", user, source: "state" });
  }
  const registryEntry = resolveUsernameRegistryEntry(publicState, claimedUsername);
  const cleanSessionPubkey = normalizePubkey(session?.pubkey);
  const ownerPubkey = String(
    user?.usernameOwnerPubkey ||
      registryEntry?.owner_pubkey ||
      ""
  )
    .trim()
    .toLowerCase();
  const conflict = Boolean(
    claimedUsername &&
      ownerPubkey &&
      cleanSessionPubkey &&
      !identityPubkeysMatch(publicState, ownerPubkey, cleanSessionPubkey)
  ) || userHasUsernameConflict(user);
  return buildResolvedIntegrity({
    conflict,
    claimedUsername,
    ownerPubkey,
    user,
    source: "state"
  });
}

export function resolveSessionUsernameConflict(publicState, session = null) {
  const stateIntegrity = resolveSessionUsernameConflictFromState(publicState, session);
  const trustedState = publicStateHasTrustedRemovalState(publicState);
  const cachedIntegrity = readCachedSessionUsernameIntegrity(session);
  if (stateIntegrity.conflict && currentSessionHistoryTrustsOwner(session, stateIntegrity.ownerPubkey)) {
    clearCachedSessionUsernameIntegrity(session);
    return buildResolvedIntegrity({
      conflict: false,
      claimedUsername: stateIntegrity.claimedUsername,
      ownerPubkey: normalizePubkey(session?.pubkey),
      user: stateIntegrity.user,
      source: "history-current"
    });
  }
  if (stateIntegrity.conflict && trustedState) {
    rememberSessionUsernameIntegrity(session, stateIntegrity);
    return stateIntegrity;
  }
  if (stateIntegrity.claimedUsername && !stateIntegrity.conflict && trustedState && stateIntegrity.ownerPubkey) {
    clearCachedSessionUsernameIntegrity(session);
    return stateIntegrity;
  }
  if (cachedIntegrity?.conflict && cachedIntegrity.source === "lookup") {
    if (currentSessionHistoryTrustsOwner(session, cachedIntegrity.ownerPubkey)) {
      clearCachedSessionUsernameIntegrity(session);
      return buildResolvedIntegrity({
        conflict: false,
        claimedUsername: cachedIntegrity.claimedUsername || stateIntegrity.claimedUsername,
        ownerPubkey: normalizePubkey(session?.pubkey),
        user: stateIntegrity.user,
        source: "history-current"
      });
    }
    return buildResolvedIntegrity({
      conflict: true,
      claimedUsername: cachedIntegrity.claimedUsername || stateIntegrity.claimedUsername,
      ownerPubkey: cachedIntegrity.ownerPubkey,
      user: stateIntegrity.user,
      source: "cache"
    });
  }
  if (stateIntegrity.conflict && !trustedState) {
    return buildResolvedIntegrity({
      conflict: false,
      claimedUsername: stateIntegrity.claimedUsername,
      ownerPubkey: stateIntegrity.ownerPubkey,
      user: stateIntegrity.user,
      source: "state-untrusted"
    });
  }
  return stateIntegrity;
}

export function sessionHasUsernameConflict(publicState, session = null) {
  return resolveSessionUsernameConflict(publicState, session).conflict;
}

export function currentSessionUsernameConflictMessage(publicState, session = null, action = "use this account") {
  const integrity = resolveSessionUsernameConflict(publicState, session);
  if (!integrity.conflict) return "";
  return buildUsernameConflictMessage({
    claimedUsername: integrity.claimedUsername,
    action
  });
}

export function buildUsernameConflictMessage({ claimedUsername = "", action = "use this account" } = {}) {
  const cleanUsername = normalizeClaimedUsername(claimedUsername);
  const usernameLabel = cleanUsername ? `@${cleanUsername}` : "this username";
  return `${usernameLabel} is already claimed by another identity on the network. This session cannot ${action}. Sign out and choose a unique username.`;
}

export function buildUsernameLoginMismatchMessage(claimedUsername = "") {
  const cleanUsername = normalizeClaimedUsername(claimedUsername);
  const usernameLabel = cleanUsername ? `@${cleanUsername}` : "That username";
  return `${usernameLabel} already exists and your password did not match. Try again or append the next available number to the end.`;
}

export function buildRemovedAccountMessage({ claimedUsername = "" } = {}) {
  const cleanUsername = normalizeClaimedUsername(claimedUsername);
  const usernameLabel = cleanUsername ? `@${cleanUsername}` : "This account";
  return `${usernameLabel} has been removed from this site and cannot be used here. Contact an operator if you believe this is a mistake.`;
}

export function createUsernameConflictError({
  claimedUsername = "",
  action = "use this account",
  message = ""
} = {}) {
  const error = new Error(
    String(message || "").trim() ||
      buildUsernameConflictMessage({
        claimedUsername,
        action
      })
  );
  error.code = "USERNAME_TAKEN";
  error.claimedUsername = normalizeClaimedUsername(claimedUsername);
  return error;
}

export function createRemovedAccountError({ claimedUsername = "", message = "" } = {}) {
  const error = new Error(String(message || "").trim() || buildRemovedAccountMessage({ claimedUsername }));
  error.code = "ACCOUNT_REMOVED";
  error.claimedUsername = normalizeClaimedUsername(claimedUsername);
  return error;
}

export function isUsernameConflictError(error) {
  return String(error?.code || "").trim().toUpperCase() === "USERNAME_TAKEN";
}

export function isRemovedAccountError(error) {
  return String(error?.code || "").trim().toUpperCase() === "ACCOUNT_REMOVED";
}

function normalizeNumericSuffixParts(username = "") {
  const cleanUsername = normalizeClaimedUsername(username);
  if (!cleanUsername) return { stem: "", nextIndex: 2 };
  const match = cleanUsername.match(/^(.*?)(\d+)$/);
  if (!match) {
    return { stem: cleanUsername, nextIndex: 2 };
  }
  const stem = normalizeClaimedUsername(match[1]) || cleanUsername;
  const numericSuffix = Number.parseInt(match[2], 10);
  return {
    stem,
    nextIndex: Number.isFinite(numericSuffix) ? Math.max(numericSuffix + 1, 2) : 2
  };
}

function usernameEntryOwnedByAnother(entry, currentPubkey = "") {
  const ownerPubkey = normalizePubkey(entry?.owner_pubkey);
  const cleanCurrentPubkey = normalizePubkey(currentPubkey);
  if (!ownerPubkey) return false;
  return !cleanCurrentPubkey || ownerPubkey !== cleanCurrentPubkey;
}

export function inspectUsernameClaim(
  publicState,
  username = "",
  {
    currentPubkey = "",
    currentUsername = ""
  } = {}
) {
  const claimedUsername = normalizeClaimedUsername(username);
  const cleanCurrentUsername = normalizeClaimedUsername(currentUsername);
  if (!claimedUsername) {
    return {
      state: "empty",
      claimedUsername: "",
      ownerPubkey: ""
    };
  }
  if (claimedUsername === cleanCurrentUsername) {
    return {
      state: "unchanged",
      claimedUsername,
      ownerPubkey: normalizePubkey(currentPubkey)
    };
  }
  const registryEntry = resolveUsernameRegistryEntry(publicState, claimedUsername);
  const ownerPubkey = normalizePubkey(registryEntry?.owner_pubkey);
  if (usernameEntryOwnedByAnother(registryEntry, currentPubkey)) {
    return {
      state: "taken",
      claimedUsername,
      ownerPubkey
    };
  }
  return {
    state: "available",
    claimedUsername,
    ownerPubkey
  };
}

export function assertSessionUsernameIntegrity(publicState, session = null, { action = "use this account", remember = true } = {}) {
  if (publicStateHasTrustedRemovalState(publicState) && publicStateHasRemovedPubkey(publicState, session?.pubkey)) {
    throw createRemovedAccountError({
      claimedUsername: normalizeClaimedUsername(session?.username),
      message: buildRemovedAccountMessage({ claimedUsername: session?.username, action })
    });
  }
  const staleSession = resolveStaleSessionAccount(publicState, session);
  if (staleSession) {
    throw createStaleSessionError({
      claimedUsername: staleSession.claimedUsername,
      currentContext: action
    });
  }
  const integrity = resolveSessionUsernameConflict(publicState, session);
  if (remember) {
    if (integrity.conflict) {
      rememberSessionUsernameIntegrity(session, integrity);
    } else {
      clearCachedSessionUsernameIntegrity(session);
    }
  }
  if (!integrity.conflict) return integrity;
  throw createUsernameConflictError({
    claimedUsername: integrity.claimedUsername,
    action
  });
}

function selectCanonicalLookupOwner(users = [], username = "") {
  const cleanUsername = normalizeClaimedUsername(username);
  const candidates = (Array.isArray(users) ? users : []).filter((user) => {
    const candidateUsername = normalizeClaimedUsername(user?.username || user?.claimedUsername);
    return candidateUsername === cleanUsername;
  });
  const canonical = candidates.find((user) => !userHasUsernameConflict(user) && normalizeClaimedUsername(user?.username) === cleanUsername);
  return canonical || candidates[0] || null;
}

function selectLookupSessionClaimant(users = [], username = "", pubkey = "") {
  const cleanUsername = normalizeClaimedUsername(username);
  const cleanPubkey = normalizePubkey(pubkey);
  if (!cleanUsername || !cleanPubkey) return null;
  return (
    (Array.isArray(users) ? users : []).find((user) => {
      const candidatePubkey = normalizePubkey(user?.pubkey);
      const candidateUsername = normalizeClaimedUsername(user?.username || user?.claimedUsername);
      return candidatePubkey === cleanPubkey && candidateUsername === cleanUsername;
    }) || null
  );
}

function stateKnowsSessionUsernameClaim(publicState, session = null, stateIntegrity = null) {
  const cleanSessionPubkey = normalizePubkey(session?.pubkey);
  const claimedUsername = normalizeClaimedUsername(session?.username || stateIntegrity?.claimedUsername);
  if (!cleanSessionPubkey || !claimedUsername) return false;
  if (stateIntegrity?.user && normalizePubkey(stateIntegrity.user?.pubkey) === cleanSessionPubkey) {
    return true;
  }
  const registryEntry = resolveUsernameRegistryEntry(publicState, claimedUsername);
  const claimantPubkeys = Array.isArray(registryEntry?.claimant_pubkeys) ? registryEntry.claimant_pubkeys : [];
  return claimantPubkeys.some((pubkey) => normalizePubkey(pubkey) === cleanSessionPubkey);
}

export function resolveDisplayNameConflictSuffix(displayName = "", ordinal = 0) {
  const cleanDisplayName = String(displayName || "").trim();
  const numericOrdinal = Number(ordinal || 0) || 0;
  if (!cleanDisplayName) return numericOrdinal > 1 ? `User ${numericOrdinal}` : "User";
  if (numericOrdinal <= 1) return cleanDisplayName;
  return /\s\d+$/.test(cleanDisplayName) ? cleanDisplayName : `${cleanDisplayName} ${numericOrdinal}`;
}

export async function resolveNextAvailableUsername(
  publicState,
  username = "",
  {
    currentPubkey = "",
    lookupUsers = null,
    maxAttempts = 64
  } = {}
) {
  const desiredUsername = normalizeClaimedUsername(username);
  if (!desiredUsername) {
    return {
      username: "",
      verified: false
    };
  }

  const cleanCurrentPubkey = normalizePubkey(currentPubkey);
  const exactPreview = inspectUsernameClaim(publicState, desiredUsername, {
    currentPubkey: cleanCurrentPubkey,
    currentUsername: ""
  });
  if (exactPreview.state === "available") {
    return {
      username: desiredUsername,
      verified: false
    };
  }

  const { stem, nextIndex } = normalizeNumericSuffixParts(desiredUsername);
  const baseStem = stem || desiredUsername;

  for (let index = nextIndex; index < nextIndex + Math.max(4, Number(maxAttempts || 0) || 64); index += 1) {
    const candidate = `${baseStem}${index}`;
    const preview = inspectUsernameClaim(publicState, candidate, {
      currentPubkey: cleanCurrentPubkey,
      currentUsername: ""
    });
    if (preview.state === "taken") continue;
    if (typeof lookupUsers !== "function") {
      return {
        username: candidate,
        verified: false
      };
    }
    try {
      const lookupOwner = selectCanonicalLookupOwner(await lookupUsers(candidate), candidate);
      if (lookupOwner && normalizePubkey(lookupOwner.pubkey) !== cleanCurrentPubkey) {
        continue;
      }
      return {
        username: candidate,
        verified: true
      };
    } catch {
      return {
        username: candidate,
        verified: false
      };
    }
  }

  return {
    username: `${baseStem}${nextIndex}`,
    verified: false
  };
}

export async function assertNetworkSessionUsernameIntegrity(
  publicState,
  session = null,
  {
    action = "use this account",
    lookupUsers = null,
    requireLookup = true
  } = {}
) {
  const trustedState = publicStateHasTrustedRemovalState(publicState);
  if (trustedState && publicStateHasRemovedPubkey(publicState, session?.pubkey)) {
    throw createRemovedAccountError({
      claimedUsername: normalizeClaimedUsername(session?.username)
    });
  }
  const identityState = resolveSessionIdentityState(publicState, session);
  const staleSession = resolveStaleSessionAccount(publicState, session);
  const claimedUsername = normalizeClaimedUsername(session?.username);
  const stateIntegrity = resolveSessionUsernameConflictFromState(publicState, session);
  const hasStateOwnershipSignal = Boolean(
    stateIntegrity.user || resolveUsernameRegistryEntry(publicState, claimedUsername)
  );
  if (identityState.isStaleKey) {
    throw createStaleSessionError({
      claimedUsername: staleSession?.claimedUsername || claimedUsername,
      currentContext: action
    });
  }
  if (staleSession && !hasStateOwnershipSignal) {
    throw createStaleSessionError({
      claimedUsername: staleSession.claimedUsername || claimedUsername,
      currentContext: action
    });
  }
  const cleanSessionPubkey = normalizePubkey(session?.pubkey);
  if (!claimedUsername) {
    clearCachedSessionUsernameIntegrity(session);
    return stateIntegrity;
  }

  let lookupResults = [];
  let lookupAttempted = false;
  let lookupSuccessful = false;
  if (typeof lookupUsers === "function") {
    lookupAttempted = true;
    try {
      lookupResults = await lookupUsers(claimedUsername, {
        includePubkeys: cleanSessionPubkey ? [cleanSessionPubkey] : []
      });
      lookupSuccessful = true;
    } catch {
      lookupResults = [];
    }
  }

  const lookupOwner = selectCanonicalLookupOwner(lookupResults, claimedUsername);
  const lookupSessionClaimant = selectLookupSessionClaimant(lookupResults, claimedUsername, cleanSessionPubkey);
  const stateRegistryEntry = resolveUsernameRegistryEntry(publicState, claimedUsername);
  const removedLookupSession = (Array.isArray(lookupResults) ? lookupResults : []).find(
    (user) => normalizePubkey(user?.pubkey) === cleanSessionPubkey && Boolean(user?.removed)
  );
  if (removedLookupSession) {
    throw createRemovedAccountError({
      claimedUsername
    });
  }
  if (lookupOwner) {
    const lookupOwnerPubkey = normalizePubkey(lookupOwner.pubkey);
    if (lookupOwnerPubkey && lookupOwnerPubkey !== cleanSessionPubkey) {
      if (currentSessionHistoryTrustsOwner(session, lookupOwnerPubkey)) {
        clearCachedSessionUsernameIntegrity(session);
        return buildResolvedIntegrity({
          conflict: false,
          claimedUsername,
          ownerPubkey: cleanSessionPubkey,
          user: stateIntegrity.user,
          source: "history-current"
        });
      }
      if (staleSession) {
        throw createStaleSessionError({
          claimedUsername,
          currentContext: action
        });
      }
      const integrity = buildResolvedIntegrity({
        conflict: true,
        claimedUsername,
        ownerPubkey: lookupOwnerPubkey,
        user: stateIntegrity.user,
        source: "lookup"
      });
      rememberSessionUsernameIntegrity(session, integrity);
      throw createUsernameConflictError({
        claimedUsername,
        action
      });
    }
    clearCachedSessionUsernameIntegrity(session);
    return buildResolvedIntegrity({
      conflict: false,
      claimedUsername,
      ownerPubkey: lookupOwnerPubkey,
      user: stateIntegrity.user,
      source: "lookup"
    });
  }

  if (lookupSessionClaimant) {
    clearCachedSessionUsernameIntegrity(session);
    return buildResolvedIntegrity({
      conflict: false,
      claimedUsername,
      ownerPubkey: cleanSessionPubkey,
      user: stateIntegrity.user || lookupSessionClaimant,
      source: "lookup"
    });
  }

  if (stateIntegrity.conflict) {
    if (currentSessionHistoryTrustsOwner(session, stateIntegrity.ownerPubkey)) {
      clearCachedSessionUsernameIntegrity(session);
      return buildResolvedIntegrity({
        conflict: false,
        claimedUsername: stateIntegrity.claimedUsername,
        ownerPubkey: cleanSessionPubkey,
        user: stateIntegrity.user,
        source: "history-current"
      });
    }
    const stateKnowsClaimant = stateKnowsSessionUsernameClaim(publicState, session, stateIntegrity);
    const trustedStateOwnerPubkey = normalizePubkey(
      stateRegistryEntry?.owner_pubkey || stateIntegrity.ownerPubkey
    );
    if (trustedState && trustedStateOwnerPubkey && !stateKnowsClaimant) {
      rememberSessionUsernameIntegrity(session, stateIntegrity);
      throw createUsernameConflictError({
        claimedUsername: stateIntegrity.claimedUsername,
        action
      });
    }
    if (requireLookup && (!lookupSuccessful || !stateKnowsClaimant)) {
      throw new Error(`Could not verify whether @${claimedUsername} belongs to this account on the network. Try again in a moment.`);
    }
    rememberSessionUsernameIntegrity(session, stateIntegrity);
    throw createUsernameConflictError({
      claimedUsername: stateIntegrity.claimedUsername,
      action
    });
  }

  if (stateRegistryEntry || stateIntegrity.user) {
    clearCachedSessionUsernameIntegrity(session);
    return stateIntegrity;
  }

  const cachedIntegrity = readCachedSessionUsernameIntegrity(session);
  if (cachedIntegrity?.conflict) {
    throw createUsernameConflictError({
      claimedUsername: cachedIntegrity.claimedUsername || claimedUsername,
      action
    });
  }

  if (lookupSuccessful) {
    clearCachedSessionUsernameIntegrity(session);
    return stateIntegrity;
  }

  if (requireLookup && lookupAttempted && !lookupSuccessful) {
    throw new Error(`Could not verify whether @${claimedUsername} is available on the network. Try again in a moment.`);
  }

  clearCachedSessionUsernameIntegrity(session);
  return stateIntegrity;
}

function persistSessionIntegrityProjection(params = null, value = null, source = "") {
  if (!params || !value) return;
  const generation = sessionIntegrityGeneration;
  void Promise.resolve()
    .then(() => {
      if (generation !== sessionIntegrityGeneration) return null;
      return rememberSiteRuntimeValue(USERNAME_INTEGRITY_CHANNEL, params, value, {
        source
      });
    })
    .catch(() => null);
}
