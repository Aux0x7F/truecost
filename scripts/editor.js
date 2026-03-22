import SITE from "./core/site-config.js";
import { createUniqueSlug, splitTags } from "./core/content-utils.js";
import {
  cleanSlug,
  connectStructuredUnitOverlay,
  deriveIdentity,
  ensureEventToolsLoaded,
  publishTaggedJson,
  uploadPublicBlob
} from "./core/nostr.js";
import { createRuntimePublicStateStore } from "./core/runtime-public-state-store.js";
import { replaceEditorShellMarkup } from "./core/editor-mount.js";
import { normalizeAdminPubkeys, publicStateHasAdminPubkey } from "./core/public-state.js";
import { createSiteDocumentController } from "./core/runtime-document.js";
import {
  loadSiteRuntimeValue,
  moveSiteRuntimeValue,
  rememberSiteRuntimeValue
} from "./core/runtime-local-state.js";
import {
  deriveInvestigationStructuredArtifacts,
  editorDocumentFromInvestigationRecord,
  normalizeInvestigationImagePlacement,
  stringifyInvestigationImageTitleSpec
} from "./core/investigation-document.js";
import {
  dedupeStrings as dedupe,
  escapeAttribute,
  escapeHtml,
  lastCommaValue
} from "./core/text-utils.js";
import { getStoredSession, resolveStoredSession } from "./core/session.js";
import { createEditorPageController } from "./features/editor-page.js";
import {
  renderEditorLoadingMarkup,
  renderEditorModalView,
  renderEditorShellView
} from "./surfaces/editor-shell.js";

let editorPublicStateStore = null;
let editorPage = null;

const editorState = {
  session: getStoredSession(),
  viewer: null,
  publicState: null,
  staticSlugs: [],
  currentSlug: "",
  relayVersions: [],
  localSnapshots: [],
  editor: null,
  localTimer: 0,
  relayTimer: 0,
  lastLocalFingerprint: "",
  lastRelayFingerprint: "",
  draftStatus: "draft",
  activePickerField: "",
  entityModal: null,
  imageModal: null,
  modalRoot: null,
  documentClicksBound: false,
  liveController: null,
  liveDocumentId: "",
  liveStatus: "idle",
  livePublishTimer: 0,
  suppressSyncDepth: 0,
  documentController: null,
  documentControllerId: "",
  documentProjection: null,
  documentProjectionFingerprint: "",
  documentSyncTimer: 0
};

editorPublicStateStore = createRuntimePublicStateStore({
  getSessionSecretKey: async () => editorState.session?.secretKeyHex || "",
  page: "editor",
  refreshDelayMs: () => 0,
  shouldRefresh: () => false
});
editorState.publicState = editorPublicStateStore.value;
editorPublicStateStore.subscribe((snapshot) => {
  editorState.publicState = snapshot.value;
});

editorPage = createEditorPageController({
  deps: {
    document,
    window,
    sessionChangedEvent: "truecost:session-changed"
  },
  callbacks: {
    beforeSessionRefresh: async () => {
      const nextSession = getStoredSession();
      if (sameEditorSession(editorState.session, nextSession)) return;
      destroyLiveInvestigationOverlay();
      destroyStructuredDocumentController();
      editorState.entityModal = null;
      editorState.imageModal = null;
    },
    beforePageHide: async () => {
      destroyLiveInvestigationOverlay();
      destroyStructuredDocumentController();
    },
    initPage: async (force = false) => {
      await initEditorPage(force);
    }
  }
});

document.addEventListener("DOMContentLoaded", () => {
  void editorPage?.start();
});

async function initEditorPage(force = false) {
  renderEditorLoading("Opening authoring...");
  editorState.session = await resolveStoredSession({
    persistSession: true
  }).catch(() => getStoredSession());
  editorState.viewer = null;
  if (!editorState.session) {
    destroyStructuredDocumentController();
    editorState.publicState = editorState.publicState || { admins: [] };
    editorState.staticSlugs = [];
    renderEditorShell();
    return;
  }
  await ensureEventToolsLoaded();
  editorState.viewer = deriveIdentity(editorState.session.secretKeyHex);
  const cachedPublicState = !force ? editorPublicStateStore.value : null;
  const renderedFromCachedAdminState = Boolean(
    cachedPublicState && editorUserIsAdmin(cachedPublicState, editorState.viewer?.pubkey)
  );
  if (renderedFromCachedAdminState) {
    editorState.publicState = cachedPublicState;
    await hydrateDraftState();
    renderEditorShell();
  } else {
    renderEditorLoading("Looking up editor...");
  }
  editorState.publicState = (await editorPublicStateStore.hydrate({ force, reason: "editor-load" })).value;
  editorState.staticSlugs = await loadStaticSlugs().catch(() => []);
  await hydrateDraftState();
  const nextIsAdmin = editorUserIsAdmin(editorState.publicState, editorState.viewer?.pubkey);
  const hasLiveEditor = document.querySelector("[data-editor-form]") instanceof HTMLFormElement;
  if (!renderedFromCachedAdminState || !nextIsAdmin || !hasLiveEditor) {
    renderEditorShell();
  } else {
    updateMetaPanel();
    updateHistoryPanels();
    hydrateEntityResults();
    void ensureLiveInvestigationOverlay();
  }
}

