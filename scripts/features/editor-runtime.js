import { Editor } from "@tiptap/core";
import SITE from "../core/site-config.js";
import { createUniqueSlug, splitTags } from "../core/content-utils.js";
import {
  getMockAdminSession,
  installLocalDevelopmentHelpers,
  isLocalMockAdminEnabled,
  mergeLocalAdminPublicState
} from "../core/dev-local-admin.js";
import {
  cleanSlug,
  connectStructuredUnitOverlay,
  deriveIdentity,
  ensureEventToolsLoaded,
  getCachedPublicState,
  publishTaggedJson,
  uploadPublicBlob
} from "../core/nostr.js";
import { createPublicStateProjectionStore } from "../core/public-state-projection.js";
import { publicStateSnapshotStorageKey, sanitizeStoredPublicStateSnapshot } from "../core/public-state-cache.js";
import { replaceEditorShellMarkup } from "../core/editor-mount.js";
import { normalizeAdminPubkeys, publicStateHasAdminPubkey } from "../core/public-state.js";
import { createSiteDocumentController } from "../core/runtime-document.js";
import { createRuntimeDocumentLocalState } from "../core/document-local-state.js";
import { createDocumentProjectionSync } from "../core/document-projection-sync.js";
import { getSiteRuntimeClient } from "../core/runtime-client.js";
import { renderLoadingState } from "../core/rendering.js";
import {
  deriveInvestigationStructuredArtifacts,
  editorDocumentFromInvestigationRecord,
  emptyInvestigationBodyJson,
  investigationDocumentId,
  normalizeInvestigationBodyJson
} from "../core/investigation-document.js";
import {
  createInvestigationEditorExtensions,
  editorToolbarState,
  findSelectedEditorNode,
  isInspectableEditorNode,
  normalizeCitationAttrs,
  normalizeEntityTileAttrs,
  normalizeEntityRefAttrs,
  normalizeMultimediaAttrs,
  updateSelectedInvestigationNode
} from "../core/investigation-editor-schema.js";
import {
  createImageAssetFromFile,
  dataUrlToBlob,
  filterImageAssets,
  normalizeImageAsset,
  normalizeImageAssets,
  resolveImageAssetUrl,
  serializeImageAssetForDraft,
  serializeImageAssetForLocalState,
  updateImageAsset
} from "../core/editor-image-assets.js";
import { escapeAttribute, escapeHtml, lastCommaValue } from "../core/text-utils.js";
import { getStoredSession, resolveStoredSession } from "../core/session.js";
import { createEditorPageController } from "./editor-page.js";
import { createEditorLiveOverlayController } from "./editor-live-overlay.js";
import {
  renderEditorCitationsView,
  renderEditorLoadingMarkup,
  renderEditorModalView,
  renderEditorRailView,
  renderEditorShellView,
  renderEditorToolbarView
} from "../surfaces/editor-shell.js";

const DEFAULT_DATE = () => new Date().toISOString().slice(0, 10);
const documentRef = globalThis.document;
const windowRef = globalThis.window;

installLocalDevelopmentHelpers();

const editorState = {
  session: getStoredSession(),
  viewer: null,
  publicState: null,
  staticSlugs: [],
  currentSlug: "",
  relayVersions: [],
  localSnapshots: [],
  editor: null,
  liveController: null,
  liveDocumentId: "",
  liveStatus: "idle",
  liveMessage: "",
  livePublishTimer: 0,
  saveStatus: { state: "idle", message: "Unsaved" },
  saveToast: { state: "idle", message: "", visible: false },
  projectionStatus: { state: "idle", message: "Projection idle" },
  localTimer: 0,
  relayTimer: 0,
  document: null,
  documentController: null,
  documentControllerId: "",
  documentProjection: null,
  documentProjectionFingerprint: "",
  documentSyncTimer: 0,
  lastLocalFingerprint: "",
  lastRelayFingerprint: "",
  draftStatus: "draft",
  activePickerField: "",
  modalRoot: null,
  activeRailPanel: "document",
  mobileRailOpen: false,
  imageAssets: [],
  filteredImageAssets: [],
  activeImageAssetId: "",
  imageAssetSearchQuery: "",
  activeImageAsset: null,
  bannerPresets: [],
  activeBannerPresetId: "",
  pendingWrappedVariant: "image",
  wrappedInsertMenuOpen: false,
  multimediaDraft: null,
  multimediaDraftSourcePos: 0,
  multimediaInsertMode: false,
  skipNextMultimediaDraftCapture: false,
  multimediaEditorMode: "",
  imageEditorMode: "",
  citationDraft: null,
  citationEditorOpen: false,
  editingCitationId: "",
  documentCitations: [],
  entityTileDraft: null,
  entityTileMatches: [],
  entityTileDraftSourcePos: 0,
  entityTileInsertMode: false,
  skipNextEntityDraftCapture: false,
  entityTileEditorMode: "",
  selectedNode: null,
  cropGesture: null,
  arrangementGesture: null,
  arrangementDirty: false,
  documentClicksBound: false,
  optimisticAdmin: false,
  mockMode: false,
  mockModeMessage: "",
  formatMenuOpen: false,
  linkEditorOpen: false,
  linkDraft: { text: "", href: "" },
  toolbarOverlayFrame: 0,
  chromeRefreshFrame: 0,
  multimediaSessionSnapshot: null,
  saveToastTimer: 0,
  suppressSyncDepth: 0,
  suppressEditorEvents: 0
};

const localDocumentState = createRuntimeDocumentLocalState({
  getRuntimeClient: async () => getSiteRuntimeClient(),
  resolveParams: (slug = "") => ({
    docId: investigationDocumentId(slug || "unsaved") || "investigation:unsaved"
  }),
  draftKey: "draft"
});

const editorPublicStateStore = createPublicStateProjectionStore({
  getSessionSecretKey: async () => editorState.session?.secretKeyHex || "",
  page: "editor",
  refreshDelayMs: () => 0,
  shouldRefresh: () => false
});
editorState.publicState = editorPublicStateStore.value;
editorPublicStateStore.subscribe((snapshot) => {
  editorState.publicState = snapshot.value;
});

const documentProjectionSync = createDocumentProjectionSync({
  window: windowRef,
  state: editorState,
  canEdit: () => Boolean(editorState.session && currentUserIsAdmin()),
  resolveDocId: () => resolveCurrentDocumentId(),
  createController: async ({ docId, initialDocument }) =>
    createSiteDocumentController({
      docId,
      kind: "investigation",
      initialDocument
    }),
  buildDocument: () => buildCurrentStructuredDocument(),
  projectionToDocument: (projection) => {
    if (!projection?.document) return null;
    return normalizeEditorDocument({
      slug: editorState.currentSlug,
      structured_document: projection.document
    });
  },
  readCurrentDocument: () => readCurrentDocument(),
  createBlankDocument,
  fingerprintDocument,
  applyDocument: (nextDocument) => {
    applyDocument(nextDocument, { restoreSelection: false });
  },
  updateMetaPanel: (message) => {
    setProjectionStatus("success", message || "Projection restored");
  },
  restoreMessage: "Restored structured document state."
});

const liveOverlayController = createEditorLiveOverlayController({
  window: windowRef,
  state: editorState,
  connectStructuredUnitOverlay,
  kind: SITE.nostr.kinds.collabDocument,
  resolveSlug: () => editorState.currentSlug,
  investigationDocumentId,
  currentUserIsAdmin: () => currentUserIsAdmin(),
  trustedAdminPubkeys: () => trustedAdminPubkeys(),
  buildDraftPayload: (status) => buildDraftPayload(status),
  draftToDocument: (value) => normalizeEditorDocument(value),
  fingerprintDocument,
  readCurrentDocument: () => readCurrentDocument(),
  applyDocument: (nextDocument) => {
    applyDocument(nextDocument, { restoreSelection: false });
  },
  updateMetaPanel: (message) => {
    if (message) setLiveStatus(editorState.liveStatus || "connected", message);
  }
});

const editorPage = createEditorPageController({
  deps: {
    document: documentRef,
    window: windowRef,
    sessionChangedEvent: "truecost:session-changed"
  },
  callbacks: {
    beforeSessionRefresh: async () => {
      destroyEditorRuntime();
    },
    beforePageHide: async () => {
      destroyEditorRuntime();
    },
    initPage: async (force = false) => {
      await initEditorPage(force);
    }
  }
});

export function startInvestigationEditorRuntime() {
  bindGlobalCropEvents();
  return editorPage?.start();
}

async function initEditorPage(force = false) {
  renderEditorLoading("Opening authoring...");
  const mockAdminEnabled = isLocalMockAdminEnabled();
  const storedSession = mockAdminEnabled ? getMockAdminSession() : getStoredSession();
  editorState.session = storedSession;
  editorState.viewer = mockAdminEnabled && storedSession
    ? { pubkey: storedSession.pubkey, secretKeyHex: storedSession.secretKeyHex }
    : null;
  editorState.optimisticAdmin = Boolean(storedSession?.pubkey);
  editorState.mockMode = mockAdminEnabled;
  editorState.mockModeMessage = mockAdminEnabled
    ? "UI-only mock mode"
    : "";
  const cachedPublicState = !force
    ? (
        mockAdminEnabled
          ? mergeLocalAdminPublicState(editorPublicStateStore.value || readCachedPublicStateSnapshot() || null)
          : (editorPublicStateStore.value || readCachedPublicStateSnapshot())
      )
    : null;
  const cachedPubkey = String(storedSession?.pubkey || "").trim().toLowerCase();
  const canRenderFromCache = Boolean(
    cachedPublicState &&
    cachedPubkey &&
    publicStateHasAdminPubkey(cachedPublicState, cachedPubkey)
  );

  if (!storedSession) {
    editorState.publicState = editorState.publicState || { admins: [] };
    editorState.staticSlugs = [];
    editorState.document = createBlankDocument();
    renderEditorShell();
  }

  if (canRenderFromCache) {
    editorState.session = storedSession;
    editorState.viewer = { pubkey: cachedPubkey };
    editorState.publicState = cachedPublicState;
    const requestedSlug = cleanSlug(new URLSearchParams(windowRef?.location?.search || "").get("slug") || "");
    const relayDrafts = (cachedPublicState?.drafts || []).filter(
      (draft) => String(draft?.content_type || "").trim().toLowerCase() !== "page"
    );
    const relayDraft = requestedSlug
      ? relayDrafts.find((draft) => draft.slug === requestedSlug) || null
      : null;
    editorState.currentSlug = relayDraft?.slug || requestedSlug || "";
    editorState.relayVersions = Array.isArray(relayDraft?.revisions)
      ? relayDraft.revisions.slice()
      : relayDraft
        ? [relayDraft]
        : [];
    editorState.draftStatus = relayDraft?.status || "draft";
    editorState.localSnapshots = [];
    editorState.document = normalizeEditorDocument(relayDraft || createBlankDocument());
    renderEditorShell();
  }

  if (storedSession && !canRenderFromCache) {
    const requestedSlug = cleanSlug(new URLSearchParams(windowRef?.location?.search || "").get("slug") || "");
    const bootstrapState = readEditorBootstrapState(requestedSlug);
    editorState.session = storedSession;
    editorState.viewer = cachedPubkey ? { pubkey: cachedPubkey } : null;
    editorState.publicState = editorState.publicState || { admins: [] };
    editorState.currentSlug = requestedSlug;
    editorState.relayVersions = [];
    editorState.draftStatus = "draft";
    editorState.localSnapshots = Array.isArray(bootstrapState?.history) ? bootstrapState.history : [];
    editorState.document = normalizeEditorDocument(
      bootstrapState?.draft || {
        ...createBlankDocument(),
        slug: requestedSlug
      }
    );
    renderEditorShell();
  }

  if (mockAdminEnabled && storedSession) {
    editorState.session = storedSession;
    editorState.viewer = { pubkey: storedSession.pubkey, secretKeyHex: storedSession.secretKeyHex };
    editorState.publicState = mergeLocalAdminPublicState(editorState.publicState || cachedPublicState || null);
    editorState.staticSlugs = await loadStaticSlugs().catch(() => []);
    await hydrateDraftState({ preferImmediate: true });
    renderEditorShell();
    return;
  }

  const resolvedSession = await resolveStoredSession({
    persistSession: true
  }).catch(() => storedSession || getStoredSession());
  editorState.session = resolvedSession || null;
  editorState.optimisticAdmin = false;
  editorState.mockMode = false;
  editorState.mockModeMessage = "";

  if (!resolvedSession) {
    if (!canRenderFromCache) {
      editorState.publicState = editorState.publicState || { admins: [] };
      editorState.staticSlugs = [];
      editorState.document = editorState.document || createBlankDocument();
      renderEditorShell();
    }
    return;
  }

  await ensureEventToolsLoaded();
  editorState.viewer = deriveIdentity(resolvedSession.secretKeyHex);

  const hydratedPublicState = await editorPublicStateStore
    .hydrate({ force, reason: "editor-load" })
    .then((result) => result.value)
    .catch(() => editorState.publicState || cachedPublicState || { admins: [] });
  editorState.publicState = hydratedPublicState;
  editorState.staticSlugs = await loadStaticSlugs().catch(() => []);
  await hydrateDraftState({ preferImmediate: true });
  if (editorState.editor && currentUserIsAdmin()) {
    applyDocument(editorState.document || createBlankDocument(), { restoreSelection: false });
    refreshEditorChrome();
    return;
  }
  if (!canRenderFromCache || currentUserIsAdmin()) {
    renderEditorShell();
  } else {
    refreshEditorChrome();
  }
}

function renderEditorLoading(message) {
  const shell = documentRef?.querySelector?.("[data-editor-shell]");
  if (!(shell instanceof HTMLElement)) return;
  replaceEditorShellMarkup(shell, editorState, renderEditorLoadingMarkup(message, { renderLoadingState }));
}

function renderEditorShell() {
  const shell = documentRef?.querySelector?.("[data-editor-shell]");
  if (!(shell instanceof HTMLElement)) return;

  const view = renderEditorShellView({
    editorState,
    deps: {
      currentUserIsAdmin,
      canOpenAuthoringShell,
      escapeAttribute,
      escapeHtml,
      previewHref: currentPreviewHref()
    }
  });
  replaceEditorShellMarkup(shell, editorState, view.shellMarkup);
  renderEditorModal();

  if (!editorState.session || !canOpenAuthoringShell()) return;

  bindEditorShell();
  mountEditorSurface();
  if (!editorState.mockMode) {
    void ensureLiveOverlay();
    void ensureDocumentProjection();
  }
  refreshEditorChrome();
}

function bindEditorShell() {
  const layout = documentRef?.querySelector?.("[data-editor-layout]");
  if (!(layout instanceof HTMLElement) || layout.dataset.bound === "true") return;

  layout.dataset.bound = "true";
  layout.addEventListener("input", handleShellInput);
  layout.addEventListener("change", handleShellChange);
  layout.addEventListener("click", handleShellClick);
  layout.addEventListener("pointerdown", handleShellPointerDown, true);
  layout.addEventListener("touchstart", handleShellTouchStart, { passive: false });
  layout.addEventListener("touchmove", handleShellTouchMove, { passive: false });
  layout.addEventListener("touchend", handleShellTouchEnd, { passive: false });

  if (!editorState.documentClicksBound) {
    documentRef?.addEventListener?.("click", handleDocumentClick, true);
    editorState.documentClicksBound = true;
  }
}

function mountEditorSurface() {
  const surface = documentRef?.querySelector?.("[data-editor-surface]");
  if (!(surface instanceof HTMLElement)) return;

  const initialDocument = normalizeEditorDocument(editorState.document || createBlankDocument());
  editorState.editor?.destroy?.();
  editorState.editor = new Editor({
    element: surface,
    extensions: createInvestigationEditorExtensions(),
    content: initialDocument.bodyJson || emptyInvestigationBodyJson(),
    onSelectionUpdate: () => {
      queueEditorChromeRefresh();
    },
    onTransaction: ({ transaction }) => {
      if (transaction?.selectionSet) {
        queueEditorChromeRefresh();
      }
    },
    onUpdate: () => {
      handleEditorMutation();
    }
  });
  hydrateSurfaceFromDocument(initialDocument);
  refreshEditorChrome();
}

async function hydrateDraftState({ preferImmediate = false } = {}) {
  const requestedSlug = cleanSlug(new URLSearchParams(windowRef?.location?.search || "").get("slug") || "");
  const relayDrafts = (editorState.publicState?.drafts || []).filter(
    (draft) => String(draft?.content_type || "").trim().toLowerCase() !== "page"
  );
  const relayDraft = requestedSlug
    ? relayDrafts.find((draft) => draft.slug === requestedSlug) || null
    : null;

  editorState.currentSlug = relayDraft?.slug || requestedSlug || "";
  editorState.relayVersions = Array.isArray(relayDraft?.revisions)
    ? relayDraft.revisions.slice()
    : relayDraft
      ? [relayDraft]
      : [];
  editorState.draftStatus = relayDraft?.status || "draft";
  const bootstrapState = readEditorBootstrapState(editorState.currentSlug);
  const fallbackDocument = normalizeEditorDocument(bootstrapState?.draft || relayDraft || createBlankDocument());
  editorState.document = fallbackDocument;
  editorState.localSnapshots = Array.isArray(bootstrapState?.history) ? bootstrapState.history : [];
  editorState.lastLocalFingerprint = fingerprintDocument(fallbackDocument);
  editorState.lastRelayFingerprint = relayDraft
    ? fingerprintDocument(normalizeEditorDocument(relayDraft), relayDraft.status)
    : "";

  const localStatePromise = Promise.all([
    localDocumentState.loadDraft(editorState.currentSlug),
    localDocumentState.loadHistory(editorState.currentSlug)
  ]).catch(() => [null, []]);

  if (preferImmediate) {
    void localStatePromise.then(([localDocument, localHistory]) => {
      applyResolvedLocalDraftState({
        slug: editorState.currentSlug,
        relayDraft,
        fallbackDocument,
        localDocument,
        localHistory
      });
    });
    return;
  }

  const [localDocument, localHistory] = await localStatePromise;
  applyResolvedLocalDraftState({
    slug: editorState.currentSlug,
    relayDraft,
    fallbackDocument,
    localDocument,
    localHistory
  });
}

function applyResolvedLocalDraftState({
  slug = "",
  relayDraft = null,
  fallbackDocument = createBlankDocument(),
  localDocument = null,
  localHistory = []
} = {}) {
  if (slug && cleanSlug(editorState.currentSlug || "") !== cleanSlug(slug)) return;

  const source = localDocument || relayDraft || fallbackDocument || createBlankDocument();
  const nextDocument = normalizeEditorDocument(source);
  hydrateImageAssetsFromDocument(nextDocument);
  const nextSnapshots = Array.isArray(localHistory) ? localHistory : [];
  const relayFingerprint = relayDraft
    ? fingerprintDocument(normalizeEditorDocument(relayDraft), relayDraft.status)
    : "";
  const nextFingerprint = fingerprintDocument(nextDocument);

  editorState.localSnapshots = nextSnapshots;
  editorState.lastRelayFingerprint = relayFingerprint;

  if (!editorState.editor) {
    editorState.document = nextDocument;
    editorState.lastLocalFingerprint = nextFingerprint;
    return;
  }

  const currentDocument = readCurrentDocument();
  const baselineFingerprint = fingerprintDocument(fallbackDocument);
  const currentFingerprint = fingerprintDocument(currentDocument);
  if (currentFingerprint !== baselineFingerprint) {
    refreshEditorChrome();
    return;
  }

  editorState.document = nextDocument;
  editorState.lastLocalFingerprint = nextFingerprint;
  applyDocument(nextDocument, { restoreSelection: false });
}

function createBlankDocument() {
  return {
    slug: "",
    title: "",
    date: DEFAULT_DATE(),
    summary: "",
    tags: [],
    primaryEntity: "",
    entityRefs: [],
    featured: false,
    bodyJson: emptyInvestigationBodyJson(),
    relationshipCandidates: [],
    citations: [],
    mediaAssets: []
  };
}

function normalizeEditorDocument(record = {}) {
  const documentValue = editorDocumentFromInvestigationRecord(record);
  return {
    ...createBlankDocument(),
    ...documentValue,
    slug: cleanSlug(documentValue.slug || record.slug || ""),
    tags: Array.isArray(documentValue.tags) ? documentValue.tags.slice() : [],
    entityRefs: Array.isArray(documentValue.entityRefs) ? documentValue.entityRefs.slice() : [],
    relationshipCandidates: Array.isArray(documentValue.relationshipCandidates)
      ? cloneValue(documentValue.relationshipCandidates)
      : [],
    citations: Array.isArray(documentValue.citations)
      ? cloneValue(documentValue.citations)
      : [],
    mediaAssets: normalizeImageAssets(documentValue.mediaAssets || record.mediaAssets || record.media_assets),
    bodyJson: normalizeInvestigationBodyJson(
      documentValue.bodyJson || documentValue.body_json || record.bodyJson || record.body_json
    )
  };
}

