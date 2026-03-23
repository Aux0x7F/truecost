import SITE from "./core/site-config.js";
import { createUniqueSlug, splitTags } from "./core/content-utils.js";
import {
  cleanSlug,
  deriveIdentity,
  uploadEncryptedBlob,
  ensureEventToolsLoaded,
  loadSubmissionThread,
  loadUserSubmissions,
  publishTaggedJson,
  publishSubmission,
  publishSubmissionChat,
  resolveSitePubkey
} from "./core/nostr.js";
import { createPublicStateProjectionStore } from "./core/public-state-projection.js";
import { getSiteRuntimeClient } from "./core/runtime-client.js";
import {
  dedupeStrings as dedupe,
  escapeAttribute,
  escapeHtml,
  lastCommaValue
} from "./core/text-utils.js";
import { applyObservedMarkup, applyObservedText } from "./core/observed-regions.js";
import { closeSearchResults, cycleHighlightIndex } from "./core/search-controls.js";
import { getStoredSession, resolveStoredSession } from "./core/session.js";
import {
  renderSubmitPageView,
  renderSubmitSuggestionMarkup
} from "./surfaces/submit-shell.js";

const submitState = {
  session: getStoredSession(),
  sessionIdentity: null,
  viewer: null,
  publicState: null,
  submissions: [],
  loading: false,
  loadingMessage: "",
  formModal: null,
  chatModal: null,
  searchUi: {
    entityRefs: { highlight: -1, closedValue: "" },
    location: { highlight: -1, closedValue: "" },
    suggestedEntity: { highlight: -1, closedValue: "" }
  }
};

const submitPublicStateStore = createPublicStateProjectionStore({
  getSessionSecretKey: async () => submitState.session?.secretKeyHex || "",
  page: "submit",
  refreshDelayMs: () => 0,
  shouldRefresh: () => false
});

submitState.publicState = submitPublicStateStore.value;
submitPublicStateStore.subscribe((snapshot) => {
  const previousPublicState = submitState.publicState;
  submitState.publicState = snapshot.value;
  if (
    submitState.session &&
    submitSessionAccessBlocked(previousPublicState, submitState.sessionIdentity) !==
      submitSessionAccessBlocked(submitState.publicState, submitState.sessionIdentity) &&
    submitSessionAccessBlocked(submitState.publicState, submitState.sessionIdentity)
  ) {
    submitState.submissions = [];
  }
  if (submitState.session) {
    void hydrateSubmitSessionIdentity(true).then(() => {
      if (!submitState.loading && !submitState.formModal && !submitState.chatModal) {
        renderSubmitPage();
      }
    });
  }
  if (!submitState.loading && !submitState.formModal && !submitState.chatModal) {
    renderSubmitPage();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  if (!document.querySelector("[data-submit-page]")) return;
  bindSubmitPage();
  window.addEventListener("truecost:session-changed", handleSubmitSessionChanged);
  void refreshSubmitPage();
});

function handleSubmitSessionChanged() {
  const nextSession = getStoredSession();
  if (sameSubmitSession(submitState.session, nextSession)) return;
  submitState.formModal = null;
  submitState.chatModal = null;
  submitState.searchUi = {
    entityRefs: { highlight: -1, closedValue: "" },
    location: { highlight: -1, closedValue: "" },
    suggestedEntity: { highlight: -1, closedValue: "" }
  };
  submitState.session = nextSession;
  submitState.sessionIdentity = null;
  void refreshSubmitPage(true);
}

function bindSubmitPage() {
  const shell = document.querySelector("[data-submit-shell]");
  if (!shell) return;

  shell.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (target.closest("[data-open-submission-modal]")) {
      const submissionId = target.getAttribute("data-open-submission-modal") || "";
      workspaceOpenSubmission(submissionId);
      return;
    }

    if (target.closest("[data-open-submission-chat]")) {
      submitState.chatModal = {
        submissionId: target.getAttribute("data-open-submission-chat") || "",
        loading: true,
        messages: []
      };
      renderSubmitPage();
      await hydrateChatModal();
      return;
    }

    const entityPick = target.closest("[data-submit-entity-pick]");
    if (entityPick) {
      applyEntityPick(entityPick);
      return;
    }

    const locationPick = target.closest("[data-submit-location-pick]");
    if (locationPick) {
      applyLocationPick(locationPick);
      return;
    }

    const suggestedEntityPick = target.closest("[data-submit-suggested-entity-pick]");
    if (suggestedEntityPick) {
      applySuggestedEntityPick(suggestedEntityPick);
      return;
    }

    const clearField = target.closest("[data-clear-submit-field]");
    if (clearField) {
      clearSubmissionField(clearField.getAttribute("data-clear-submit-field") || "");
      return;
    }

    if (target.closest("[data-submit-modal-close]")) {
      submitState.formModal = null;
      submitState.chatModal = null;
      renderSubmitPage();
    }
  });

  shell.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (form.matches("[data-submission-form]")) {
      await handleSubmissionSave(form);
      return;
    }
    if (form.matches("[data-submission-chat-form]")) {
      await handleChatSend(form);
    }
  });

  shell.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const fieldKey = resolveSubmitSearchFieldKey(target);
    if (!fieldKey) return;
    resetSubmitSearchField(fieldKey, readSubmitSearchValue(fieldKey));
    hydrateSubmissionEnhancements();
  });

  shell.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const fieldKey = resolveSubmitSearchFieldKey(target);
    if (!fieldKey) return;
    handleSubmitSearchKeydown(event, fieldKey);
  });

  shell.addEventListener("focusin", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const fieldKey = resolveSubmitSearchFieldKey(target);
    if (!fieldKey) return;
    const value = readSubmitSearchValue(fieldKey);
    if (!String(value || "").trim()) return;
    const uiState = submitSearchUiState(fieldKey);
    uiState.closedValue = "";
    hydrateSubmissionEnhancements();
  });

  shell.addEventListener("focusout", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const fieldKey = resolveSubmitSearchFieldKey(target);
    if (!fieldKey) return;
    const wrapper = target.closest(".workspace-search");
    window.setTimeout(() => {
      if (wrapper instanceof HTMLElement && wrapper.contains(document.activeElement)) return;
      closeSubmitSearchField(fieldKey);
    }, 0);
  });
}

