import SITE from "./core/site-config.js";
import { createUniqueSlug, splitTags } from "./core/content-utils.js";
import {
  cleanSlug,
  deriveIdentity,
  ensureEventToolsLoaded,
  loadPublicState,
  publishTaggedJson
} from "./core/nostr.js";
import { getStoredSession } from "./core/session.js";

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
  modalRoot: null,
  documentClicksBound: false
};

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
  renderEditorLoading("Looking up editor...");
  await ensureEventToolsLoaded();
  editorState.viewer = deriveIdentity(editorState.session.secretKeyHex);
  editorState.publicState = await loadPublicState(force);
  editorState.staticSlugs = await loadStaticSlugs().catch(() => []);
  renderEditorShell();
}

function renderEditorLoading(message) {
  const shell = document.querySelector("[data-editor-shell]");
  const lede = document.querySelector("[data-editor-lede]");
  if (lede) lede.textContent = message;
  if (shell) shell.innerHTML = renderLoadingState(message);
}

function renderEditorShell() {
  const shell = document.querySelector("[data-editor-shell]");
  const title = document.querySelector("[data-editor-title]");
  const lede = document.querySelector("[data-editor-lede]");
  if (!shell || !title || !lede) return;

  if (!editorState.session) {
    title.textContent = "Log in";
    lede.textContent = "Log in with an admin account to write and review investigation drafts.";
    shell.innerHTML = `
      <section class="surface-panel editor-gate">
        <div class="eyebrow">Authoring</div>
        <h2>Admin access required</h2>
        <p>Investigation drafting is available to approved admins only.</p>
        <a class="button" href="./admin.html?tab=login">Log in</a>
      </section>
    `;
    return;
  }

  if (!currentUserIsAdmin()) {
    title.textContent = "Authoring";
    lede.textContent = "This page opens for admin accounts only.";
    shell.innerHTML = `
      <section class="surface-panel editor-gate">
        <div class="eyebrow">Authoring</div>
        <h2>Admin access required</h2>
        <p>This account can manage its profile and comments, but it does not have investigation authoring access.</p>
        <a class="button" href="./investigations.html">Back to investigations</a>
      </section>
    `;
    return;
  }

  hydrateDraftState();
  title.textContent = editorState.currentSlug ? "Edit investigation" : "Create investigation";
  lede.textContent = "Write in the full editor, let working drafts save automatically, and send finished versions into review.";
  shell.innerHTML = `
    <section class="surface-panel editor-studio">
      <form class="editor-form editor-form--studio" data-editor-form>
        <div class="editor-actions">
          <div class="editor-actions__copy">
            <div class="eyebrow">Investigation draft</div>
            <h2>${editorState.currentSlug ? "Continue editing" : "Start a new investigation"}</h2>
            <p>${editorState.currentSlug ? "Keep shaping the draft, then send the next version into review when it is ready." : "Write the title, summary, and full body here. Drafts save as you work and can be sent into review when they are ready."}</p>
          </div>
          <div class="editor-actions__controls">
            <div class="editor-save-state" data-editor-status aria-live="polite">Autosave is on. Save draft now pushes the latest version immediately.</div>
            <div class="button-row">
              <button class="button-ghost" type="button" data-editor-save>Save draft now</button>
              <button class="button" type="button" data-editor-submit>Send to review</button>
            </div>
          </div>
        </div>

        <label class="editor-field editor-field--title">
          <span class="sr-only">Title</span>
          <input class="editor-title-input" name="title" type="text" maxlength="140" placeholder="Investigation title" value="${escapeAttribute(editorState.document.title)}" required>
        </label>

        <label class="editor-field editor-field--summary">
          <span class="sr-only">Summary</span>
          <textarea class="editor-summary-input" name="summary" rows="3" placeholder="Short summary for the archive card">${escapeHtml(editorState.document.summary)}</textarea>
        </label>

        <div class="editor-meta-grid">
          <label class="editor-field editor-field--compact">
            <span class="sr-only">Date</span>
            <input name="date" type="date" aria-label="Publication date" value="${escapeAttribute(editorState.document.date)}">
          </label>
          <label class="editor-field editor-field--compact">
            <span class="sr-only">Tags</span>
            <input name="tags" type="text" placeholder="Tags: records, follow-up, budget" value="${escapeAttribute(editorState.document.tags.join(", "))}">
          </label>
          <label class="editor-field editor-field--compact">
            <span class="sr-only">Lead entity</span>
            <div class="editor-picker" data-editor-picker="primaryEntity">
              <input name="primaryEntity" type="text" data-editor-entity-input="primaryEntity" autocomplete="off" placeholder="Lead entity" value="${escapeAttribute(editorState.document.primaryEntity)}">
              <div class="picker-results picker-results--dropdown" data-editor-entity-results="primaryEntity"></div>
            </div>
          </label>
          <label class="editor-field editor-field--compact editor-field--wide">
            <span class="sr-only">Related entities</span>
            <div class="editor-picker" data-editor-picker="entityRefs">
              <input name="entityRefs" type="text" data-editor-entity-input="entityRefs" autocomplete="off" placeholder="Related entities" value="${escapeAttribute(editorState.document.entityRefs.join(", "))}">
              <div class="picker-results picker-results--dropdown" data-editor-entity-results="entityRefs"></div>
            </div>
          </label>
        </div>

        <div class="editor-markdown-field" role="group" aria-label="Body">
          <span class="sr-only">Body</span>
          <div class="editor-surface" data-editor-surface></div>
        </div>
      </form>
    </section>
  `;

  bindEditorShell();
  renderEntityModal();
  updateMetaPanel();
  updateHistoryPanels();
  hydrateEntityResults();
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

  if (editorState.editor?.destroy) {
    editorState.editor.destroy();
    editorState.editor = null;
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

  const queueSave = () => {
    syncSlugPreview();
    scheduleLocalSnapshot();
    scheduleRelaySave();
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
  const relayDraft = requestedSlug
    ? (editorState.publicState?.drafts || []).find((draft) => draft.slug === requestedSlug) || null
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
  return dedupe([
    ...editorState.staticSlugs,
    ...(editorState.publicState?.drafts || []).map((draft) => draft.slug),
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
  host.textContent = "Autosave is on. Save draft now pushes the latest version immediately.";
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
  editorState.entityModal = createEntityModalState(fieldName);
  renderEntityModal();
}

function closeEntityModal() {
  editorState.entityModal = null;
  renderEntityModal();
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

function renderEntityModal() {
  const root = ensureModalRoot();
  if (!editorState.entityModal) {
    root.innerHTML = "";
    return;
  }
  const { seedName, seedLocation, seedType, seedNotes } = editorState.entityModal;
  root.innerHTML = `
    <div class="modal-backdrop" data-editor-modal-backdrop>
      <section class="modal-card modal-card--editor" aria-label="Add entity">
        <div class="section-heading">
          <div>
            <div class="eyebrow">Add entity</div>
            <h3>Create an entity without leaving the draft</h3>
            <p>Save it once, then keep writing.</p>
          </div>
          <button class="button-ghost" type="button" data-editor-modal-close>Close</button>
        </div>
        <form class="form-grid editor-entity-form" data-editor-entity-form>
          <label>
            <span class="sr-only">Entity name</span>
            <input name="name" type="text" maxlength="120" placeholder="Entity name" value="${escapeAttribute(seedName)}" required>
          </label>
          <label>
            <span class="sr-only">Entity type</span>
            <input name="type" type="text" maxlength="80" placeholder="Type: factory farm, processor, store" value="${escapeAttribute(seedType)}">
          </label>
          <label class="editor-field editor-field--wide">
            <span class="sr-only">Location</span>
            <div class="editor-picker editor-picker--modal">
              <input name="location" type="text" maxlength="160" data-editor-location-input autocomplete="off" placeholder="Location" value="${escapeAttribute(seedLocation)}">
              <div class="picker-results picker-results--dropdown" data-editor-location-results></div>
            </div>
          </label>
          <label class="editor-field editor-field--compact">
            <span class="sr-only">Latitude</span>
            <input name="lat" type="text" inputmode="decimal" placeholder="Latitude (optional)">
          </label>
          <label class="editor-field editor-field--compact">
            <span class="sr-only">Longitude</span>
            <input name="lng" type="text" inputmode="decimal" placeholder="Longitude (optional)">
          </label>
          <label class="editor-field editor-field--wide">
            <span class="sr-only">Notes</span>
            <textarea name="notes" rows="4" placeholder="Notes for admins or future map context">${escapeHtml(seedNotes)}</textarea>
          </label>
          <div class="button-row">
            <button class="button-ghost" type="button" data-editor-modal-close>Cancel</button>
            <button class="button" type="submit">Save entity</button>
          </div>
        </form>
      </section>
    </div>
  `;
  bindEntityModal();
  renderLocationResults();
}

function bindEntityModal() {
  const root = ensureModalRoot();
  const form = root.querySelector("[data-editor-entity-form]");
  if (!(form instanceof HTMLFormElement)) return;
  root.onclick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.matches("[data-editor-modal-backdrop]")) {
      closeEntityModal();
      return;
    }
    if (target.closest("[data-editor-modal-close]")) {
      closeEntityModal();
      return;
    }
    const locationPick = target.closest("[data-editor-location-pick]");
    if (locationPick) {
      applyLocationPick(locationPick);
    }
  };
  form.oninput = (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.matches("[data-editor-location-input]")) {
      renderLocationResults();
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    await handleEntitySave(form);
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

function renderLocationResults() {
  const host = document.querySelector("[data-editor-location-results]");
  const input = document.querySelector("[data-editor-location-input]");
  if (!(host instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
  const query = input.value.trim();
  const matches = uniqueLocations(query).slice(0, 6);
  if (!query && !matches.length) {
    host.innerHTML = "";
    host.removeAttribute("data-open");
    return;
  }
  host.setAttribute("data-open", "true");
  host.innerHTML = `
    ${matches.length
      ? matches
          .map(
            (location) => `
              <button class="picker-chip" type="button" data-editor-location-pick="${escapeAttribute(location)}">
                <strong>${escapeHtml(location)}</strong>
              </button>
            `
          )
          .join("")
      : `<div class="picker-hint">${query ? "No saved location matches yet." : "Start typing to reuse a location."}</div>`}
    ${query
      ? `<button class="picker-create" type="button" data-editor-location-pick="${escapeAttribute(query)}">
          <strong>Use "${escapeHtml(query)}"</strong>
          <span>Keep this exact location</span>
        </button>`
      : ""}
  `;
}

function applyLocationPick(button) {
  const value = button.getAttribute("data-editor-location-pick") || "";
  const input = document.querySelector("[data-editor-location-input]");
  if (!(input instanceof HTMLInputElement)) return;
  input.value = value;
  renderLocationResults();
}

function uniqueLocations(query = "") {
  const clean = String(query || "").trim().toLowerCase();
  const values = dedupe((editorState.publicState?.entities || []).map((entity) => entity.location));
  if (!clean) return values;
  return values.filter((location) => location.toLowerCase().includes(clean));
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
  return Boolean(editorState.viewer && editorState.publicState?.admins?.includes(editorState.viewer.pubkey));
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

function lastCommaValue(value) {
  return String(value || "").split(",").pop().trim();
}

function parseMaybeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dedupe(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