function destroyEditorRuntime() {
  editorState.editor?.destroy?.();
  editorState.editor = null;
  liveOverlayController.destroy();
  documentProjectionSync.destroy();
  clearTimer("localTimer");
  clearTimer("relayTimer");
  clearTimer("livePublishTimer");
  clearTimer("documentSyncTimer");
  if (editorState.chromeRefreshFrame) {
    windowRef?.cancelAnimationFrame?.(editorState.chromeRefreshFrame);
    editorState.chromeRefreshFrame = 0;
  }
  editorState.selectedNode = null;
  editorState.cropGesture = null;
  clearArrangementGesture();
}

function clearTimer(key) {
  const timer = editorState[key];
  if (!timer) return;
  windowRef?.clearTimeout?.(timer);
  editorState[key] = 0;
}

function handleEditorMutation() {
  if (editorState.suppressEditorEvents > 0) {
    queueEditorChromeRefresh();
    return;
  }
  const nextBodyJson = normalizeInvestigationBodyJson(
    editorState.editor?.getJSON?.() || editorState.document?.bodyJson || emptyInvestigationBodyJson()
  );
  editorState.document = normalizeEditorDocument({
    ...(editorState.document || createBlankDocument()),
    citations: cloneValue(editorState.documentCitations),
    mediaAssets: normalizeImageAssets(editorState.imageAssets),
    bodyJson: nextBodyJson,
    body_json: nextBodyJson
  });
  ensureEditorSlug();
  setSaveStatus("pending", "Unsaved");
  scheduleLocalSnapshot();
  scheduleRelaySave();
  scheduleDerivedProjection();
  scheduleLivePublish();
  queueEditorChromeRefresh();
}

function hydrateSurfaceFromDocument(nextDocument) {
  const normalized = normalizeEditorDocument(nextDocument);
  editorState.document = normalized;
  editorState.citationDraft = editorState.citationDraft || createBlankCitationDraft();
  editorState.entityTileDraft = editorState.entityTileDraft || createBlankEntityTileDraft();
  editorState.multimediaDraft = editorState.multimediaDraft || createBlankMultimediaDraft();
}

function readCurrentDocument(eventTarget = null) {
  const baseline = normalizeEditorDocument(editorState.document || createBlankDocument());
  const bodyJson = normalizeInvestigationBodyJson(
    editorState.editor?.getJSON?.() || baseline.bodyJson || emptyInvestigationBodyJson()
  );
  return normalizeEditorDocument({
    ...baseline,
    slug: editorState.currentSlug || baseline.slug || "",
    title: readInputEventValue(eventTarget, "title", '[name="title"]', baseline.title),
    summary: readTextareaEventValue(eventTarget, "summary", '[name="summary"]', baseline.summary),
    date: readInputEventValue(eventTarget, "date", '[name="date"]', baseline.date || DEFAULT_DATE()),
    tags: splitTags(readInputEventValue(eventTarget, "tags", '[name="tags"]', (baseline.tags || []).join(", "))),
    primaryEntity: readInputEventValue(eventTarget, "primaryEntity", '[name="primaryEntity"]', baseline.primaryEntity),
    entityRefs: splitTags(readInputEventValue(eventTarget, "entityRefs", '[name="entityRefs"]', (baseline.entityRefs || []).join(", "))),
    featured: readCheckboxEventValue(eventTarget, "featured", '[name="featured"]', baseline.featured),
    citations: cloneValue(editorState.documentCitations.length ? editorState.documentCitations : baseline.citations),
    mediaAssets: normalizeImageAssets(editorState.imageAssets),
    body_json: bodyJson
  });
}

function buildCurrentStructuredDocument() {
  const current = readCurrentDocument();
  const primaryEntity = resolveEntityByNameOrSlug(current.primaryEntity);
  const resolvedRefs = [
    primaryEntity?.slug || "",
    ...current.entityRefs.map((value) => resolveEntityByNameOrSlug(value)?.slug || cleanSlug(value))
  ];
  return deriveInvestigationStructuredArtifacts({
    slug: current.slug || current.title || "unsaved",
    title: current.title,
    summary: current.summary,
    bodyJson: current.bodyJson,
    entityRefs: dedupe(resolvedRefs),
    tags: current.tags,
    mediaAssets: current.mediaAssets
  }).structuredDocument;
}

function scheduleLocalSnapshot() {
  clearTimer("localTimer");
  editorState.localTimer = windowRef?.setTimeout?.(() => {
    editorState.localTimer = 0;
    void persistLocalSnapshot("Auto-saved");
  }, 1200) || 0;
}

function scheduleRelaySave() {
  if (editorState.mockMode) return;
  clearTimer("relayTimer");
  editorState.relayTimer = windowRef?.setTimeout?.(() => {
    editorState.relayTimer = 0;
    void saveDraftNow("draft", true);
  }, 12000) || 0;
}

function scheduleDerivedProjection(force = false, delayMs = force ? 50 : 300) {
  if (editorState.mockMode) return;
  documentProjectionSync.schedule(force, delayMs);
}

function scheduleLivePublish(delayMs = 700) {
  if (editorState.mockMode) return;
  liveOverlayController.schedule(delayMs);
}

async function ensureLiveOverlay() {
  if (editorState.mockMode) return null;
  if (!editorState.currentSlug) return null;
  await liveOverlayController.ensure().catch((error) => {
    setLiveStatus("error", String(error?.message || error || "Live draft connection failed."));
    return null;
  });
  return editorState.liveController;
}

async function ensureDocumentProjection() {
  if (editorState.mockMode) return null;
  if (!editorState.currentSlug) return null;
  return documentProjectionSync.ensure().catch((error) => {
    setProjectionStatus("error", String(error?.message || error || "Projection open failed."));
    return null;
  });
}

async function persistLocalSnapshot(label) {
  const nextDocument = readCurrentDocument();
  if (!nextDocument.title.trim() && !bodyHasContent(nextDocument.bodyJson)) return;

  const fingerprint = fingerprintDocument(nextDocument);
  const forceHistoryEntry = String(label || "").trim().toLowerCase() === "manual snapshot";
  const pendingWrites = [
    localDocumentState.saveDraft(editorState.currentSlug, nextDocument)
  ];

  if (forceHistoryEntry || fingerprint !== editorState.lastLocalFingerprint) {
    editorState.localSnapshots.unshift({
      id: `${Date.now()}`,
      saved_at: new Date().toISOString(),
      label,
      document: cloneValue(nextDocument)
    });
    editorState.localSnapshots = editorState.localSnapshots.slice(0, 10);
    pendingWrites.push(localDocumentState.saveHistory(editorState.currentSlug, editorState.localSnapshots));
    editorState.lastLocalFingerprint = fingerprint;
  }
  writeEditorBootstrapState(editorState.currentSlug, {
    draft: nextDocument,
    history: editorState.localSnapshots
  });
  void Promise.all(pendingWrites).catch(() => null);

  setSaveStatus("success", `Saved locally ${formatTime(new Date().toISOString())}`);
  refreshEditorChrome();
}

async function saveDraftNow(status = "draft", silent = false) {
  if (editorState.mockMode) {
    setSaveStatus("idle", "Review/publish is disabled in local mock admin mode.");
    refreshEditorChrome();
    return;
  }
  if (!editorState.session || !currentUserIsAdmin()) return;

  const payload = buildDraftPayload(status);
  if (!payload.title.trim() || !bodyHasContent(payload.body_json)) return;
  const fingerprint = fingerprintDocument(payload, status);
  if (silent && fingerprint === editorState.lastRelayFingerprint) return;

  setSaveStatus("pending", status === "candidate" ? "Sending to review..." : "Saving draft...");

  const result = await publishTaggedJson({
    kind: SITE.nostr.kinds.draft,
    secretKeyHex: editorState.session.secretKeyHex,
    tags: [
      ["d", payload.slug],
      ["status", status]
    ],
    content: {
      ...payload,
      updated_at: new Date().toISOString()
    }
  });

  if (!editorState.currentSlug) {
    editorState.currentSlug = payload.slug;
    await moveLocalDraftStateToSlug(payload.slug);
  }

  editorState.draftStatus = status;
  editorState.lastRelayFingerprint = fingerprint;
  if (result?.id) {
    editorState.relayVersions.unshift({
      ...payload,
      id: result.id,
      created_at: Math.floor(Date.now() / 1000)
    });
  }

  scheduleDerivedProjection(true);
  setSaveStatus("success", status === "candidate" ? "Sent to review." : "Draft saved.");
  refreshEditorChrome();
}

function buildDraftPayload(status = "draft") {
  const current = readCurrentDocument();
  const primaryEntity = resolveEntityByNameOrSlug(current.primaryEntity);
  const resolvedRefs = [
    primaryEntity?.slug || "",
    ...current.entityRefs.map((value) => resolveEntityByNameOrSlug(value)?.slug || cleanSlug(value))
  ];
  const slug = editorState.currentSlug || createUniqueSlug(current.title || "untitled", takenSlugs());
  const structuredArtifacts = deriveInvestigationStructuredArtifacts({
    slug,
    title: current.title,
    summary: current.summary,
    bodyJson: current.bodyJson,
    entityRefs: dedupe(resolvedRefs),
    tags: current.tags,
    mediaAssets: current.mediaAssets
  });

  return {
    slug,
    title: current.title || "Untitled investigation",
    date: current.date,
    location: primaryEntity?.name || primaryEntity?.location || "Undisclosed location",
    status,
    content_type: "investigation",
    author_pubkey: draftOwnerPubkey(),
    summary: current.summary,
    tags: current.tags,
    entity_refs: structuredArtifacts.entityRefs,
    featured: Boolean(current.featured),
    body_json: current.bodyJson,
    markdown: structuredArtifacts.markdown,
    structured_document: structuredArtifacts.structuredDocument,
    body_html: "",
    search_text: structuredArtifacts.searchText,
    relationship_candidates: structuredArtifacts.relationshipCandidates,
    citations: structuredArtifacts.citations,
    media_assets: normalizeImageAssets(current.mediaAssets).map((asset) => serializeImageAssetForDraft(asset, { slug })),
    records: []
  };
}

function takenSlugs() {
  const current = editorState.currentSlug ? [editorState.currentSlug] : [];
  const relayDraftSlugs = (editorState.publicState?.drafts || [])
    .filter((draft) => String(draft?.content_type || "").trim().toLowerCase() !== "page")
    .map((draft) => draft.slug);

  return dedupe([
    ...editorState.staticSlugs,
    ...relayDraftSlugs,
    ...current
  ]);
}

function refreshEditorChrome() {
  captureTransientPanelDrafts();
  editorState.selectedNode = inspectSelectedNode();
  syncRailPanelWithSelection();
  editorState.filteredImageAssets = filterImageAssets(editorState.imageAssets, editorState.imageAssetSearchQuery);
  editorState.activeImageAsset = resolveActiveImageAsset();
  editorState.entityTileMatches = matchEntities(editorState.entityTileDraft?.query || "").slice(0, 8);
  editorState.documentCitations = collectDocumentCitations();

  const toolbar = documentRef?.querySelector?.("[data-editor-toolbar]");
  if (toolbar instanceof HTMLElement) {
    const activeElement = documentRef?.activeElement;
    const preserveToolbarInput = activeElement instanceof HTMLElement &&
      toolbar.contains(activeElement) &&
      (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLSelectElement);
    const nextToolbarRenderKey = JSON.stringify({
      toolbarState: editorToolbarState(editorState.editor),
      formatMenuOpen: Boolean(editorState.formatMenuOpen),
      linkEditorOpen: Boolean(editorState.linkEditorOpen),
      wrappedInsertMenuOpen: Boolean(editorState.wrappedInsertMenuOpen)
    });
    const mustRenderToolbar = toolbar.dataset.renderKey !== nextToolbarRenderKey;
    const freezeToolbarWhileEditing = Boolean(editorState.linkEditorOpen) && !mustRenderToolbar;
    if (mustRenderToolbar || (!preserveToolbarInput && !freezeToolbarWhileEditing)) {
      const focusSnapshot = captureFocusSnapshot(toolbar);
      toolbar.innerHTML = renderEditorToolbarView({
        toolbarState: editorToolbarState(editorState.editor),
        editorState,
        deps: {
          escapeAttribute,
          escapeHtml
        }
      });
      toolbar.dataset.renderKey = nextToolbarRenderKey;
      restoreFocusSnapshot(toolbar, focusSnapshot);
    }
    bindToolbarOverlayPositioning(toolbar);
  }

  const rail = documentRef?.querySelector?.("[data-editor-rail]");
  if (rail instanceof HTMLElement) {
    const activeElement = documentRef?.activeElement;
    const preserveRailInput = activeElement instanceof HTMLElement &&
      rail.contains(activeElement) &&
      (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLSelectElement);
    const nextRailRenderKey = JSON.stringify({
      activeRailPanel: editorState.activeRailPanel || "",
      mobileRailOpen: Boolean(editorState.mobileRailOpen),
      citationEditorOpen: Boolean(editorState.citationEditorOpen),
      multimediaEditorMode: editorState.multimediaEditorMode || "",
      imageEditorMode: editorState.imageEditorMode || "",
      editingCitationId: editorState.editingCitationId || "",
      activeImageAssetId: editorState.activeImageAssetId || "",
      activeImageAssetUpdatedAt: editorState.activeImageAsset?.updatedAt || "",
      historyVersion: editorState.localSnapshots?.[0]?.saved_at || "",
      multimediaVariant: editorState.multimediaDraft?.variant || editorState.pendingWrappedVariant || "",
      multimediaDraftKey: JSON.stringify({
        variant: editorState.multimediaDraft?.variant || "",
        title: editorState.multimediaDraft?.title || "",
        text: editorState.multimediaDraft?.text || "",
        placement: editorState.multimediaDraft?.placement || "",
        assetId: editorState.multimediaDraft?.assetId || "",
        src: editorState.multimediaDraft?.src || "",
        backgroundColor: editorState.multimediaDraft?.backgroundColor || "",
        textColor: editorState.multimediaDraft?.textColor || "",
        overlayColor: editorState.multimediaDraft?.overlayColor || "",
        titleScale: editorState.multimediaDraft?.titleScale || 1,
        textScale: editorState.multimediaDraft?.textScale || 1,
        titleBox: editorState.multimediaDraft?.titleBox || null,
        textBox: editorState.multimediaDraft?.textBox || null
      }),
      activeBannerPresetId: editorState.activeBannerPresetId || "",
      bannerPresetIds: (Array.isArray(editorState.bannerPresets) ? editorState.bannerPresets : [])
        .map((preset) => `${preset?.id || ""}:${preset?.title || ""}:${preset?.updatedAt || ""}`)
        .filter(Boolean)
        .join("|"),
      imageSearchQuery: editorState.imageAssetSearchQuery || "",
      filteredImageAssetIds: (Array.isArray(editorState.filteredImageAssets) ? editorState.filteredImageAssets : [])
        .map((asset) => asset?.id || "")
        .filter(Boolean)
        .join("|"),
      citationIds: (Array.isArray(editorState.documentCitations) ? editorState.documentCitations : [])
        .map((citation) => citation?.id || "")
        .filter(Boolean)
        .join("|"),
      entityQuery: editorState.entityTileDraft?.query || "",
      entityMatchIds: (Array.isArray(editorState.entityTileMatches) ? editorState.entityTileMatches : [])
        .map((entity) => entity?.slug || entity?.name || "")
        .filter(Boolean)
        .join("|")
    });
    const mustRenderRail = rail.dataset.renderKey !== nextRailRenderKey;
    const freezeRailWhileEditing = (Boolean(editorState.citationEditorOpen) ||
      Boolean(editorState.multimediaEditorMode) ||
      Boolean(editorState.imageEditorMode) ||
      editorState.activeRailPanel === "multimedia" ||
      editorState.activeRailPanel === "document" ||
      editorState.activeRailPanel === "entityTile") &&
      !mustRenderRail;
    if (mustRenderRail || (!preserveRailInput && !freezeRailWhileEditing)) {
      const focusSnapshot = captureFocusSnapshot(rail);
      rail.innerHTML = renderEditorRailView({
        editorState: {
          ...editorState,
          document: readCurrentDocument()
        },
        deps: {
          escapeAttribute,
          escapeHtml,
          previewHref: currentPreviewHref()
        }
      });
      rail.dataset.renderKey = nextRailRenderKey;
      restoreFocusSnapshot(rail, focusSnapshot);
    }
  }

  const citationsTile = documentRef?.querySelector?.("[data-editor-citations-tile]");
  if (citationsTile instanceof HTMLElement) {
    citationsTile.innerHTML = renderEditorCitationsView({
      citations: editorState.documentCitations,
      deps: {
        escapeAttribute,
        escapeHtml
      }
    });
  }

  refreshRailShellVisibility();
  hydrateSaveToast();
  hydrateHeaderTitle();
  hydratePreviewLink();
  hydrateEntityResults();
  renderEditorModal();
}

function bindToolbarOverlayPositioning(toolbar) {
  if (!(toolbar instanceof HTMLElement)) return;
  const scroller = toolbar.querySelector("[data-editor-toolbar-scroll]");
  if (scroller instanceof HTMLElement && scroller.dataset.overlayBound !== "true") {
    scroller.dataset.overlayBound = "true";
    scroller.addEventListener("scroll", queueToolbarOverlayPosition, { passive: true });
  }
  queueToolbarOverlayPosition();
}

function captureTransientPanelDrafts() {
  if (editorState.linkEditorOpen) {
    editorState.linkDraft = {
      text: readInputValue('[name="linkDraftText"]', editorState.linkDraft?.text || ""),
      href: readInputValue('[name="linkDraftHref"]', editorState.linkDraft?.href || "")
    };
  }

  if (editorState.citationEditorOpen) {
    editorState.citationDraft = normalizeCitationAttrs({
      ...(editorState.citationDraft || {}),
      id: editorState.citationDraft?.id || editorState.editingCitationId || "",
      number: editorState.citationDraft?.number || 0,
      title: readInputValue('[name="citationTitle"]', editorState.citationDraft?.title || ""),
      author: readInputValue('[name="citationAuthor"]', editorState.citationDraft?.author || ""),
      source: readInputValue('[name="citationSource"]', editorState.citationDraft?.source || ""),
      publisher: readInputValue('[name="citationPublisher"]', editorState.citationDraft?.publisher || ""),
      publishedAt: readInputValue('[name="citationPublishedAt"]', editorState.citationDraft?.publishedAt || ""),
      page: readInputValue('[name="citationPage"]', editorState.citationDraft?.page || ""),
      href: readInputValue('[name="citationHref"]', editorState.citationDraft?.href || ""),
      archiveHref: readInputValue('[name="citationArchiveHref"]', editorState.citationDraft?.archiveHref || ""),
      accessedAt: readInputValue('[name="citationAccessedAt"]', editorState.citationDraft?.accessedAt || ""),
      note: readTextareaValue('[name="citationNote"]', editorState.citationDraft?.note || "")
    });
  }

  if (editorState.activeImageAsset) {
    const patch = {
      name: readInputValue('[name="imageAssetName"]', editorState.activeImageAsset?.name || ""),
      alt: readInputValue('[name="imageAssetAlt"]', editorState.activeImageAsset?.alt || ""),
      caption: readInputValue('[name="imageAssetDescription"]', editorState.activeImageAsset?.caption || ""),
      tags: splitTags(readInputValue('[name="imageAssetTags"]', (editorState.activeImageAsset?.tags || []).join(", "))),
      linkedEntities: splitTags(readInputValue('[name="imageAssetEntities"]', (editorState.activeImageAsset?.linkedEntities || []).join(", ")))
    };
    if (imageAssetPatchChanged(editorState.activeImageAsset, patch)) {
      applyActiveImageAssetPatch(patch, { persist: false });
    }
  }

  if (editorState.activeRailPanel === "multimedia") {
    if (editorState.skipNextMultimediaDraftCapture) {
      editorState.skipNextMultimediaDraftCapture = false;
    } else {
      const currentDraft = editorState.multimediaDraft || createBlankMultimediaDraft();
      editorState.multimediaDraft = normalizeMultimediaAttrs({
        ...withMultimediaAssetDefaults(
          currentDraft,
          editorState.activeImageAsset || resolveImageAssetById(currentDraft.assetId || "")
        ),
        variant: readSelectValue('[name="mediaVariant"]', currentDraft.variant || editorState.pendingWrappedVariant || "image"),
        title: readInputValue('[name="mediaTitle"]', currentDraft.title || ""),
        text: readTextareaValue('[name="mediaText"]', currentDraft.text || ""),
        backgroundColor: readInputValue('[name="mediaBackgroundColor"]', currentDraft.backgroundColor || "#ece3d4"),
        textColor: readInputValue('[name="mediaTextColor"]', currentDraft.textColor || "#171717"),
        overlayColor: readInputValue('[name="mediaOverlayColor"]', currentDraft.overlayColor || "#000000")
      });
    }
  }

  if (editorState.activeRailPanel === "entityTile") {
    if (editorState.skipNextEntityDraftCapture) {
      editorState.skipNextEntityDraftCapture = false;
    } else {
      const query = readInputValue('[name="entityTileSearch"]', editorState.entityTileDraft?.query || "");
      if (query || editorState.entityTileDraft?.selected) {
        editorState.entityTileDraft = {
          ...(editorState.entityTileDraft || createBlankEntityTileDraft()),
          query
        };
      }
    }
  }
}