async function refreshSubmitPage(force = false) {
  renderSubmitLoading("Opening your account...");
  submitState.session = await resolveStoredSession({
    persistSession: true
  }).catch(() => getStoredSession());
  if (!submitState.session) {
    submitState.sessionIdentity = null;
    submitState.loading = false;
    submitState.loadingMessage = "";
    submitState.publicState = submitPublicStateStore.value;
    submitState.submissions = [];
    renderSubmitPage();
    return;
  }
  await hydrateSubmitSessionIdentity(force);
  const cachedPublicState = !force ? submitPublicStateStore.value : null;
  const cachedBlocked = cachedPublicState && submitSessionAccessBlocked(cachedPublicState, submitState.sessionIdentity);
  if (cachedPublicState) {
    submitState.publicState = cachedPublicState;
    if (cachedBlocked) {
      submitState.submissions = [];
      submitState.loading = false;
      submitState.loadingMessage = "";
      renderSubmitPage();
    } else {
      renderSubmitPage();
    }
  }
  if (cachedBlocked) {
    void hydrateSubmitRemoteState(force, { allowLoadingState: false });
    return;
  }
  await hydrateSubmitRemoteState(force, { allowLoadingState: true });
}

async function hydrateSubmitRemoteState(force = false, { allowLoadingState = true } = {}) {
  if (allowLoadingState) {
    renderSubmitLoading("Looking up your submissions...");
  }
  submitState.publicState = (await submitPublicStateStore.hydrate({ force, reason: "submit-load" })).value;
  await hydrateSubmitSessionIdentity(force);
  if (submitSessionAccessBlocked(submitState.publicState, submitState.sessionIdentity)) {
    submitState.submissions = [];
    submitState.loading = false;
    submitState.loadingMessage = "";
    renderSubmitPage();
    return;
  }
  await ensureEventToolsLoaded();
  submitState.viewer = deriveIdentity(submitState.session.secretKeyHex);
  submitState.submissions = await loadUserSubmissions(submitState.session.secretKeyHex).catch(() => []);
  await maybeOpenChatFromUrl();
  submitState.loading = false;
  submitState.loadingMessage = "";
  renderSubmitPage();
}

