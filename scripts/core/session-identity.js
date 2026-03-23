import {
  expandCanonicalIdentityPubkeys,
  identityPubkeyIsCurrent,
  identityPubkeysMatch,
  resolveCanonicalIdentityPubkey,
  resolveCurrentIdentityPubkey
} from "./public-state.js";

export function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeClaimedUsername(value) {
  return normalizeUsername(value);
}

export function normalizePubkey(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeAccountHistoryEntry(entry = null, usernameOrSession = "") {
  const username = normalizeUsername(
    typeof usernameOrSession === "string" ? usernameOrSession : usernameOrSession?.username
  );
  const source = entry && typeof entry === "object" ? entry : {};
  const knownPubkeys = [...new Set(
    (Array.isArray(source.knownPubkeys) ? source.knownPubkeys : [])
      .map(normalizePubkey)
      .filter(Boolean)
  )];
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

export function resolveSessionIdentityState(publicState, session = null) {
  const claimedUsername = normalizeUsername(session?.username);
  const sessionPubkey = normalizePubkey(session?.pubkey);
  const canonicalPubkey = resolveCanonicalIdentityPubkey(publicState, sessionPubkey);
  const currentPubkey = resolveCurrentIdentityPubkey(publicState, sessionPubkey);
  const identityMemberPubkeys = expandCanonicalIdentityPubkeys(publicState, sessionPubkey);
  const hasIdentity = Boolean(sessionPubkey);
  const isCurrentKey = hasIdentity
    ? identityPubkeyIsCurrent(publicState, sessionPubkey) || currentPubkey === sessionPubkey
    : false;
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

export function resolveStaleSessionFromHistory(session = null, accountHistory = null) {
  const username = normalizeUsername(session?.username);
  const pubkey = normalizePubkey(session?.pubkey);
  if (!username || !pubkey) return null;
  const history = normalizeAccountHistoryEntry(accountHistory, username);
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

export function resolveStaleSessionAccount(publicState, session = null, { accountHistory = null } = {}) {
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
  return resolveStaleSessionFromHistory(session, accountHistory);
}

export function sessionUsesCurrentIdentityKey(publicState, session = null, { accountHistory = null } = {}) {
  return !resolveStaleSessionAccount(publicState, session, { accountHistory });
}

export function buildStaleSessionMessage({ claimedUsername = "", currentContext = "use this account" } = {}) {
  const cleanUsername = normalizeUsername(claimedUsername);
  const usernameLabel = cleanUsername ? `@${cleanUsername}` : "This account";
  return `${usernameLabel} is using an older password for this account. This session cannot ${currentContext}. Sign out and log in with the current password.`;
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

export function rotationReusesIdentityKey(publicState, session = null, nextPubkey = "", accountHistory = null) {
  const identityState = resolveSessionIdentityState(publicState, session);
  const cleanNextPubkey = normalizePubkey(nextPubkey);
  if (!cleanNextPubkey) return false;
  if (identityState.identityMemberPubkeys.includes(cleanNextPubkey)) return true;
  const history = normalizeAccountHistoryEntry(accountHistory, session);
  return Boolean(history?.knownPubkeys?.includes(cleanNextPubkey));
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
  return (
    normalizeClaimedUsername(user?.claimedUsername) ||
    normalizeClaimedUsername(user?.username) ||
    normalizeClaimedUsername(session?.username)
  );
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

export function publicStateHasRemovedPubkey(publicState, pubkey = "") {
  const pubkeys = expandCanonicalIdentityPubkeys(publicState, pubkey);
  if (!pubkeys.length) return false;
  const removed = (Array.isArray(publicState?.removedPubkeys) ? publicState.removedPubkeys : []).map(normalizePubkey);
  return pubkeys.some((candidate) => removed.includes(candidate));
}

export function publicStateHasTrustedRemovalState(publicState) {
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

function resolveSessionUsernameConflictFromState(publicState, session = null) {
  const user = resolveSessionUser(publicState, session);
  const claimedUsername = resolveClaimedUsername(user, session);
  if (!claimedUsername) {
    return buildResolvedIntegrity({ conflict: false, claimedUsername: "", ownerPubkey: "", user, source: "state" });
  }
  const registryEntry = resolveUsernameRegistryEntry(publicState, claimedUsername);
  const cleanSessionPubkey = normalizePubkey(session?.pubkey);
  const ownerPubkey = String(user?.usernameOwnerPubkey || registryEntry?.owner_pubkey || "").trim().toLowerCase();
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

function currentSessionHistoryTrustsOwner(session = null, ownerPubkey = "", accountHistory = null) {
  const cleanSessionPubkey = normalizePubkey(session?.pubkey);
  const cleanOwnerPubkey = normalizePubkey(ownerPubkey);
  const history = normalizeAccountHistoryEntry(accountHistory, session);
  if (!cleanSessionPubkey || !cleanOwnerPubkey || !history?.currentPubkey) return false;
  if (history.currentPubkey !== cleanSessionPubkey) return false;
  return Array.isArray(history.knownPubkeys) && history.knownPubkeys.includes(cleanOwnerPubkey);
}

export function resolveSessionUsernameConflict(publicState, session = null, { storedIntegrity = null, accountHistory = null } = {}) {
  const stateIntegrity = resolveSessionUsernameConflictFromState(publicState, session);
  const trustedState = publicStateHasTrustedRemovalState(publicState);
  const cachedIntegrity = storedIntegrity && typeof storedIntegrity === "object"
    ? {
        conflict: Boolean(storedIntegrity.conflict),
        claimedUsername: normalizeClaimedUsername(storedIntegrity.claimedUsername || session?.username),
        ownerPubkey: normalizePubkey(storedIntegrity.ownerPubkey),
        checkedAt: Number(storedIntegrity.checkedAt || 0) || 0,
        source: String(storedIntegrity.source || "cache").trim().toLowerCase() || "cache"
      }
    : null;
  if (stateIntegrity.conflict && currentSessionHistoryTrustsOwner(session, stateIntegrity.ownerPubkey, accountHistory)) {
    return buildResolvedIntegrity({
      conflict: false,
      claimedUsername: stateIntegrity.claimedUsername,
      ownerPubkey: normalizePubkey(session?.pubkey),
      user: stateIntegrity.user,
      source: "history-current"
    });
  }
  if (stateIntegrity.conflict && trustedState) {
    return stateIntegrity;
  }
  if (stateIntegrity.claimedUsername && !stateIntegrity.conflict && trustedState && stateIntegrity.ownerPubkey) {
    return stateIntegrity;
  }
  if (cachedIntegrity?.conflict && cachedIntegrity.source === "lookup") {
    if (currentSessionHistoryTrustsOwner(session, cachedIntegrity.ownerPubkey, accountHistory)) {
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

export function sessionHasUsernameConflict(publicState, session = null, options = {}) {
  return Boolean(resolveSessionUsernameConflict(publicState, session, options)?.conflict);
}

export function currentSessionUsernameConflictMessage(publicState, session = null, action = "use this account", options = {}) {
  const integrity = resolveSessionUsernameConflict(publicState, session, options);
  if (!integrity?.conflict) return "";
  return buildUsernameConflictMessage({
    claimedUsername: integrity.claimedUsername || normalizeClaimedUsername(session?.username),
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

export function createUsernameConflictError({ claimedUsername = "", action = "use this account", message = "" } = {}) {
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

export function assertSessionUsernameIntegrity(
  publicState,
  session = null,
  {
    action = "use this account",
    storedIntegrity = null,
    accountHistory = null
  } = {}
) {
  const removedAccount = resolveRemovedSessionAccount(publicState, session);
  if (removedAccount) {
    throw createRemovedAccountError({
      claimedUsername:
        removedAccount.claimedUsername ||
        removedAccount.username ||
        normalizeClaimedUsername(session?.username)
    });
  }
  const staleSession = resolveStaleSessionAccount(publicState, session, { accountHistory });
  if (staleSession) {
    throw createStaleSessionError({
      claimedUsername: staleSession.claimedUsername || normalizeClaimedUsername(session?.username),
      currentContext: action
    });
  }
  const integrity = resolveSessionUsernameConflict(publicState, session, {
    storedIntegrity,
    accountHistory
  });
  if (integrity?.conflict) {
    throw createUsernameConflictError({
      claimedUsername: integrity.claimedUsername || normalizeClaimedUsername(session?.username),
      action
    });
  }
  return integrity;
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
    return { state: "empty", claimedUsername: "", ownerPubkey: "" };
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
    return { state: "taken", claimedUsername, ownerPubkey };
  }
  return { state: "available", claimedUsername, ownerPubkey };
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
  if (!cleanSessionPubkey) return false;
  const ownerPubkey = normalizePubkey(stateIntegrity?.ownerPubkey);
  if (ownerPubkey && identityPubkeysMatch(publicState, ownerPubkey, cleanSessionPubkey)) return true;
  const user = resolveSessionUser(publicState, session);
  return Boolean(user && identityPubkeysMatch(publicState, user?.pubkey, cleanSessionPubkey));
}

export function resolveDisplayNameConflictSuffix(displayName = "", ordinal = 0) {
  const cleanDisplayName = String(displayName || "").trim();
  const numericOrdinal = Number(ordinal || 0) || 0;
  if (!cleanDisplayName) return numericOrdinal > 1 ? `User ${numericOrdinal}` : "User";
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
    return { username: "", verified: false };
  }

  const cleanCurrentPubkey = normalizePubkey(currentPubkey);
  const exactPreview = inspectUsernameClaim(publicState, desiredUsername, {
    currentPubkey: cleanCurrentPubkey,
    currentUsername: ""
  });
  if (exactPreview.state === "available") {
    return { username: desiredUsername, verified: false };
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
      return { username: candidate, verified: false };
    }
    try {
      const lookupOwner = selectCanonicalLookupOwner(await lookupUsers(candidate), candidate);
      if (lookupOwner && normalizePubkey(lookupOwner.pubkey) !== cleanCurrentPubkey) continue;
      return { username: candidate, verified: true };
    } catch {
      return { username: candidate, verified: false };
    }
  }

  return { username: `${baseStem}${nextIndex}`, verified: false };
}

export async function assertNetworkSessionUsernameIntegrity(
  publicState,
  session = null,
  {
    action = "use this account",
    lookupUsers = null,
    requireLookup = true,
    accountHistory = null,
    storedIntegrity = null,
    onRememberIntegrity = null,
    onClearIntegrity = null
  } = {}
) {
  const trustedState = publicStateHasTrustedRemovalState(publicState);
  if (trustedState && publicStateHasRemovedPubkey(publicState, session?.pubkey)) {
    throw createRemovedAccountError({
      claimedUsername: normalizeClaimedUsername(session?.username)
    });
  }
  const identityState = resolveSessionIdentityState(publicState, session);
  const staleSession = resolveStaleSessionAccount(publicState, session, { accountHistory });
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
    await Promise.resolve(onClearIntegrity?.(session)).catch(() => null);
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
    throw createRemovedAccountError({ claimedUsername });
  }
  if (lookupOwner) {
    const lookupOwnerPubkey = normalizePubkey(lookupOwner.pubkey);
    if (lookupOwnerPubkey && lookupOwnerPubkey !== cleanSessionPubkey) {
      if (currentSessionHistoryTrustsOwner(session, lookupOwnerPubkey, accountHistory)) {
        await Promise.resolve(onClearIntegrity?.(session)).catch(() => null);
        return buildResolvedIntegrity({
          conflict: false,
          claimedUsername,
          ownerPubkey: cleanSessionPubkey,
          user: stateIntegrity.user,
          source: "history-current"
        });
      }
      if (staleSession) {
        throw createStaleSessionError({ claimedUsername, currentContext: action });
      }
      const integrity = buildResolvedIntegrity({
        conflict: true,
        claimedUsername,
        ownerPubkey: lookupOwnerPubkey,
        user: stateIntegrity.user,
        source: "lookup"
      });
      await Promise.resolve(onRememberIntegrity?.(session, integrity)).catch(() => null);
      throw createUsernameConflictError({ claimedUsername, action });
    }
    await Promise.resolve(onClearIntegrity?.(session)).catch(() => null);
    return buildResolvedIntegrity({
      conflict: false,
      claimedUsername,
      ownerPubkey: lookupOwnerPubkey,
      user: stateIntegrity.user,
      source: "lookup"
    });
  }

  if (lookupSessionClaimant) {
    await Promise.resolve(onClearIntegrity?.(session)).catch(() => null);
    return buildResolvedIntegrity({
      conflict: false,
      claimedUsername,
      ownerPubkey: cleanSessionPubkey,
      user: stateIntegrity.user || lookupSessionClaimant,
      source: "lookup"
    });
  }

  if (stateIntegrity.conflict) {
    if (currentSessionHistoryTrustsOwner(session, stateIntegrity.ownerPubkey, accountHistory)) {
      await Promise.resolve(onClearIntegrity?.(session)).catch(() => null);
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
      await Promise.resolve(onRememberIntegrity?.(session, stateIntegrity)).catch(() => null);
      throw createUsernameConflictError({ claimedUsername: stateIntegrity.claimedUsername, action });
    }
    if (requireLookup && (!lookupSuccessful || !stateKnowsClaimant)) {
      throw new Error(`Could not verify whether @${claimedUsername} belongs to this account on the network. Try again in a moment.`);
    }
    await Promise.resolve(onRememberIntegrity?.(session, stateIntegrity)).catch(() => null);
    throw createUsernameConflictError({ claimedUsername: stateIntegrity.claimedUsername, action });
  }

  if (stateRegistryEntry || stateIntegrity.user) {
    await Promise.resolve(onClearIntegrity?.(session)).catch(() => null);
    return stateIntegrity;
  }

  if (storedIntegrity?.conflict) {
    throw createUsernameConflictError({
      claimedUsername: storedIntegrity.claimedUsername || claimedUsername,
      action
    });
  }

  if (lookupSuccessful) {
    await Promise.resolve(onClearIntegrity?.(session)).catch(() => null);
    return stateIntegrity;
  }

  if (requireLookup && lookupAttempted && !lookupSuccessful) {
    throw new Error(`Could not verify whether @${claimedUsername} is available on the network. Try again in a moment.`);
  }

  await Promise.resolve(onClearIntegrity?.(session)).catch(() => null);
  return stateIntegrity;
}

export function buildSessionIdentityProjection({
  publicState = null,
  session = null,
  accountHistory = null,
  usernameIntegrity = null
} = {}) {
  const claimedUsername = normalizeClaimedUsername(session?.username);
  const staleSession = resolveStaleSessionAccount(publicState, session, { accountHistory });
  const removedAccount = resolveRemovedSessionAccount(publicState, session);
  const usernameConflict = resolveSessionUsernameConflict(publicState, session, {
    storedIntegrity: usernameIntegrity,
    accountHistory
  });
  const identityState = resolveSessionIdentityState(publicState, session);
  const blocked = Boolean(removedAccount || staleSession || usernameConflict.conflict);
  return {
    session: session || null,
    claimedUsername,
    sessionPubkey: identityState.sessionPubkey,
    canonicalPubkey: identityState.canonicalPubkey,
    currentPubkey: identityState.currentPubkey,
    identityMemberPubkeys: identityState.identityMemberPubkeys,
    removed: Boolean(removedAccount),
    removedAccount,
    removedMessage: removedAccount
      ? buildRemovedAccountMessage({
          claimedUsername: removedAccount.claimedUsername || removedAccount.username || claimedUsername
        })
      : "",
    staleKey: Boolean(staleSession),
    staleSession,
    staleMessage: staleSession
      ? buildStaleSessionMessage({
          claimedUsername: staleSession.claimedUsername || claimedUsername
        })
      : "",
    usernameConflict: Boolean(usernameConflict.conflict),
    usernameIntegrity: usernameConflict,
    usernameConflictMessage: usernameConflict.conflict
      ? buildUsernameConflictMessage({
          claimedUsername: usernameConflict.claimedUsername || claimedUsername
        })
      : "",
    accountHistory: normalizeAccountHistoryEntry(accountHistory, session),
    allowedActions: {
      openAccount: !removedAccount && !usernameConflict.conflict && !staleSession,
      publish: !removedAccount && !usernameConflict.conflict && !staleSession,
      comment: !removedAccount && !usernameConflict.conflict && !staleSession,
      rotatePassword: !removedAccount && !usernameConflict.conflict && !staleSession
    },
    blocked
  };
}