function refreshRailShellVisibility() {
  const shell = documentRef?.querySelector?.("[data-editor-rail-shell]");
  if (shell instanceof HTMLElement) {
    shell.classList.toggle("is-open", Boolean(editorState.activeRailPanel) && !isMobileViewport());
  }
  const optionsButton = documentRef?.querySelector?.('[data-editor-open-panel="document"]');
  if (optionsButton instanceof HTMLElement) {
    optionsButton.setAttribute(
      "aria-expanded",
      editorState.activeRailPanel === "document" && !isMobileViewport() ? "true" : "false"
    );
    if (editorState.activeRailPanel === "document" && !isMobileViewport()) {
      optionsButton.setAttribute("aria-disabled", "true");
    } else {
      optionsButton.removeAttribute("aria-disabled");
    }
  }
}

function setLiveStatus(state, message) {
  editorState.liveStatus = String(state || "idle");
  editorState.liveMessage = String(message || "");
}

function setSaveStatus(state, message) {
  editorState.saveStatus = {
    state: String(state || "idle"),
    message: String(message || "")
  };
  setSaveToast(state, message);
}

function setProjectionStatus(state, message) {
  editorState.projectionStatus = {
    state: String(state || "idle"),
    message: String(message || "")
  };
}

function normalizeLiveState(state) {
  const clean = String(state || "").trim().toLowerCase();
  if (clean === "connected") return "success";
  if (clean === "connecting") return "pending";
  if (clean === "error") return "error";
  if (clean === "closed") return "idle";
  if (clean === "degraded") return "warning";
  return clean || "idle";
}

function currentLiveMessage() {
  if (editorState.liveMessage) return editorState.liveMessage;
  const state = String(editorState.liveStatus || "").trim().toLowerCase();
  if (state === "connected" || state === "live") return "Live collaboration on";
  if (state === "connecting") return "Connecting live draft...";
  if (state === "error" || state === "degraded") return "Live collaboration delayed";
  return "Local draft";
}

function setSaveToast(state, message) {
  clearTimer("saveToastTimer");
  editorState.saveToast = {
    state: String(state || "idle"),
    message: String(message || ""),
    visible: true
  };
  editorState.saveToastTimer = windowRef?.setTimeout?.(() => {
    editorState.saveToastTimer = 0;
    editorState.saveToast = {
      ...editorState.saveToast,
      visible: false
    };
    hydrateSaveToast();
  }, 2600) || 0;
}

function hydrateSaveToast() {
  const toast = documentRef?.querySelector?.("[data-editor-save-status]");
  if (!(toast instanceof HTMLElement)) return;
  const fallbackMessage = editorState.mockModeMessage || "Unsaved";
  const visible = editorState.saveToast.visible !== false;
  toast.dataset.state = visible
    ? (editorState.saveToast.state || editorState.saveStatus.state || "idle")
    : (editorState.mockMode ? "mock" : (editorState.saveStatus.state || "idle"));
  toast.textContent = visible
    ? (editorState.saveToast.message || editorState.saveStatus.message || fallbackMessage)
    : fallbackMessage;
  toast.classList.toggle("is-hidden", false);
}

function hydrateHeaderTitle() {
  return;
}

function queueEditorChromeRefresh() {
  if (!windowRef) {
    refreshEditorChrome();
    return;
  }
  if (editorState.chromeRefreshFrame) {
    return;
  }
  editorState.chromeRefreshFrame = windowRef.requestAnimationFrame?.(() => {
    editorState.chromeRefreshFrame = 0;
    refreshEditorChrome();
  }) || 0;
}

function queueToolbarOverlayPosition() {
  if (!windowRef) return;
  if (editorState.toolbarOverlayFrame) {
    windowRef.cancelAnimationFrame?.(editorState.toolbarOverlayFrame);
  }
  editorState.toolbarOverlayFrame = windowRef.requestAnimationFrame?.(() => {
    editorState.toolbarOverlayFrame = 0;
    positionToolbarOverlays();
  }) || 0;
}

function positionToolbarOverlays() {
  const toolbar = documentRef?.querySelector?.("[data-editor-toolbar]");
  if (!(toolbar instanceof HTMLElement)) return;
  const toolbarRect = toolbar.getBoundingClientRect();
  const popovers = toolbar.querySelectorAll("[data-editor-toolbar-popover]");
  popovers.forEach((popoverNode) => {
    const popover = popoverNode instanceof HTMLElement ? popoverNode : null;
    if (!popover) return;
    const kind = String(popover.getAttribute("data-editor-toolbar-popover") || "").trim();
    if (!kind) return;
    const anchor = toolbar.querySelector(`[data-editor-toolbar-anchor="${kind}"]`);
    if (!(anchor instanceof HTMLElement)) return;
    const anchorRect = anchor.getBoundingClientRect();
    const popoverWidth = popover.offsetWidth || 0;
    const gutter = 8;
    let left = anchorRect.left - toolbarRect.left;
    if (kind === "wrapped") {
      left = anchorRect.right - toolbarRect.left - popoverWidth;
    }
    const maxLeft = Math.max(gutter, toolbarRect.width - popoverWidth - gutter);
    left = Math.max(gutter, Math.min(left, maxLeft));
    popover.style.left = `${left}px`;
  });
}

function captureFocusSnapshot(container) {
  const active = documentRef?.activeElement;
  if (!(active instanceof HTMLElement) || !container.contains(active)) return null;
  const snapshot = {
    selector: buildFocusSelector(active)
  };
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    snapshot.start = active.selectionStart;
    snapshot.end = active.selectionEnd;
  }
  return snapshot;
}

function restoreFocusSnapshot(container, snapshot) {
  if (!snapshot?.selector) return;
  const target = container.querySelector(snapshot.selector);
  if (!(target instanceof HTMLElement)) return;
  target.focus();
  if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && Number.isInteger(snapshot.start) && Number.isInteger(snapshot.end)) {
    try {
      target.setSelectionRange(snapshot.start, snapshot.end);
    } catch {
      // no-op
    }
  }
}

function buildFocusSelector(element) {
  if (element.id) return `#${element.id}`;
  const name = element.getAttribute("name");
  if (name) return `[name="${cssEscape(name)}"]`;
  for (const attribute of element.getAttributeNames()) {
    if (attribute.startsWith("data-")) {
      const value = element.getAttribute(attribute);
      if (value) return `[${attribute}="${cssEscape(value)}"]`;
      return `[${attribute}]`;
    }
  }
  return element.tagName.toLowerCase();
}

function cssEscape(value = "") {
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function hydratePreviewLink() {
  const preview = documentRef?.querySelector?.("[data-editor-preview]");
  if (!(preview instanceof HTMLAnchorElement)) return;
  const href = currentPreviewHref();
  preview.href = href || "#";
  if (href) {
    preview.removeAttribute("aria-disabled");
    preview.classList.remove("is-disabled");
    return;
  }
  preview.setAttribute("aria-disabled", "true");
  preview.classList.add("is-disabled");
}

function currentPreviewHref() {
  return editorState.currentSlug
    ? `./investigation.html?draft=${encodeURIComponent(editorState.currentSlug)}`
    : "";
}

function ensureEditorSlug() {
  if (editorState.currentSlug) return editorState.currentSlug;
  const title = readInputValue('[name="title"]');
  if (!title) return "";

  const nextSlug = createUniqueSlug(title || "untitled", takenSlugs());
  if (!nextSlug) return "";

  editorState.currentSlug = nextSlug;
  const url = new URL(windowRef.location.href);
  url.searchParams.set("slug", nextSlug);
  windowRef.history?.replaceState?.({}, "", url);
  void moveLocalDraftStateToSlug(nextSlug);
  if (!editorState.mockMode) {
    void ensureLiveOverlay();
    void ensureDocumentProjection();
  }
  hydratePreviewLink();
  return nextSlug;
}

async function moveLocalDraftStateToSlug(nextSlug) {
  if (!nextSlug) return null;
  moveEditorBootstrapState("", nextSlug);
  return localDocumentState.moveState("", nextSlug);
}

function resolveCurrentDocumentId() {
  const slug = cleanSlug(editorState.currentSlug || "");
  return slug ? investigationDocumentId(slug) : "";
}

function inspectSelectedNode() {
  const selected = findSelectedEditorNode(editorState.editor);
  return isInspectableEditorNode(selected) ? selected : null;
}

function handleShellInput(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  if (target.matches('[name="title"], [name="summary"], [name="date"], [name="tags"], [name="primaryEntity"], [name="entityRefs"], [name="featured"]')) {
    if (target.getAttribute("name") === "title") ensureEditorSlug();
    editorState.document = readCurrentDocument(target);
    setSaveStatus("pending", "Unsaved");
    scheduleLocalSnapshot();
    scheduleRelaySave();
    scheduleDerivedProjection();
    scheduleLivePublish();
    refreshEditorChrome();
    return;
  }

  if (target.matches('[name="imageAssetName"], [name="imageAssetAlt"], [name="imageAssetDescription"], [name="imageAssetTags"], [name="imageAssetEntities"], [name="imageAssetSearch"], [name="linkDraftText"], [name="linkDraftHref"]')) {
    if (target.getAttribute("name") === "linkDraftText" || target.getAttribute("name") === "linkDraftHref") {
      editorState.linkDraft = {
        text: readInputEventValue(target, "linkDraftText", '[name="linkDraftText"]', editorState.linkDraft?.text || ""),
        href: readInputEventValue(target, "linkDraftHref", '[name="linkDraftHref"]', editorState.linkDraft?.href || "")
      };
      return;
    }
    if (target.getAttribute("name") === "imageAssetSearch") {
      editorState.imageAssetSearchQuery = readInputEventValue(target, "imageAssetSearch", '[name="imageAssetSearch"]', "");
      refreshEditorChrome();
      return;
    }
    applyActiveImageAssetPatch({
      name: readInputEventValue(target, "imageAssetName", '[name="imageAssetName"]', editorState.activeImageAsset?.name || ""),
      alt: readInputEventValue(target, "imageAssetAlt", '[name="imageAssetAlt"]', editorState.activeImageAsset?.alt || ""),
      caption: readInputEventValue(target, "imageAssetDescription", '[name="imageAssetDescription"]', editorState.activeImageAsset?.caption || ""),
      tags: splitTags(readInputEventValue(target, "imageAssetTags", '[name="imageAssetTags"]', (editorState.activeImageAsset?.tags || []).join(", "))),
      linkedEntities: splitTags(readInputEventValue(target, "imageAssetEntities", '[name="imageAssetEntities"]', (editorState.activeImageAsset?.linkedEntities || []).join(", ")))
    }, { persist: false });
    return;
  }

  if (target.matches('[name="citationTitle"], [name="citationAuthor"], [name="citationSource"], [name="citationPublisher"], [name="citationPublishedAt"], [name="citationPage"], [name="citationHref"], [name="citationArchiveHref"], [name="citationAccessedAt"], [name="citationNote"]')) {
    editorState.citationDraft = normalizeCitationAttrs({
      ...editorState.citationDraft,
      id: editorState.citationDraft?.id || editorState.editingCitationId || "",
      number: editorState.citationDraft?.number || 0,
      title: readInputEventValue(target, "citationTitle", '[name="citationTitle"]', editorState.citationDraft?.title || ""),
      author: readInputEventValue(target, "citationAuthor", '[name="citationAuthor"]', editorState.citationDraft?.author || ""),
      source: readInputEventValue(target, "citationSource", '[name="citationSource"]', editorState.citationDraft?.source || ""),
      publisher: readInputEventValue(target, "citationPublisher", '[name="citationPublisher"]', editorState.citationDraft?.publisher || ""),
      publishedAt: readInputEventValue(target, "citationPublishedAt", '[name="citationPublishedAt"]', editorState.citationDraft?.publishedAt || ""),
      page: readInputEventValue(target, "citationPage", '[name="citationPage"]', editorState.citationDraft?.page || ""),
      href: readInputEventValue(target, "citationHref", '[name="citationHref"]', editorState.citationDraft?.href || ""),
      archiveHref: readInputEventValue(target, "citationArchiveHref", '[name="citationArchiveHref"]', editorState.citationDraft?.archiveHref || ""),
      accessedAt: readInputEventValue(target, "citationAccessedAt", '[name="citationAccessedAt"]', editorState.citationDraft?.accessedAt || ""),
      note: readTextareaEventValue(target, "citationNote", '[name="citationNote"]', editorState.citationDraft?.note || "")
    });
    return;
  }

  if (target.matches('[name="mediaVariant"], [name="mediaTitle"], [name="mediaText"], [name="mediaBackgroundColor"], [name="mediaTextColor"], [name="mediaOverlayColor"]')) {
    const nextDraft = normalizeMultimediaAttrs({
      ...withMultimediaAssetDefaults(
        editorState.multimediaDraft || createBlankMultimediaDraft(),
        editorState.activeImageAsset || resolveImageAssetById(editorState.multimediaDraft?.assetId || "")
      ),
      variant: readSelectEventValue(target, "mediaVariant", '[name="mediaVariant"]', editorState.multimediaDraft?.variant || editorState.pendingWrappedVariant || "image"),
      title: readInputEventValue(target, "mediaTitle", '[name="mediaTitle"]', editorState.multimediaDraft?.title || ""),
      text: readTextareaEventValue(target, "mediaText", '[name="mediaText"]', editorState.multimediaDraft?.text || ""),
      backgroundColor: readInputEventValue(target, "mediaBackgroundColor", '[name="mediaBackgroundColor"]', editorState.multimediaDraft?.backgroundColor || "#ece3d4"),
      textColor: readInputEventValue(target, "mediaTextColor", '[name="mediaTextColor"]', editorState.multimediaDraft?.textColor || "#171717"),
      overlayColor: readInputEventValue(target, "mediaOverlayColor", '[name="mediaOverlayColor"]', editorState.multimediaDraft?.overlayColor || "#000000")
    });
    editorState.multimediaDraft = nextDraft;
    if (isEditingSelectedMultimedia()) {
      applySelectedMultimediaAttrs(nextDraft, { silent: true });
    }
    return;
  }

  if (target.matches('[name="entityTileSearch"]')) {
    const query = readInputEventValue(target, "entityTileSearch", '[name="entityTileSearch"]', "");
    editorState.entityTileDraft = {
      ...(editorState.entityTileDraft || createBlankEntityTileDraft()),
      query,
      selected: editorState.entityTileDraft?.selected || null
    };
    editorState.entityTileMatches = matchEntities(query).slice(0, 8);
    refreshEditorChrome();
    return;
  }

  if (target.matches("[data-editor-entity-input]")) {
    editorState.activePickerField = target.getAttribute("data-editor-entity-input") || "";
    hydrateEntityResults();
  }
}

function handleShellChange(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  if (target.matches('[name="imageAspectPreset"]') && target instanceof HTMLSelectElement) {
    applyCropPreset(target.value, { persist: false });
    return;
  }

  if (target.matches("[data-editor-image-file]") && target instanceof HTMLInputElement) {
    const [file] = Array.from(target.files || []);
    if (!file) {
      editorState.multimediaEditorMode = "";
      editorState.imageEditorMode = "";
      refreshEditorChrome();
      return;
    }
    void handleImageFile(file, target);
    return;
  }

  handleShellInput(event);
}

function handleShellClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const formatValue = target.closest("[data-editor-format-value]")?.getAttribute("data-editor-format-value");
  if (formatValue) {
    void runFormatCommand(formatValue);
    return;
  }

  const command = target.closest("[data-editor-command]")?.getAttribute("data-editor-command");
  if (command) {
    void runEditorCommand(command);
    return;
  }

  const openPanel = target.closest("[data-editor-open-panel]")?.getAttribute("data-editor-open-panel");
  if (openPanel) {
    if (openPanel === "document") {
      toggleDocumentPanel();
    } else {
      openRailPanel(openPanel);
    }
    return;
  }

  if (target.closest("[data-editor-modal-close]") || target.matches("[data-editor-modal-backdrop]")) {
    closeModal();
    return;
  }

  const entityPick = target.closest("[data-editor-entity-pick]");
  if (entityPick) {
    applyEntityPick(entityPick);
    return;
  }

  const cropPreset = target.closest("[data-image-crop-preset]")?.getAttribute("data-image-crop-preset");
  if (cropPreset) {
    applyCropPreset(cropPreset, { persist: false });
    return;
  }

  if (target.closest("[data-editor-image-aspect-orientation]")) {
    rotateCropAspectOrientation({ persist: false });
    return;
  }

  const imageInsert = target.closest("[data-editor-image-insert]")?.getAttribute("data-editor-image-insert");
  if (imageInsert) {
    placeMultimediaAsset(imageInsert, target.closest("[data-editor-image-insert]")?.getAttribute("data-editor-media-variant") || "");
    return;
  }

  const wrappedKind = target.closest("[data-editor-wrapped-kind]")?.getAttribute("data-editor-wrapped-kind");
  if (wrappedKind) {
    if (wrappedKind === "entityTile") {
      editorState.wrappedInsertMenuOpen = false;
      editorState.entityTileDraft = createBlankEntityTileDraft();
      editorState.entityTileDraftSourcePos = 0;
      editorState.entityTileInsertMode = true;
      editorState.skipNextEntityDraftCapture = true;
      editorState.entityTileEditorMode = "create";
      editorState.entityTileMatches = matchEntities(editorState.entityTileDraft.query || "").slice(0, 8);
      openRailPanel("entityTile");
      return;
    }
    openWrappedInsertMenuChoice(wrappedKind);
    return;
  }

  if (target.closest("[data-editor-banner-create]")) {
    openBannerPresetCreateFlow();
    return;
  }

  const bannerPresetInsert = target.closest("[data-editor-banner-insert]")?.getAttribute("data-editor-banner-insert");
  if (bannerPresetInsert) {
    insertBannerPreset(bannerPresetInsert);
    return;
  }

  const bannerPresetEdit = target.closest("[data-editor-banner-entry]")?.getAttribute("data-editor-banner-entry");
  if (bannerPresetEdit) {
    openBannerPresetEditor(bannerPresetEdit);
    return;
  }

  if (target.closest("[data-editor-image-upload]")) {
    openImageUploadFlow();
    return;
  }

  const assetPick = target.closest("[data-editor-image-entry]");
  if (assetPick) {
    openImageAssetEditor(assetPick.getAttribute("data-editor-image-entry") || "");
    return;
  }

  if (target.closest("[data-editor-image-clear-search]")) {
    editorState.imageAssetSearchQuery = "";
    refreshEditorChrome();
    return;
  }

  const imageTransform = target.closest("[data-editor-image-transform]")?.getAttribute("data-editor-image-transform");
  if (imageTransform) {
    applyImageTransform(imageTransform, { persist: false });
    return;
  }

  const mediaPlacement = target.closest("[data-editor-media-placement]")?.getAttribute("data-editor-media-placement");
  if (mediaPlacement) {
    const nextDraft = normalizeMultimediaAttrs({
      ...(editorState.multimediaDraft || createBlankMultimediaDraft()),
      placement: mediaPlacement
    });
    editorState.multimediaDraft = nextDraft;
    if (isEditingSelectedMultimedia()) {
      applySelectedMultimediaAttrs(nextDraft, { silent: true });
    }
    refreshEditorChrome();
    return;
  }

  const entityPlacement = target.closest("[data-editor-entity-placement]")?.getAttribute("data-editor-entity-placement");
  if (entityPlacement) {
    applySelectedEntityTileAttrs({
      placement: entityPlacement,
      ...(entityPlacement === "full-width" ? { widthRatio: 1 } : {})
    });
    return;
  }

  const mediaScale = target.closest("[data-editor-media-scale]")?.getAttribute("data-editor-media-scale");
  if (mediaScale) {
    applyMultimediaScale(mediaScale);
    return;
  }

  const mediaBoxAlign = target.closest("[data-editor-media-box-align]")?.getAttribute("data-editor-media-box-align");
  if (mediaBoxAlign) {
    applyMultimediaTextAlignment(mediaBoxAlign, "alignX");
    return;
  }

  const mediaBoxVertical = target.closest("[data-editor-media-box-vertical]")?.getAttribute("data-editor-media-box-vertical");
  if (mediaBoxVertical) {
    applyMultimediaTextAlignment(mediaBoxVertical, "alignY");
    return;
  }

  if (target.closest("[data-editor-multimedia-save]")) {
    saveMultimediaDraft();
    return;
  }

  if (target.closest("[data-editor-multimedia-cancel]")) {
    cancelMultimediaEditing();
    return;
  }

  if (target.closest("[data-editor-multimedia-delete]")) {
    if (editorState.multimediaEditorMode === "banner-edit" && !isEditingSelectedMultimedia()) {
      deleteActiveBannerPreset();
    } else if (editorState.multimediaEditorMode === "edit" && !isEditingSelectedMultimedia()) {
      deleteActiveImageAsset();
    } else {
      deleteSelectedMultimediaNode();
    }
    return;
  }

  if (target.closest("[data-editor-citation-add]")) {
    openCitationEditor();
    return;
  }

  const citationInsert = target.closest("[data-editor-citation-insert]")?.getAttribute("data-editor-citation-insert");
  if (citationInsert) {
    insertCitationAtSelection(citationInsert);
    return;
  }

  const citationEdit = target.closest("[data-editor-citation-edit]")?.getAttribute("data-editor-citation-edit");
  if (citationEdit) {
    openCitationEditor(citationEdit);
    return;
  }

  if (target.closest("[data-editor-citation-save]")) {
    saveCitationDraft();
    return;
  }

  if (target.closest("[data-editor-citation-cancel]")) {
    closeCitationEditor();
    return;
  }

  if (target.closest("[data-editor-citation-delete]")) {
    deleteCitationDraft();
    return;
  }

  if (target.closest("[data-editor-entity-clear-search]")) {
    editorState.entityTileDraft = {
      ...(editorState.entityTileDraft || createBlankEntityTileDraft()),
      query: "",
      selected: null
    };
    editorState.entityTileMatches = matchEntities("").slice(0, 8);
    refreshEditorChrome();
    return;
  }

  const entityTilePick = target.closest("[data-editor-entity-tile-pick]");
  if (entityTilePick) {
    applyEntityTilePick(entityTilePick.getAttribute("data-editor-entity-tile-pick") || "");
    return;
  }

  if (target.closest("[data-editor-save]")) {
    void persistLocalSnapshot("Manual snapshot");
    return;
  }

  if (target.closest("[data-editor-submit]")) {
    if (editorState.mockMode) {
      setSaveStatus("idle", "Review/publish is disabled in local mock admin mode.");
      refreshEditorChrome();
      return;
    }
    void saveDraftNow("candidate");
    return;
  }

  if (target.closest("[data-editor-modal-close]") || target.matches("[data-editor-modal-backdrop]")) {
    closeModal();
  }
}