function renderSubmitLoading(message) {
  submitState.loading = true;
  submitState.loadingMessage = message;
  renderSubmitPage();
}

function submitSessionAccessBlocked(_publicState, sessionIdentity) {
  return Boolean(sessionIdentity?.blocked);
}

function renderSubmitPage() {
  const shell = document.querySelector("[data-submit-shell]");
  const lede = document.querySelector("[data-submit-lede]");
  if (!shell) return;
  const view = renderSubmitPageView({
    submitState,
    deps: submitSurfaceDeps()
  });
  const ledeChanged = applyObservedText(lede, view.lede);
  const shellChanged = applyObservedMarkup(shell, view.shellMarkup);
  if (ledeChanged || shellChanged) {
    hydrateSubmissionEnhancements();
  }
}

function workspaceOpenSubmission(submissionId) {
  if (submissionId === "new") {
    submitState.formModal = {
      mode: "create",
      submissionId: "",
      payload: {}
    };
    renderSubmitPage();
    return;
  }
  const submission = submitState.submissions.find((item) => item.id === submissionId);
  submitState.formModal = {
    mode: "edit",
    submissionId,
    payload: submission?.latest?.payload || {}
  };
  renderSubmitPage();
}

async function handleSubmissionSave(form) {
  const status = form.querySelector("[data-submission-status]");
  try {
    await assertSubmitSessionAllowed("publish a submission");
    const next = await buildSubmissionDraft(form, submitState.formModal?.payload || {});
    if (next.pendingEntity) {
      const entity = await publishPendingEntity(next.pendingEntity);
      if (entity?.slug && !next.payload.entity_refs.includes(entity.slug)) {
        next.payload.entity_refs.push(entity.slug);
      }
      next.payload.suggested_entity = entity
        ? { slug: entity.slug, name: entity.name, location: entity.location, type: entity.type, notes: entity.notes }
        : next.payload.suggested_entity;
    }
    await publishSubmission(submitState.session.secretKeyHex, next.payload, {
      sitePubkey: activeSitePubkey()
    });
    if (status) {
      status.textContent = next.pendingEntity ? "Submission revision and pending entity published." : "Submission revision published.";
      status.dataset.state = "success";
    }
    submitState.formModal = null;
    await refreshSubmitPage(true);
  } catch (error) {
    if (status) {
      status.textContent = String(error?.message || error || "Submission failed.");
      status.dataset.state = "error";
    }
  }
}

async function hydrateChatModal() {
  if (!submitState.chatModal || !activeSitePubkey()) return;
  submitState.chatModal.loading = true;
  renderSubmitPage();
  submitState.chatModal.messages = await loadSubmissionThread(
    submitState.session.secretKeyHex,
    submitState.chatModal.submissionId,
    knownSitePubkeys()
  ).catch(() => []);
  submitState.chatModal.loading = false;
  renderSubmitPage();
}

async function maybeOpenChatFromUrl() {
  const chatId = cleanSlug(new URLSearchParams(window.location.search).get("chat") || "");
  if (!chatId) return;
  const exists = submitState.submissions.find((item) => item.id === chatId);
  if (!exists) return;
  submitState.chatModal = {
    submissionId: chatId,
    loading: true,
    messages: []
  };
  await hydrateChatModal();
}

async function handleChatSend(form) {
  await assertSubmitSessionAllowed("send submission chat");
  const formData = new FormData(form);
  const body = String(formData.get("body") || "").trim();
  if (!body) return;
  const sitePubkey = activeSitePubkey();
  if (!sitePubkey) {
    throw new Error("Submission chat is unavailable until a site inbox key is active.");
  }
  await publishSubmissionChat(submitState.session.secretKeyHex, {
    targetPubkey: sitePubkey,
    submissionId: String(formData.get("submissionId") || ""),
    body,
    role: "submitter"
  });
  await hydrateChatModal();
}