async function refreshEditorPublicStateAfterRepair() {
  if (!editorState.session || !editorState.viewer) return;
  const nextPublicState = await editorPublicStateStore
    .hydrate({ force: true, reason: "editor-repair-refresh" })
    .then((result) => result.value)
    .catch(() => null);
  if (!nextPublicState) return;
  const priorPublicState = editorState.publicState;
  const hadLiveEditor = document.querySelector("[data-editor-form]") instanceof HTMLFormElement;
  const previousWasAdmin = editorUserIsAdmin(priorPublicState, editorState.viewer.pubkey);
  const nextIsAdmin = editorUserIsAdmin(nextPublicState, editorState.viewer.pubkey);
  const nextLooksReliable = Boolean(nextPublicState?.connected || (Array.isArray(nextPublicState?.admins) && nextPublicState.admins.length));
  if (hadLiveEditor && previousWasAdmin && !nextIsAdmin && !nextLooksReliable) return;
  editorState.publicState = nextPublicState;
  editorState.staticSlugs = await loadStaticSlugs().catch(() => editorState.staticSlugs);
  if (hadLiveEditor && nextIsAdmin) {
    hydrateEntityResults();
    void ensureLiveInvestigationOverlay();
    return;
  }
  renderEditorShell();
}

function renderEditorLoading(message) {
  const shell = document.querySelector("[data-editor-shell]");
  const lede = document.querySelector("[data-editor-lede]");
  if (lede) lede.textContent = message;
  if (shell) replaceEditorShellMarkup(shell, editorState, renderEditorLoadingMarkup(message, { renderLoadingState }));
}

function renderEditorShell() {
  const shell = document.querySelector("[data-editor-shell]");
  const title = document.querySelector("[data-editor-title]");
  const lede = document.querySelector("[data-editor-lede]");
  if (!shell || !title || !lede) return;
  const view = renderEditorShellView({
    editorState,
    deps: {
      currentUserIsAdmin,
      escapeAttribute,
      escapeHtml
    }
  });
  title.textContent = view.title;
  lede.textContent = view.lede;
  replaceEditorShellMarkup(shell, editorState, view.shellMarkup);

  if (!editorState.session || !currentUserIsAdmin()) return;

  bindEditorShell();
  renderEditorModal();
  updateMetaPanel();
  updateHistoryPanels();
  hydrateEntityResults();
  void ensureStructuredDocumentController();
  void ensureLiveInvestigationOverlay();
}

function bindEditorShell() {
  const form = document.querySelector("[data-editor-form]");
  const surface = document.querySelector("[data-editor-surface]");
  if (!(form instanceof HTMLFormElement) || !(surface instanceof HTMLElement)) return;
  const ToastEditor = window.toastui?.Editor;
  if (!ToastEditor) {
    setEditorStatus("The editor library could not be loaded.", "error");
    return;
  }

  editorState.editor = new ToastEditor({
    el: surface,
    initialValue: editorState.document.markdown || "",
    initialEditType: "wysiwyg",
    previewStyle: "vertical",
    height: "720px",
    hideModeSwitch: true,
    usageStatistics: false,
    placeholder: "Write the full investigation here. Use headings, quotes, links, and lists.",
    toolbarItems: [
      ["heading", "bold", "italic"],
      ["quote", "ul", "ol"],
      ["link"],
      ["code", "codeblock"]
    ]
  });
  surface.__cmsEditor = editorState.editor;
  decorateToolbar(surface);
  window.setTimeout(() => decorateToolbar(surface), 120);

  const queueSave = () => {
    if (editorState.suppressSyncDepth > 0) return;
    ensureEditorUnitSlug();
    syncSlugPreview();
    scheduleLocalSnapshot();
    scheduleRelaySave();
    scheduleStructuredDocumentSync();
    scheduleLivePublish();
    hydrateEntityResults();
  };

  form.addEventListener("input", queueSave);
  editorState.editor.on("change", queueSave);
  form.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches("[data-editor-entity-input]")) {
      editorState.activePickerField = target.getAttribute("data-editor-entity-input") || "";
      hydrateEntityResults();
    }
  });

  form.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const entityPick = target.closest("[data-editor-entity-pick]");
    if (entityPick) {
      applyEntityPick(entityPick);
      return;
    }

    const restoreLocal = target.closest("[data-restore-local]");
    if (restoreLocal) {
      restoreLocalSnapshot(Number(restoreLocal.getAttribute("data-restore-local") || "-1"));
      return;
    }

    const restoreRelay = target.closest("[data-restore-relay]");
    if (restoreRelay) {
      restoreRelayVersion(restoreRelay.getAttribute("data-restore-relay") || "");
      return;
    }

    const createEntity = target.closest("[data-editor-create-entity]");
    if (createEntity) {
      openEntityModal(createEntity.getAttribute("data-editor-create-entity") || "");
      return;
    }

    if (target.closest("[data-editor-save]")) {
      await saveDraftNow("draft");
      return;
    }

    if (target.closest("[data-editor-image]")) {
      openImageModal();
      return;
    }

    if (target.closest("[data-editor-submit]")) {
      await saveDraftNow("candidate");
    }
  });

  if (!editorState.documentClicksBound) {
    document.addEventListener("click", handleDocumentClick, true);
    editorState.documentClicksBound = true;
  }
}

async function hydrateDraftState() {
  const requestedSlug = cleanSlug(new URLSearchParams(window.location.search).get("slug") || "");
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

  const [localDocument, localHistory] = await Promise.all([
    loadLocalDocument(editorState.currentSlug),
    loadLocalHistory(editorState.currentSlug)
  ]);
  const source = localDocument || relayDraft || createBlankDocument();
  editorState.document = draftToDocument(source);
  editorState.localSnapshots = Array.isArray(localHistory) ? localHistory : [];
  editorState.lastLocalFingerprint = fingerprintDocument(editorState.document);
  editorState.lastRelayFingerprint = relayDraft ? fingerprintDocument(draftToDocument(relayDraft), relayDraft.status) : "";
}

function createBlankDocument() {
  return {
    title: "",
    date: new Date().toISOString().slice(0, 10),
    summary: "",
    tags: [],
    markdown: "",
    entity_refs: [],
    primaryEntity: ""
  };
}

function draftToDocument(draft) {
  const normalized = editorDocumentFromInvestigationRecord(draft);
  return {
    ...normalized,
    primaryEntity: resolveEntityDisplayValue(normalized.primaryEntity || draft?.primaryEntity || ""),
    entityRefs: (Array.isArray(normalized.entityRefs) ? normalized.entityRefs : []).map((value) => resolveEntityDisplayValue(value))
  };
}