async function runEditorCommand(command) {
  const editor = editorState.editor;
  if (!editor) return;

  if (command === "toggle-format-menu") {
    editorState.formatMenuOpen = !editorState.formatMenuOpen;
    if (editorState.formatMenuOpen) {
      editorState.linkEditorOpen = false;
      editorState.wrappedInsertMenuOpen = false;
    }
    refreshEditorChrome();
    return;
  }

  if (command === "toggle-wrapped-menu") {
    editorState.wrappedInsertMenuOpen = !editorState.wrappedInsertMenuOpen;
    if (editorState.wrappedInsertMenuOpen) {
      editorState.formatMenuOpen = false;
      editorState.linkEditorOpen = false;
    }
    refreshEditorChrome();
    return;
  }

  if (command === "bold") editor.chain().focus().toggleBold().run();
  if (command === "italic") editor.chain().focus().toggleItalic().run();
  if (command === "underline") editor.chain().focus().toggleUnderline().run();
  if (command === "blockquote") {
    editor.chain().focus().toggleBlockquote().run();
  }
  if (command === "bullet-list") {
    editor.chain().focus().toggleBulletList().run();
  }
  if (command === "ordered-list") {
    editor.chain().focus().toggleOrderedList().run();
  }
  if (command === "align-left") editor.chain().focus().setTextAlign("left").run();
  if (command === "align-center") editor.chain().focus().setTextAlign("center").run();
  if (command === "align-right") editor.chain().focus().setTextAlign("right").run();

  if (command === "toggle-link-editor") {
    const existing = editor.getAttributes("link")?.href || "";
    editorState.linkDraft = {
      text: String(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " ") || "").trim(),
      href: existing
    };
    editorState.linkEditorOpen = !editorState.linkEditorOpen;
    if (editorState.linkEditorOpen) {
      editorState.formatMenuOpen = false;
      editorState.wrappedInsertMenuOpen = false;
    }
    refreshEditorChrome();
    return;
  }

  if (command === "submit-link") {
    applyLinkDraft();
    return;
  }

  if (command === "open-citation-panel") {
    openCitationEditor();
    openRailPanel("citation");
    return;
  }

  refreshEditorChrome();
}

async function runFormatCommand(value) {
  const editor = editorState.editor;
  if (!editor) return;
  const clean = String(value || "").trim().toLowerCase();
  editorState.formatMenuOpen = false;
  if (clean === "paragraph") editor.chain().focus().setParagraph().run();
  if (clean === "heading-2") editor.chain().focus().toggleHeading({ level: 2 }).run();
  if (clean === "heading-3") editor.chain().focus().toggleHeading({ level: 3 }).run();
  refreshEditorChrome();
}

function toggleDocumentPanel() {
  if (isMobileViewport()) {
    editorState.activeRailPanel = "document";
    editorState.mobileRailOpen = true;
    renderEditorModal();
    return;
  }
  if (editorState.activeRailPanel === "document") return;
  editorState.activeRailPanel = "document";
  refreshEditorChrome();
}

function openRailPanel(panel) {
  editorState.activeRailPanel = String(panel || "document").trim() || "document";
  if (isMobileViewport()) {
    editorState.mobileRailOpen = true;
    renderEditorModal();
    return;
  }
  refreshEditorChrome();
}

function closeActivePanel() {
  if (editorState.mobileRailOpen) {
    editorState.mobileRailOpen = false;
    renderEditorModal();
    return;
  }
  editorState.activeRailPanel = "";
  refreshEditorChrome();
}

function closeModal() {
  editorState.mobileRailOpen = false;
  renderEditorModal();
}

function renderEditorModal() {
  const root = ensureModalRoot();
  if (!(root instanceof HTMLElement)) return;
  root.innerHTML = renderEditorModalView({
    editorState,
    deps: {
      escapeAttribute,
      escapeHtml,
      previewHref: currentPreviewHref()
    }
  });
}

function ensureModalRoot() {
  if (editorState.modalRoot instanceof HTMLElement) return editorState.modalRoot;
  const existing = documentRef?.querySelector?.("[data-editor-modal-root]");
  if (existing instanceof HTMLElement) {
    editorState.modalRoot = existing;
    return existing;
  }
  const root = documentRef?.createElement?.("div");
  if (!(root instanceof HTMLElement)) return documentRef?.body || null;
  root.dataset.editorModalRoot = "";
  documentRef?.body?.append?.(root);
  editorState.modalRoot = root;
  return root;
}

async function handleImageFile(file, input) {
  const asset = await createImageAssetFromFile(file, {
    alt: cleanFileStem(file.name),
    caption: "",
    uploadStatus: "local"
  });
  editorState.imageAssets = normalizeImageAssets([asset, ...editorState.imageAssets]);
  editorState.activeImageAssetId = asset.id;
  editorState.pendingWrappedVariant = editorState.pendingWrappedVariant || "image";
  editorState.multimediaDraft = hydrateMultimediaDraftWithAsset({
    ...(editorState.multimediaDraft || createBlankMultimediaDraft()),
    variant: editorState.pendingWrappedVariant || "image"
  }, asset);
  editorState.multimediaInsertMode = editorState.multimediaInsertMode || editorState.multimediaEditorMode !== "instance";
  editorState.multimediaEditorMode = "create";
  editorState.imageEditorMode = "create";
  editorState.activeRailPanel = "multimedia";
  editorState.mobileRailOpen = isMobileViewport();
  refreshEditorChrome();
  if (!editorState.mockMode) {
    void syncImageAssetUpload(asset.id);
  }
  if (input instanceof HTMLInputElement) input.value = "";
}

async function syncImageAssetUpload(assetId) {
  const asset = resolveImageAssetById(assetId);
  if (
    !asset ||
    asset.publishUrl ||
    asset.uploadStatus === "syncing" ||
    !asset.localDataUrl ||
    !editorState.session ||
    editorState.mockMode
  ) {
    return;
  }
  applyActiveOrStoredImagePatch(assetId, { uploadStatus: "syncing" });
  try {
    const blob = dataUrlToBlob(asset.localDataUrl, asset.mimeType);
    if (!blob) throw new Error("Image data could not be prepared for upload.");
    const upload = await uploadPublicBlob(editorState.session.secretKeyHex, blob, {
      fileName: asset.name || "image",
      purpose: "investigation-image"
    });
    applyActiveOrStoredImagePatch(assetId, {
      publishUrl: String(upload?.url || "").trim(),
      blobSha256: String(upload?.sha256 || "").trim(),
      uploadStatus: upload?.url ? "synced" : "error"
    });
  } catch {
    applyActiveOrStoredImagePatch(assetId, { uploadStatus: "error" });
  }
}

function applyActiveImageAssetPatch(patch = {}, options = {}) {
  const activeId = editorState.activeImageAssetId || editorState.activeImageAsset?.id || "";
  if (!activeId) return;
  applyActiveOrStoredImagePatch(activeId, patch, options);
}

function applyActiveOrStoredImagePatch(assetId, patch = {}, options = {}) {
  const persist = options.persist !== false;
  const refreshChrome = options.refreshChrome !== false;
  const nextAssets = editorState.imageAssets.map((asset) =>
    asset.id === assetId ? updateImageAsset(asset, patch) : asset
  );
  editorState.imageAssets = normalizeImageAssets(nextAssets);
  editorState.activeImageAssetId = assetId;
  const nextAsset = resolveImageAssetById(assetId);
  if (nextAsset) {
    editorState.multimediaDraft = isDraftBackedMultimediaEditor()
      ? normalizeMultimediaAttrs({
          ...(editorState.multimediaDraft || createBlankMultimediaDraft(editorState.pendingWrappedVariant || "image"))
        })
      : hydrateMultimediaDraftWithAsset(
          editorState.multimediaDraft || createBlankMultimediaDraft(editorState.pendingWrappedVariant || "image"),
          nextAsset
        );
  }
  if (persist) {
    if (nextAsset) {
      syncSelectedMultimediaNodeFromAsset(nextAsset);
    }
    editorState.document = readCurrentDocument();
    setSaveStatus("pending", "Unsaved");
    scheduleLocalSnapshot();
    scheduleRelaySave();
    scheduleDerivedProjection();
    scheduleLivePublish();
  }
  if (refreshChrome) {
    refreshEditorChrome();
  } else {
    syncLiveImageEditorDom(nextAsset);
  }
}

function syncLiveImageEditorDom(asset = null) {
  const currentAsset = asset || resolveEditableMultimediaImageState();
  if (!currentAsset) return;
  const preview = documentRef?.querySelector?.("[data-editor-media-preview]");
  if (preview instanceof HTMLElement) {
    preview.style.setProperty("--editor-media-aspect", String(resolveLiveImageAspect(currentAsset)));
    preview.style.setProperty("--image-focus-x", String(currentAsset.focusX ?? 0.5));
    preview.style.setProperty("--image-focus-y", String(currentAsset.focusY ?? 0.5));
    preview.style.setProperty("--image-crop-x", String(currentAsset.cropX ?? 0));
    preview.style.setProperty("--image-crop-y", String(currentAsset.cropY ?? 0));
    preview.style.setProperty("--image-crop-width", String(currentAsset.cropWidth ?? 1));
    preview.style.setProperty("--image-crop-height", String(currentAsset.cropHeight ?? 1));
    preview.style.setProperty("--editor-media-rotation", `${quarterTurnsToCssTurns(currentAsset.rotationQuarterTurns)}turn`);
    preview.style.setProperty("--editor-media-flip-x", currentAsset.flipX ? "-1" : "1");
    preview.style.setProperty("--editor-media-flip-y", currentAsset.flipY ? "-1" : "1");
    preview.style.setProperty("--editor-media-width", String(currentAsset.widthRatio ?? 1));
  }
  const cropSurface = documentRef?.querySelector?.("[data-editor-crop-surface]");
  if (cropSurface instanceof HTMLElement) {
    cropSurface.style.setProperty("--crop-x", String(currentAsset.cropX ?? 0));
    cropSurface.style.setProperty("--crop-y", String(currentAsset.cropY ?? 0));
    cropSurface.style.setProperty("--crop-width", String(currentAsset.cropWidth ?? 1));
    cropSurface.style.setProperty("--crop-height", String(currentAsset.cropHeight ?? 1));
  }
  const aspectInput = documentRef?.querySelector?.('[name="imageAspectPreset"]');
  if (aspectInput instanceof HTMLSelectElement) {
    aspectInput.value = resolveCropPresetValue(currentAsset);
  }
}

function resolveLiveImageAspect(asset = {}) {
  const width = Math.max(1, Number(asset.assetWidth || asset.width || 0) || 1);
  const height = Math.max(1, Number(asset.assetHeight || asset.height || 0) || 1);
  const cropWidth = Math.max(0.0001, Number(asset.cropWidth || 1));
  const cropHeight = Math.max(0.0001, Number(asset.cropHeight || 1));
  const ratio = (cropWidth * width) / Math.max(cropHeight * height, 0.0001);
  return Math.max(0.3, Math.min(4.5, Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 3));
}

function resolveCropPresetValue(asset = {}) {
  const width = Math.max(1, Number(asset.assetWidth || asset.width || 1));
  const height = Math.max(1, Number(asset.assetHeight || asset.height || 1));
  const ratio = ((Number(asset.cropWidth || 1) * width) / Math.max(Number(asset.cropHeight || 1) * height, 0.0001)) || (width / height);
  if (Math.abs((width / height) - ratio) <= 0.03) return "original";
  const ratios = {
    "16:9": 16 / 9,
    "3:2": 3 / 2,
    "4:3": 4 / 3,
    "1:1": 1,
    "4:5": 4 / 5,
    "3:1": 3
  };
  const match = Object.entries(ratios).find(([, candidate]) =>
    Math.abs(candidate - ratio) <= 0.03 || Math.abs((1 / candidate) - ratio) <= 0.03
  );
  return match?.[0] || "original";
}

function openImageUploadFlow(variant = editorState.pendingWrappedVariant || "image") {
  const wasEditingSelectedMultimedia = isEditingSelectedMultimedia();
  beginMultimediaSession({ clearActiveAsset: true });
  editorState.pendingWrappedVariant = variant || "image";
  editorState.activeImageAssetId = "";
  editorState.multimediaDraft = normalizeMultimediaAttrs({
    ...(editorState.multimediaDraft || createBlankMultimediaDraft()),
    variant: editorState.pendingWrappedVariant
  });
  editorState.multimediaEditorMode = editorState.pendingWrappedVariant === "banner" ? "banner" : "create";
  editorState.imageEditorMode = "create";
  editorState.multimediaInsertMode = !wasEditingSelectedMultimedia;
  editorState.skipNextMultimediaDraftCapture = true;
  openRailPanel("multimedia");
  refreshEditorChrome();
  const input = documentRef?.querySelector?.("[data-editor-image-file]");
  if (input instanceof HTMLInputElement && editorState.pendingWrappedVariant !== "banner") {
    input.click();
  }
}

function openImageAssetEditor(assetId = "") {
  if (!assetId) return;
  beginMultimediaSession();
  const asset = resolveImageAssetById(assetId);
  editorState.activeImageAssetId = assetId;
  editorState.imageEditorMode = "edit";
  editorState.multimediaEditorMode = editorState.imageEditorMode;
  editorState.multimediaInsertMode = false;
  editorState.skipNextMultimediaDraftCapture = true;
  editorState.multimediaDraft = hydrateMultimediaDraftWithAsset({
    ...(editorState.multimediaDraft || createBlankMultimediaDraft()),
    variant: editorState.pendingWrappedVariant || "image",
    assetId
  }, asset);
  openRailPanel("multimedia");
}

function beginMultimediaSession({ clearActiveAsset = false } = {}) {
  editorState.multimediaSessionSnapshot = {
    imageAssets: cloneValue(editorState.imageAssets || []),
    bannerPresets: cloneValue(editorState.bannerPresets || []),
    activeImageAssetId: editorState.activeImageAssetId || "",
    activeBannerPresetId: editorState.activeBannerPresetId || "",
    multimediaDraft: cloneValue(editorState.multimediaDraft || null),
    selectedNodePos: editorState.selectedNode?.name === "templateMultimedia"
      ? Number(editorState.selectedNode?.pos || 0)
      : 0,
    selectedNodeAttrs: editorState.selectedNode?.name === "templateMultimedia"
      ? cloneValue(editorState.selectedNode?.attrs || {})
      : null
  };
  if (clearActiveAsset) {
    editorState.activeImageAssetId = "";
  }
}

function clearMultimediaSession() {
  editorState.multimediaSessionSnapshot = null;
}

function restoreMultimediaSessionSnapshot() {
  const snapshot = editorState.multimediaSessionSnapshot;
  if (!snapshot) return;
  editorState.imageAssets = normalizeImageAssets(snapshot.imageAssets || []);
  editorState.bannerPresets = normalizeBannerPresets(snapshot.bannerPresets || []);
  editorState.activeImageAssetId = snapshot.activeImageAssetId || "";
  editorState.activeBannerPresetId = snapshot.activeBannerPresetId || "";
  if (snapshot.selectedNodeAttrs && snapshot.selectedNodePos && editorState.editor) {
    try {
      editorState.editor
        .chain()
        .focus()
        .setNodeSelection(snapshot.selectedNodePos)
        .updateAttributes("templateMultimedia", snapshot.selectedNodeAttrs)
        .run();
    } catch {
      // no-op
    }
  }
  editorState.multimediaDraft = snapshot.multimediaDraft
    ? normalizeMultimediaAttrs(snapshot.multimediaDraft)
    : createBlankMultimediaDraft(editorState.pendingWrappedVariant || "image");
  clearMultimediaSession();
  editorState.selectedNode = inspectSelectedNode();
}

function closeMultimediaEditor({ clearSelection = false } = {}) {
  editorState.multimediaEditorMode = "";
  editorState.imageEditorMode = "";
  editorState.multimediaDraftSourcePos = 0;
  editorState.multimediaInsertMode = false;
  editorState.skipNextMultimediaDraftCapture = false;
  editorState.activeBannerPresetId = "";
  if (clearSelection) {
    clearSelectedMultimediaSelection();
  }
  refreshEditorChrome();
}

function clearSelectedMultimediaSelection() {
  const editor = editorState.editor;
  const selected = editorState.selectedNode;
  if (!editor || selected?.name !== "templateMultimedia") return;
  const node = editor.state?.doc?.nodeAt?.(selected.pos);
  const after = Math.min(
    Number(editor.state?.doc?.content?.size || selected.pos || 0),
    Number(selected.pos || 0) + Number(node?.nodeSize || 1)
  );
  try {
    editor.chain().focus().setTextSelection(after).run();
  } catch {
    // no-op
  }
  editorState.selectedNode = inspectSelectedNode();
}

function removeMultimediaNodesForAsset(bodyJson = {}, assetId = "") {
  const cleanAssetId = String(assetId || "").trim();
  if (!cleanAssetId || !bodyJson || typeof bodyJson !== "object") {
    return normalizeInvestigationBodyJson(bodyJson);
  }
  const walk = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.type === "templateMultimedia" && String(node.attrs?.assetId || "").trim() === cleanAssetId) {
      return null;
    }
    const nextNode = { ...node };
    if (Array.isArray(node.content)) {
      nextNode.content = node.content
        .map((child) => walk(child))
        .filter(Boolean);
    }
    return nextNode;
  };
  return normalizeInvestigationBodyJson(walk(bodyJson) || emptyInvestigationBodyJson());
}

function resolveActiveImageAsset() {
  const selectedImageAssetId = editorState.selectedNode?.name === "templateMultimedia"
    ? String(editorState.selectedNode?.attrs?.assetId || "").trim()
    : "";
  const preferredId = editorState.activeImageAssetId || selectedImageAssetId;
  if (preferredId) {
    const exact = resolveImageAssetById(preferredId);
    if (exact) return exact;
  }
  if (selectedImageAssetId) {
    const fallback = normalizeImageAsset({
      id: selectedImageAssetId || undefined,
      name: editorState.selectedNode?.attrs?.alt || "Image",
      alt: editorState.selectedNode?.attrs?.alt || "",
      caption: editorState.selectedNode?.attrs?.description || "",
      localDataUrl: editorState.selectedNode?.attrs?.src || "",
      publishUrl: editorState.selectedNode?.attrs?.src || "",
      width: editorState.selectedNode?.attrs?.assetWidth,
      height: editorState.selectedNode?.attrs?.assetHeight,
      focusX: editorState.selectedNode?.attrs?.focusX,
      focusY: editorState.selectedNode?.attrs?.focusY,
      cropX: editorState.selectedNode?.attrs?.cropX,
      cropY: editorState.selectedNode?.attrs?.cropY,
      cropWidth: editorState.selectedNode?.attrs?.cropWidth,
      cropHeight: editorState.selectedNode?.attrs?.cropHeight,
      uploadStatus: "synced"
    });
    editorState.imageAssets = normalizeImageAssets([fallback, ...editorState.imageAssets]);
    editorState.activeImageAssetId = fallback.id;
    return fallback;
  }
  if (!preferredId && !selectedImageAssetId && (
    editorState.multimediaInsertMode ||
    editorState.multimediaEditorMode === "create" ||
    editorState.multimediaEditorMode === "banner" ||
    editorState.imageEditorMode === "create"
  )) {
    return null;
  }
  return editorState.filteredImageAssets[0] || editorState.imageAssets[0] || null;
}

