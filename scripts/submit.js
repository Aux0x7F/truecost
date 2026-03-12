import SITE from "./core/site-config.js";
import { createUniqueSlug, splitTags } from "./core/content-utils.js";
import {
  cleanSlug,
  deriveIdentity,
  uploadEncryptedBlob,
  ensureEventToolsLoaded,
  loadPublicState,
  loadSubmissionThread,
  loadUserSubmissions,
  publishTaggedJson,
  publishSubmission,
  publishSubmissionChat,
  resolveSitePubkey
} from "./core/nostr.js";
import { getStoredSession } from "./core/session.js";

const submitState = {
  session: getStoredSession(),
  viewer: null,
  publicState: null,
  submissions: [],
  formModal: null,
  chatModal: null
};

document.addEventListener("DOMContentLoaded", () => {
  if (!document.querySelector("[data-submit-page]")) return;
  bindSubmitPage();
  void refreshSubmitPage();
});

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
    if (target.matches("[data-submit-entity-input], [data-submit-location-input]")) {
      hydrateSubmissionEnhancements();
    }
  });
}

async function refreshSubmitPage(force = false) {
  submitState.session = getStoredSession();
  if (!submitState.session) {
    renderSubmitPage();
    return;
  }
  renderSubmitLoading("Looking up your submissions...");
  await ensureEventToolsLoaded();
  submitState.viewer = deriveIdentity(submitState.session.secretKeyHex);
  submitState.publicState = await loadPublicState(force);
  submitState.submissions = await loadUserSubmissions(submitState.session.secretKeyHex).catch(() => []);
  renderSubmitPage();
}

function renderSubmitLoading(message) {
  const shell = document.querySelector("[data-submit-shell]");
  const lede = document.querySelector("[data-submit-lede]");
  if (lede) lede.textContent = message;
  if (shell) shell.innerHTML = renderLoadingState(message);
}

function renderSubmitPage() {
  const shell = document.querySelector("[data-submit-shell]");
  const lede = document.querySelector("[data-submit-lede]");
  if (!shell || !lede) return;

  if (!submitState.session) {
    lede.textContent = "Log in to submit material, track status changes, and keep a private thread attached to each submission.";
    shell.innerHTML = `
      <section class="surface-panel">
        <div class="eyebrow">Log in required</div>
        <h2>Use a shared account first</h2>
        <p>Submission history and encrypted discussion are tied to your site identity.</p>
        <div class="button-row">
          <a class="button" href="./admin.html?tab=login">Log in</a>
        </div>
      </section>
    `;
    return;
  }

  lede.textContent = "Each submission stays attached to your account, with status updates and a message thread once admins reply from the shared inbox.";
  shell.innerHTML = `
    <section class="surface-panel">
      <div class="workspace-list__row">
        <div>
          <div class="eyebrow">Submit</div>
          <h2>Your submissions</h2>
        </div>
        <button class="button" type="button" data-open-submission-modal="new">Add submission</button>
      </div>
      <div class="roster-list">
        ${
          submitState.submissions.length
            ? submitState.submissions.map((submission) => renderSubmissionRow(submission)).join("")
            : `<div class="empty-state">No submissions yet.</div>`
        }
      </div>
    </section>
    ${renderSubmissionModal()}
    ${renderSubmissionChatModal()}
  `;
  hydrateSubmissionEnhancements();
}

function renderSubmissionRow(submission) {
  const latest = submission.latest?.payload || {};
  const status = submitState.publicState?.submissionStatuses.get(submission.id)?.status || "received";
  const entityRefs = Array.isArray(latest.entity_refs) ? latest.entity_refs : [];
  return `
    <article class="roster-item">
      <div class="workspace-list__row">
        <div>
          <strong>${escapeHtml(latest.subject || "Untitled submission")}</strong>
          <span>${escapeHtml(latest.location || "No location supplied")}</span>
        </div>
        <div class="tag-row">
          <span class="tag">${escapeHtml(status)}</span>
        </div>
      </div>
      <span>${escapeHtml(trimmed(latest.details || "", 180))}</span>
      ${
        entityRefs.length
          ? `<span class="muted-text">Entities: ${escapeHtml(entityRefs.map(resolveEntityDisplayValue).join(", "))}</span>`
          : ""
      }
      <div class="button-row button-row--tight">
        <button class="button-ghost" type="button" data-open-submission-modal="${submission.id}">Edit</button>
        <button class="button-ghost" type="button" data-open-submission-chat="${submission.id}">Chat</button>
      </div>
    </article>
  `;
}