function collectDocumentFromForm() {
  const form = document.querySelector("[data-editor-form]");
  if (!(form instanceof HTMLFormElement)) return createBlankDocument();
  const markdown = editorState.editor?.getMarkdown ? editorState.editor.getMarkdown() : "";
  return {
    title: String(form.elements.namedItem("title")?.value || "").trim(),
    date: String(form.elements.namedItem("date")?.value || "").trim() || new Date().toISOString().slice(0, 10),
    summary: String(form.elements.namedItem("summary")?.value || "").trim(),
    tags: splitTags(form.elements.namedItem("tags")?.value || ""),
    markdown: String(markdown || "").trim(),
    primaryEntity: String(form.elements.namedItem("primaryEntity")?.value || "").trim(),
    entityRefs: splitTags(form.elements.namedItem("entityRefs")?.value || "")
  };
}

function buildDraftPayload(status = "draft") {
  const document = collectDocumentFromForm();
  const primaryEntity = resolveEntityByNameOrSlug(document.primaryEntity);
  const resolvedRefs = [
    primaryEntity?.slug || "",
    ...document.entityRefs.map((value) => resolveEntityByNameOrSlug(value)?.slug || cleanSlug(value))
  ];
  const slug = editorState.currentSlug || createUniqueSlug(document.title || "untitled", takenSlugs());
  const structuredArtifacts = deriveInvestigationStructuredArtifacts({
    slug,
    title: document.title,
    summary: document.summary,
    markdown: document.markdown,
    entityRefs: dedupe(resolvedRefs),
    tags: document.tags,
    relationshipCandidates: Array.isArray(editorState.documentProjection?.document?.metadata?.relationshipCandidates)
      ? editorState.documentProjection.document.metadata.relationshipCandidates
      : [],
    citations: Array.isArray(editorState.documentProjection?.document?.metadata?.citations)
      ? editorState.documentProjection.document.metadata.citations
      : []
  });
  return {
    slug,
    title: document.title || "Untitled investigation",
    date: document.date,
    location: primaryEntity?.name || primaryEntity?.location || "Undisclosed location",
    status,
    author_pubkey: draftOwnerPubkey(),
    summary: document.summary,
    tags: document.tags,
    entity_refs: structuredArtifacts.entityRefs.length ? structuredArtifacts.entityRefs : dedupe(resolvedRefs),
    featured: false,
    markdown: document.markdown,
    structured_document: structuredArtifacts.structuredDocument,
    body_html: "",
    search_text: structuredArtifacts.searchText,
    relationship_candidates: structuredArtifacts.relationshipCandidates,
    citations: structuredArtifacts.citations,
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

function syncSlugPreview() {
  const title = String(document.querySelector('[name="title"]')?.value || "").trim();
  return editorState.currentSlug || createUniqueSlug(title || "untitled", takenSlugs());
}

function scheduleLocalSnapshot() {
  if (editorState.localTimer) window.clearTimeout(editorState.localTimer);
  editorState.localTimer = window.setTimeout(() => {
    void persistLocalSnapshot("Auto-saved");
  }, 1400);
}

function scheduleRelaySave() {
  if (editorState.relayTimer) window.clearTimeout(editorState.relayTimer);
  editorState.relayTimer = window.setTimeout(() => {
    void saveDraftNow("draft", true);
  }, 14000);
}

async function persistLocalSnapshot(label) {
  const document = collectDocumentFromForm();
  if (!document.title && !document.markdown) return;
  const fingerprint = fingerprintDocument(document);
  void saveLocalDocument(editorState.currentSlug, document);
  if (fingerprint !== editorState.lastLocalFingerprint) {
    editorState.localSnapshots.unshift({
      id: `${Date.now()}`,
      saved_at: new Date().toISOString(),
      label,
      document
    });
    editorState.localSnapshots = editorState.localSnapshots.slice(0, 10);
    void saveLocalHistory(editorState.currentSlug, editorState.localSnapshots);
    editorState.lastLocalFingerprint = fingerprint;
  }
  updateMetaPanel(`Saved locally ${formatTime(new Date().toISOString())}`);
  updateHistoryPanels();
}

async function saveDraftNow(status = "draft", silent = false) {
  if (!editorState.session || !currentUserIsAdmin()) return;
  const payload = buildDraftPayload(status);
  if (!payload.title.trim() || !payload.markdown.trim()) return;
  const fingerprint = fingerprintDocument(payload, status);
  if (silent && fingerprint === editorState.lastRelayFingerprint) return;

  setEditorStatus(status === "candidate" ? "Sending to review..." : "Saving working draft...", "pending");
  const result = await publishTaggedJson({
    kind: SITE.nostr.kinds.draft,
    secretKeyHex: editorState.session.secretKeyHex,
    tags: [["d", payload.slug], ["status", status]],
    content: {
      ...payload,
      updated_at: new Date().toISOString()
    }
  });

  if (!editorState.currentSlug) {
    editorState.currentSlug = payload.slug;
    await moveLocalDraftStateToSlug(payload.slug);
    const url = new URL(window.location.href);
    url.searchParams.set("slug", payload.slug);
    history.replaceState({}, "", url);
    await ensureStructuredDocumentController(true);
  }

  await ensureLiveInvestigationOverlay();
  if (editorState.liveController) {
    await editorState.liveController.setContent(payload).catch(() => false);
    await editorState.liveController.flush?.().catch(() => null);
  }

  editorState.draftStatus = status;
  editorState.lastRelayFingerprint = fingerprint;
  editorState.relayVersions.unshift({
    ...payload,
    id: result.event.id,
    created_at: Number(result.event.created_at || Math.floor(Date.now() / 1000)),
    _event: result.event
  });
  editorState.relayVersions = dedupeVersions(editorState.relayVersions);
  await persistLocalSnapshot(status === "candidate" ? "Sent to review" : "Saved");
  syncSlugPreview();
  updateMetaPanel();
  updateHistoryPanels();
  setEditorStatus(
    status === "candidate" ? "Draft sent to review." : "Working draft saved.",
    "success"
  );
}

function updateMetaPanel(message = "") {
  const host = document.querySelector("[data-editor-status]");
  if (!(host instanceof HTMLElement)) return;
  const latestRelay = editorState.relayVersions[0] || null;
  if (message) {
    host.textContent = message;
    delete host.dataset.state;
    return;
  }
  if (latestRelay) {
    host.textContent = `Latest review save ${formatTime(latestRelay.created_at)}.`;
    delete host.dataset.state;
    return;
  }
  if (editorState.localSnapshots.length) {
    host.textContent = `Saved on this device ${formatTime(editorState.localSnapshots[0].saved_at)}.`;
    delete host.dataset.state;
    return;
  }
  host.textContent = "Autosave is on. Snapshot saves the current draft immediately.";
  delete host.dataset.state;
}

function updateHistoryPanels() {
  return;
}

function restoreLocalSnapshot(index) {
  const snapshot = editorState.localSnapshots[index];
  if (!snapshot) return;
  applyDocument(snapshot.document);
  scheduleStructuredDocumentSync(true);
  updateMetaPanel(`Restored a local save from ${formatTime(snapshot.saved_at)}`);
}

function restoreRelayVersion(id) {
  const version = editorState.relayVersions.find((item) => String(item.id || item.slug) === String(id || ""));
  if (!version) return;
  applyDocument(draftToDocument(version));
  editorState.draftStatus = version.status || "draft";
  scheduleStructuredDocumentSync(true);
  updateMetaPanel(`Restored a saved version from ${formatTime(version.created_at)}`);
}

function reviewVersionLabel(status) {
  const clean = String(status || "").toLowerCase();
  if (clean === "candidate" || clean === "review" || clean === "submitted") return "Sent to review";
  if (clean === "approved") return "Approved";
  if (clean === "revision") return "Revision requested";
  if (clean === "denied") return "Denied";
  return "Working draft";
}

function draftOwnerPubkey() {
  const revisions = Array.isArray(editorState.relayVersions) ? editorState.relayVersions : [];
  const oldest = revisions.length ? revisions[revisions.length - 1] : null;
  return String(oldest?.author_pubkey || oldest?.author || editorState.viewer?.pubkey || "").trim().toLowerCase();
}

function applyDocument(nextDocument) {
  const form = document.querySelector("[data-editor-form]");
  if (!(form instanceof HTMLFormElement)) return;
  editorState.document = {
    ...nextDocument,
    tags: Array.isArray(nextDocument?.tags) ? nextDocument.tags.slice() : [],
    entityRefs: Array.isArray(nextDocument?.entityRefs) ? nextDocument.entityRefs.slice() : []
  };
  editorState.suppressSyncDepth += 1;
  try {
    form.elements.namedItem("title").value = nextDocument.title || "";
    form.elements.namedItem("date").value = nextDocument.date || new Date().toISOString().slice(0, 10);
    form.elements.namedItem("summary").value = nextDocument.summary || "";
    form.elements.namedItem("tags").value = Array.isArray(nextDocument.tags) ? nextDocument.tags.join(", ") : "";
    form.elements.namedItem("primaryEntity").value = nextDocument.primaryEntity || "";
    form.elements.namedItem("entityRefs").value = Array.isArray(nextDocument.entityRefs) ? nextDocument.entityRefs.join(", ") : "";
    if (editorState.editor?.setMarkdown) {
      editorState.editor.setMarkdown(nextDocument.markdown || "", false);
    }
    syncSlugPreview();
    hydrateEntityResults();
  } finally {
    editorState.suppressSyncDepth = Math.max(0, editorState.suppressSyncDepth - 1);
  }
}

function hydrateEntityResults() {
  renderEntityResults("primaryEntity");
  renderEntityResults("entityRefs");
}

function renderEntityResults(fieldName) {
  const host = document.querySelector(`[data-editor-entity-results="${fieldName}"]`);
  const input = document.querySelector(`[name="${fieldName}"]`);
  if (!(host instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
  const query = fieldName === "entityRefs" ? lastCommaValue(input.value) : input.value.trim();
  const isActive = editorState.activePickerField === fieldName;
  if (!query && !isActive) {
    host.innerHTML = "";
    host.removeAttribute("data-open");
    return;
  }
  const matches = matchEntities(query).slice(0, 6);
  const createLabel = query ? `Add "${query}" as a new entity` : "Add a new entity";
  host.setAttribute("data-open", "true");
  host.innerHTML = `
    ${matches.length
      ? matches
          .map(
            (entity) => `
              <button class="picker-chip" type="button" data-editor-entity-pick="${escapeAttribute(entity.slug)}" data-target-field="${fieldName}">
                <strong>${escapeHtml(entity.name)}</strong>
                <span>${escapeHtml(entity.location || entity.type || "Entity")}</span>
              </button>
            `
          )
          .join("")
      : `<div class="picker-hint">${query ? "No saved entity matches that search yet." : "Start typing to search existing entities."}</div>`}
    <button class="picker-create" type="button" data-editor-create-entity="${fieldName}">
      <strong>${escapeHtml(createLabel)}</strong>
      <span>Create it here</span>
    </button>
  `;
}

function applyEntityPick(button) {
  const slug = button.getAttribute("data-editor-entity-pick") || "";
  const fieldName = button.getAttribute("data-target-field") || "";
  const entity = resolveEntityByNameOrSlug(slug);
  const input = document.querySelector(`[name="${fieldName}"]`);
  if (!entity || !(input instanceof HTMLInputElement)) return;
  if (fieldName === "entityRefs") {
    const existing = splitTags(input.value).map((value) => resolveEntityByNameOrSlug(value)?.name || value);
    input.value = dedupe([...existing, entity.name]).join(", ");
  } else {
    input.value = entity.name;
  }
  editorState.activePickerField = "";
  hydrateEntityResults();
}

function matchEntities(query) {
  const clean = String(query || "").trim().toLowerCase();
  const entities = (editorState.publicState?.approvedEntities || []).slice().sort((left, right) => {
    const leftName = String(left?.name || "").toLowerCase();
    const rightName = String(right?.name || "").toLowerCase();
    return leftName.localeCompare(rightName);
  });
  if (!clean) return entities;
  return entities.filter((entity) => {
    const values = [
      entity.name,
      entity.slug,
      entity.location,
      ...(Array.isArray(entity.aliases) ? entity.aliases : [])
    ]
      .map((value) => String(value || "").toLowerCase())
      .filter(Boolean);
    return values.some((value) => value.includes(clean));
  });
}

function openEntityModal(fieldName) {
  editorState.imageModal = null;
  editorState.entityModal = createEntityModalState(fieldName);
  renderEditorModal();
}

function closeEntityModal() {
  editorState.entityModal = null;
  renderEditorModal();
}

function openImageModal() {
  editorState.entityModal = null;
  try {
    editorState.editor?.focus?.();
  } catch {
    // Ignore focus errors and still let the modal open.
  }
  editorState.imageModal = {
    alt: "",
    caption: "",
    placement: "full-width",
    drag: { x: 0.5, y: 0.5 },
    crop: { x: 0, y: 0, width: 1, height: 1 }
  };
  renderEditorModal();
}

function closeImageModal() {
  editorState.imageModal = null;
  renderEditorModal();
}

function createEntityModalState(fieldName) {
  const input = document.querySelector(`[name="${fieldName}"]`);
  const rawValue = input instanceof HTMLInputElement ? input.value.trim() : "";
  return {
    fieldName,
    seedName: fieldName === "entityRefs" ? lastCommaValue(rawValue) : rawValue,
    seedLocation: "",
    seedType: "",
    seedNotes: ""
  };
}

function renderEditorModal() {
  const root = ensureModalRoot();
  root.innerHTML = renderEditorModalView({
    editorState,
    deps: {
      escapeAttribute,
      escapeHtml
    }
  });
  if (editorState.imageModal) {
    bindImageModal();
    return;
  }
  if (editorState.entityModal) {
    bindEntityModal();
  }
}

function bindEntityModal() {
  const root = ensureModalRoot();
  const form = root.querySelector("[data-editor-entity-form]");
  if (!(form instanceof HTMLFormElement)) return;
  root.onclick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches("[data-editor-modal-backdrop]") || target.closest("[data-editor-modal-close]")) {
      closeEntityModal();
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    await handleEntitySave(form);
  };
}

function bindImageModal() {
  const root = ensureModalRoot();
  const form = root.querySelector("[data-editor-image-form]");
  if (!(form instanceof HTMLFormElement)) return;
  root.onclick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches("[data-editor-modal-backdrop]") || target.closest("[data-editor-modal-close]")) {
      closeImageModal();
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    await handleImageInsert(form);
  };
}

async function handleEntitySave(form) {
  if (!editorState.session || !currentUserIsAdmin()) return;
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  const taken = (editorState.publicState?.entities || []).map((entity) => entity.slug);
  const slug = createUniqueSlug(name, taken);
  const entity = {
    slug,
    name,
    location: String(formData.get("location") || "").trim(),
    type: String(formData.get("type") || "").trim() || "entity",
    lat: parseMaybeNumber(formData.get("lat")),
    lng: parseMaybeNumber(formData.get("lng")),
    notes: String(formData.get("notes") || "").trim(),
    aliases: [],
    status: "approved"
  };
  await publishTaggedJson({
    kind: SITE.nostr.kinds.entity,
    secretKeyHex: editorState.session.secretKeyHex,
    tags: [["d", slug]],
    content: entity
  });
  mergeEntityIntoState(entity);
  applyNewEntityToField(entity, editorState.entityModal?.fieldName || "");
  closeEntityModal();
  setEditorStatus(`Saved ${entity.name}.`, "success");
}

async function handleImageInsert(form) {
  if (!editorState.session || !currentUserIsAdmin()) {
    destroyStructuredDocumentController();
    return;
  }
  const formData = new FormData(form);
  const file = formData.get("image");
  if (!(file instanceof File) || !file.size) return;
  const placement = normalizeInvestigationImagePlacement(formData.get("placement"), "full-width");
  const alt = String(formData.get("alt") || "").trim() || cleanFileStem(file.name);
  const caption = String(formData.get("caption") || "").trim();
  const drag = {
    x: clampFraction(Number(formData.get("focusX")) / 100, 0.5),
    y: clampFraction(Number(formData.get("focusY")) / 100, 0.5)
  };
  const crop = {
    x: clampFraction(Number(formData.get("cropX")) / 100, 0),
    y: clampFraction(Number(formData.get("cropY")) / 100, 0),
    width: clampFraction(Number(formData.get("cropWidth")) / 100, 1),
    height: clampFraction(Number(formData.get("cropHeight")) / 100, 1)
  };
  setEditorStatus("Uploading image...", "pending");
  try {
    const upload = await uploadPublicBlob(editorState.session.secretKeyHex, file, {
      purpose: "investigation-image"
    });
    insertEditorImageBlock(upload, { alt, caption, placement, drag, crop });
    closeImageModal();
    scheduleLocalSnapshot();
    scheduleRelaySave();
    scheduleStructuredDocumentSync();
    scheduleLivePublish();
    setEditorStatus("Image inserted.", "success");
  } catch (error) {
    setEditorStatus(String(error?.message || error || "Image upload failed."), "error");
  }
}

function mergeEntityIntoState(entity) {
  if (!editorState.publicState) return;
  const nextEntities = [
    ...(editorState.publicState.entities || []).filter((item) => item.slug !== entity.slug),
    entity
  ].sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
  editorState.publicState.entities = nextEntities;
  editorState.publicState.approvedEntities = nextEntities.filter((item) => item.status === "approved");
}

function applyNewEntityToField(entity, fieldName) {
  const input = document.querySelector(`[name="${fieldName}"]`);
  if (!(input instanceof HTMLInputElement)) return;
  if (fieldName === "entityRefs") {
    const existing = splitTags(input.value)
      .map((value) => resolveEntityByNameOrSlug(value)?.name || value)
      .filter(Boolean);
    input.value = dedupe([...existing, entity.name]).join(", ");
  } else {
    input.value = entity.name;
  }
  editorState.activePickerField = fieldName;
  hydrateEntityResults();
}

function insertEditorImageBlock(upload, options = {}) {
  if (!upload?.url) return;
  try {
    editorState.editor?.focus?.();
  } catch {
    // Keep going even if the editor cannot reclaim focus first.
  }
  const alt = String(options.alt || "").trim() || "Image";
  const placement = normalizeInvestigationImagePlacement(options.placement, "full-width");
  const caption = String(options.caption || "").trim();
  const title = stringifyInvestigationImageTitleSpec({
    placement,
    caption,
    drag: options.drag,
    crop: options.crop
  });
  const snippet = `![${escapeMarkdownText(alt)}](${upload.url} "${escapeMarkdownTitle(title)}")`;
  const insertable = `\n\n${snippet}\n\n`;
  const before = editorState.editor?.getMarkdown?.() || "";
  if (typeof editorState.editor?.insertText === "function") {
    editorState.editor.insertText(insertable);
    const afterInsert = editorState.editor?.getMarkdown?.() || "";
    if (afterInsert !== before && afterInsert.includes(upload.url)) return;
  }
  editorState.editor?.setMarkdown?.(`${String(before || "").trimEnd()}${insertable}`, false);
}

function cleanFileStem(value) {
  return String(value || "").replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Image";
}

function escapeMarkdownText(value) {
  return String(value || "").replace(/[[\]\\]/g, "\\$&");
}

function escapeMarkdownTitle(value) {
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function ensureModalRoot() {
  if (editorState.modalRoot instanceof HTMLElement) return editorState.modalRoot;
  const existing = document.querySelector("[data-editor-modal-root]");
  if (existing instanceof HTMLElement) {
    editorState.modalRoot = existing;
    return existing;
  }
  const root = document.createElement("div");
  root.dataset.editorModalRoot = "";
  document.body.append(root);
  editorState.modalRoot = root;
  return root;
}

function handleDocumentClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest("[data-editor-picker]") || target.closest("[data-editor-modal-root]")) return;
  editorState.activePickerField = "";
  hydrateEntityResults();
}

function decorateToolbar(surface) {
  const labels = new Map([
    ["Headings", "Headings"],
    ["Bold", "Bold"],
    ["Italic", "Italic"],
    ["Blockquote", "Quote"],
    ["Unordered list", "Bullets"],
    ["Ordered list", "Numbers"],
    ["Insert link", "Link"],
    ["Inline code", "Code"],
    ["Insert codeBlock", "Code block"],
    ["Insert code block", "Code block"]
  ]);
  surface.querySelectorAll(".toastui-editor-defaultUI-toolbar button").forEach((button) => {
    const label = labels.get(String(button.getAttribute("aria-label") || "").trim());
    if (!label) return;
    button.classList.add("editor-toolbar-button");
    button.setAttribute("aria-label", label);
    button.removeAttribute("title");
    const icon = button.querySelector(".toastui-editor-toolbar-icons, .toastui-editor-toolbar-icons.last");
    if (icon instanceof HTMLElement) {
      icon.textContent = label;
      icon.setAttribute("aria-hidden", "true");
      icon.removeAttribute("title");
      icon.classList.add("editor-toolbar-chip");
    } else {
      button.textContent = label;
    }
  });

  const toolbar = surface.querySelector(".toastui-editor-defaultUI-toolbar");
  if (!(toolbar instanceof HTMLElement) || toolbar.querySelector("[data-editor-image]")) return;
  const groups = toolbar.querySelectorAll(".toastui-editor-toolbar-group");
  const customGroup = document.createElement("div");
  customGroup.className = "toastui-editor-toolbar-group editor-toolbar-group--custom";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "editor-toolbar-button";
  button.dataset.editorImage = "";
  button.setAttribute("aria-label", "Image");
  button.removeAttribute("title");
  button.innerHTML = `<span class="toastui-editor-toolbar-icons editor-toolbar-chip" aria-hidden="true">Image</span>`;
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  customGroup.append(button);
  const insertBeforeTarget = groups.length > 2 ? groups[2] : null;
  if (insertBeforeTarget?.parentNode) {
    insertBeforeTarget.parentNode.insertBefore(customGroup, insertBeforeTarget);
  } else {
    toolbar.append(customGroup);
  }
}

function resolveEntityByNameOrSlug(value) {
  const clean = String(value || "").trim().toLowerCase();
  return (editorState.publicState?.approvedEntities || []).find(
    (entity) => entity.slug === cleanSlug(clean) || entity.name.toLowerCase() === clean
  ) || null;
}

function resolveEntityDisplayValue(value) {
  const entity = resolveEntityByNameOrSlug(value);
  return entity?.name || String(value || "");
}

function dedupeVersions(versions) {
  const seen = new Set();
  return versions.filter((version) => {
    const key = String(version.id || `${version.slug}:${version.status}:${version.created_at || ""}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function setEditorStatus(message, state = "") {
  const box = document.querySelector("[data-editor-status]");
  if (!(box instanceof HTMLElement)) return;
  box.textContent = message;
  if (state) {
    box.dataset.state = state;
  } else {
    delete box.dataset.state;
  }
}

async function loadStaticSlugs() {
  const response = await fetch("./content/investigations/index.json");
  if (!response.ok) return [];
  const data = await response.json();
  return (Array.isArray(data.files) ? data.files : []).map((file) => cleanSlug(String(file).replace(/\.md$/i, "")));
}

function currentUserIsAdmin() {
  return editorUserIsAdmin(editorState.publicState, editorState.viewer?.pubkey);
}

function editorUserIsAdmin(publicState, pubkey = "") {
  return publicStateHasAdminPubkey(publicState, pubkey);
}

function trustedAdminPubkeys() {
  const admins = new Set(normalizeAdminPubkeys(editorState.publicState));
  const rootAdminPubkey = String(editorState.publicState?.rootAdminPubkey || SITE.nostr.rootAdminPubkey || "").trim();
  if (rootAdminPubkey) admins.add(rootAdminPubkey);
  return [...admins];
}

function ensureEditorUnitSlug() {
  if (editorState.currentSlug) return editorState.currentSlug;
  const title = String(document.querySelector('[name="title"]')?.value || "").trim();
  if (!title) return "";
  const nextSlug = createUniqueSlug(title || "untitled", takenSlugs());
  if (!nextSlug) return "";
  editorState.currentSlug = nextSlug;
  void moveLocalDraftStateToSlug(nextSlug);
  const url = new URL(window.location.href);
  url.searchParams.set("slug", nextSlug);
  history.replaceState({}, "", url);
  void ensureStructuredDocumentController(true);
  void ensureLiveInvestigationOverlay();
  return nextSlug;
}

async function ensureLiveInvestigationOverlay() {
  if (!editorState.session || !currentUserIsAdmin()) return;
  const slug = editorState.currentSlug || ensureEditorUnitSlug();
  if (!slug) return;
  const documentId = investigationDocumentId(slug);
  if (editorState.liveController && editorState.liveDocumentId === documentId) return;
  destroyLiveInvestigationOverlay();
  editorState.liveDocumentId = documentId;
  editorState.liveController = await connectStructuredUnitOverlay({
    documentId,
    secretKeyHex: editorState.session.secretKeyHex,
    kind: SITE.nostr.kinds.collabDocument,
    getTrustedPubkeys: trustedAdminPubkeys,
    canPublish: currentUserIsAdmin,
    onRemoteContent: handleLiveInvestigationContent,
    onStatus: handleLiveInvestigationStatus,
  });
  const initialContent = editorState.liveController?.getContent?.() || {};
  if (Object.keys(initialContent).length) {
    handleLiveInvestigationContent(initialContent, {
      documentId,
      hasLiveContent: true,
      origin: "initial"
    });
  }
}

function destroyLiveInvestigationOverlay() {
  if (editorState.livePublishTimer) {
    window.clearTimeout(editorState.livePublishTimer);
    editorState.livePublishTimer = 0;
  }
  try {
    editorState.liveController?.destroy?.();
  } catch {
    return;
  } finally {
    editorState.liveController = null;
    editorState.liveDocumentId = "";
    editorState.liveStatus = "idle";
  }
}

function scheduleLivePublish() {
  if (editorState.livePublishTimer) window.clearTimeout(editorState.livePublishTimer);
  editorState.livePublishTimer = window.setTimeout(async () => {
    editorState.livePublishTimer = 0;
    if (!editorState.session || !currentUserIsAdmin()) return;
    await ensureLiveInvestigationOverlay().catch(() => null);
    if (!editorState.liveController) return;
    const payload = buildDraftPayload(editorState.draftStatus || "draft");
    if (!payload.title.trim() && !payload.markdown.trim()) return;
    await editorState.liveController.setContent(payload).catch(() => false);
    await editorState.liveController.flush?.().catch(() => null);
  }, 260);
}

function handleLiveInvestigationStatus(detail) {
  if (detail?.documentId !== editorState.liveDocumentId) return;
  editorState.liveStatus = String(detail?.state || "idle");
}

function handleLiveInvestigationContent(content, detail) {
  if (detail?.documentId !== editorState.liveDocumentId || !detail?.hasLiveContent) return;
  const nextDocument = draftToDocument(content);
  if (fingerprintDocument(nextDocument, editorState.draftStatus || "draft") === fingerprintDocument(collectDocumentFromForm(), editorState.draftStatus || "draft")) {
    return;
  }
  applyDocument(nextDocument);
  updateMetaPanel("Applied live updates from another admin.");
}

function investigationDocumentId(slug) {
  const clean = cleanSlug(slug || "");
  return clean ? `investigation:${clean}` : "";
}

function sameEditorSession(left, right) {
  const normalize = (value) =>
    value
      ? {
          username: String(value.username || "").trim().toLowerCase(),
          secretKeyHex: String(value.secretKeyHex || "").trim().toLowerCase(),
          pubkey: String(value.pubkey || "").trim().toLowerCase()
        }
      : null;
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

async function ensureStructuredDocumentController(force = false) {
  if (!editorState.session || !currentUserIsAdmin()) {
    destroyStructuredDocumentController();
    return null;
  }
  const docId = investigationDocumentId(editorState.currentSlug || "unsaved") || "investigation:unsaved";
  if (!force && editorState.documentController && editorState.documentControllerId === docId) {
    return editorState.documentController;
  }

  destroyStructuredDocumentController();
  const controller = await createSiteDocumentController({
    docId,
    kind: "investigation",
    initialDocument: buildCurrentStructuredDocument()
  });

  editorState.documentController = controller;
  editorState.documentControllerId = docId;
  controller.subscribe((projection, meta = {}) => {
    handleStructuredDocumentProjection(projection, meta);
  });
  const opened = await controller.open();
  handleStructuredDocumentProjection(opened, { source: "open" });
  return controller;
}

function destroyStructuredDocumentController() {
  if (editorState.documentSyncTimer) {
    window.clearTimeout(editorState.documentSyncTimer);
    editorState.documentSyncTimer = 0;
  }
  try {
    editorState.documentController?.destroy?.();
  } catch {
    return;
  } finally {
    editorState.documentController = null;
    editorState.documentControllerId = "";
    editorState.documentProjection = null;
    editorState.documentProjectionFingerprint = "";
  }
}

function scheduleStructuredDocumentSync(force = false) {
  if (editorState.documentSyncTimer) window.clearTimeout(editorState.documentSyncTimer);
  editorState.documentSyncTimer = window.setTimeout(() => {
    editorState.documentSyncTimer = 0;
    void syncStructuredDocumentNow(force);
  }, force ? 20 : 240);
}

async function syncStructuredDocumentNow(force = false) {
  if (!editorState.session || !currentUserIsAdmin()) return;
  const controller = await ensureStructuredDocumentController();
  if (!controller) return;
  const nextDocument = buildCurrentStructuredDocument();
  const nextFingerprint = JSON.stringify(nextDocument);
  if (!force && nextFingerprint === editorState.documentProjectionFingerprint) return;
  const projection = await controller.replaceDocument(nextDocument);
  editorState.documentProjection = projection || null;
  editorState.documentProjectionFingerprint = JSON.stringify(projection?.document || nextDocument);
}

function handleStructuredDocumentProjection(projection, meta = {}) {
  if (!projection?.document) return;
  editorState.documentProjection = projection;
  const nextFingerprint = JSON.stringify(projection.document);
  if (nextFingerprint === editorState.documentProjectionFingerprint) return;
  editorState.documentProjectionFingerprint = nextFingerprint;
  if (editorState.suppressSyncDepth > 0) return;

  const nextDocument = draftToDocument({
    title: projection.document.title,
    summary: projection.document.summary,
    date: collectDocumentFromForm().date,
    tags: projection.document.metadata?.tags || [],
    entity_refs: projection.entityRefs || [],
    structured_document: projection.document
  });
  const currentDocument = document.querySelector("[data-editor-form]")
    ? collectDocumentFromForm()
    : editorState.document || createBlankDocument();
  if (fingerprintDocument(currentDocument, editorState.draftStatus || "draft") === fingerprintDocument(nextDocument, editorState.draftStatus || "draft")) {
    return;
  }
  applyDocument(nextDocument);
  if (meta?.source === "open" || meta?.cached) {
    updateMetaPanel("Restored structured draft state from local runtime.");
  }
}

function buildCurrentStructuredDocument() {
  const documentValue = document.querySelector("[data-editor-form]")
    ? collectDocumentFromForm()
    : editorState.document || createBlankDocument();
  const primaryEntity = resolveEntityByNameOrSlug(documentValue.primaryEntity);
  const resolvedRefs = [
    primaryEntity?.slug || "",
    ...(Array.isArray(documentValue.entityRefs) ? documentValue.entityRefs : []).map((value) => resolveEntityByNameOrSlug(value)?.slug || cleanSlug(value))
  ];
  return deriveInvestigationStructuredArtifacts({
    slug: cleanSlug(editorState.currentSlug || documentValue.title || "unsaved") || "unsaved",
    title: documentValue.title,
    summary: documentValue.summary,
    markdown: documentValue.markdown,
    entityRefs: dedupe(resolvedRefs),
    tags: documentValue.tags,
    relationshipCandidates: Array.isArray(editorState.documentProjection?.document?.metadata?.relationshipCandidates)
      ? editorState.documentProjection.document.metadata.relationshipCandidates
      : [],
    citations: Array.isArray(editorState.documentProjection?.document?.metadata?.citations)
      ? editorState.documentProjection.document.metadata.citations
      : []
  }).structuredDocument;
}

async function loadLocalDocument(slug) {
  return loadSiteRuntimeValue("editorLocalDraft", storageParams(slug)).catch(() => null);
}

async function saveLocalDocument(slug, document) {
  return rememberSiteRuntimeValue("editorLocalDraft", storageParams(slug), document, {
    source: "editor-local-draft"
  });
}

async function loadLocalHistory(slug) {
  const history = await loadSiteRuntimeValue("editorLocalHistory", storageParams(slug)).catch(() => null);
  return Array.isArray(history) ? history : [];
}

async function saveLocalHistory(slug, history) {
  return rememberSiteRuntimeValue("editorLocalHistory", storageParams(slug), Array.isArray(history) ? history : [], {
    source: "editor-local-history"
  });
}

async function moveLocalDraftStateToSlug(slug) {
  if (!slug) return;
  await Promise.all([
    moveSiteRuntimeValue("editorLocalDraft", storageParams(""), storageParams(slug), {
      source: "editor-local-draft-move"
    }),
    moveSiteRuntimeValue("editorLocalHistory", storageParams(""), storageParams(slug), {
      source: "editor-local-history-move"
    })
  ]);
}

function storageParams(slug) {
  return {
    slug: cleanSlug(slug || "") || "unsaved"
  };
}

function fingerprintDocument(document, status = "draft") {
  return JSON.stringify({
    title: document.title || "",
    date: document.date || "",
    summary: document.summary || "",
    tags: Array.isArray(document.tags) ? document.tags : [],
    markdown: document.markdown || "",
    primaryEntity: document.primaryEntity || "",
    entityRefs: Array.isArray(document.entityRefs) ? document.entityRefs : document.entity_refs || [],
    status
  });
}

function parseMaybeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampFraction(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
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

function renderLoadingState(message) {
  const reloadHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `
    <div class="loading-state loading-state--panel" role="status" aria-live="polite">
      <div class="loading-state__message">
        <span class="loading-spinner" aria-hidden="true"></span>
        <span>${escapeHtml(message)}</span>
      </div>
      <div class="loading-state__slow">
        <span>This is taking longer than expected.</span>
        <a class="button-ghost loading-state__reload" href="${escapeAttribute(reloadHref)}">Reload</a>
      </div>
    </div>
  `;
}