function resolveImageAssetById(assetId = "") {
  const clean = String(assetId || "").trim();
  return editorState.imageAssets.find((asset) => asset.id === clean) || null;
}

function placeMultimediaAsset(assetId = "", variant = "") {
  const editor = editorState.editor;
  const asset = resolveImageAssetById(assetId || editorState.activeImageAssetId || "");
  if (!editor) return;
  const updatingSelected = isEditingSelectedMultimedia();
  const nextVariant = String(variant || editorState.pendingWrappedVariant || editorState.multimediaDraft?.variant || "image").trim() || "image";
  const matchingDraft = asset && String(editorState.multimediaDraft?.assetId || "").trim() === String(asset.id || "").trim()
    ? normalizeMultimediaAttrs(editorState.multimediaDraft || {})
    : null;
  const draftSeed = updatingSelected
    ? editorState.selectedNode.attrs
    : (matchingDraft || editorState.multimediaDraft || {});
  const nextAttrs = normalizeMultimediaAttrs({
    ...draftSeed,
    variant: nextVariant,
    assetId: asset?.id || matchingDraft?.assetId || editorState.multimediaDraft?.assetId || "",
    src: matchingDraft?.src || (asset ? resolveImageAssetUrl(asset) : (editorState.multimediaDraft?.src || "")),
    assetWidth: matchingDraft?.assetWidth ?? asset?.width ?? editorState.multimediaDraft?.assetWidth,
    assetHeight: matchingDraft?.assetHeight ?? asset?.height ?? editorState.multimediaDraft?.assetHeight,
    alt: matchingDraft?.alt || asset?.alt || editorState.multimediaDraft?.alt || "",
    description: matchingDraft?.description || asset?.caption || editorState.multimediaDraft?.description || "",
    placement: updatingSelected
      ? editorState.selectedNode.attrs?.placement
      : (nextVariant === "banner" ? "full-width" : "center"),
    focusX: matchingDraft?.focusX ?? asset?.focusX ?? editorState.multimediaDraft?.focusX,
    focusY: matchingDraft?.focusY ?? asset?.focusY ?? editorState.multimediaDraft?.focusY,
    cropX: matchingDraft?.cropX ?? asset?.cropX ?? editorState.multimediaDraft?.cropX,
    cropY: matchingDraft?.cropY ?? asset?.cropY ?? editorState.multimediaDraft?.cropY,
    cropWidth: matchingDraft?.cropWidth ?? asset?.cropWidth ?? editorState.multimediaDraft?.cropWidth,
    cropHeight: matchingDraft?.cropHeight ?? asset?.cropHeight ?? editorState.multimediaDraft?.cropHeight,
    rotationQuarterTurns: matchingDraft?.rotationQuarterTurns ?? asset?.rotationQuarterTurns ?? editorState.multimediaDraft?.rotationQuarterTurns,
    flipX: matchingDraft?.flipX ?? asset?.flipX ?? editorState.multimediaDraft?.flipX,
    flipY: matchingDraft?.flipY ?? asset?.flipY ?? editorState.multimediaDraft?.flipY
  });

  if (updatingSelected) {
    updateSelectedInvestigationNode(editor, "templateMultimedia", nextAttrs);
  } else {
    insertEditorNodeAtAuthoringSelection(editor, {
      type: "templateMultimedia",
      attrs: nextAttrs
    });
  }
  editorState.multimediaDraft = nextAttrs;
  editorState.multimediaInsertMode = false;
  handleEditorMutation();
  editorState.selectedNode = inspectSelectedNode();
  editorState.multimediaDraftSourcePos = Number(editorState.selectedNode?.pos || 0);
  editorState.multimediaEditorMode = "instance";
  editorState.imageEditorMode = "instance";
  openRailPanel("multimedia");
}

function syncSelectedMultimediaNodeFromAsset(asset) {
  if (!asset || editorState.selectedNode?.name !== "templateMultimedia") return;
  if (String(editorState.selectedNode?.attrs?.assetId || "") !== asset.id) return;
  updateSelectedInvestigationNode(editorState.editor, "templateMultimedia", normalizeMultimediaAttrs({
    ...editorState.selectedNode.attrs,
    assetId: asset.id,
    src: resolveImageAssetUrl(asset),
    assetWidth: asset.width,
    assetHeight: asset.height,
    alt: asset.alt,
    description: asset.caption,
    focusX: asset.focusX,
    focusY: asset.focusY,
    cropX: asset.cropX,
    cropY: asset.cropY,
    cropWidth: asset.cropWidth,
    cropHeight: asset.cropHeight,
    rotationQuarterTurns: asset.rotationQuarterTurns,
    flipX: asset.flipX,
    flipY: asset.flipY
  }));
  editorState.selectedNode = inspectSelectedNode();
}

function applyCropPreset(preset = "", options = {}) {
  const asset = resolveEditableMultimediaImageState();
  if (!asset || !asset.src) return;
  const crop = cropPresetRect(String(preset || "").trim().toLowerCase(), {
    width: Number(asset.assetWidth || asset.width || 0),
    height: Number(asset.assetHeight || asset.height || 0)
  });
  applyEditableMultimediaImagePatch(crop, options);
}

function applyImageTransform(action = "", options = {}) {
  const asset = resolveEditableMultimediaImageState();
  if (!asset || !asset.src) return;
  if (action === "rotate-90") {
    applyEditableMultimediaImagePatch({
      rotationQuarterTurns: Number(asset.rotationQuarterTurns || 0) + 1
    }, options);
    return;
  }
  if (action === "flip-horizontal") {
    applyEditableMultimediaImagePatch({
      flipX: !asset.flipX
    }, options);
    return;
  }
  if (action === "flip-vertical") {
    applyEditableMultimediaImagePatch({
      flipY: !asset.flipY
    }, options);
  }
}

function rotateCropAspectOrientation(options = {}) {
  const asset = resolveEditableMultimediaImageState();
  if (!asset || !asset.src) return;
  const width = Math.max(1, Number(asset.assetWidth || asset.width || 1));
  const height = Math.max(1, Number(asset.assetHeight || asset.height || 1));
  const currentRatio = ((Number(asset.cropWidth || 1) * width) / Math.max(Number(asset.cropHeight || 1) * height, 0.0001)) || (width / height);
  applyEditableMultimediaImagePatch(cropRectForRatio(1 / Math.max(currentRatio, 0.0001), { width, height }), options);
}

function finishImageEditing() {
  closeMultimediaEditor();
}

function cancelImageEditing() {
  restoreMultimediaSessionSnapshot();
  closeMultimediaEditor({ clearSelection: true });
}

function deleteActiveImageAsset() {
  const assetId = editorState.activeImageAssetId;
  if (!assetId) return;
  editorState.imageAssets = normalizeImageAssets(editorState.imageAssets.filter((asset) => asset.id !== assetId));
  editorState.activeImageAssetId = "";
  editorState.document = normalizeEditorDocument({
    ...readCurrentDocument(),
    mediaAssets: editorState.imageAssets,
    body_json: removeMultimediaNodesForAsset(readCurrentDocument().bodyJson, assetId)
  });
  applyDocument(editorState.document, { restoreSelection: false });
  setSaveStatus("pending", "Unsaved");
  scheduleLocalSnapshot();
  scheduleRelaySave();
  scheduleDerivedProjection();
  scheduleLivePublish();
  clearMultimediaSession();
  closeMultimediaEditor({ clearSelection: true });
}

function collectDocumentCitations() {
  const current = readCurrentDocument();
  return Array.isArray(current?.citations) ? current.citations.slice() : [];
}

function openCitationEditor(citationId = "") {
  const citations = collectDocumentCitations();
  const existing = citations.find((item) => String(item.id || "") === String(citationId || ""));
  editorState.editingCitationId = existing?.id || "";
  editorState.citationDraft = normalizeCitationAttrs(existing || createBlankCitationDraft());
  editorState.citationEditorOpen = true;
  openRailPanel("citation");
}

function closeCitationEditor() {
  editorState.citationEditorOpen = false;
  editorState.editingCitationId = "";
  editorState.citationDraft = createBlankCitationDraft();
  refreshEditorChrome();
}

function saveCitationDraft() {
  captureTransientPanelDrafts();
  const attrs = normalizeCitationAttrs({
    ...(editorState.citationDraft || {}),
    id: editorState.citationDraft?.id || editorState.editingCitationId || "",
    number: editorState.citationDraft?.number || 0,
    title: editorState.citationDraft?.title || "",
    author: editorState.citationDraft?.author || "",
    source: editorState.citationDraft?.source || "",
    publisher: editorState.citationDraft?.publisher || "",
    publishedAt: editorState.citationDraft?.publishedAt || "",
    page: editorState.citationDraft?.page || "",
    href: editorState.citationDraft?.href || "",
    archiveHref: editorState.citationDraft?.archiveHref || "",
    accessedAt: editorState.citationDraft?.accessedAt || "",
    note: editorState.citationDraft?.note || ""
  });
  editorState.citationDraft = attrs;
  if (!attrs.title && !attrs.href && !attrs.note) return;
  const current = readCurrentDocument();
  const citations = Array.isArray(current.citations) ? current.citations.slice() : [];
  const citationId = attrs.id || editorState.editingCitationId || createCitationId();
  const nextCitation = {
    ...attrs,
    id: citationId
  };
  const existingIndex = citations.findIndex((item) => String(item.id || "") === citationId);
  if (existingIndex >= 0) {
    citations[existingIndex] = nextCitation;
  } else {
    citations.push(nextCitation);
  }
  editorState.document = normalizeEditorDocument({
    ...current,
    citations
  });
  updateStoredCitations(citations);
  editorState.documentCitations = citations;
  editorState.citationEditorOpen = false;
  editorState.editingCitationId = citationId;
  setSaveStatus("pending", "Unsaved");
  scheduleLocalSnapshot();
  scheduleRelaySave();
  scheduleDerivedProjection();
  scheduleLivePublish();
  refreshEditorChrome();
}

function deleteCitationDraft() {
  const citationId = editorState.editingCitationId;
  if (!citationId) return;
  const current = readCurrentDocument();
  const citations = (Array.isArray(current.citations) ? current.citations : []).filter((item) => String(item.id || "") !== citationId);
  editorState.document = normalizeEditorDocument({
    ...current,
    citations
  });
  updateStoredCitations(citations);
  editorState.documentCitations = citations;
  closeCitationEditor();
  setSaveStatus("pending", "Unsaved");
  scheduleLocalSnapshot();
  scheduleRelaySave();
  scheduleDerivedProjection();
  scheduleLivePublish();
}

function insertCitationAtSelection(citationId = "") {
  const editor = editorState.editor;
  if (!editor || !citationId) return;
  const citations = collectDocumentCitations();
  const citation = citations.find((item) => String(item.id || "") === citationId);
  if (!citation) return;
  const number = citations.findIndex((item) => String(item.id || "") === citationId) + 1;
  const insertAt = Number(editor.state?.selection?.to || editor.state?.selection?.from || 0);
  editor.chain().focus().insertContentAt(insertAt, {
    type: "templateCitation",
    attrs: normalizeCitationAttrs({
      ...citation,
      id: citationId,
      number
    })
  }).run();
  handleEditorMutation();
}

function insertEntityTileDraft() {
  const editor = editorState.editor;
  if (!editor) return;
  const selected = editorState.entityTileDraft?.selected || null;
  const attrs = normalizeEntityTileAttrs({
    entity: selected?.slug || editorState.entityTileDraft?.entity || "",
    label: selected?.name || editorState.entityTileDraft?.label || "",
    summary: selected?.summary || editorState.entityTileDraft?.summary || "",
    meta: [selected?.type, selected?.location].filter(Boolean).join(" · ") || editorState.entityTileDraft?.meta || "",
    href: selected?.slug
      ? `./wiki.html?slug=${encodeURIComponent(selected.slug)}`
      : editorState.entityTileDraft?.href || "",
    displayStyle: editorState.entityTileDraft?.displayStyle || "smart"
  });
  if (!attrs.entity && !attrs.label) return;
  if (isEditingSelectedEntityTile()) {
    updateSelectedInvestigationNode(editor, "investigationEntityTile", attrs);
  } else {
    insertEditorNodeAtAuthoringSelection(editor, {
      type: "investigationEntityTile",
      attrs
    });
  }
  editorState.entityTileInsertMode = false;
  handleEditorMutation();
  editorState.selectedNode = inspectSelectedNode();
  editorState.entityTileDraftSourcePos = Number(editorState.selectedNode?.pos || 0);
  editorState.entityTileEditorMode = "instance";
  openRailPanel("entityTile");
}

function syncRailPanelWithSelection() {
  const selected = editorState.selectedNode;
  if (!selected) return;
  if (selected.name === "templateMultimedia") {
    const assetId = String(selected.attrs?.assetId || "").trim();
    if (assetId) editorState.activeImageAssetId = assetId;
    const preserveActiveDraft = editorState.activeRailPanel === "multimedia" && (
      editorState.multimediaInsertMode ||
      (
        Boolean(editorState.multimediaEditorMode) &&
        Number(editorState.multimediaDraftSourcePos || 0) === Number(selected.pos || 0)
      )
    );
    if (!preserveActiveDraft) {
      editorState.multimediaDraft = normalizeMultimediaAttrs(selected.attrs || {});
      editorState.multimediaDraftSourcePos = Number(selected.pos || 0);
      editorState.multimediaInsertMode = false;
    }
    if (!editorState.activeRailPanel) editorState.activeRailPanel = "multimedia";
    if (!editorState.multimediaEditorMode) editorState.multimediaEditorMode = "instance";
    if (!editorState.imageEditorMode) editorState.imageEditorMode = "instance";
    return;
  }
  if (selected.name === "templateCitation") {
    editorState.citationDraft = normalizeCitationAttrs(selected.attrs || {});
    if (!editorState.activeRailPanel) editorState.activeRailPanel = "citation";
    return;
  }
  if (selected.name === "investigationEntityTile") {
    const preserveInsertDraft = editorState.activeRailPanel === "entityTile" && editorState.entityTileInsertMode;
    if (!preserveInsertDraft) {
      editorState.entityTileDraft = draftEntityTileFromNode(selected.attrs || {});
      editorState.entityTileDraftSourcePos = Number(selected.pos || 0);
      editorState.entityTileInsertMode = false;
    }
    editorState.entityTileMatches = matchEntities(editorState.entityTileDraft?.query || "").slice(0, 8);
    if (!editorState.activeRailPanel) editorState.activeRailPanel = "entityTile";
    if (!editorState.entityTileEditorMode) editorState.entityTileEditorMode = "instance";
  }
}

function hydrateImageAssetsFromDocument(nextDocument) {
  const incoming = normalizeImageAssets(nextDocument?.mediaAssets || nextDocument?.media_assets || []);
  const existing = new Map(editorState.imageAssets.map((asset) => [asset.id, asset]));
  const merged = incoming.map((asset) => {
    const current = existing.get(asset.id);
    if (!current) return asset;
    return normalizeImageAsset({
      ...asset,
      localDataUrl: current.localDataUrl || asset.localDataUrl,
      publishUrl: current.publishUrl || asset.publishUrl,
      uploadStatus: current.uploadStatus !== "local" ? current.uploadStatus : asset.uploadStatus
    });
  });
  for (const asset of editorState.imageAssets) {
    if (!incoming.find((entry) => entry.id === asset.id)) {
      merged.push(asset);
    }
  }
  editorState.imageAssets = normalizeImageAssets(merged);
}

function hydrateEntityResults() {
  renderEntityResults("primaryEntity");
  renderEntityResults("entityRefs");
}

