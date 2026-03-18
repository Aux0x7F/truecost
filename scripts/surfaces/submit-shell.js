import { renderSearchField } from "../core/search-controls.js";

export function renderSubmitPageView({ submitState, deps = {} } = {}) {
  const renderLoadingState = deps.renderLoadingState || ((value) => String(value || ""));
  if (submitState.loading && submitState.session) {
    return {
      lede: submitState.loadingMessage || "Looking up your submissions...",
      shellMarkup: `
        <section class="surface-panel">
          <div class="workspace-list__row">
            <div>
              <div class="eyebrow">Submit</div>
              <h2>Your submissions</h2>
            </div>
            <button class="button" type="button" data-open-submission-modal="new">Add submission</button>
          </div>
          <div class="roster-list">
            ${renderLoadingState(submitState.loadingMessage || "Looking up your submissions...")}
          </div>
        </section>
        ${renderSubmissionModal(submitState, deps)}
        ${renderSubmissionChatModal(submitState, deps)}
      `
    };
  }

  if (submitState.loading) {
    return {
      lede: submitState.loadingMessage || "Looking up your submissions...",
      shellMarkup: renderLoadingState(submitState.loadingMessage || "Looking up your submissions...")
    };
  }

  if (!submitState.session) {
    return {
      lede: "Submission history and encrypted discussion are tied to your site identity.",
      shellMarkup: `
        <section class="surface-panel">
          <div class="eyebrow">Log in required</div>
          <h2>Use a shared account first</h2>
          <p>Submission history and encrypted discussion are tied to your site identity.</p>
          <div class="button-row">
            <a class="button" href="./admin.html?tab=login">Log in</a>
          </div>
        </section>
      `
    };
  }

  return {
    lede: "Each submission stays attached to your account, with status updates and a message thread once admins reply from the shared inbox.",
    shellMarkup: `
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
              ? submitState.submissions.map((submission) => renderSubmissionRow(submission, submitState, deps)).join("")
              : `<div class="empty-state">No submissions yet.</div>`
          }
        </div>
      </section>
      ${renderSubmissionModal(submitState, deps)}
      ${renderSubmissionChatModal(submitState, deps)}
    `
  };
}

