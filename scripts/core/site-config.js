export const SITE = Object.freeze({
  projectName: "The True Cost Project",
  shortName: "True Cost",
  tagline: "Public records investigations into how taxpayer dollars support animal agriculture.",
  donateUrl: "https://example.org/donate",
  merchUrl: "https://example.org/store",
  youtubeUrl: "https://youtube.com/@truecostproject",
  contactEmail: "tips@example.org",
  content: {
    seedEntitiesPath: "",
    graphSeedPath: "./content/graph/wiki-seed.json"
  },
  blobs: {
    baseUrl: "https://blossom.band",
    maxUploadBytes: 2000000,
    requestTimeoutMs: 8000,
    requestPollMs: 900
  },
  map: {
    defaultCenter: [39.5, -98.35],
    defaultZoom: 4,
    minZoom: 3,
    tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  },
  nostr: {
    appTag: "true-cost-project",
    clientName: "true-cost-site",
    protocolPrefix: "true-cost",
    storageNamespace: "truecost.v2",
    relays: ["wss://relay.primal.net", "wss://nos.lol"],
    authorityRelays: ["wss://relay.primal.net", "wss://nos.lol"],
    inboxPubkey: "a2841b1f4971d2a646b476982a353d0165df07f8ae88d795e4a75cd1e0d3d42f",
    rootAdminPubkey: "4e1b9528032c874fb5f2ad864afd29d26e31613fbff15150b8d5cd28c3a74933",
    maxAttachmentBytes: 90000,
    connectTimeoutMs: 3200,
    authorityConnectTimeoutMs: 9000,
    publicRefreshMs: 15000,
    publicEventCacheLimit: 800,
    publicRepairRepublishLimit: 180,
    publicLoadLimit: 400,
    privateLoadLimit: 200,
    filterChunkSize: 4,
    kinds: {
      snapshot: 34126,
      tip: 4,
      adminClaim: 34127,
      adminRole: 34128,
      userMod: 34129,
      nameClaim: 34130,
      profile: 34131,
      snapshotRequest: 34132,
      entity: 34133,
      draft: 34134,
      comment: 34135,
      commentMod: 34136,
      submissionStatus: 34137,
      adminKeyShare: 34138,
      blobRequest: 34139,
      blobFulfillment: 34140,
      visitPulse: 34141,
      siteKey: 34142,
      adminKeyRequest: 34143,
      collabDocument: 34144,
      publicStateRequest: 34145,
      commentVote: 34146,
      identityRotation: 34147,
      relationship: 34148
    }
  }
});

export default SITE;