function renderEntityResults(fieldName) {
  const host = documentRef?.querySelector?.(`[data-editor-entity-results="${fieldName}"]`);
  const input = documentRef?.querySelector?.(`[data-editor-entity-input="${fieldName}"]`);
  if (!(host instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;

  const query = fieldName === "entityRefs" ? lastCommaValue(input.value) : input.value.trim();
  const isActive = editorState.activePickerField === fieldName;
  if (!query && !isActive) {
    host.innerHTML = "";
    host.removeAttribute("data-open");
    return;
  }

  const matches = matchEntities(query).slice(0, 6);
  host.setAttribute("data-open", "yes");
  host.innerHTML = matches.length
    ? matches.map((entity) => `
        <button
          class="picker-chip"
          type="button"
          data-editor-entity-pick="${escapeAttribute(entity.slug)}"
          data-target-field="${escapeAttribute(fieldName)}"
        >
          <strong>${escapeHtml(entity.name)}</strong>
          <span>${escapeHtml(entity.location || entity.type || "Entity")}</span>
        </button>
      `).join("")
    : `<div class="picker-hint">${query ? "No saved entity matches that search yet." : "Start typing to search saved entities."}</div>`;
}

function applyEntityPick(button) {
  const slug = button.getAttribute("data-editor-entity-pick") || "";
  const fieldName = button.getAttribute("data-target-field") || "";
  const entity = resolveEntityByNameOrSlug(slug);
  const input = documentRef?.querySelector?.(`[data-editor-entity-input="${fieldName}"]`);
  if (!entity || !(input instanceof HTMLInputElement)) return;

  if (fieldName === "entityRefs") {
    const existing = splitTags(input.value)
      .map((value) => resolveEntityByNameOrSlug(value)?.name || value)
      .filter(Boolean);
    input.value = dedupe([...existing, entity.name]).join(", ");
  } else {
    input.value = entity.name;
  }
  editorState.activePickerField = "";
  handleShellInput({ target: input });
}

function matchEntities(query) {
  const clean = String(query || "").trim().toLowerCase();
  const entities = (editorState.publicState?.approvedEntities || editorState.publicState?.entities || [])
    .slice()
    .sort((left, right) => String(left?.name || "").localeCompare(String(right?.name || "")));
  if (!clean) return entities;
  return entities.filter((entity) => {
    const values = [
      entity?.name,
      entity?.slug,
      entity?.summary,
      entity?.location,
      entity?.type,
      ...(Array.isArray(entity?.aliases) ? entity.aliases : [])
    ]
      .map((value) => String(value || "").toLowerCase())
      .filter(Boolean);
    return values.some((value) => value.includes(clean));
  });
}

function applyEntityTilePick(slug = "") {
  const entity = resolveEntityByNameOrSlug(slug);
  if (!entity) return;
  editorState.entityTileDraft = {
    ...(editorState.entityTileDraft || createBlankEntityTileDraft()),
    query: entity.name || entity.slug || "",
    selected: entity
  };
  editorState.entityTileMatches = matchEntities(editorState.entityTileDraft.query || "").slice(0, 8);
  insertEntityTileDraft();
}

function draftEntityTileFromNode(attrs = {}) {
  const normalized = normalizeEntityTileAttrs(attrs || {});
  const selected = resolveEntityByNameOrSlug(normalized.entity || normalized.label || "") || (
    normalized.entity || normalized.label
      ? {
          slug: normalized.entity,
          name: normalized.label || normalized.entity,
          summary: normalized.summary,
          type: "",
          location: ""
        }
      : null
  );
  return {
    query: selected?.name || normalized.label || "",
    selected,
    entity: normalized.entity,
    label: normalized.label,
    summary: normalized.summary,
    meta: normalized.meta,
    href: normalized.href,
    displayStyle: normalized.displayStyle || "smart",
    placement: normalized.placement || "center",
    widthRatio: Number(normalized.widthRatio || 0.46)
  };
}

function createBlankCitationDraft() {
  return normalizeCitationAttrs({
    id: "",
    number: 0,
    title: "",
    href: "",
    note: "",
    author: "",
    source: "",
    publisher: "",
    publishedAt: "",
    page: "",
    archiveHref: "",
    accessedAt: ""
  });
}

function createBlankMultimediaDraft(variant = editorState.pendingWrappedVariant || "image") {
  return normalizeMultimediaAttrs({
    variant,
    placement: variant === "banner" ? "full-width" : "center",
    widthRatio: variant === "banner" ? 1 : 0.7,
    backgroundColor: variant === "banner" ? "#8f2017" : "#ece3d4",
    textColor: variant === "banner" ? "#fff7ef" : "#171717",
    overlayColor: variant === "banner" ? "rgba(0,0,0,0.38)" : "",
    title: "",
    text: ""
  });
}

function hydrateMultimediaDraftWithAsset(draft = {}, asset = null) {
  const currentDraft = draft && typeof draft === "object"
    ? draft
    : createBlankMultimediaDraft(editorState.pendingWrappedVariant || "image");
  if (!asset) {
    return normalizeMultimediaAttrs(currentDraft);
  }
  return normalizeMultimediaAttrs({
    ...currentDraft,
    assetId: asset.id || currentDraft.assetId || "",
    src: resolveImageAssetUrl(asset) || currentDraft.src || "",
    assetWidth: Number(asset.width || currentDraft.assetWidth || 0),
    assetHeight: Number(asset.height || currentDraft.assetHeight || 0),
    alt: asset.alt || currentDraft.alt || "",
    description: asset.caption || currentDraft.description || "",
    focusX: asset.focusX,
    focusY: asset.focusY,
    cropX: asset.cropX,
    cropY: asset.cropY,
    cropWidth: asset.cropWidth,
    cropHeight: asset.cropHeight,
    rotationQuarterTurns: asset.rotationQuarterTurns,
    flipX: asset.flipX,
    flipY: asset.flipY
  });
}

function withMultimediaAssetDefaults(draft = {}, asset = null) {
  const currentDraft = draft && typeof draft === "object"
    ? draft
    : createBlankMultimediaDraft(editorState.pendingWrappedVariant || "image");
  if (!asset) {
    return normalizeMultimediaAttrs(currentDraft);
  }
  return normalizeMultimediaAttrs({
    ...currentDraft,
    assetId: currentDraft.assetId || asset.id || "",
    src: currentDraft.src || resolveImageAssetUrl(asset) || "",
    assetWidth: Number(currentDraft.assetWidth || asset.width || 0),
    assetHeight: Number(currentDraft.assetHeight || asset.height || 0),
    alt: currentDraft.alt || asset.alt || "",
    description: currentDraft.description || asset.caption || ""
  });
}

function isDraftBackedMultimediaEditor() {
  const mode = String(editorState.multimediaEditorMode || editorState.imageEditorMode || "").trim();
  return mode === "instance" || mode === "banner" || mode === "banner-create" || mode === "banner-edit";
}

function resolveEditableMultimediaImageState() {
  const draft = editorState.multimediaDraft || createBlankMultimediaDraft(editorState.pendingWrappedVariant || "image");
  const asset = editorState.activeImageAsset || resolveImageAssetById(draft.assetId || editorState.activeImageAssetId || "");
  if (isDraftBackedMultimediaEditor()) {
    return withMultimediaAssetDefaults(draft, asset);
  }
  if (asset) {
    return hydrateMultimediaDraftWithAsset(draft, asset);
  }
  return normalizeMultimediaAttrs(draft);
}

function applyEditableMultimediaImagePatch(patch = {}, options = {}) {
  if (isDraftBackedMultimediaEditor()) {
    const nextDraft = normalizeMultimediaAttrs({
      ...withMultimediaAssetDefaults(
        editorState.multimediaDraft || createBlankMultimediaDraft(editorState.pendingWrappedVariant || "image"),
        editorState.activeImageAsset || resolveImageAssetById(editorState.multimediaDraft?.assetId || "")
      ),
      ...patch
    });
    editorState.multimediaDraft = nextDraft;
    if (isEditingSelectedMultimedia()) {
      applySelectedMultimediaAttrs(nextDraft, { silent: true });
    }
    if (options.refreshChrome === false) {
      syncLiveImageEditorDom(nextDraft);
    } else {
      refreshEditorChrome();
    }
    return;
  }
  applyActiveImageAssetPatch(patch, options);
}

function createBannerPresetId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `banner-${globalThis.crypto.randomUUID()}`;
  }
  return `banner-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBannerPreset(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const now = new Date().toISOString();
  return {
    ...normalizeMultimediaAttrs({
      ...source,
      variant: "banner"
    }),
    id: String(source.id || "").trim() || createBannerPresetId(),
    updatedAt: String(source.updatedAt || now).trim() || now
  };
}

function normalizeBannerPresets(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => normalizeBannerPreset(value))
    .filter((preset) => {
      if (!preset.id || seen.has(preset.id)) return false;
      seen.add(preset.id);
      return true;
    });
}

function createBlankEntityTileDraft() {
  return {
    query: "",
    selected: null,
    entity: "",
    label: "",
    summary: "",
    meta: "",
    href: "",
    displayStyle: "smart",
    placement: "center",
    widthRatio: 0.46
  };
}

function isEditingSelectedMultimedia() {
  return Boolean(
    editorState.selectedNode?.name === "templateMultimedia" &&
    !editorState.multimediaInsertMode &&
    String(editorState.multimediaEditorMode || editorState.imageEditorMode || "").trim() === "instance" &&
    Number(editorState.multimediaDraftSourcePos || 0) === Number(editorState.selectedNode?.pos || 0)
  );
}

function isEditingSelectedEntityTile() {
  return Boolean(
    editorState.selectedNode?.name === "investigationEntityTile" &&
    !editorState.entityTileInsertMode &&
    String(editorState.entityTileEditorMode || "").trim() === "instance" &&
    Number(editorState.entityTileDraftSourcePos || 0) === Number(editorState.selectedNode?.pos || 0)
  );
}

function insertEditorNodeAtAuthoringSelection(editor, content) {
  if (!editor || !content) return false;
  const selection = editor.state?.selection;
  if (selection?.node) {
    const insertPos = Number(selection.to || 0);
    return editor.chain().focus().insertContentAt(insertPos, content).setNodeSelection(insertPos).run();
  }
  return editor.chain().focus().insertContent(content).run();
}

function createCitationId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return `cite-${globalThis.crypto.randomUUID()}`;
  }
  return `cite-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function openWrappedInsertMenuChoice(kind = "image") {
  const variant = String(kind || "image").trim().toLowerCase() === "banner" ? "banner" : "image";
  editorState.pendingWrappedVariant = variant;
  editorState.wrappedInsertMenuOpen = false;
  editorState.multimediaDraftSourcePos = 0;
  editorState.multimediaInsertMode = true;
  editorState.activeBannerPresetId = "";
  if (variant === "banner") {
    editorState.multimediaDraft = createBlankMultimediaDraft("banner");
    editorState.multimediaEditorMode = "";
    openRailPanel("multimedia");
    refreshEditorChrome();
    return;
  }
  beginMultimediaSession({ clearActiveAsset: true });
  editorState.activeImageAssetId = "";
  editorState.multimediaDraft = createBlankMultimediaDraft(variant);
  editorState.skipNextMultimediaDraftCapture = true;
  editorState.multimediaEditorMode = "";
  openRailPanel("multimedia");
  if (variant === "image") {
    refreshEditorChrome();
  }
}

function openBannerPresetCreateFlow() {
  beginMultimediaSession({ clearActiveAsset: true });
  editorState.pendingWrappedVariant = "banner";
  editorState.activeBannerPresetId = "";
  editorState.activeImageAssetId = "";
  editorState.multimediaDraft = createBlankMultimediaDraft("banner");
  editorState.multimediaEditorMode = "banner-create";
  editorState.multimediaInsertMode = true;
  editorState.skipNextMultimediaDraftCapture = true;
  openRailPanel("multimedia");
}

function openBannerPresetEditor(presetId = "") {
  const preset = editorState.bannerPresets.find((item) => item.id === String(presetId || "").trim());
  if (!preset) return;
  beginMultimediaSession({ clearActiveAsset: true });
  editorState.pendingWrappedVariant = "banner";
  editorState.activeBannerPresetId = preset.id;
  editorState.activeImageAssetId = String(preset.assetId || "").trim();
  editorState.multimediaDraft = normalizeMultimediaAttrs(preset);
  editorState.multimediaEditorMode = "banner-edit";
  editorState.multimediaInsertMode = false;
  editorState.skipNextMultimediaDraftCapture = true;
  openRailPanel("multimedia");
}

function insertBannerPreset(presetId = "") {
  const preset = editorState.bannerPresets.find((item) => item.id === String(presetId || "").trim());
  const editor = editorState.editor;
  if (!preset || !editor) return;
  const attrs = normalizeMultimediaAttrs(preset);
  insertEditorNodeAtAuthoringSelection(editor, {
    type: "templateMultimedia",
    attrs
  });
  editorState.multimediaDraft = attrs;
  editorState.multimediaDraftSourcePos = 0;
  editorState.multimediaInsertMode = false;
  handleEditorMutation();
  editorState.selectedNode = inspectSelectedNode();
  editorState.multimediaDraftSourcePos = Number(editorState.selectedNode?.pos || 0);
  editorState.multimediaEditorMode = "instance";
  editorState.imageEditorMode = "instance";
  openRailPanel("multimedia");
}

function saveMultimediaDraft() {
  captureTransientPanelDrafts();
  const baseDraft = normalizeMultimediaAttrs({
    ...(editorState.multimediaDraft || createBlankMultimediaDraft())
  });
  const draft = isDraftBackedMultimediaEditor()
    ? withMultimediaAssetDefaults(
        baseDraft,
        editorState.activeImageAsset || resolveImageAssetById(editorState.multimediaDraft?.assetId || "")
      )
    : hydrateMultimediaDraftWithAsset(
        baseDraft,
        editorState.activeImageAsset || resolveImageAssetById(editorState.multimediaDraft?.assetId || "")
      );
  const editor = editorState.editor;
  if (!editor) return;
  const bannerPrototypeMode = ["banner-create", "banner-edit"].includes(String(editorState.multimediaEditorMode || "").trim()) && !isEditingSelectedMultimedia();
  const assetOnlyMode = ["create", "edit"].includes(String(editorState.multimediaEditorMode || "").trim()) && !isEditingSelectedMultimedia();
  if (bannerPrototypeMode) {
    const nextPreset = normalizeBannerPreset({
      ...draft,
      id: editorState.activeBannerPresetId || ""
    });
    const existingIndex = editorState.bannerPresets.findIndex((item) => item.id === nextPreset.id);
    const nextPresets = editorState.bannerPresets.slice();
    if (existingIndex >= 0) {
      nextPresets.splice(existingIndex, 1, nextPreset);
    } else {
      nextPresets.unshift(nextPreset);
    }
    editorState.bannerPresets = normalizeBannerPresets(nextPresets);
    editorState.activeBannerPresetId = nextPreset.id;
    editorState.multimediaDraft = nextPreset;
    clearMultimediaSession();
    closeMultimediaEditor({ clearSelection: true });
    return;
  }
  if (assetOnlyMode) {
    editorState.multimediaDraft = draft;
    editorState.document = readCurrentDocument();
    setSaveStatus("pending", "Unsaved");
    scheduleLocalSnapshot();
    scheduleRelaySave();
    scheduleDerivedProjection();
    scheduleLivePublish();
    clearMultimediaSession();
    closeMultimediaEditor({ clearSelection: true });
    return;
  }
  if (draft.variant === "banner" && !draft.title && !draft.text && !draft.src) return;
  if ((draft.variant === "image" || draft.variant === "captioned_image") && !draft.src) {
    clearMultimediaSession();
    closeMultimediaEditor({ clearSelection: true });
    return;
  }
  if (editorState.multimediaEditorMode === "edit" && !isEditingSelectedMultimedia()) {
    clearMultimediaSession();
    closeMultimediaEditor({ clearSelection: true });
    return;
  }
  const updatingSelected = isEditingSelectedMultimedia();
  if (isEditingSelectedMultimedia()) {
    updateSelectedInvestigationNode(editor, "templateMultimedia", draft);
  } else {
    insertEditorNodeAtAuthoringSelection(editor, {
      type: "templateMultimedia",
      attrs: draft
    });
  }
  editorState.multimediaDraft = draft;
  editorState.multimediaInsertMode = false;
  handleEditorMutation();
  clearMultimediaSession();
  closeMultimediaEditor({ clearSelection: updatingSelected });
}

function cancelMultimediaEditing() {
  restoreMultimediaSessionSnapshot();
  editorState.activeBannerPresetId = "";
  closeMultimediaEditor({ clearSelection: true });
}

function deleteSelectedMultimediaNode() {
  const editor = editorState.editor;
  const selected = editorState.selectedNode;
  if (!editor || selected?.name !== "templateMultimedia") return;
  editor.chain().focus().setNodeSelection(selected.pos).deleteSelection().run();
  editorState.multimediaDraft = createBlankMultimediaDraft(editorState.pendingWrappedVariant || "image");
  editorState.multimediaDraftSourcePos = 0;
  clearMultimediaSession();
  handleEditorMutation();
  closeMultimediaEditor();
}

function deleteActiveBannerPreset() {
  const presetId = String(editorState.activeBannerPresetId || "").trim();
  if (!presetId) return;
  editorState.bannerPresets = normalizeBannerPresets(
    editorState.bannerPresets.filter((item) => item.id !== presetId)
  );
  editorState.activeBannerPresetId = "";
  editorState.multimediaDraft = createBlankMultimediaDraft("banner");
  clearMultimediaSession();
  closeMultimediaEditor({ clearSelection: true });
}

function applyMultimediaScale(rawValue = "") {
  const [scope, direction] = String(rawValue || "").trim().split(":");
  if (!scope || !direction) return;
  const key = scope === "title" ? "titleScale" : "textScale";
  const current = Number(editorState.multimediaDraft?.[key] || 1);
  const delta = direction === "up" ? 0.08 : -0.08;
  const nextDraft = normalizeMultimediaAttrs({
    ...(editorState.multimediaDraft || createBlankMultimediaDraft()),
    [key]: Math.max(0.4, Math.min(2.5, current + delta))
  });
  editorState.multimediaDraft = nextDraft;
  if (isEditingSelectedMultimedia()) {
    applySelectedMultimediaAttrs(nextDraft, { silent: true });
  }
  refreshEditorChrome();
}

function applyMultimediaTextAlignment(rawValue = "", key = "alignX") {
  const [scope, direction] = String(rawValue || "").trim().split(":");
  if (!scope || !direction) return;
  const boxKey = scope === "title" ? "titleBox" : "textBox";
  const currentBox = cloneValue(editorState.multimediaDraft?.[boxKey] || {});
  currentBox[key] = direction;
  const nextDraft = normalizeMultimediaAttrs({
    ...(editorState.multimediaDraft || createBlankMultimediaDraft()),
    [boxKey]: currentBox
  });
  editorState.multimediaDraft = nextDraft;
  if (isEditingSelectedMultimedia()) {
    applySelectedMultimediaAttrs(nextDraft, { silent: true });
  }
  refreshEditorChrome();
}

function updateStoredCitations(citations = []) {
  editorState.document = normalizeEditorDocument({
    ...readCurrentDocument(),
    citations
  });
}

function applyLinkDraft() {
  const editor = editorState.editor;
  if (!editor) return;
  const href = String(editorState.linkDraft?.href || "").trim();
  const text = String(editorState.linkDraft?.text || "").trim();
  if (!href) {
    editor.chain().focus().unsetLink().run();
    editorState.linkEditorOpen = false;
    refreshEditorChrome();
    return;
  }
  const start = editor.state.selection.from;
  if (editor.state.selection.empty && text) {
    editor.chain().focus().insertContent(text).setTextSelection({
      from: start,
      to: start + text.length
    }).setLink({ href }).run();
  } else {
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  }
  editorState.linkEditorOpen = false;
  refreshEditorChrome();
}

function startWrappedObjectArrangementGesture(event, target) {
  if (startMultimediaPreviewGesture(event, target)) {
    return true;
  }
  const multimedia = target.closest("[data-template-multimedia]");
  if (multimedia instanceof HTMLElement) {
    return startMultimediaArrangementGesture(event, target, multimedia);
  }
  const entityTile = target.closest("[data-investigation-entity-tile]");
  if (entityTile instanceof HTMLElement) {
    return startEntityArrangementGesture(event, target, entityTile);
  }
  return false;
}

function startMultimediaPreviewGesture(event, target) {
  const preview = target.closest("[data-editor-media-preview]");
  const textHandle = target.closest("[data-editor-media-preview-text-box-handle]");
  const textBox = target.closest("[data-editor-media-preview-text-box]");
  if (!(preview instanceof HTMLElement) || (!textHandle && !textBox)) {
    return false;
  }

  const region = preview.querySelector("[data-editor-media-preview-region]");
  if (!(region instanceof HTMLElement)) return false;

  const [scopeFromHandle = "", handleFromHandle = ""] = String(textHandle?.getAttribute("data-editor-media-preview-text-box-handle") || "").split(":");
  const scope = scopeFromHandle || String(textBox?.getAttribute("data-editor-media-preview-text-box") || "").trim();
  if (!scope) return false;

  const boxKey = scope === "title" ? "titleBox" : "textBox";
  editorState.arrangementGesture = {
    kind: "multimediaPreview",
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    scope,
    mode: handleFromHandle === "resize" ? "text-resize" : "text-move",
    regionRect: region.getBoundingClientRect(),
    startBox: cloneValue(editorState.multimediaDraft?.[boxKey] || {})
  };
  editorState.arrangementDirty = false;
  return true;
}

function startMultimediaArrangementGesture(event, target, wrapped) {
  const textHandle = target.closest("[data-editor-media-text-box-handle]");
  const resizeHandle = target.closest("[data-editor-resize-handle]");
  const textBox = target.closest("[data-editor-media-text-box]");
  if (!textHandle && !resizeHandle && !textBox && target.closest("a, button, input, textarea, select")) {
    return false;
  }

  const selected = selectInspectableNodeFromElement(wrapped);
  if (!selected || selected.name !== "templateMultimedia") return false;
  const surfaceRect = resolveEditorSurfaceRect();
  const wrapperRect = wrapped.getBoundingClientRect();
  if (!surfaceRect || !wrapperRect.width || !wrapperRect.height) return false;

  const gesture = {
    kind: "multimedia",
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    surfaceRect,
    wrapperRect,
    startAttrs: cloneValue(selected.attrs || {}),
    mode: "move",
    scope: "",
    handle: "",
    regionRect: null,
    ghost: null,
    snapPlacement: String(selected.attrs?.placement || ""),
    dropCaret: null,
    edgeGlow: null,
    pendingInsertPos: Number(selected.pos || 0)
  };

  if (textHandle instanceof HTMLElement) {
    const [scope, handle] = String(textHandle.getAttribute("data-editor-media-text-box-handle") || "").split(":");
    const region = wrapped.querySelector("[data-editor-media-text-region]");
    if (!(region instanceof HTMLElement) || !scope || !handle) return false;
    gesture.mode = handle === "resize" ? "text-resize" : "text-move";
    gesture.scope = scope;
    gesture.handle = handle;
    gesture.regionRect = region.getBoundingClientRect();
  } else if (textBox instanceof HTMLElement) {
    const scope = String(textBox.getAttribute("data-editor-media-text-box") || "").trim();
    const region = wrapped.querySelector("[data-editor-media-text-region]");
    if (!(region instanceof HTMLElement) || !scope) return false;
    gesture.mode = "text-move";
    gesture.scope = scope;
    gesture.regionRect = region.getBoundingClientRect();
  } else if (resizeHandle instanceof HTMLElement) {
    gesture.mode = "resize";
    gesture.handle = String(resizeHandle.getAttribute("data-editor-resize-handle") || "e").trim().toLowerCase();
  } else {
    gesture.mode = "move";
    gesture.ghost = createArrangementGhost(wrapped, wrapperRect);
    gesture.edgeGlow = createArrangementEdgeGlow();
    gesture.dropCaret = createArrangementDropCaret();
    updateArrangementGhost(gesture, event.clientX, event.clientY);
  }

  editorState.arrangementGesture = gesture;
  editorState.arrangementDirty = false;
  return true;
}

function startEntityArrangementGesture(event, target, wrapped) {
  if (target.closest("[data-editor-entity-link], a, button, input, textarea, select") && !target.closest("[data-editor-entity-resize-handle]")) {
    return false;
  }

  const selected = selectInspectableNodeFromElement(wrapped);
  if (!selected || selected.name !== "investigationEntityTile") return false;
  const surfaceRect = resolveEditorSurfaceRect();
  const wrapperRect = wrapped.getBoundingClientRect();
  if (!surfaceRect || !wrapperRect.width || !wrapperRect.height) return false;

  const resizeHandle = target.closest("[data-editor-entity-resize-handle]");
  const gesture = {
    kind: "entityTile",
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastClientX: event.clientX,
    lastClientY: event.clientY,
    surfaceRect,
    wrapperRect,
    startAttrs: cloneValue(selected.attrs || {}),
    mode: resizeHandle ? "resize" : "move",
    handle: resizeHandle ? String(resizeHandle.getAttribute("data-editor-entity-resize-handle") || "e").trim().toLowerCase() : "",
    ghost: resizeHandle ? null : createArrangementGhost(wrapped, wrapperRect),
    snapPlacement: String(selected.attrs?.placement || ""),
    dropCaret: null,
    edgeGlow: null,
    pendingInsertPos: Number(selected.pos || 0)
  };

  if (gesture.ghost) {
    gesture.edgeGlow = createArrangementEdgeGlow();
    gesture.dropCaret = createArrangementDropCaret();
    updateArrangementGhost(gesture, event.clientX, event.clientY);
  }

  editorState.arrangementGesture = gesture;
  editorState.arrangementDirty = false;
  return true;
}

function handleArrangementPointerMove(event) {
  const gesture = editorState.arrangementGesture;
  if (!gesture || gesture.pointerId !== event.pointerId) return false;
  event.preventDefault();

  if (gesture.kind === "multimediaPreview") {
    const boxKey = gesture.scope === "title" ? "titleBox" : "textBox";
    const current = cloneValue(gesture.startBox || {});
    const dx = (event.clientX - gesture.startX) / Math.max(gesture.regionRect?.width || 1, 1);
    const dy = (event.clientY - gesture.startY) / Math.max(gesture.regionRect?.height || 1, 1);
    const nextBox = gesture.mode === "text-resize"
      ? {
          ...current,
          width: clampRatio((current.width || 0.84) + dx, 0.16, 1 - (current.x || 0)),
          height: clampRatio((current.height || 0.24) + dy, 0.12, 1 - (current.y || 0))
        }
        : {
            ...current,
            x: clampRatio((current.x || 0) + dx, 0, 1 - (current.width || 0.84)),
            y: clampRatio((current.y || 0) + dy, 0, 1 - (current.height || 0.24))
          };
    gesture.lastClientX = event.clientX;
    gesture.lastClientY = event.clientY;
    const nextDraft = normalizeMultimediaAttrs({
      ...(editorState.multimediaDraft || createBlankMultimediaDraft()),
      [boxKey]: nextBox
    });
    editorState.multimediaDraft = nextDraft;
    if (isEditingSelectedMultimedia()) {
      applySelectedMultimediaAttrs(nextDraft, { silent: true });
    }
    editorState.arrangementDirty = true;
    queueEditorChromeRefresh();
    return true;
  }

  if (gesture.kind === "multimedia") {
    if (gesture.mode === "move") {
      gesture.lastClientX = event.clientX;
      gesture.lastClientY = event.clientY;
      const placement = resolveWrappedPlacement(gesture.surfaceRect, event.clientX, gesture.startAttrs?.variant || "image");
      gesture.snapPlacement = placement;
      updateArrangementGhost(gesture, event.clientX, event.clientY);
      updateArrangementIndicators(gesture, event.clientX, event.clientY);
      return true;
    }
    if (gesture.mode === "resize") {
      const delta = (event.clientX - gesture.startX) * (gesture.handle === "w" ? -1 : 1);
      const widthRatio = snapObjectWidthRatio(
        clampRatio((gesture.wrapperRect.width + delta) / Math.max(gesture.surfaceRect.width, 1), 0.24, 1),
        0.24
      );
      applySelectedMultimediaAttrs({ widthRatio }, { silent: true });
      return true;
    }
    if (gesture.mode === "text-move" || gesture.mode === "text-resize") {
      const boxKey = gesture.scope === "title" ? "titleBox" : "textBox";
      const current = cloneValue(gesture.startAttrs?.[boxKey] || {});
      const dx = (event.clientX - gesture.startX) / Math.max(gesture.regionRect?.width || 1, 1);
      const dy = (event.clientY - gesture.startY) / Math.max(gesture.regionRect?.height || 1, 1);
      const nextBox = gesture.mode === "text-resize"
        ? {
            ...current,
            width: clampRatio((current.width || 0.84) + dx, 0.16, 1 - (current.x || 0)),
            height: clampRatio((current.height || 0.24) + dy, 0.12, 1 - (current.y || 0))
          }
        : {
            ...current,
            x: clampRatio((current.x || 0) + dx, 0, 1 - (current.width || 0.84)),
            y: clampRatio((current.y || 0) + dy, 0, 1 - (current.height || 0.24))
          };
      applySelectedMultimediaAttrs({ [boxKey]: nextBox }, { silent: true });
      return true;
    }
    return false;
  }

  if (gesture.kind === "entityTile") {
    if (gesture.mode === "move") {
      gesture.lastClientX = event.clientX;
      gesture.lastClientY = event.clientY;
      const placement = resolveWrappedPlacement(gesture.surfaceRect, event.clientX, "entity");
      gesture.snapPlacement = placement;
      updateArrangementGhost(gesture, event.clientX, event.clientY);
      updateArrangementIndicators(gesture, event.clientX, event.clientY);
      return true;
    }
    if (gesture.mode === "resize") {
      const delta = (event.clientX - gesture.startX) * (gesture.handle === "w" ? -1 : 1);
      const widthRatio = snapObjectWidthRatio(
        clampRatio((gesture.wrapperRect.width + delta) / Math.max(gesture.surfaceRect.width, 1), 0.24, 1),
        0.24
      );
      applySelectedEntityTileAttrs({ widthRatio }, { silent: true });
      return true;
    }
  }

  return false;
}

function commitArrangementGesture() {
  const gesture = editorState.arrangementGesture;
  const dirty = Boolean(editorState.arrangementDirty);
  if (gesture?.kind === "multimediaPreview") {
    clearArrangementGesture();
    if (dirty) {
      queueEditorChromeRefresh();
    }
    return;
  }
  if (gesture?.mode === "move") {
    const surface = documentRef?.querySelector?.("[data-editor-surface] .ProseMirror");
    if (surface instanceof HTMLElement) {
      const resolvedTarget = resolveTopLevelInsertTarget(surface, Number(gesture.lastClientY || gesture.startY || 0));
      if (resolvedTarget) {
        gesture.pendingInsertPos = resolvedTarget.pos;
      }
    }
    const placement = gesture.snapPlacement || gesture.startAttrs?.placement || "center";
    const widthRatio = placement === "float-left" || placement === "float-right"
      ? 0.33
      : gesture.startAttrs?.widthRatio;
    if (gesture.kind === "multimedia") {
      moveSelectedBlockNodeToInsertPos("templateMultimedia", gesture.pendingInsertPos);
      applySelectedMultimediaAttrs({ placement, widthRatio }, { silent: true });
    } else if (gesture.kind === "entityTile") {
      moveSelectedBlockNodeToInsertPos("investigationEntityTile", gesture.pendingInsertPos);
      applySelectedEntityTileAttrs({ placement, widthRatio }, { silent: true });
    }
  }
  clearArrangementGesture();
  if (dirty) {
    handleEditorMutation();
  }
}

function clearArrangementGesture() {
  if (editorState.arrangementGesture?.ghost instanceof HTMLElement) {
    editorState.arrangementGesture.ghost.remove();
  }
  if (editorState.arrangementGesture?.dropCaret instanceof HTMLElement) {
    editorState.arrangementGesture.dropCaret.remove();
  }
  if (editorState.arrangementGesture?.edgeGlow instanceof HTMLElement) {
    editorState.arrangementGesture.edgeGlow.remove();
  }
  editorState.arrangementGesture = null;
  editorState.arrangementDirty = false;
}

function selectInspectableNodeFromElement(element) {
  const editor = editorState.editor;
  const view = editor?.view;
  if (!editor || !view || !(element instanceof HTMLElement)) return editorState.selectedNode;
  try {
    const resolved = resolveInspectableNodePosition(view, element, ["templateMultimedia", "investigationEntityTile"]);
    if (!resolved) return editorState.selectedNode;
    editorState.selectedNode = resolved;
    editor.chain().focus().setNodeSelection(resolved.pos).run();
    const inspected = inspectSelectedNode();
    if (inspected?.name === resolved.name) {
      editorState.selectedNode = inspected;
    }
    return editorState.selectedNode;
  } catch {
    return editorState.selectedNode;
  }
}

function resolveInspectableNodePosition(view, element, allowedNames = []) {
  const root = view?.dom;
  if (!(root instanceof HTMLElement) || !(element instanceof HTMLElement)) return null;
  const allow = Array.isArray(allowedNames) ? allowedNames.filter(Boolean) : [];
  let current = element;
  while (current && current instanceof HTMLElement) {
    const resolved = resolveNodePositionFromDomPoint(view, current, 0, allow) ||
      resolveNodePositionFromDomPoint(view, current, current.childNodes.length, allow);
    if (resolved) return resolved;
    if (current === root) break;
    current = current.parentElement;
  }
  return null;
}

function resolveNodePositionFromDomPoint(view, domNode, offset = 0, allowedNames = []) {
  if (!view || !domNode) return null;
  try {
    const pos = view.posAtDOM(domNode, offset);
    return inspectNodeAroundPosition(view.state, pos, allowedNames);
  } catch {
    return null;
  }
}

function inspectNodeAroundPosition(state, pos, allowedNames = []) {
  if (!state?.doc) return null;
  const maxPos = Math.max(0, state.doc.content.size);
  const clamped = Math.max(0, Math.min(Number(pos) || 0, maxPos));
  const resolved = state.doc.resolve(clamped);
  const allow = Array.isArray(allowedNames) ? allowedNames.filter(Boolean) : [];
  const nodeAfter = resolved.nodeAfter;
  if (nodeAfter && (!allow.length || allow.includes(nodeAfter.type?.name))) {
    return {
      name: nodeAfter.type.name,
      attrs: cloneValue(nodeAfter.attrs || {}),
      pos: clamped
    };
  }
  const nodeBefore = resolved.nodeBefore;
  if (nodeBefore && (!allow.length || allow.includes(nodeBefore.type?.name))) {
    return {
      name: nodeBefore.type.name,
      attrs: cloneValue(nodeBefore.attrs || {}),
      pos: Math.max(0, clamped - nodeBefore.nodeSize)
    };
  }
  return null;
}

function applySelectedMultimediaAttrs(patch = {}, { silent = false } = {}) {
  const editor = editorState.editor;
  const selected = editorState.selectedNode;
  if (!editor || selected?.name !== "templateMultimedia") return false;
  const nextAttrs = normalizeMultimediaAttrs({
    ...(selected.attrs || {}),
    ...patch
  });
  if (JSON.stringify(selected.attrs || {}) === JSON.stringify(nextAttrs)) {
    return false;
  }
  if (silent) editorState.suppressEditorEvents += 1;
  try {
    updateSelectedInvestigationNode(editor, "templateMultimedia", nextAttrs);
  } finally {
    if (silent) editorState.suppressEditorEvents = Math.max(0, editorState.suppressEditorEvents - 1);
  }
  editorState.multimediaDraft = nextAttrs;
  editorState.selectedNode = inspectSelectedNode();
  editorState.arrangementDirty = true;
  if (silent) {
    if (editorState.activeRailPanel === "multimedia") {
      syncLiveImageEditorDom(nextAttrs);
    }
  } else {
    refreshEditorChrome();
  }
  return true;
}

function applySelectedEntityTileAttrs(patch = {}, { silent = false } = {}) {
  const editor = editorState.editor;
  const selected = editorState.selectedNode;
  if (!editor || selected?.name !== "investigationEntityTile") return false;
  const nextAttrs = normalizeEntityTileAttrs({
    ...(selected.attrs || {}),
    ...patch
  });
  if (JSON.stringify(selected.attrs || {}) === JSON.stringify(nextAttrs)) {
    return false;
  }
  if (silent) editorState.suppressEditorEvents += 1;
  try {
    updateSelectedInvestigationNode(editor, "investigationEntityTile", nextAttrs);
  } finally {
    if (silent) editorState.suppressEditorEvents = Math.max(0, editorState.suppressEditorEvents - 1);
  }
  editorState.entityTileDraft = draftEntityTileFromNode(nextAttrs);
  editorState.selectedNode = inspectSelectedNode();
  editorState.arrangementDirty = true;
  if (!silent) {
    refreshEditorChrome();
  }
  return true;
}

function resolveEditorSurfaceRect() {
  const surface = documentRef?.querySelector?.("[data-editor-surface] .ProseMirror");
  return surface instanceof HTMLElement ? surface.getBoundingClientRect() : null;
}

function resolveWrappedPlacement(surfaceRect, clientX, variant = "image") {
  if (String(variant || "").trim().toLowerCase() === "banner") return "full-width";
  const threshold = Math.max(surfaceRect.width * 0.1, 48);
  if (clientX - surfaceRect.left <= threshold) return "float-left";
  if (surfaceRect.right - clientX <= threshold) return "float-right";
  return "center";
}

function createArrangementGhost(element, rect) {
  const ghost = element.cloneNode(true);
  if (!(ghost instanceof HTMLElement)) return null;
  ghost.classList.remove("ProseMirror-selectednode");
  ghost.classList.add("editor-arrangement-ghost");
  ghost.style.setProperty("--ghost-scale", "0.7");
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.querySelectorAll("[data-editor-arrange-controls], .editor-media-card__text-handle").forEach((node) => node.remove());
  documentRef?.body?.append?.(ghost);
  return ghost;
}

function updateArrangementGhost(gesture, clientX, clientY) {
  const ghost = gesture?.ghost;
  if (!(ghost instanceof HTMLElement)) return;
  ghost.style.setProperty("--ghost-scale", "0.4");
  const width = gesture.wrapperRect?.width || ghost.offsetWidth || 0;
  const height = gesture.wrapperRect?.height || ghost.offsetHeight || 0;
  const snap = gesture.snapPlacement || "";
  let left = clientX - width / 2;
  if (snap === "float-left") left = gesture.surfaceRect.left;
  if (snap === "float-right") left = gesture.surfaceRect.right - width;
  left = Math.max(12, Math.min(left, Math.max(12, windowRef.innerWidth - width - 12)));
  const top = Math.max(12, Math.min(clientY - height / 2, Math.max(12, windowRef.innerHeight - height - 12)));
  ghost.style.left = `${left}px`;
  ghost.style.top = `${top}px`;
  ghost.dataset.snapEdge = snap === "float-left" ? "left" : snap === "float-right" ? "right" : "";
}

function createArrangementDropCaret() {
  const caret = documentRef?.createElement?.("div");
  if (!(caret instanceof HTMLElement)) return null;
  caret.className = "editor-drop-caret";
  documentRef?.body?.append?.(caret);
  return caret;
}

function createArrangementEdgeGlow() {
  const glow = documentRef?.createElement?.("div");
  if (!(glow instanceof HTMLElement)) return null;
  glow.className = "editor-edge-glow";
  documentRef?.body?.append?.(glow);
  return glow;
}

function updateArrangementIndicators(gesture, clientX, clientY) {
  const surface = documentRef?.querySelector?.("[data-editor-surface] .ProseMirror");
  if (!(surface instanceof HTMLElement)) return;
  const resolvedTarget = resolveTopLevelInsertTarget(surface, clientY);
  const caret = gesture.dropCaret instanceof HTMLElement ? gesture.dropCaret : null;
  const glow = gesture.edgeGlow instanceof HTMLElement ? gesture.edgeGlow : null;
  if (glow) {
    const side = gesture.snapPlacement === "float-left"
      ? "left"
      : gesture.snapPlacement === "float-right"
        ? "right"
        : "";
    if (side) {
      glow.dataset.side = side;
      glow.style.top = `${gesture.surfaceRect.top}px`;
      glow.style.left = side === "left" ? `${gesture.surfaceRect.left}px` : `${gesture.surfaceRect.right - 10}px`;
      glow.style.height = `${gesture.surfaceRect.height}px`;
      glow.style.width = "10px";
      glow.hidden = false;
    } else {
      glow.hidden = true;
    }
  }
  if (!caret) return;
  if (resolvedTarget?.target instanceof HTMLElement && resolvedTarget.rect) {
    const rect = resolvedTarget.rect;
    gesture.pendingInsertPos = resolvedTarget.pos;
    caret.style.left = `${gesture.surfaceRect.left + 14}px`;
    caret.style.top = `${resolvedTarget.before ? rect.top : rect.bottom}px`;
    caret.style.width = `${Math.max(48, gesture.surfaceRect.width - 28)}px`;
    caret.hidden = false;
    return;
  }
  gesture.pendingInsertPos = resolveTopLevelInsertPos(surface, null, false);
  caret.style.left = `${gesture.surfaceRect.left + 14}px`;
  caret.style.top = `${gesture.surfaceRect.bottom - 2}px`;
  caret.style.width = `${Math.max(48, gesture.surfaceRect.width - 28)}px`;
  caret.hidden = false;
}

function resolveTopLevelInsertTarget(surface, clientY) {
  const doc = editorState.editor?.state?.doc;
  if (!(surface instanceof HTMLElement) || !doc) return null;
  const children = Array.from(surface.children).filter((child) => child instanceof HTMLElement);
  if (!children.length) {
    return {
      target: null,
      before: false,
      rect: null,
      pos: resolveTopLevelInsertPos(surface, null, false)
    };
  }
  let pos = 0;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const rect = child.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    if (clientY < midpoint) {
      return {
        target: child,
        before: true,
        rect,
        pos
      };
    }
    pos += Number(doc.child(index)?.nodeSize || 0);
    if (clientY <= rect.bottom) {
      return {
        target: child,
        before: false,
        rect,
        pos
      };
    }
  }
  const last = children[children.length - 1];
  return {
    target: last,
    before: false,
    rect: last.getBoundingClientRect(),
    pos
  };
}