function renderSubmissionModal() {
  if (!submitState.formModal) return "";
  const payload = submitState.formModal.payload || {};
  return `
    <div class="modal-backdrop">
      <section class="modal-card modal-card--wide">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Submission</div>
            <h2>${submitState.formModal.mode === "edit" ? "Edit submission" : "Add submission"}</h2>
          </div>
          <button class="button-ghost" type="button" data-submit-modal-close>Close</button>
        </div>
        <form class="tip-form" data-submission-form>
          <input name="submissionId" type="hidden" value="${escapeAttribute(submitState.formModal.submissionId || "")}">
          <div class="tip-form__split">
            <label>
              <span>Submission type</span>
              <select name="category">
                ${renderOption("tip", payload.category)}
                ${renderOption("document", payload.category)}
                ${renderOption("subsidy-audit", payload.category)}
                ${renderOption("policing-record", payload.category)}
              </select>
            </label>
            <label>
              <span>Subject</span>
              <input name="subject" type="text" maxlength="140" value="${escapeAttribute(payload.subject || "")}" required>
            </label>
          </div>
          <label>
            <span>Location or agency</span>
            <input name="location" type="text" maxlength="160" value="${escapeAttribute(payload.location || "")}">
          </label>
          <label>
            <span>Related entities</span>
            <input name="entityRefs" type="text" data-submit-entity-input placeholder="Search existing entities or list comma-separated names" value="${escapeAttribute((payload.entity_refs || []).map(resolveEntityDisplayValue).join(", "))}">
            <div class="picker-results" data-submit-entity-results></div>
          </label>
          <label>
            <span>Details</span>
            <textarea name="details" required>${escapeHtml(payload.details || "")}</textarea>
          </label>
          <div class="status-box">If the entity is not listed yet, suggest a new one below for admin review.</div>
          <div class="tip-form__split">
            <label>
              <span>Suggested entity name</span>
              <input name="suggestedEntityName" type="text" maxlength="140" value="${escapeAttribute(payload.suggested_entity?.name || "")}">
            </label>
            <label>
              <span>Suggested entity location</span>
              <input name="suggestedEntityLocation" type="text" maxlength="160" data-submit-location-input value="${escapeAttribute(payload.suggested_entity?.location || "")}">
              <div class="picker-results" data-submit-location-results></div>
            </label>
          </div>
          <div class="tip-form__split">
            <label>
              <span>Suggested entity type</span>
              <input name="suggestedEntityType" type="text" maxlength="80" placeholder="facility, office, store" value="${escapeAttribute(payload.suggested_entity?.type || "")}">
            </label>
            <label>
              <span>Suggested entity note</span>
              <input name="suggestedEntityNotes" type="text" maxlength="200" value="${escapeAttribute(payload.suggested_entity?.notes || "")}">
            </label>
          </div>
          <label>
            <span>Source links</span>
            <textarea name="sourceLinks">${escapeHtml((payload.source_links || []).join("\n"))}</textarea>
          </label>
          <div class="tip-form__split">
            <label>
              <span>Name</span>
              <input name="name" type="text" maxlength="120" value="${escapeAttribute(payload.contact?.name || "")}">
            </label>
            <label>
              <span>Email</span>
              <input name="email" type="email" maxlength="160" value="${escapeAttribute(payload.contact?.email || "")}">
            </label>
          </div>
          <div class="tip-form__split">
            <label>
              <span>Preferred contact method</span>
              <input name="contactMethod" type="text" maxlength="120" value="${escapeAttribute(payload.contact?.preferred_method || "")}">
            </label>
            <label>
              <span>Attachment</span>
              <input name="attachment" type="file" accept=".txt,.md,.csv,.json,.pdf,.png,.jpg,.jpeg">
            </label>
          </div>
          <label class="checkbox">
            <input name="consent" type="checkbox" value="yes" ${payload.consent_to_follow_up ? "checked" : ""}>
            <span>The project may follow up if clarification is needed.</span>
          </label>
          <div class="button-row">
            <button class="button" type="submit">Save submission</button>
          </div>
          <div class="status-box" data-submission-status>${payload.attachment?.name ? `Current attachment: ${escapeHtml(payload.attachment.name)}` : "Attachments are encrypted before upload."}</div>
        </form>
      </section>
    </div>
  `;
}

