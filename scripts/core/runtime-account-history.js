import {
  normalizeAccountHistoryEntry,
  rememberAccountRotationHistoryEntry,
  rememberCurrentAccountHistoryEntry
} from "./account-management.js";

function accountHistoryMetaKey(username = "") {
  return `account-history:${String(username || "").trim().toLowerCase()}`;
}

export async function readRuntimeAccountHistory(database, usernameOrSession = "") {
  const username = String(
    typeof usernameOrSession === "string" ? usernameOrSession : usernameOrSession?.username
  )
    .trim()
    .toLowerCase();
  if (!database || !username) return null;
  const record = await database.getMeta(accountHistoryMetaKey(username)).catch(() => null);
  return normalizeAccountHistoryEntry(record?.value || null, username);
}

export async function rememberRuntimeCurrentAccountSession(database, session = null) {
  const username = String(session?.username || "").trim().toLowerCase();
  if (!database || !username) return null;
  const current = await readRuntimeAccountHistory(database, username);
  const next = rememberCurrentAccountHistoryEntry(current, session);
  await database.setMeta(accountHistoryMetaKey(username), {
    value: next,
    updatedAt: Date.now()
  });
  return next;
}

export async function rememberRuntimeAccountRotation(database, previousSession = null, nextSession = null) {
  const username = String(nextSession?.username || previousSession?.username || "").trim().toLowerCase();
  if (!database || !username) return null;
  const current = await readRuntimeAccountHistory(database, username);
  const next = rememberAccountRotationHistoryEntry(current, previousSession, nextSession);
  await database.setMeta(accountHistoryMetaKey(username), {
    value: next,
    updatedAt: Date.now()
  });
  return next;
}

export default {
  readRuntimeAccountHistory,
  rememberRuntimeAccountRotation,
  rememberRuntimeCurrentAccountSession
};