function resolveTopLevelInsertPos(surface, target, before = false) {
  const doc = editorState.editor?.state?.doc;
  if (!doc || !(surface instanceof HTMLElement)) return 0;
  const children = Array.from(surface.children);
  const targetIndex = target instanceof HTMLElement ? children.indexOf(target) : -1;
  const insertionIndex = targetIndex < 0
    ? doc.childCount
    : before
      ? targetIndex
      : targetIndex + 1;
  let pos = 0;
  for (let index = 0; index < insertionIndex; index += 1) {
    pos += Number(doc.child(index)?.nodeSize || 0);
  }
  return pos;
}

function moveSelectedBlockNodeToInsertPos(expectedName = "", targetPos = 0) {
  const editor = editorState.editor;
  const selected = editorState.selectedNode;
  if (!editor || !selected || selected.name !== expectedName) return false;
  const state = editor.state;
  const currentNode = state.doc.nodeAt(selected.pos);
  if (!currentNode) return false;
  const normalizedTarget = Math.max(0, Math.min(Number(targetPos || 0), Number(state.doc.content.size || 0)));
  if (normalizedTarget === Number(selected.pos || 0) || normalizedTarget === Number(selected.pos || 0) + Number(currentNode.nodeSize || 0)) {
    return false;
  }
  const tr = state.tr;
  tr.delete(selected.pos, selected.pos + currentNode.nodeSize);
  const insertPos = normalizedTarget > selected.pos
    ? Math.max(0, normalizedTarget - currentNode.nodeSize)
    : normalizedTarget;
  tr.insert(insertPos, currentNode);
  editor.view.dispatch(tr.scrollIntoView());
  try {
    editor.chain().focus().setNodeSelection(insertPos).run();
  } catch {
    // no-op
  }
  editorState.selectedNode = inspectSelectedNode();
  editorState.arrangementDirty = true;
  return true;
}

function snapObjectWidthRatio(value, minimum = 0.24) {
  const snapped = Math.round(clampRatio(value, minimum, 1) * 10) / 10;
  return clampRatio(snapped, minimum, 1);
}

function clampRatio(value, minimum = 0, maximum = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return minimum;
  return Math.max(minimum, Math.min(maximum, numeric));
}

function imageAssetPatchChanged(asset = {}, patch = {}) {
  return String(asset?.name || "") !== String(patch?.name || "") ||
    String(asset?.alt || "") !== String(patch?.alt || "") ||
    String(asset?.caption || "") !== String(patch?.caption || "") ||
    JSON.stringify(asset?.tags || []) !== JSON.stringify(patch?.tags || []) ||
    JSON.stringify(asset?.linkedEntities || []) !== JSON.stringify(patch?.linkedEntities || []);
}

function isMobileViewport() {
  return Number(windowRef?.innerWidth || 0) <= 1080;
}

function handleShellPointerDown(event) {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  if (!(target instanceof Element)) return;
  const editorControl = target.closest("[data-editor-command], [data-editor-open-panel], [data-editor-format-value], [data-editor-image-upload], [data-editor-image-entry], [data-editor-image-insert], [data-editor-banner-create], [data-editor-banner-entry], [data-editor-banner-insert], [data-editor-wrapped-kind], [data-editor-citation-add], [data-editor-citation-edit], [data-editor-citation-insert], [data-image-crop-preset], [data-editor-image-aspect-orientation], [data-editor-image-transform], [data-editor-media-placement], [data-editor-entity-placement], [data-editor-media-scale], [data-editor-media-box-align], [data-editor-media-box-vertical], [data-editor-multimedia-save], [data-editor-multimedia-cancel], [data-editor-multimedia-delete], [data-editor-citation-save], [data-editor-citation-cancel], [data-editor-citation-delete], [data-editor-save], [data-editor-submit], [data-editor-entity-tile-pick], [data-editor-entity-clear-search], [data-editor-resize-handle], [data-editor-media-text-box-handle], [data-editor-media-preview-text-box], [data-editor-media-preview-text-box-handle], [data-editor-entity-resize-handle]");
  if (editorControl && !(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement) && !(target instanceof HTMLSelectElement)) {
    event.preventDefault();
  }

  if (startMultimediaPreviewGesture(event, target)) {
    event.preventDefault();
    return;
  }

  if (startWrappedObjectArrangementGesture(event, target)) {
    event.preventDefault();
    return;
  }

  const cropSurface = target.closest("[data-editor-crop-surface]");
  const cropBox = target.closest("[data-editor-crop-box]");
  const handle = target.closest("[data-crop-handle]");
  const editableImage = resolveEditableMultimediaImageState();
  if (!cropSurface || !(cropSurface instanceof HTMLElement) || !editableImage?.src) return;

  event.preventDefault();
  if (!handle && !cropBox) {
    resetCropToCurrentAspect();
    return;
  }
  const rect = cropSurface.getBoundingClientRect();
  editorState.cropGesture = {
    kind: "pointer",
    mode: handle?.getAttribute("data-crop-handle") || (cropBox ? "move" : ""),
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    surfaceRect: rect,
    crop: {
      x: editableImage.cropX,
      y: editableImage.cropY,
      width: editableImage.cropWidth,
      height: editableImage.cropHeight
    }
  };
}