async function buildSubmissionDraft(form, existingPayload) {
  const formData = new FormData(form);
  const nextAttachment = await uploadSubmissionAttachment(formData.get("attachment"));
  const sourceLinks = String(formData.get("sourceLinks") || "")
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const suggestedEntity = buildSuggestedEntity(formData, existingPayload.suggested_entity);

  return {
    payload: {
      submission_id: String(formData.get("submissionId") || "").trim() || cleanSubject(String(formData.get("subject") || "")),
      category: String(formData.get("category") || "").trim(),
      subject: String(formData.get("subject") || "").trim(),
      location: String(formData.get("location") || "").trim(),
      details: String(formData.get("details") || "").trim(),
      entity_refs: resolveEntityRefs(String(formData.get("entityRefs") || "")),
      source_links: sourceLinks,
      contact: {
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        preferred_method: String(formData.get("contactMethod") || "").trim()
      },
      consent_to_follow_up: formData.has("consent"),
      attachment: nextAttachment || existingPayload.attachment || null,
      suggested_entity: suggestedEntity
        ? {
            slug: suggestedEntity.slug,
            name: suggestedEntity.name,
            location: suggestedEntity.location,
            type: suggestedEntity.type,
            notes: suggestedEntity.notes
          }
        : null
    },
    pendingEntity: suggestedEntity
  };
}

async function uploadSubmissionAttachment(file) {
  if (!(file instanceof File) || file.size === 0) return null;
  const sitePubkey = activeSitePubkey();
  if (!sitePubkey) {
    throw new Error("Encrypted attachments require an inbox pubkey.");
  }
  return uploadEncryptedBlob(
    submitState.session.secretKeyHex,
    sitePubkey,
    file,
    { purpose: "submission-attachment" }
  );
}

function cleanSubject(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `submission-${Date.now()}`;
}

function renderOption(value, current) {
  return `<option value="${value}" ${current === value ? "selected" : ""}>${value}</option>`;
}

function submitSurfaceDeps() {
  const sessionIdentity = submitState.sessionIdentity || null;
  return {
    escapeAttribute,
    escapeHtml,
    sessionHasStalePassword: Boolean(sessionIdentity?.staleKey),
    sessionStaleMessage: String(sessionIdentity?.staleMessage || "").trim(),
    sessionConflictMessage: String(sessionIdentity?.usernameConflictMessage || "").trim(),
    sessionHasUsernameConflict: Boolean(sessionIdentity?.usernameConflict),
    renderLoadingState,
    renderOption,
    resolveEntityDisplayValue,
    trimmed
  };
}

async function hydrateSubmitSessionIdentity(force = false) {
  if (!submitState.session) {
    submitState.sessionIdentity = null;
    return null;
  }
  const runtimeClient = await getSiteRuntimeClient().catch(() => null);
  if (!runtimeClient) return submitState.sessionIdentity;
  await runtimeClient.seedSession(submitState.session, { force: true }).catch(() => null);
  const projection = (force
    ? await runtimeClient.refreshProjection("sessionIdentity", {}, {
        reason: "submit-session-identity-refresh"
      }).catch(() => null)
    : await runtimeClient.getProjection("sessionIdentity", {}, {
        preferFresh: false,
        reason: "submit-session-identity"
      }).catch(() => null));
  submitState.sessionIdentity = projection?.value || null;
  return submitState.sessionIdentity;
}

async function assertSubmitSessionAllowed(action = "publish from this account") {
  const sessionIdentity = await hydrateSubmitSessionIdentity(true);
  if (sessionIdentity?.removed) {
    throw new Error(String(sessionIdentity.removedMessage || "").trim() || "This account has been removed.");
  }
  if (sessionIdentity?.staleKey) {
    throw new Error(String(sessionIdentity.staleMessage || "").trim() || "This session is using an older password.");
  }
  if (sessionIdentity?.usernameConflict) {
    throw new Error(
      String(sessionIdentity.usernameConflictMessage || "").trim() ||
        `This session cannot ${String(action || "use this account").trim()}.`
    );
  }
  return sessionIdentity;
}

function hydrateSubmissionEnhancements() {
  renderEntityResults();
  renderLocationResults();
  renderSuggestedEntityResults();
}

