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
import { createPublicStateStore } from "./core/public-state-store.js";
import { replaceEditorShellMarkup } from "./core/editor-mount.js";
import { normalizeAdminPubkeys, publicStateHasAdminPubkey } from "./core/public-state.js";
import {
  dedupeStrings as dedupe,
  escapeAttribute,
  escapeHtml,
  lastCommaValue
} from "./core/text-utils.js";
import { getStoredSession } from "./core/session.js";
import {
  renderEditorLoadingMarkup,
  renderEditorModalView,
  renderEditorShellView
} from "./surfaces/editor-shell.js";

let editorPublicStateStore = null;

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
  pagehideBound: false
};

editorPublicStateStore = createPublicStateStore({
  getSessionSecretKey: async () => editorState.session?.secretKeyHex || "",
  page: "editor",
  refreshDelayMs: () => 0,
  shouldRefresh: () => false
});
editorState.publicState = editorPublicStateStore.value;
editorPublicStateStore.subscribe((snapshot) => {
  editorState.publicState = snapshot.value;
});

document.addEventListener("DOMContentLoaded", () => {
  if (!document.querySelector("[data-editor-page]")) return;
  void initEditorPage();
});

async function initEditorPage(force = false) {
  editorState.session = getStoredSession();
  editorState.viewer = null;
  if (!editorState.session) {
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
    renderEditorShell();
  } else {
    renderEditorLoading("Looking up editor...");
  }
  editorState.publicState = (await editorPublicStateStore.hydrate({ force, reason: "editor-load" })).value;
  editorState.staticSlugs = await loadStaticSlugs().catch(() => []);
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
  if (!editorState.pagehideBound) {
    window.addEventListener("pagehide", destroyLiveInvestigationOverlay);
    editorState.pagehideBound = true;
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
  hydrateDraftState();
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

function hydrateDraftState() {
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

  const localDocument = loadLocalDocument(editorState.currentSlug);
  const source = localDocument || relayDraft || createBlankDocument();
  editorState.document = draftToDocument(source);
  editorState.localSnapshots = loadLocalHistory(editorState.currentSlug);
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
  const entityRefs = Array.isArray(draft?.entity_refs) ? draft.entity_refs : [];
  return {
    title: String(draft?.title || "").trim(),
    date: String(draft?.date || new Date().toISOString().slice(0, 10)).trim(),
    summary: String(draft?.summary || "").trim(),
    tags: Array.isArray(draft?.tags) ? draft.tags : splitTags(draft?.tags),
    markdown: String(draft?.markdown || "").trim(),
    primaryEntity: resolveEntityDisplayValue(entityRefs[0] || draft?.primaryEntity || ""),
    entityRefs: entityRefs.slice(1)
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
  return {
    slug,
    title: document.title || "Untitled investigation",
    date: document.date,
    location: primaryEntity?.name || primaryEntity?.location || "Undisclosed location",
    status,
    author_pubkey: draftOwnerPubkey(),
    summary: document.summary,
    tags: document.tags,
    entity_refs: dedupe(resolvedRefs),
    featured: false,
    markdown: document.markdown,
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
    persistLocalSnapshot("Auto-saved");
  }, 1400);
}

function scheduleRelaySave() {
  if (editorState.relayTimer) window.clearTimeout(editorState.relayTimer);
  editorState.relayTimer = window.setTimeout(() => {
    void saveDraftNow("draft", true);
  }, 14000);
}

function persistLocalSnapshot(label) {
  const document = collectDocumentFromForm();
  if (!document.title && !document.markdown) return;
  const fingerprint = fingerprintDocument(document);
  saveLocalDocument(editorState.currentSlug, document);
  if (fingerprint !== editorState.lastLocalFingerprint) {
    editorState.localSnapshots.unshift({
      id: `${Date.now()}`,
      saved_at: new Date().toISOString(),
      label,
      document
    });
    editorState.localSnapshots = editorState.localSnapshots.slice(0, 10);
    saveLocalHistory(editorState.currentSlug, editorState.localSnapshots);
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
    moveLocalStorageToSlug(payload.slug);
    const url = new URL(window.location.href);
    url.searchParams.set("slug", payload.slug);
    history.replaceState({}, "", url);
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
  persistLocalSnapshot(status === "candidate" ? "Sent to review" : "Saved");
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
  updateMetaPanel(`Restored a local save from ${formatTime(snapshot.saved_at)}`);
}

function restoreRelayVersion(id) {
  const version = editorState.relayVersions.find((item) => String(item.id || item.slug) === String(id || ""));
  if (!version) return;
  applyDocument(draftToDocument(version));
  editorState.draftStatus = version.status || "draft";
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
    placement: "full"
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
  if (!editorState.session || !currentUserIsAdmin()) return;
  const formData = new FormData(form);
  const file = formData.get("image");
  if (!(file instanceof File) || !file.size) return;
  const placement = normalizeImagePlacement(formData.get("placement"));
  const alt = String(formData.get("alt") || "").trim() || cleanFileStem(file.name);
  const caption = String(formData.get("caption") || "").trim();
  setEditorStatus("Uploading image...", "pending");
  try {
    const upload = await uploadPublicBlob(editorState.session.secretKeyHex, file, {
      purpose: "investigation-image"
    });
    insertEditorImageBlock(upload, { alt, caption, placement });
    closeImageModal();
    scheduleLocalSnapshot();
    scheduleRelaySave();
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
  const placement = normalizeImagePlacement(options.placement);
  const caption = String(options.caption || "").trim();
  const title = caption ? `align:${placement}|${caption}` : `align:${placement}`;
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

function normalizeImagePlacement(value) {
  const clean = String(value || "").trim().toLowerCase();
  return ["left", "right", "full"].includes(clean) ? clean : "full";
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
  moveLocalStorageToSlug(nextSlug);
  const url = new URL(window.location.href);
  url.searchParams.set("slug", nextSlug);
  history.replaceState({}, "", url);
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

function loadLocalDocument(slug) {
  try {
    const raw = localStorage.getItem(storageKey("draft", slug));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLocalDocument(slug, document) {
  localStorage.setItem(storageKey("draft", slug), JSON.stringify(document));
}

function loadLocalHistory(slug) {
  try {
    const raw = localStorage.getItem(storageKey("history", slug));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalHistory(slug, history) {
  localStorage.setItem(storageKey("history", slug), JSON.stringify(history));
}

function moveLocalStorageToSlug(slug) {
  if (!slug) return;
  const draftRaw = localStorage.getItem(storageKey("draft", ""));
  const historyRaw = localStorage.getItem(storageKey("history", ""));
  if (draftRaw) {
    localStorage.setItem(storageKey("draft", slug), draftRaw);
    localStorage.removeItem(storageKey("draft", ""));
  }
  if (historyRaw) {
    localStorage.setItem(storageKey("history", slug), historyRaw);
    localStorage.removeItem(storageKey("history", ""));
  }
}

function storageKey(type, slug) {
  const suffix = cleanSlug(slug || "") || "unsaved";
  return `${SITE.nostr.storageNamespace}.editor.${type}.${suffix}`;
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
