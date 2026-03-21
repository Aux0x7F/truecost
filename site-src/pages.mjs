export const siteTemplate = {
  lang: "en",
  themeColor: "#121212",
  csp:
    "default-src 'self'; base-uri 'self'; form-action 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https: wss:; font-src 'self' data:; object-src 'none'; media-src 'self' blob: https:; manifest-src 'self'; worker-src 'self' blob:;",
  referrer: "strict-origin-when-cross-origin",
  permissionsPolicy: "camera=(), microphone=(), geolocation=()",
  brandMark: "TC",
  brandTitle: "The True Cost Project",
  brandTagline: "Public records investigations into how taxpayer dollars support animal agriculture.",
  footer: {
    brandEyebrow: "The True Cost Project",
    brandTitle: "Public records. Clear trails. A readable archive.",
    brandBody: "Follow the money, track the entities, and keep the evidence easy to revisit.",
    columnOneTitle: "Explore",
    columnOneLinks: [
      { href: "./investigations.html", label: "Investigations" },
      { href: "./map.html", label: "Map" },
      { href: "./graph.html", label: "Graph" },
      { href: "./wiki.html", label: "Wiki" }
    ],
    columnTwoTitle: "Support",
    columnTwoLinks: [
      { href: "./get-involved.html", label: "Get involved" },
      { href: "./submit.html", label: "Submit" },
      { href: "./about.html", label: "About" },
      { href: "./merch.html", label: "Merch" }
    ]
  }
};

export const pageDefinitions = [
  {
    fileName: "index.html",
    dataPage: "home",
    title: "The True Cost Project",
    description:
      "The True Cost Project investigates how taxpayer dollars support animal agriculture and publishes public-records-based accountability reporting.",
    mainSource: "index.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "landing",
      staticKeyPrefix: "home",
      contentCollections: ["investigations"],
      interactiveMounts: ["homeInvestigations", "archiveSummary"]
    }
  },
  {
    fileName: "investigations.html",
    dataPage: "investigations",
    title: "Investigations | The True Cost Project",
    description: "Browse published investigations and draft previews from The True Cost Project.",
    mainSource: "investigations.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "collection",
      staticKeyPrefix: "investigations",
      contentCollections: ["investigations"],
      interactiveMounts: ["investigationList", "archiveFilters"]
    }
  },
  {
    fileName: "investigation.html",
    dataPage: "investigation",
    title: "Investigation | The True Cost Project",
    description: "Read a public-records investigation and review the linked evidence, entities, and comments.",
    mainSource: "investigation.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "detail",
      staticKeyPrefix: "investigation",
      contentCollections: ["investigations"],
      interactiveMounts: ["investigationArticle", "commentThread", "relatedEntities"]
    }
  },
  {
    fileName: "guide.html",
    dataPage: "guide",
    title: "Guide | The True Cost Project",
    description: "Learn the methods, workflow, and practical records process behind The True Cost Project.",
    mainSource: "guide.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "guide",
      staticKeyPrefix: "guide",
      contentCollections: [],
      interactiveMounts: ["staticPageOverlay"]
    }
  },
  {
    fileName: "submit.html",
    dataPage: "submit",
    title: "Submit | The True Cost Project",
    description: "Submit tips, documents, and records for The True Cost Project.",
    mainSource: "submit.html",
    entryScripts: ["./scripts/shell.js", "./scripts/submit.js"],
    bakedown: {
      templateKind: "intake",
      staticKeyPrefix: "submit",
      contentCollections: [],
      interactiveMounts: ["submitShell", "submissionChat"]
    }
  },
  {
    fileName: "admin.html",
    dataPage: "workspace",
    title: "Log In | The True Cost Project",
    description:
      "Log in to manage your profile, comments, and role-based workspace tools for The True Cost Project.",
    mainSource: "admin.html",
    entryScripts: ["./scripts/shell.js", "./scripts/admin.js"],
    bakedown: {
      templateKind: "workspace",
      staticKeyPrefix: "workspace",
      contentCollections: [],
      interactiveMounts: ["workspaceShell"]
    }
  },
  {
    fileName: "map.html",
    dataPage: "map",
    title: "Map | The True Cost Project",
    description: "Browse mapped entities and locations connected to The True Cost Project archive.",
    mainSource: "map.html",
    extraStyles: ["./vendor/leaflet.css"],
    extraScripts: [{ src: "./vendor/leaflet.js" }],
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "map",
      staticKeyPrefix: "map",
      contentCollections: ["entities", "investigations"],
      interactiveMounts: ["mapCanvas", "mapList"]
    }
  },
  {
    fileName: "graph.html",
    dataPage: "graph",
    title: "Graph | The True Cost Project",
    description: "Explore entity and relationship evidence as a navigable research graph.",
    mainSource: "graph.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "graph",
      staticKeyPrefix: "graph",
      contentCollections: ["graph"],
      interactiveMounts: ["graphExplorer", "graphRail"]
    }
  },
  {
    fileName: "wiki.html",
    dataPage: "wiki",
    title: "Wiki | The True Cost Project",
    description: "Open entity wiki pages connected to investigations, citations, and graph relationships.",
    mainSource: "wiki.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "wiki",
      staticKeyPrefix: "wiki",
      contentCollections: ["graph", "investigations"],
      interactiveMounts: ["wikiArticle", "wikiRail"]
    }
  },
  {
    fileName: "editor.html",
    dataPage: "editor",
    title: "Create Investigation | The True Cost Project",
    description: "Write and review investigation drafts for The True Cost Project.",
    mainSource: "editor.html",
    extraStyles: ["./vendor/toastui-editor.min.css"],
    extraScripts: [{ src: "./vendor/toastui-editor-all.min.js" }],
    entryScripts: ["./scripts/shell.js", "./scripts/editor.js"],
    bakedown: {
      templateKind: "editor",
      staticKeyPrefix: "editor",
      contentCollections: [],
      interactiveMounts: ["editorShell"]
    }
  },
  {
    fileName: "get-involved.html",
    dataPage: "get-involved",
    title: "Get Involved | The True Cost Project",
    description: "Support, contribute to, or collaborate with The True Cost Project.",
    mainSource: "get-involved.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "support",
      staticKeyPrefix: "getinvolved",
      contentCollections: [],
      interactiveMounts: ["staticPageOverlay"]
    }
  },
  {
    fileName: "about.html",
    dataPage: "about",
    title: "About | The True Cost Project",
    description: "Learn what The True Cost Project is building and why the archive is structured this way.",
    mainSource: "about.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "about",
      staticKeyPrefix: "about",
      contentCollections: [],
      interactiveMounts: ["staticPageOverlay"]
    }
  },
  {
    fileName: "merch.html",
    dataPage: "merch",
    title: "Merch | The True Cost Project",
    description: "Support The True Cost Project through merch and related support options.",
    mainSource: "merch.html",
    entryScripts: ["./scripts/shell.js", "./scripts/app.js"],
    bakedown: {
      templateKind: "support",
      staticKeyPrefix: "merch",
      contentCollections: [],
      interactiveMounts: ["staticPageOverlay"]
    }
  }
];

export default {
  pageDefinitions,
  siteTemplate
};
