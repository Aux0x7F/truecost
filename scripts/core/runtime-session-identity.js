import {
  buildSessionIdentityProjection,
  normalizeAccountHistoryEntry,
  normalizeClaimedUsername,
  normalizePubkey,
  rememberAccountRotationHistoryEntry,
  rememberCurrentAccountHistoryEntry
} from "./session-identity.js";

function accountHistoryMetaKey(username = "") {
  return `account-history:${normalizeClaimedUsername(username)}`;
}

function usernameIntegrityProjectionParams(session = null) {
  const username = normalizeClaimedUsername(session?.username);
  const pubkey = normalizePubkey(session?.pubkey);
  return username && pubkey ? { username, pubkey, __projectionScope: "global" } : null;
}

export async function readRuntimeAccountHistory(database, usernameOrSession = "") {
  const username = normalizeClaimedUsername(
    typeof usernameOrSession === "string" ? usernameOrSession : usernameOrSession?.username
  );
  if (!database || !username) return null;
  const [record, seededProjection] = await Promise.all([
    database.getMeta(accountHistoryMetaKey(username)).catch(() => null),
    database.getProjection("accountHistory", { username }).catch(() => null)
  ]);
  return normalizeAccountHistoryEntry(record?.value || seededProjection?.value || null, username);
}

export async function rememberRuntimeCurrentAccountSession(database, session = null) {
  const username = normalizeClaimedUsername(session?.username);
  if (!database || !username) return null;
  const current = await readRuntimeAccountHistory(database, username);
  const next = rememberCurrentAccountHistoryEntry(current, session);
  const payload = {
    value: next,
    updatedAt: Date.now()
  };
  await Promise.all([
    database.setMeta(accountHistoryMetaKey(username), payload),
    database.setProjection("accountHistory", { username }, payload)
  ]);
  return next;
}

export async function rememberRuntimeAccountRotation(database, previousSession = null, nextSession = null) {
  const username = normalizeClaimedUsername(nextSession?.username || previousSession?.username);
  if (!database || !username) return null;
  const current = await readRuntimeAccountHistory(database, username);
  const next = rememberAccountRotationHistoryEntry(current, previousSession, nextSession);
  const payload = {
    value: next,
    updatedAt: Date.now()
  };
  await Promise.all([
    database.setMeta(accountHistoryMetaKey(username), payload),
    database.setProjection("accountHistory", { username }, payload)
  ]);
  return next;
}

export async function loadRuntimeAccountHistoryProjection({ params = {}, database } = {}) {
  return readRuntimeAccountHistory(database, params?.username || "");
}

export async function readRuntimeUsernameIntegrity(database, session = null) {
  const params = usernameIntegrityProjectionParams(session);
  if (!database || !params) return null;
  const record = await database.getProjection("usernameIntegrity", {
    username: params.username,
    pubkey: params.pubkey
  }).catch(() => null);
  return record?.value || null;
}

export async function rememberRuntimeUsernameIntegrity(host, session = null, integrity = {}) {
  const params = usernameIntegrityProjectionParams(session);
  if (!host || !params) return null;
  return host.rememberProjection(
    "usernameIntegrity",
    params,
    {
      conflict: Boolean(integrity?.conflict),
      claimedUsername: normalizeClaimedUsername(integrity?.claimedUsername || session?.username),
      ownerPubkey: normalizePubkey(integrity?.ownerPubkey),
      checkedAt: Date.now(),
      source: String(integrity?.source || "lookup").trim().toLowerCase() || "lookup"
    },
    { source: "username-integrity" }
  );
}

export async function clearRuntimeUsernameIntegrity(host, session = null) {
  const params = usernameIntegrityProjectionParams(session);
  if (!host || !params) return null;
  return host.rememberProjection("usernameIntegrity", params, null, {
    source: "username-integrity-clear"
  });
}

export async function loadRuntimeUsernameIntegrityProjection({ params = {}, database } = {}) {
  if (!database) return null;
  const username = normalizeClaimedUsername(params?.username);
  const pubkey = normalizePubkey(params?.pubkey);
  if (!username || !pubkey) return null;
  const record = await database.getProjection("usernameIntegrity", { username, pubkey }).catch(() => null);
  return record?.value || null;
}

export async function loadSessionIdentityProjection({ session, host, database } = {}) {
  const [publicState, accountHistory, usernameIntegrity] = await Promise.all([
    host.getProjectionValue("publicState", {}, { preferFresh: false }),
    readRuntimeAccountHistory(database, session),
    readRuntimeUsernameIntegrity(database, session)
  ]);
  return buildSessionIdentityProjection({
    publicState,
    session,
    accountHistory,
    usernameIntegrity
  });
}

export default {
  clearRuntimeUsernameIntegrity,
  loadRuntimeAccountHistoryProjection,
  loadRuntimeUsernameIntegrityProjection,
  loadSessionIdentityProjection,
  readRuntimeAccountHistory,
  readRuntimeUsernameIntegrity,
  rememberRuntimeAccountRotation,
  rememberRuntimeCurrentAccountSession,
  rememberRuntimeUsernameIntegrity
};
