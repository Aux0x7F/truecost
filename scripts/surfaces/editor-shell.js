export function renderEditorLoadingMarkup(message, deps = {}) {
  const renderLoadingState = deps.renderLoadingState || ((value) => String(value || ""));
  return renderLoadingState(message);
}

export function renderEditorShellView({ editorState, deps = {} } = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const currentUserIsAdmin = deps.currentUserIsAdmin || (() => false);

  if (!editorState?.session) {
    return {
      title: "Log in",
      lede: "Log in with an admin account to write and review investigation drafts.",
      shellMarkup: `
        <section class="surface-panel editor-gate">
          <div class="eyebrow">Authoring</div>
          <h2>Admin access required</h2>
          <p>Investigation drafting is available to approved admins only.</p>
          <a class="button" href="./admin.html?tab=login">Log in</a>
        </section>
      `
    };
  }

  if (!currentUserIsAdmin()) {
    return {
      title: "Authoring",
      lede: "This page opens for admin accounts only.",
      shellMarkup: `
        <section class="surface-panel editor-gate">
          <div class="eyebrow">Authoring</div>
          <h2>Admin access required</h2>
          <p>This account can manage its profile and comments, but it does not have investigation authoring access.</p>
          <a class="button" href="./investigations.html">Back to investigations</a>
        </section>
      `
    };
  }

  const documentState = editorState.document || {
    title: "",
    summary: "",
    date: "",
    tags: [],
    primaryEntity: "",
    entityRefs: []
  };
  return {
    title: editorState.currentSlug ? "Edit investigation" : "Create investigation",
    lede: "Write in the full editor, let working drafts save automatically, and send finished versions into review.",
    shellMarkup: `
      <section class="surface-panel editor-studio">
        <form class="editor-form editor-form--studio" data-editor-form>
          <div class="editor-actions">
            <div class="editor-actions__copy">
              <div class="eyebrow">Investigation draft</div>
              <h2>${editorState.currentSlug ? "Continue editing" : "Start a new investigation"}</h2>
              <p>${editorState.currentSlug ? "Keep shaping the draft, then send the next version into review when it is ready." : "Write the title, summary, and full body here. Drafts save as you work and can be sent into review when they are ready."}</p>
            </div>
            <div class="editor-actions__controls">
              <div class="editor-save-state" data-editor-status aria-live="polite">Autosave is on. Snapshot saves the current draft immediately.</div>
              <div class="button-row">
                <button class="button-ghost" type="button" data-editor-save>Snapshot</button>
                <button class="button" type="button" data-editor-submit>Send to review</button>
              </div>
            </div>
          </div>

          <label class="editor-field editor-field--title">
            <span class="sr-only">Title</span>
            <input class="editor-title-input" name="title" type="text" maxlength="140" placeholder="Investigation title" value="${escapeAttribute(documentState.title)}" required>
          </label>

          <label class="editor-field editor-field--summary">
            <span class="sr-only">Summary</span>
            <textarea class="editor-summary-input" name="summary" rows="3" placeholder="Short summary for the archive card">${escapeHtml(documentState.summary)}</textarea>
          </label>

          <div class="editor-meta-grid">
            <label class="editor-field editor-field--compact">
              <span class="sr-only">Date</span>
              <input name="date" type="date" aria-label="Publication date" value="${escapeAttribute(documentState.date)}">
            </label>
            <label class="editor-field editor-field--compact">
              <span class="sr-only">Tags</span>
              <input name="tags" type="text" placeholder="Tags: records, follow-up, budget" value="${escapeAttribute((documentState.tags || []).join(", "))}">
            </label>
            <label class="editor-field editor-field--compact">
              <span class="sr-only">Lead entity</span>
              <div class="editor-picker" data-editor-picker="primaryEntity">
                <input name="primaryEntity" type="text" data-editor-entity-input="primaryEntity" autocomplete="off" placeholder="Lead entity" value="${escapeAttribute(documentState.primaryEntity)}">
                <div class="picker-results picker-results--dropdown" data-editor-entity-results="primaryEntity"></div>
              </div>
            </label>
            <label class="editor-field editor-field--compact editor-field--wide">
              <span class="sr-only">Related entities</span>
              <div class="editor-picker" data-editor-picker="entityRefs">
                <input name="entityRefs" type="text" data-editor-entity-input="entityRefs" autocomplete="off" placeholder="Related entities" value="${escapeAttribute((documentState.entityRefs || []).join(", "))}">
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
    `
  };
}

export function renderEditorModalView({ editorState, deps = {} } = {}) {
  if (editorState?.imageModal) return renderImageModalMarkup(editorState.imageModal, deps);
  if (editorState?.entityModal) return renderEntityModalMarkup(editorState.entityModal, deps);
  return "";
}

function renderEntityModalMarkup(modalState, deps = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const escapeHtml = deps.escapeHtml || ((value) => String(value || ""));
  const { seedName, seedLocation, seedType, seedNotes } = modalState;
  return `
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
            <input name="location" type="text" maxlength="160" autocomplete="address-level2" placeholder="Location" value="${escapeAttribute(seedLocation)}">
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
}

function renderImageModalMarkup(modalState, deps = {}) {
  const escapeAttribute = deps.escapeAttribute || ((value) => String(value || ""));
  const { alt, caption, placement } = modalState;
  return `
    <div class="modal-backdrop" data-editor-modal-backdrop>
      <section class="modal-card modal-card--editor" aria-label="Insert image">
        <div class="section-heading">
          <div>
            <div class="eyebrow">Image</div>
            <h3>Add an image to the investigation</h3>
            <p>Upload once, then place it directly in the draft.</p>
          </div>
          <button class="button-ghost" type="button" data-editor-modal-close>Close</button>
        </div>
        <form class="form-grid editor-image-form" data-editor-image-form>
          <label class="editor-field editor-field--wide">
            <span class="sr-only">Image file</span>
            <input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" required>
          </label>
          <label>
            <span class="sr-only">Alt text</span>
            <input name="alt" type="text" maxlength="160" placeholder="Alt text" value="${escapeAttribute(alt)}">
          </label>
          <label>
            <span class="sr-only">Placement</span>
            <select name="placement" aria-label="Image placement">
              <option value="full" ${placement === "full" ? "selected" : ""}>Full width</option>
              <option value="left" ${placement === "left" ? "selected" : ""}>Left</option>
              <option value="right" ${placement === "right" ? "selected" : ""}>Right</option>
            </select>
          </label>
          <label class="editor-field editor-field--wide">
            <span class="sr-only">Caption</span>
            <input name="caption" type="text" maxlength="180" placeholder="Caption (optional)" value="${escapeAttribute(caption)}">
          </label>
          <div class="button-row">
            <button class="button-ghost" type="button" data-editor-modal-close>Cancel</button>
            <button class="button" type="submit">Insert image</button>
          </div>
        </form>
      </section>
    </div>
  `;
}