function renderSubmissionChatModal() {
  if (!submitState.chatModal) return "";
  const submission = submitState.submissions.find((item) => item.id === submitState.chatModal.submissionId);
  const messages = submitState.chatModal.messages || [];
  const loading = submitState.chatModal.loading;
  return `
    <div class="modal-backdrop">
      <section class="modal-card modal-card--wide">
        <div class="workspace-list__row">
          <div>
            <div class="eyebrow">Submission chat</div>
            <h2>${escapeHtml(submission?.latest?.payload?.subject || submitState.chatModal.submissionId)}</h2>
          </div>
          <button class="button-ghost" type="button" data-submit-modal-close>Close</button>
        </div>
        <div class="chat-thread">
          ${
            loading
              ? renderLoadingState("Looking up chat...")
              : messages.length
              ? messages
                  .map(
                    (message) => `
                      <article class="chat-message ${message.author === submitState.viewer?.pubkey ? "is-self" : ""}">
                        <strong>${message.author === submitState.viewer?.pubkey ? "You" : "Admin"}</strong>
                        <p>${escapeHtml(message.payload.body || "")}</p>
                      </article>
                    `
                  )
                  .join("")
              : `<div class="empty-state">No messages yet.</div>`
          }
        </div>
        <form class="tip-form" data-submission-chat-form>
          <input name="submissionId" type="hidden" value="${escapeAttribute(submitState.chatModal.submissionId)}">
          <label>
            <span>Reply</span>
            <textarea name="body" placeholder="Write a message to admins" required></textarea>
          </label>
          <div class="button-row">
            <button class="button" type="submit">Send message</button>
          </div>
        </form>
      </section>
    </div>
  `;
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

async function handleChatSend(form) {
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

function hydrateSubmissionEnhancements() {
  renderEntityResults();
  renderLocationResults();
}

function renderEntityResults() {
  const host = document.querySelector("[data-submit-entity-results]");
  const input = document.querySelector("[data-submit-entity-input]");
  if (!(host instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
  const query = lastCommaValue(input.value);
  const matches = matchEntities(query).slice(0, 6);
  if (!query) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = matches.length
    ? matches
        .map(
          (entity) => `
            <button class="picker-chip" type="button" data-submit-entity-pick="${escapeAttribute(entity.slug)}">
              <strong>${escapeHtml(entity.name)}</strong>
              <span>${escapeHtml(entity.location)}</span>
            </button>
          `
        )
        .join("")
    : `<div class="picker-hint">No existing entity matches. Use the suggested entity fields to add a new one for review.</div>`;
}

function renderLocationResults() {
  const host = document.querySelector("[data-submit-location-results]");
  const input = document.querySelector("[data-submit-location-input]");
  if (!(host instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;
  const query = input.value.trim().toLowerCase();
  const matches = uniqueLocations()
    .filter((location) => !query || location.toLowerCase().includes(query))
    .slice(0, 6);
  if (!query && !matches.length) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = matches.length
    ? matches
        .map(
          (location) => `
            <button class="picker-chip" type="button" data-submit-location-pick="${escapeAttribute(location)}">
              <strong>${escapeHtml(location)}</strong>
            </button>
          `
        )
        .join("")
    : `<div class="picker-hint">No known location matches. Keep the typed value to propose a new one.</div>`;
}

function applyEntityPick(button) {
  const slug = button.getAttribute("data-submit-entity-pick") || "";
  const entity = resolveEntityByNameOrSlug(slug);
  const input = document.querySelector("[data-submit-entity-input]");
  if (!entity || !(input instanceof HTMLInputElement)) return;
  const existing = resolveEntityRefs(input.value);
  input.value = dedupe([...existing, entity.slug]).map(resolveEntityDisplayValue).join(", ");
  hydrateSubmissionEnhancements();
}

function applyLocationPick(button) {
  const value = button.getAttribute("data-submit-location-pick") || "";
  const input = document.querySelector("[data-submit-location-input]");
  if (!(input instanceof HTMLInputElement)) return;
  input.value = value;
  hydrateSubmissionEnhancements();
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

function lastCommaValue(value) {
  return String(value || "").split(",").pop().trim();
}

function dedupe(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function trimmed(value, length) {
  const text = String(value || "").trim();
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "");
}

function renderLoadingState(message) {
  return `
    <div class="loading-state loading-state--panel" role="status" aria-live="polite">
      <span class="loading-spinner" aria-hidden="true"></span>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}
