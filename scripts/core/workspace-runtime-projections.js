async function resolveRuntimeClient(getRuntimeClient = async () => null) {
  return Promise.resolve(typeof getRuntimeClient === "function" ? getRuntimeClient() : null).catch(() => null);
}

async function getProjectionValue(getRuntimeClient, channel = "", params = {}, options = {}) {
  const runtimeClient = await resolveRuntimeClient(getRuntimeClient);
  if (!runtimeClient) return null;
  const projection = await runtimeClient.getProjection(channel, params, {
    preferFresh: false,
    ...options
  }).catch(() => null);
  return projection?.value ?? null;
}

async function rememberProjectionValue(getRuntimeClient, channel = "", params = {}, value = null, meta = {}) {
  const runtimeClient = await resolveRuntimeClient(getRuntimeClient);
  if (!runtimeClient) return null;
  const projection = await runtimeClient.rememberProjection(channel, params, value, meta).catch(() => null);
  return projection?.value ?? null;
}

export function createWorkspaceProjectionClient({
  getRuntimeClient = async () => null,
  resolveSitePubkey = () => "",
  findSiteKeyShare = () => null
} = {}) {
  return {
    async loadCachedSiteKeyShares() {
      return (await getProjectionValue(getRuntimeClient, "workspaceSiteKeys", {}, {
        reason: "workspace-site-keys-cache"
      }))?.siteKeyShares || [];
    },

    async persistSiteKeyShares(shares = [], publicState = null) {
      const activeSitePubkey = String(resolveSitePubkey(publicState) || "").trim().toLowerCase();
      return rememberProjectionValue(getRuntimeClient, "workspaceSiteKeys", {}, {
        activeSitePubkey,
        siteKeyShares: Array.isArray(shares) ? shares : [],
        siteKeyShare: findSiteKeyShare(shares, activeSitePubkey)
      }, {
        source: "workspace-site-key-cache"
      });
    },

    async loadCachedInboxProjection() {
      return await getProjectionValue(getRuntimeClient, "workspaceInbox", {}, {
        reason: "workspace-inbox-cache"
      });
    },

    async persistInboxSubmissions(submissions = [], { sitePubkey = "", publicState = null } = {}) {
      const activeSitePubkey = String(sitePubkey || resolveSitePubkey(publicState) || "").trim().toLowerCase();
      return rememberProjectionValue(getRuntimeClient, "workspaceInbox", {}, {
        activeSitePubkey,
        submissions: Array.isArray(submissions) ? submissions : []
      }, {
        source: "workspace-inbox-cache"
      });
    },

    async clearInboxSubmissions(options = {}) {
      return this.persistInboxSubmissions([], options);
    }
  };
}

export default createWorkspaceProjectionClient;