function renderEntityResults() {
  const host = submitSearchHost("entityRefs");
  const input = submitSearchInput("entityRefs");
  if (!(host instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
  const query = lastCommaValue(input.value);
  if (!query || submitSearchUiState("entityRefs").closedValue === query) {
    closeSearchResults(host);
    return;
  }
  const matches = matchEntities(query).slice(0, 6);
  host.setAttribute("data-open", "yes");
  host.innerHTML = renderSubmitSuggestionMarkup(
    matches,
    `<div class="picker-hint">No existing entity matches. Use the suggested entity fields to add a new one for review.</div>`,
    {
      kind: "entity",
      escapeAttribute,
      escapeHtml,
      highlightedIndex: submitSearchUiState("entityRefs").highlight
    }
  );
}

function renderLocationResults() {
  const host = submitSearchHost("location");
  const input = submitSearchInput("location");
  if (!(host instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
  const rawValue = input.value.trim();
  const query = rawValue.toLowerCase();
  if (!query || submitSearchUiState("location").closedValue === rawValue) {
    closeSearchResults(host);
    return;
  }
  const matches = uniqueLocations()
    .filter((location) => location.toLowerCase().includes(query))
    .slice(0, 6);
  if (!matches.length) {
    closeSearchResults(host);
    return;
  }
  host.setAttribute("data-open", "yes");
  host.innerHTML = renderSubmitSuggestionMarkup(
    matches,
    `<div class="picker-hint">No known location matches. Keep the typed value to propose a new one.</div>`,
    {
      kind: "location",
      escapeAttribute,
      escapeHtml,
      highlightedIndex: submitSearchUiState("location").highlight
    }
  );
}

function renderSuggestedEntityResults() {
  const host = submitSearchHost("suggestedEntity");
  const input = submitSearchInput("suggestedEntity");
  if (!(host instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
  const query = input.value.trim();
  if (!query || submitSearchUiState("suggestedEntity").closedValue === query) {
    closeSearchResults(host);
    return;
  }
  const matches = matchEntities(query).slice(0, 6);
  host.setAttribute("data-open", "yes");
  host.innerHTML = renderSubmitSuggestionMarkup(
    matches,
    `<div class="picker-hint">No existing entity matches. Keep the typed name to suggest a new one.</div>`,
    {
      kind: "suggested-entity",
      escapeAttribute,
      escapeHtml,
      highlightedIndex: submitSearchUiState("suggestedEntity").highlight
    }
  );
}

function applyEntityPick(button) {
  applyEntityPickValue(button.getAttribute("data-submit-entity-pick") || "");
}

function applyLocationPick(button) {
  applyLocationValue(button.getAttribute("data-submit-location-pick") || "");
}

function applySuggestedEntityPick(button) {
  applySuggestedEntityValue(button.getAttribute("data-submit-suggested-entity-pick") || "");
}

function applyEntityPickValue(slug) {
  const entity = resolveEntityByNameOrSlug(slug);
  const input = submitSearchInput("entityRefs");
  if (!entity || !(input instanceof HTMLInputElement)) return;
  const existing = resolveEntityRefs(input.value);
  input.value = `${dedupe([...existing, entity.slug]).map(resolveEntityDisplayValue).join(", ")}, `;
  closeSubmitSearchField("entityRefs");
  hydrateSubmissionEnhancements();
}

function applyLocationValue(value) {
  const input = submitSearchInput("location");
  if (!(input instanceof HTMLInputElement)) return;
  input.value = value;
  closeSubmitSearchField("location");
  hydrateSubmissionEnhancements();
}

function applySuggestedEntityValue(slug) {
  const entity = resolveEntityByNameOrSlug(slug);
  const nameInput = submitSearchInput("suggestedEntity");
  const locationInput = submitSearchInput("location");
  const typeInput = document.querySelector('[name="suggestedEntityType"]');
  const notesInput = document.querySelector('[name="suggestedEntityNotes"]');
  if (!(nameInput instanceof HTMLInputElement) || !entity) return;
  nameInput.value = entity.name || "";
  if (locationInput instanceof HTMLInputElement) locationInput.value = entity.location || "";
  if (typeInput instanceof HTMLInputElement) typeInput.value = entity.type || "";
  if (notesInput instanceof HTMLInputElement) notesInput.value = entity.notes || "";
  closeSubmitSearchField("suggestedEntity");
  closeSubmitSearchField("location");
  hydrateSubmissionEnhancements();
}

function clearSubmissionField(fieldName) {
  const input = document.querySelector(`[name="${fieldName}"]`);
  if (!(input instanceof HTMLInputElement)) return;
  input.value = "";
  const fieldKey = clearableSubmitFieldKey(fieldName);
  if (fieldKey) resetSubmitSearchField(fieldKey, "");
  hydrateSubmissionEnhancements();
}

function handleSubmitSearchKeydown(event, fieldKey) {
  const suggestions = submitSuggestions(fieldKey);
  if (!suggestions.length && event.key !== "Escape" && event.key !== "Enter") return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    submitSearchUiState(fieldKey).highlight = cycleHighlightIndex(submitSearchUiState(fieldKey).highlight, suggestions.length, 1);
    hydrateSubmissionEnhancements();
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    submitSearchUiState(fieldKey).highlight = cycleHighlightIndex(submitSearchUiState(fieldKey).highlight, suggestions.length, -1);
    hydrateSubmissionEnhancements();
    return;
  }
  if (event.key === "Enter") {
    const host = submitSearchHost(fieldKey);
    const isOpen = host instanceof HTMLElement && host.getAttribute("data-open") === "yes";
    if (!isOpen) return;
    event.preventDefault();
    const highlight = submitSearchUiState(fieldKey).highlight;
    if (highlight >= 0 && suggestions[highlight] !== undefined) {
      commitSubmitSuggestion(fieldKey, suggestions[highlight]);
      submitSearchInput(fieldKey)?.blur();
      return;
    }
    closeSubmitSearchField(fieldKey);
    submitSearchInput(fieldKey)?.blur();
    return;
  }
  if (event.key === "Escape") {
    closeSubmitSearchField(fieldKey);
  }
}

function commitSubmitSuggestion(fieldKey, suggestion) {
  if (fieldKey === "entityRefs") {
    applyEntityPickValue(suggestion?.slug || "");
    return;
  }
  if (fieldKey === "location") {
    applyLocationValue(String(suggestion || ""));
    return;
  }
  if (fieldKey === "suggestedEntity") {
    applySuggestedEntityValue(suggestion?.slug || "");
  }
}

function submitSearchUiState(fieldKey) {
  return submitState.searchUi[fieldKey];
}

function resetSubmitSearchField(fieldKey, currentValue = "") {
  const state = submitSearchUiState(fieldKey);
  if (!state) return;
  state.highlight = -1;
  if (state.closedValue && state.closedValue !== String(currentValue || "").trim()) {
    state.closedValue = "";
  }
}

function closeSubmitSearchField(fieldKey) {
  const state = submitSearchUiState(fieldKey);
  const host = submitSearchHost(fieldKey);
  const value = readSubmitSearchValue(fieldKey);
  if (state) {
    state.highlight = -1;
    state.closedValue = value;
  }
  closeSearchResults(host);
}

function resolveSubmitSearchFieldKey(target) {
  if (!(target instanceof Element)) return "";
  if (target.matches("[data-submit-entity-input]")) return "entityRefs";
  if (target.matches("[data-submit-location-input]")) return "location";
  if (target.matches("[data-submit-suggested-entity-input]")) return "suggestedEntity";
  return "";
}

function clearableSubmitFieldKey(fieldName) {
  return {
    entityRefs: "entityRefs",
    suggestedEntityName: "suggestedEntity",
    suggestedEntityLocation: "location"
  }[fieldName] || "";
}

function submitSearchInput(fieldKey) {
  const selector = {
    entityRefs: "[data-submit-entity-input]",
    location: "[data-submit-location-input]",
    suggestedEntity: "[data-submit-suggested-entity-input]"
  }[fieldKey];
  return selector ? document.querySelector(selector) : null;
}

function submitSearchHost(fieldKey) {
  const selector = {
    entityRefs: "[data-submit-entity-results]",
    location: "[data-submit-location-results]",
    suggestedEntity: "[data-submit-suggested-entity-results]"
  }[fieldKey];
  return selector ? document.querySelector(selector) : null;
}

function readSubmitSearchValue(fieldKey) {
  const input = submitSearchInput(fieldKey);
  if (!(input instanceof HTMLInputElement)) return "";
  if (fieldKey === "entityRefs") return lastCommaValue(input.value).trim();
  return input.value.trim();
}

function submitSuggestions(fieldKey) {
  if (fieldKey === "entityRefs") return matchEntities(readSubmitSearchValue(fieldKey)).slice(0, 6);
  if (fieldKey === "location") {
    const query = readSubmitSearchValue(fieldKey).toLowerCase();
    if (!query) return [];
    return uniqueLocations().filter((location) => location.toLowerCase().includes(query)).slice(0, 6);
  }
  if (fieldKey === "suggestedEntity") return matchEntities(readSubmitSearchValue(fieldKey)).slice(0, 6);
  return [];
}

function buildSuggestedEntity(formData, existingEntity) {
  const name = String(formData.get("suggestedEntityName") || "").trim();
  const location = String(formData.get("suggestedEntityLocation") || "").trim();
  const type = String(formData.get("suggestedEntityType") || "").trim();
  const notes = String(formData.get("suggestedEntityNotes") || "").trim();
  if (!name && !location && !type && !notes) return null;
  if (!name || !location) {
    throw new Error("Suggested entities need at least a name and location.");
  }
  const existing = resolveEntityByNameOrSlug(name);
  if (existing) {
    return {
      slug: existing.slug,
      name: existing.name,
      location: existing.location,
      type: existing.type,
      notes: existing.notes || notes
    };
  }
  return {
    slug: existingEntity?.slug || createUniqueSlug(name, (submitState.publicState?.entities || []).map((entity) => entity.slug)),
    name,
    location,
    type: type || "entity",
    notes
  };
}

async function publishPendingEntity(entity) {
  const existing = resolveEntityByNameOrSlug(entity.slug) || resolveEntityByNameOrSlug(entity.name);
  if (existing) return existing;
  await publishTaggedJson({
    kind: SITE.nostr.kinds.entity,
    secretKeyHex: submitState.session.secretKeyHex,
    tags: [["d", entity.slug]],
    content: {
      slug: entity.slug,
      name: entity.name,
      location: entity.location,
      type: entity.type,
      notes: entity.notes,
      status: "pending"
    }
  });
  return entity;
}

function resolveEntityRefs(value) {
  return dedupe(
    splitTags(value)
      .map((token) => resolveEntityByNameOrSlug(token)?.slug || cleanSlug(token))
      .filter(Boolean)
  );
}

function matchEntities(query) {
  const clean = String(query || "").trim().toLowerCase();
  if (!clean) return [];
  return (submitState.publicState?.approvedEntities || []).filter((entity) => {
    const haystacks = [entity.name, entity.slug, entity.location, ...(Array.isArray(entity.aliases) ? entity.aliases : [])]
      .map((value) => String(value || "").toLowerCase())
      .filter(Boolean);
    return haystacks.some((value) => value.includes(clean));
  });
}

function uniqueLocations() {
  return dedupe((submitState.publicState?.entities || []).map((entity) => entity.location));
}

function resolveEntityByNameOrSlug(value) {
  const clean = String(value || "").trim().toLowerCase();
  return (submitState.publicState?.entities || []).find(
    (entity) => entity.slug === cleanSlug(clean) || entity.name.toLowerCase() === clean
  );
}

function resolveEntityDisplayValue(value) {
  const entity = resolveEntityByNameOrSlug(value);
  return entity?.name || String(value || "");
}

function activeSitePubkey() {
  return resolveSitePubkey(submitState.publicState);
}

function knownSitePubkeys() {
  return dedupe([
    activeSitePubkey(),
    submitState.publicState?.siteInfo?.fallbackPubkey || "",
    ...((submitState.publicState?.siteInfo?.events || []).map((event) => event.site_pubkey || ""))
  ]);
}

function trimmed(value, length) {
  const text = String(value || "").trim();
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
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

function sameSubmitSession(left, right) {
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