export function renderSubmissionRow(submission, submitState, deps = {}) {
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const trimmed = deps.trimmed || ((value) => String(value || ""));
  const resolveEntityDisplayValue = deps.resolveEntityDisplayValue || ((value) => String(value || ""));
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
        <button class="button-ghost" type="button" data-open-submission-modal="${escapeAttribute(submission.id)}">Edit</button>
        <button class="button-ghost" type="button" data-open-submission-chat="${escapeAttribute(submission.id)}">Chat</button>
      </div>
    </article>
  `;
}

export function renderSubmissionModal(submitState, deps = {}) {
  if (!submitState.formModal) return "";
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const renderOption = deps.renderOption || (() => "");
  const payload = submitState.formModal.payload || {};
  const entityRefsValue = (payload.entity_refs || []).map(deps.resolveEntityDisplayValue || ((value) => String(value || ""))).join(", ");
  const suggestedLocationValue = String(payload.suggested_entity?.location || "");
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
            <span>Submission location</span>
            <input
              name="location"
              type="text"
              maxlength="160"
              placeholder="Where did this happen?"
              value="${escapeAttribute(payload.location || "")}"
            >
          </label>
          <div class="submit-form-field">
            <span class="submit-form-field__label">Related entities</span>
            ${renderSearchField({
              wrapperClass: "workspace-search submit-search-field",
              srLabel: "Related entities",
              inputAttributes: {
                name: "entityRefs",
                type: "text",
                maxlength: "240",
                autocomplete: "off",
                placeholder: "Search entities to connect this submission",
                value: entityRefsValue,
                "data-submit-entity-input": true
              },
              clearButton: entityRefsValue
                ? {
                    attributes: { "data-clear-submit-field": "entityRefs" },
                    ariaLabel: "Clear related entities"
                  }
                : null,
              resultsHtml:
                '<div class="picker-results picker-results--dropdown workspace-search__results" data-submit-entity-results></div>'
            })}
          </div>
          <label>
            <span>Details</span>
            <textarea name="details" required>${escapeHtml(payload.details || "")}</textarea>
          </label>
          <div class="submit-form-note">If the entity is missing, suggest it below and include the location you want attached to it.</div>
          <div class="tip-form__split">
            <div class="submit-form-field">
              <span class="submit-form-field__label">Suggested entity</span>
              ${renderSearchField({
                wrapperClass: "workspace-search submit-search-field",
                srLabel: "Suggested entity",
                inputAttributes: {
                  name: "suggestedEntityName",
                  type: "text",
                  maxlength: "140",
                  autocomplete: "off",
                  placeholder: "Search existing entities or name a new one",
                  value: payload.suggested_entity?.name || "",
                  "data-submit-suggested-entity-input": true
                },
                clearButton: payload.suggested_entity?.name
                  ? {
                      attributes: { "data-clear-submit-field": "suggestedEntityName" },
                      ariaLabel: "Clear suggested entity"
                    }
                  : null,
                resultsHtml:
                  '<div class="picker-results picker-results--dropdown workspace-search__results" data-submit-suggested-entity-results></div>'
              })}
            </div>
            <div class="submit-form-field">
              <span class="submit-form-field__label">Suggested entity location</span>
              ${renderSearchField({
                wrapperClass: "workspace-search submit-search-field",
                srLabel: "Suggested entity location",
                inputAttributes: {
                  name: "suggestedEntityLocation",
                  type: "text",
                  maxlength: "160",
                  autocomplete: "off",
                  placeholder: "Search known locations or type a new one",
                  value: suggestedLocationValue,
                  "data-submit-location-input": true
                },
                clearButton: suggestedLocationValue
                  ? {
                      attributes: { "data-clear-submit-field": "suggestedEntityLocation" },
                      ariaLabel: "Clear suggested entity location"
                    }
                  : null,
                resultsHtml:
                  '<div class="picker-results picker-results--dropdown workspace-search__results" data-submit-location-results></div>'
              })}
            </div>
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
          <label class="checkbox checkbox--panel">
            <input class="checkbox__input" name="consent" type="checkbox" value="yes" ${payload.consent_to_follow_up ? "checked" : ""}>
            <span class="checkbox__indicator" aria-hidden="true"></span>
            <span class="checkbox__copy">
              <strong>Allow follow-up</strong>
              <small>We may contact you if a quick clarification would help.</small>
            </span>
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

export function renderSubmissionChatModal(submitState, deps = {}) {
  if (!submitState.chatModal) return "";
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const renderLoadingState = deps.renderLoadingState || ((value) => String(value || ""));
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

export function renderSubmitSuggestionMarkup(items, emptyMarkup, deps = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const kind = deps.kind || "entity";
  const highlightedIndex = Number.isInteger(deps.highlightedIndex) ? deps.highlightedIndex : -1;
  if (!items.length) return emptyMarkup;
  return items
    .map((item, index) => {
      const highlightedClass = highlightedIndex === index ? " is-highlighted" : "";
      if (kind === "location") {
        return `
          <button class="workspace-search__option${highlightedClass}" type="button" data-submit-location-pick="${escapeAttribute(item)}" aria-selected="${highlightedIndex === index ? "true" : "false"}">
            <strong>${escapeHtml(item)}</strong>
          </button>
        `;
      }
      return `
        <button class="workspace-search__option${highlightedClass}" type="button" data-submit-${kind}-pick="${escapeAttribute(item.slug)}" aria-selected="${highlightedIndex === index ? "true" : "false"}">
          <strong>${escapeHtml(item.name)}</strong>
          <span class="workspace-search__option-meta">${escapeHtml(item.location)}</span>
        </button>
      `;
    })
    .join("");
}