function bindGlobalCropEvents() {
  if (windowRef?.__truecostEditorCropBound) return;
  if (!windowRef) return;
  windowRef.__truecostEditorCropBound = true;
  windowRef.addEventListener("pointermove", handleWindowPointerMove);
  windowRef.addEventListener("pointerup", clearCropGesture);
  windowRef.addEventListener("pointercancel", clearCropGesture);
}

function handleWindowPointerMove(event) {
  if (handleArrangementPointerMove(event)) {
    return;
  }
  const gesture = editorState.cropGesture;
  if (!gesture || gesture.kind !== "pointer" || gesture.pointerId !== event.pointerId || !resolveEditableMultimediaImageState()?.src) {
    return;
  }
  event.preventDefault();
  const dx = (event.clientX - gesture.startX) / Math.max(gesture.surfaceRect.width, 1);
  const dy = (event.clientY - gesture.startY) / Math.max(gesture.surfaceRect.height, 1);
  const nextCrop = applyCropDelta(gesture.crop, gesture.mode, dx, dy);
  applyEditableMultimediaImagePatch(nextCrop, { persist: false, refreshChrome: false });
}

function clearCropGesture() {
  if (editorState.cropGesture) {
    editorState.cropGesture = null;
    queueEditorChromeRefresh();
  }
  if (editorState.arrangementGesture) {
    commitArrangementGesture();
  }
}

function handleShellTouchStart(event) {
  if (event.touches.length < 2) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const cropSurface = target.closest("[data-editor-crop-surface]");
  const editableImage = resolveEditableMultimediaImageState();
  if (!(cropSurface instanceof HTMLElement) || !editableImage?.src) return;
  event.preventDefault();
  const rect = cropSurface.getBoundingClientRect();
  const [first, second] = [event.touches[0], event.touches[1]];
  editorState.cropGesture = {
    kind: "pinch",
    startDistance: distanceBetweenTouches(first, second),
    centerX: (first.clientX + second.clientX) / 2,
    centerY: (first.clientY + second.clientY) / 2,
    surfaceRect: rect,
    crop: {
      x: editableImage.cropX,
      y: editableImage.cropY,
      width: editableImage.cropWidth,
      height: editableImage.cropHeight
    }
  };
}

function handleShellTouchMove(event) {
  const gesture = editorState.cropGesture;
  if (!gesture || gesture.kind !== "pinch" || event.touches.length < 2 || !resolveEditableMultimediaImageState()?.src) return;
  event.preventDefault();
  const [first, second] = [event.touches[0], event.touches[1]];
  const distance = distanceBetweenTouches(first, second);
  const scale = gesture.startDistance > 0 ? distance / gesture.startDistance : 1;
  const centerX = (first.clientX + second.clientX) / 2;
  const centerY = (first.clientY + second.clientY) / 2;
  const centerDx = (centerX - gesture.centerX) / Math.max(gesture.surfaceRect.width, 1);
  const centerDy = (centerY - gesture.centerY) / Math.max(gesture.surfaceRect.height, 1);
  const nextCrop = applyPinchCrop(gesture.crop, scale, centerDx, centerDy);
  applyEditableMultimediaImagePatch(nextCrop, { persist: false, refreshChrome: false });
}

function handleShellTouchEnd(event) {
  if (event.touches.length < 2 && editorState.cropGesture?.kind === "pinch") {
    editorState.cropGesture = null;
    queueEditorChromeRefresh();
  }
}

function cropPresetRect(preset = "", dimensions = {}) {
  const width = Math.max(1, Number(dimensions.width || 1));
  const height = Math.max(1, Number(dimensions.height || 1));
  const clean = String(preset || "").trim().toLowerCase();
  if (clean === "original") {
    return {
      cropX: 0,
      cropY: 0,
      cropWidth: 1,
      cropHeight: 1
    };
  }
  const ratioMap = {
    "16:9": 16 / 9,
    "3:2": 3 / 2,
    "4:3": 4 / 3,
    "1:1": 1,
    "4:5": 4 / 5,
    "3:1": 3
  };
  return cropRectForRatio(ratioMap[clean] || (width / height), { width, height });
}

function cropRectForRatio(targetRatio = 1, dimensions = {}) {
  const width = Math.max(1, Number(dimensions.width || 1));
  const height = Math.max(1, Number(dimensions.height || 1));
  const imageRatio = width / height;
  let cropWidth = 1;
  let cropHeight = 1;
  if (imageRatio > targetRatio) {
    cropWidth = targetRatio / imageRatio;
  } else {
    cropHeight = imageRatio / targetRatio;
  }
  return {
    cropX: (1 - cropWidth) / 2,
    cropY: (1 - cropHeight) / 2,
    cropWidth,
    cropHeight
  };
}

function resetCropToCurrentAspect() {
  const asset = resolveEditableMultimediaImageState();
  if (!asset || !asset.src) return;
  const width = Math.max(1, Number(asset.assetWidth || asset.width || 1));
  const height = Math.max(1, Number(asset.assetHeight || asset.height || 1));
  const currentRatio = ((Number(asset.cropWidth || 1) * width) / Math.max(Number(asset.cropHeight || 1) * height, 0.0001)) || (width / height);
  applyEditableMultimediaImagePatch(cropRectForRatio(currentRatio, { width, height }), { persist: false });
}

function quarterTurnsToCssTurns(value = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric / 4 : 0;
}

function applyCropDelta(crop = {}, mode = "", dx = 0, dy = 0) {
  const minimum = 0.12;
  let next = {
    x: Number(crop.x || 0),
    y: Number(crop.y || 0),
    width: Number(crop.width || 1),
    height: Number(crop.height || 1)
  };

  if (mode === "move") {
    next.x += dx;
    next.y += dy;
  }
  if (mode === "n") {
    next.y += dy;
    next.height -= dy;
  }
  if (mode === "e") {
    next.width += dx;
  }
  if (mode === "s") {
    next.height += dy;
  }
  if (mode === "w") {
    next.x += dx;
    next.width -= dx;
  }
  if (mode === "nw") {
    next.x += dx;
    next.y += dy;
    next.width -= dx;
    next.height -= dy;
  }
  if (mode === "ne") {
    next.y += dy;
    next.width += dx;
    next.height -= dy;
  }
  if (mode === "sw") {
    next.x += dx;
    next.width -= dx;
    next.height += dy;
  }
  if (mode === "se") {
    next.width += dx;
    next.height += dy;
  }

  next.width = Math.max(minimum, next.width);
  next.height = Math.max(minimum, next.height);
  next.x = Math.max(0, Math.min(1 - next.width, next.x));
  next.y = Math.max(0, Math.min(1 - next.height, next.y));
  return {
    cropX: next.x,
    cropY: next.y,
    cropWidth: next.width,
    cropHeight: next.height
  };
}

function applyPinchCrop(crop = {}, scale = 1, dx = 0, dy = 0) {
  const width = Math.max(0.12, Math.min(1, Number(crop.width || 1) / Math.max(scale, 0.2)));
  const height = Math.max(0.12, Math.min(1, Number(crop.height || 1) / Math.max(scale, 0.2)));
  const centerX = Number(crop.x || 0) + Number(crop.width || 1) / 2 + dx;
  const centerY = Number(crop.y || 0) + Number(crop.height || 1) / 2 + dy;
  const x = Math.max(0, Math.min(1 - width, centerX - width / 2));
  const y = Math.max(0, Math.min(1 - height, centerY - height / 2));
  return {
    cropX: x,
    cropY: y,
    cropWidth: width,
    cropHeight: height
  };
}

function distanceBetweenTouches(left, right) {
  return Math.hypot(
    Number(left?.clientX || 0) - Number(right?.clientX || 0),
    Number(left?.clientY || 0) - Number(right?.clientY || 0)
  );
}

function restoreLocalSnapshot(index) {
  const snapshot = editorState.localSnapshots[index];
  if (!snapshot?.document) return;
  applyDocument(snapshot.document, { restoreSelection: false });
  scheduleDerivedProjection(true, 20);
  scheduleLivePublish(50);
  setSaveStatus("success", `Restored local snapshot from ${formatTime(snapshot.saved_at)}.`);
}

function restoreRelayVersion(id) {
  const version = editorState.relayVersions.find((item) => String(item.id || item.slug || "") === String(id || ""));
  if (!version) return;
  applyDocument(version, { restoreSelection: false });
  editorState.draftStatus = String(version.status || "draft");
  scheduleDerivedProjection(true, 20);
  scheduleLivePublish(50);
  setSaveStatus("success", `Restored saved draft from ${formatTime(version.created_at || version.updated_at)}.`);
}

function applyDocument(nextDocument, { restoreSelection = false } = {}) {
  const normalized = normalizeEditorDocument(nextDocument);
  const previousSlug = editorState.currentSlug;
  editorState.document = normalized;
  hydrateImageAssetsFromDocument(normalized);
  if (normalized.slug) {
    editorState.currentSlug = normalized.slug;
  }

  editorState.suppressEditorEvents += 1;
  try {
    hydrateSurfaceFromDocument(normalized);
    if (editorState.editor) {
      editorState.editor.commands.setContent(normalized.bodyJson || emptyInvestigationBodyJson(), false);
      if (!restoreSelection) {
        editorState.editor.commands.blur?.();
      }
    }
  } finally {
    editorState.suppressEditorEvents = Math.max(0, editorState.suppressEditorEvents - 1);
  }

  if (editorState.currentSlug && editorState.currentSlug !== previousSlug) {
    const url = new URL(windowRef.location.href);
    url.searchParams.set("slug", editorState.currentSlug);
    windowRef.history?.replaceState?.({}, "", url);
    void ensureLiveOverlay();
    void ensureDocumentProjection();
  }
  refreshEditorChrome();
}

function resolveEntityByNameOrSlug(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (!clean) return null;
  return (editorState.publicState?.approvedEntities || editorState.publicState?.entities || []).find(
    (entity) => entity.slug === cleanSlug(clean) || String(entity.name || "").trim().toLowerCase() === clean
  ) || null;
}

function readInputValue(selector, fallback = "") {
  const input = documentRef?.querySelector?.(selector);
  return input instanceof HTMLInputElement ? String(input.value || "").trim() : String(fallback || "");
}

function readInputEventValue(target, name, selector, fallback = "") {
  if (target instanceof HTMLInputElement && target.getAttribute("name") === name) {
    return String(target.value || "").trim();
  }
  return readInputValue(selector, fallback);
}

function readTextareaValue(selector, fallback = "") {
  const input = documentRef?.querySelector?.(selector);
  return input instanceof HTMLTextAreaElement ? String(input.value || "").trim() : String(fallback || "");
}

function readTextareaEventValue(target, name, selector, fallback = "") {
  if (target instanceof HTMLTextAreaElement && target.getAttribute("name") === name) {
    return String(target.value || "").trim();
  }
  return readTextareaValue(selector, fallback);
}

function readCheckboxValue(selector, fallback = false) {
  const input = documentRef?.querySelector?.(selector);
  return input instanceof HTMLInputElement ? Boolean(input.checked) : Boolean(fallback);
}

function readCheckboxEventValue(target, name, selector, fallback = false) {
  if (target instanceof HTMLInputElement && target.getAttribute("name") === name) {
    return Boolean(target.checked);
  }
  return readCheckboxValue(selector, fallback);
}

function readSelectValue(selector, fallback = "") {
  const input = documentRef?.querySelector?.(selector);
  return input instanceof HTMLSelectElement ? String(input.value || "").trim() : String(fallback || "");
}

function readSelectEventValue(target, name, selector, fallback = "") {
  if (target instanceof HTMLSelectElement && target.getAttribute("name") === name) {
    return String(target.value || "").trim();
  }
  return readSelectValue(selector, fallback);
}

function readRangeValue(selector, fallback = 0) {
  const input = documentRef?.querySelector?.(selector);
  const value = input instanceof HTMLInputElement ? Number(input.value) : Number.NaN;
  return Number.isFinite(value) ? value : fallback;
}

function syncInputValue(selector, value) {
  const input = documentRef?.querySelector?.(selector);
  if (!(input instanceof HTMLInputElement)) return;
  input.value = String(value ?? "");
}

function syncTextareaValue(selector, value) {
  const input = documentRef?.querySelector?.(selector);
  if (!(input instanceof HTMLTextAreaElement)) return;
  input.value = String(value ?? "");
}

function syncCheckboxValue(selector, value) {
  const input = documentRef?.querySelector?.(selector);
  if (!(input instanceof HTMLInputElement)) return;
  input.checked = Boolean(value);
}

function fingerprintDocument(documentValue, status = "draft") {
  const normalized = normalizeEditorDocument(documentValue);
  return JSON.stringify({
    slug: normalized.slug || "",
    title: normalized.title || "",
    date: normalized.date || "",
    summary: normalized.summary || "",
    tags: normalized.tags || [],
    primaryEntity: normalized.primaryEntity || "",
    entityRefs: normalized.entityRefs || [],
    featured: Boolean(normalized.featured),
    mediaAssets: (normalized.mediaAssets || []).map((asset) => serializeImageAssetForLocalState(asset)),
    bodyJson: normalized.bodyJson || emptyInvestigationBodyJson(),
    status
  });
}

function bodyHasContent(bodyJson = {}) {
  const stack = [normalizeInvestigationBodyJson(bodyJson)];
  while (stack.length) {
    const next = stack.pop();
    if (!next || typeof next !== "object") continue;
    if (typeof next.text === "string" && next.text.trim()) return true;
    if (["templateMultimedia", "templateCitation", "investigationEntityTile", "investigationEntityRef", "investigationRelationshipRef"].includes(next.type)) {
      return true;
    }
    if (Array.isArray(next.content)) {
      stack.push(...next.content);
    }
  }
  return false;
}

function draftOwnerPubkey() {
  const revisions = Array.isArray(editorState.relayVersions) ? editorState.relayVersions : [];
  const oldest = revisions.length ? revisions[revisions.length - 1] : null;
  return String(oldest?.author_pubkey || oldest?.author || editorState.viewer?.pubkey || "").trim().toLowerCase();
}

async function loadStaticSlugs() {
  const response = await fetch("./content/investigations/index.json");
  if (!response.ok) return [];
  const data = await response.json();
  return (Array.isArray(data.files) ? data.files : []).map((file) => cleanSlug(String(file).replace(/\.md$/i, "")));
}

function currentUserIsAdmin() {
  return publicStateHasAdminPubkey(editorState.publicState, editorState.viewer?.pubkey || "");
}

function canOpenAuthoringShell() {
  return Boolean(editorState.session && (editorState.optimisticAdmin || currentUserIsAdmin()));
}

function trustedAdminPubkeys() {
  const admins = new Set(normalizeAdminPubkeys(editorState.publicState));
  const rootAdminPubkey = String(editorState.publicState?.rootAdminPubkey || SITE.nostr.rootAdminPubkey || "").trim();
  if (rootAdminPubkey) admins.add(rootAdminPubkey);
  return [...admins];
}

function handleDocumentClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const documentLink = target.closest("[data-editor-surface] a[href], [data-editor-citations-tile] a[href]");
  if (documentLink instanceof HTMLAnchorElement && (event.ctrlKey || event.metaKey)) {
    const href = resolveDocumentLinkHref(documentLink);
    if (href) {
      event.preventDefault();
      event.stopPropagation();
      windowRef?.open?.(href, "_blank", "noopener,noreferrer");
      return;
    }
  }
  if (target.closest("[data-editor-picker]") || target.closest("[data-editor-modal-root]")) return;
  const clickedWrappedObject = target.closest("[data-template-multimedia], [data-investigation-entity-tile]");
  if (clickedWrappedObject instanceof HTMLElement && !target.closest("[data-editor-entity-link], a[href]")) {
    if (openInspectorForClickedObject(clickedWrappedObject)) {
      closeFloatingToolbarMenus();
      return;
    }
  }
  editorState.activePickerField = "";
  hydrateEntityResults();
  if (!target.closest("[data-editor-toolbar]")) closeFloatingToolbarMenus();
}

function resolveDocumentLinkHref(anchor) {
  if (!(anchor instanceof HTMLAnchorElement)) return "";
  const rawHref = String(anchor.getAttribute("href") || anchor.href || "").trim();
  if (!rawHref) return "";
  if (/^[a-z][a-z\d+\-.]*:/i.test(rawHref) || rawHref.startsWith("//")) {
    return rawHref;
  }
  if (rawHref.startsWith("#")) return "";
  if (/^[^./?#]+\.[^./?#]/.test(rawHref)) {
    return `https://${rawHref}`;
  }
  return anchor.href || rawHref;
}

function closeFloatingToolbarMenus() {
  const closingMenus = editorState.formatMenuOpen || editorState.linkEditorOpen || editorState.wrappedInsertMenuOpen;
  editorState.formatMenuOpen = false;
  editorState.linkEditorOpen = false;
  editorState.wrappedInsertMenuOpen = false;
  if (closingMenus) refreshEditorChrome();
}

function openInspectorForClickedObject(element) {
  const selected = selectInspectableNodeFromElement(element);
  if (!selected) return false;
  if (selected.name === "templateMultimedia") {
    const assetId = String(selected.attrs?.assetId || "").trim();
    if (assetId) editorState.activeImageAssetId = assetId;
    editorState.multimediaDraft = normalizeMultimediaAttrs(selected.attrs || {});
    editorState.multimediaDraftSourcePos = Number(selected.pos || 0);
    editorState.multimediaInsertMode = false;
    editorState.multimediaEditorMode = "instance";
    editorState.imageEditorMode = "instance";
    openRailPanel("multimedia");
    return true;
  }
  if (selected.name === "investigationEntityTile") {
    editorState.entityTileDraft = draftEntityTileFromNode(selected.attrs || {});
    editorState.entityTileDraftSourcePos = Number(selected.pos || 0);
    editorState.entityTileInsertMode = false;
    editorState.entityTileEditorMode = "instance";
    editorState.entityTileMatches = matchEntities(editorState.entityTileDraft?.query || "").slice(0, 8);
    openRailPanel("entityTile");
    return true;
  }
  return false;
}

function dedupe(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function readCachedPublicStateSnapshot() {
  try {
    const cachedState = getCachedPublicState();
    if (cachedState) return cachedState;
    const storage = windowRef?.localStorage;
    if (!storage) return null;
    const key = publicStateSnapshotStorageKey(SITE.nostr.storageNamespace);
    const raw = storage.getItem(key);
    if (!raw) return null;
    const sanitized = sanitizeStoredPublicStateSnapshot(raw);
    if (!sanitized?.valid || !sanitized.nextValue) return null;
    return JSON.parse(sanitized.nextValue);
  } catch {
    return null;
  }
}

function editorBootstrapStateKey(slug = "") {
  const clean = cleanSlug(String(slug || "").trim()) || "unsaved";
  return `${SITE.nostr.storageNamespace}.editor-bootstrap.${clean}`;
}

function readEditorBootstrapState(slug = "") {
  try {
    const storage = windowRef?.localStorage;
    if (!storage) return null;
    const raw = storage.getItem(editorBootstrapStateKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      draft: parsed.draft && typeof parsed.draft === "object" ? parsed.draft : null,
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  } catch {
    return null;
  }
}

function writeEditorBootstrapState(slug = "", value = {}) {
  try {
    const storage = windowRef?.localStorage;
    if (!storage) return false;
    storage.setItem(editorBootstrapStateKey(slug), JSON.stringify({
      draft: value?.draft ?? null,
      history: Array.isArray(value?.history) ? value.history : []
    }));
    return true;
  } catch {
    return false;
  }
}

function moveEditorBootstrapState(fromSlug = "", toSlug = "") {
  if (!toSlug) return false;
  try {
    const storage = windowRef?.localStorage;
    if (!storage) return false;
    const fromKey = editorBootstrapStateKey(fromSlug);
    const toKey = editorBootstrapStateKey(toSlug);
    if (fromKey === toKey) return false;
    const raw = storage.getItem(fromKey);
    if (!raw) return false;
    storage.setItem(toKey, raw);
    storage.removeItem(fromKey);
    return true;
  } catch {
    return false;
  }
}

function formatTime(value) {
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(date);
}

function cleanFileStem(value) {
  return String(value || "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Image";
}
