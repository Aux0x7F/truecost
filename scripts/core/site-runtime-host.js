import SITE from "./site-config.js";
import {
  createIndexedRuntimeDatabase,
  createRuntimeHost
} from "../../vendor/nostr-site-support.esm.js";
import { createEmptyGraphRecordState } from "./graph-records.js";
import {
  assertNetworkSessionUsernameIntegrity
} from "./account-integrity.js";
import {
  openAccountSession,
  rotateAccountPassword
} from "./account-actions.js";
import { isUsablePublicState } from "./public-state.js";
import {
  lookupUsers,
  loadPublicState,
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
  readRuntimeAccountHistory,
  rememberRuntimeAccountRotation,
  rememberRuntimeCurrentAccountSession
} from "./runtime-account-history.js";
import {
  loadCommentsProjection,
  loadGraphProjection,
  loadMapEntitiesProjection,
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
    readRuntimeAccountHistory,
    rememberRuntimeCurrentAccountSession,
    rememberRuntimeAccountRotation,
    loadGraphProjection,
    loadWikiEntityProjection,
    loadMapEntitiesProjection,
    loadCommentsProjection,
    loadWorkspaceProjection,
    ...deps
  };

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

  const host = createRuntimeHost({
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
          assertNetworkSessionUsernameIntegrity: runtime.assertNetworkSessionUsernameIntegrity,
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
          assertNetworkSessionUsernameIntegrity: runtime.assertNetworkSessionUsernameIntegrity,
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
    projectionLoaders: {
      async publicState({ params }) {
        return loadAvailablePublicState(Boolean(params?.force));
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
      async graphDraft({ database: runtimeDatabase, session }) {
        const scopedParams = {
          __sessionScope: String(session?.pubkey || "anonymous").trim().toLowerCase()
        };
        const record = await runtimeDatabase.getProjection("graphDraft", scopedParams).catch(() => null);
        return record?.value || createEmptyGraphRecordState();
      },
      async notifications() {
        return {
          items: []
        };
      },
      ...projectionLoaders
    }
  });

  return host;
}

export default createSiteRuntimeHost;
