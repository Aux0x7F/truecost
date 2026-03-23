import SITE from "./site-config.js";
import {
  createIndexedRuntimeDatabase,
  createRuntimeHost
} from "../../vendor/nostr-site-support.esm.js";
import { createEmptyGraphRecordState } from "./graph-records.js";
import {
  assertNetworkSessionUsernameIntegrity
} from "./session-identity.js";
import {
  openAccountSession,
  rotateAccountPassword
} from "./account-actions.js";
import { createSiteNotificationBuilder } from "./notification-builders.js";
import { isUsablePublicState, publicStateHasAdminPubkey } from "./public-state.js";
import {
  lookupUsers,
  loadAdminKeyShare,
  loadAdminKeyShares,
  loadInboxSubmissions,
  loadSubmissionThread,
  loadPublicState,
  loadUserSubmissions,
  publishAdminKeyShare,
  publishTaggedJson
} from "./nostr.js";
import {
  deriveIdentity
} from "./nostr.js";
import {
  deriveSecretKeyHex,
  rebroadcastAccount,
  repairSession,
  rotateAccountCredentials,
  signInWithCredentials
} from "./session.js";
import {
  clearRuntimeUsernameIntegrity,
  loadRuntimeAccountHistoryProjection,
  loadRuntimeUsernameIntegrityProjection,
  readRuntimeAccountHistory,
  readRuntimeUsernameIntegrity,
  rememberRuntimeAccountRotation,
  rememberRuntimeCurrentAccountSession,
  rememberRuntimeUsernameIntegrity,
  loadSessionIdentityProjection
} from "./runtime-session-identity.js";
import {
  loadCommentsProjection,
  loadContentPostsProjection,
  loadGraphProjection,
  loadMapEntitiesProjection,
  loadNotificationsProjection,
  loadWorkspaceInboxProjection,
  loadWorkspaceSiteKeysProjection,
  loadWikiEntityProjection,
  loadWorkspaceProjection
} from "./runtime-projections.js";

export function createSiteRuntimeHost({
  database = createIndexedRuntimeDatabase({
    namespace: SITE.nostr.storageNamespace
  }),
  deps = {},
  projectionLoaders = {}
} = {}) {
  const runtime = {
    openAccountSession,
    rotateAccountPassword,
    assertNetworkSessionUsernameIntegrity,
    lookupUsers,
    loadPublicState,
    signInWithCredentials,
    rebroadcastAccount,
    deriveSecretKeyHex,
    deriveIdentity,
    rotateAccountCredentials,
    repairSession,
    publishAdminKeyShare,
    publishTaggedJson,
    loadAdminKeyShare,
    loadAdminKeyShares,
    loadInboxSubmissions,
    loadSubmissionThread,
    loadUserSubmissions,
    readRuntimeAccountHistory,
    readRuntimeUsernameIntegrity,
    rememberRuntimeCurrentAccountSession,
    rememberRuntimeAccountRotation,
    rememberRuntimeUsernameIntegrity,
    clearRuntimeUsernameIntegrity,
    loadContentPostsProjection,
    loadGraphProjection,
    loadWikiEntityProjection,
    loadMapEntitiesProjection,
    loadCommentsProjection,
    loadNotificationsProjection,
    loadWorkspaceInboxProjection,
    loadWorkspaceSiteKeysProjection,
    loadWorkspaceProjection,
    loadSessionIdentityProjection,
    ...deps
  };

  const buildNotifications = createSiteNotificationBuilder({
    deps: {
      publicStateHasAdminPubkey,
      loadAdminKeyShare: runtime.loadAdminKeyShare,
      loadInboxSubmissions: runtime.loadInboxSubmissions,
      loadSubmissionThread: runtime.loadSubmissionThread,
      loadUserSubmissions: runtime.loadUserSubmissions
    }
  });

  async function loadAvailablePublicState(force = false) {
    const cachedRecord = await database.getProjection("publicState", {}).catch(() => null);
    const cachedPublicState = cachedRecord?.value || null;
    if (globalThis.__TRUECOST_RUNTIME_OFFLINE__) {
      return cachedPublicState;
    }
    try {
      const loaded = await runtime.loadPublicState(Boolean(force));
      if (isUsablePublicState(loaded)) {
        return loaded;
      }
      return cachedPublicState || loaded;
    } catch {
      return cachedPublicState;
    }
  }

  let host = null;

  async function assertRuntimeSessionUsernameIntegrity(publicState, session = null, options = {}) {
    const [accountHistory, storedIntegrity] = await Promise.all([
      runtime.readRuntimeAccountHistory(database, session),
      runtime.readRuntimeUsernameIntegrity(database, session)
    ]);
    return runtime.assertNetworkSessionUsernameIntegrity(publicState, session, {
      ...options,
      accountHistory,
      storedIntegrity,
      onRememberIntegrity: async (_currentSession, integrity) =>
        runtime.rememberRuntimeUsernameIntegrity(host, session, integrity),
      onClearIntegrity: async () =>
        runtime.clearRuntimeUsernameIntegrity(host, session)
    });
  }

  host = createRuntimeHost({
    database,
    auth: {
      async signIn({ username, password }) {
        return runtime.openAccountSession({
          username,
          password,
          loadPublicState: async () => loadAvailablePublicState(true),
          signInWithCredentials: runtime.signInWithCredentials,
          saveSession: async () => null,
          rebroadcastAccount: runtime.rebroadcastAccount,
          rememberCurrentAccountSession: async (session) =>
            runtime.rememberRuntimeCurrentAccountSession(database, session),
          assertNetworkSessionUsernameIntegrity: assertRuntimeSessionUsernameIntegrity,
          lookupUsers: runtime.lookupUsers
        });
      },
      async signOut() {
        return {
          session: null
        };
      },
      async rotatePassword(payload = {}) {
        const profilePayload = payload?.profilePayload && typeof payload.profilePayload === "object"
          ? { ...payload.profilePayload }
          : null;
        return runtime.rotateAccountPassword({
          session: payload.session,
          nextPassword: payload.nextPassword,
          currentPublicState: await loadAvailablePublicState(false),
          accountHistory: null,
          loadAccountHistory: (session) => runtime.readRuntimeAccountHistory(database, session),
          loadPublicState: async () => loadAvailablePublicState(true),
          deriveSecretKeyHex: runtime.deriveSecretKeyHex,
          deriveIdentity: runtime.deriveIdentity,
          assertNetworkSessionUsernameIntegrity: assertRuntimeSessionUsernameIntegrity,
          lookupUsers: runtime.lookupUsers,
          rotateAccountCredentials: runtime.rotateAccountCredentials,
          repairAccountSession: (session) =>
            runtime.repairSession(session, {
              persistSession: false
            }),
          saveSession: async () => null,
          rememberAccountRotation: async (previousSession, nextSession) =>
            runtime.rememberRuntimeAccountRotation(database, previousSession, nextSession),
          afterCommit: async ({ previousSession, rotation }) => {
            const warnings = [];
            if (payload?.isAdmin && payload?.siteKeyShare?.siteSecretKeyHex) {
              try {
                await runtime.publishAdminKeyShare(
                  previousSession.secretKeyHex,
                  rotation.session.pubkey,
                  payload.siteKeyShare.siteSecretKeyHex
                );
              } catch (error) {
                warnings.push(
                  String(error?.message || error || "The inbox key share could not be refreshed yet.")
                );
              }
            }
            if (profilePayload) {
              try {
                await runtime.rebroadcastAccount(rotation.session, profilePayload);
              } catch (error) {
                warnings.push(
                  String(error?.message || error || "The account profile could not be refreshed on the network yet.")
                );
              }
            }
            return { warnings };
          }
        });
      }
    },
    relay: {
      async publish(payload = {}) {
        return runtime.publishTaggedJson(payload);
      }
    },
    actions: {
      async "activity.recordVisitPulse"(payload = {}, { session }) {
        const secretKeyHex = String(session?.secretKeyHex || payload?.secretKeyHex || "").trim().toLowerCase();
        const day = String(payload?.day || new Date().toISOString().slice(0, 10)).trim();
        const page = String(payload?.page || "site").trim().toLowerCase() || "site";
        if (!secretKeyHex || !day || !SITE?.nostr?.kinds?.visitPulse) return null;
        const markerParams = {
          day,
          __projectionScope: "global"
        };
        const marker = await host.getProjectionValue("visitPulseMarker", markerParams, {
          preferFresh: false
        }).catch(() => null);
        if (marker) return marker;
        await runtime.publishTaggedJson({
          kind: SITE.nostr.kinds.visitPulse,
          secretKeyHex,
          tags: [
            ["t", SITE.nostr.appTag],
            ["k", page]
          ],
          content: {
            day,
            page
          }
        });
        const saved = {
          page,
          recordedAt: Date.now()
        };
        await host.rememberProjection("visitPulseMarker", markerParams, saved, {
          source: "visit-pulse"
        });
        return saved;
      }
    },
    projectionLoaders: {
      async publicState({ params }) {
        return loadAvailablePublicState(Boolean(params?.force));
      },
      async accountHistory(context) {
        return loadRuntimeAccountHistoryProjection(context);
      },
      async usernameIntegrity(context) {
        return loadRuntimeUsernameIntegrityProjection(context);
      },
      async sessionIdentity(context) {
        return loadSessionIdentityProjection(context);
      },
      async contentPosts(context) {
        return runtime.loadContentPostsProjection(context);
      },
      async graph(context) {
        return runtime.loadGraphProjection(context);
      },
      async wikiEntity(context) {
        return runtime.loadWikiEntityProjection(context);
      },
      async mapEntities(context) {
        return runtime.loadMapEntitiesProjection(context);
      },
      async comments(context) {
        return runtime.loadCommentsProjection(context);
      },
      async workspace(context) {
        return runtime.loadWorkspaceProjection(context);
      },
      async notifications(context) {
        return runtime.loadNotificationsProjection({
          ...context,
          buildNotifications
        });
      },
      async workspaceAccess(context) {
        return runtime.loadWorkspaceProjection(context);
      },
      async workspaceSiteKeys(context) {
        return runtime.loadWorkspaceSiteKeysProjection({
          ...context,
          loadAdminKeyShare: runtime.loadAdminKeyShare,
          loadAdminKeyShares: runtime.loadAdminKeyShares,
          deriveIdentity: runtime.deriveIdentity
        });
      },
      async workspaceInbox(context) {
        return runtime.loadWorkspaceInboxProjection({
          ...context,
          loadInboxSubmissions: runtime.loadInboxSubmissions
        });
      },
      async graphDraft({ database: runtimeDatabase, session }) {
        const scopedParams = {
          __sessionScope: String(session?.pubkey || "anonymous").trim().toLowerCase()
        };
        const record = await runtimeDatabase.getProjection("graphDraft", scopedParams).catch(() => null);
        return record?.value || createEmptyGraphRecordState();
      },
      ...projectionLoaders
    }
  });

  return host;
}

export default createSiteRuntimeHost;
