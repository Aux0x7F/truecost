import { cleanSlug } from "../core/nostr.js";
import {
  STATIC_EDITABLE_PAGES,
  buildStaticPageDraftPayload,
  findPageDraftPreview,
  isPageDraft,
  latestApprovedPageDraft
} from "../core/page-drafts.js";
import { escapeHtml } from "../core/text-utils.js";
import { bindReviewPreviewPanel, renderReviewPreviewPanel } from "./review-preview.js";

export function createStaticPageEditSurface({ site, state, deps = {} } = {}) {
  const getPublicState = deps.getPublicState || (async () => null);
  const editorEntryAllowed = deps.editorEntryAllowed || (() => false);
  const loadDraftBySlug = deps.loadDraftBySlug || (async () => null);
  const connectStaticPageOverlay = deps.connectStaticPageOverlay || (async () => null);
  const getRequestSignerSecretKey = deps.getRequestSignerSecretKey || (async () => "");
  const trustedAdminPubkeys = deps.trustedAdminPubkeys || (() => []);
  const sanitizeTrustedHtml = deps.sanitizeTrustedHtml || ((value) => String(value || ""));
  const formatLocalTimestamp = deps.formatLocalTimestamp || ((value) => String(value || ""));
  const publishTaggedJson = deps.publishTaggedJson || (async () => {});
  const afterSnapshotReview = deps.afterSnapshotReview || (async () => {});
  const formatDate = deps.formatDate || ((value) => String(value || ""));

  function ensureListenersBound() {
    if (state.staticEditListenersBound) return;
    document.addEventListener("keydown", handleShortcut);
    document.addEventListener("input", handleInput, true);
    document.addEventListener("paste", handlePaste, true);
    document.addEventListener("click", handleInteraction, true);
    state.staticEditListenersBound = true;
  }

  async function init() {
    const pageId = document.body.dataset.page || "";
    if (!STATIC_EDITABLE_PAGES.has(pageId) || state.pageOverlay) return;
    const editableElements = [...document.querySelectorAll("[data-static-edit]")].filter(
      (node) => node instanceof HTMLElement
    );
    if (!editableElements.length) return;

    const publicState = await getPublicState().catch(() => null);
    if (!publicState) return;

    const committedContent = collectStaticEditContent(editableElements, sanitizeTrustedHtml);
    const publishedDraft = latestApprovedPageDraft(publicState, pageId);
    const publishedContent = publishedDraft?.page_content && typeof publishedDraft.page_content === "object"
      ? mergeStaticEditContent(publishedDraft.page_content, committedContent)
      : cloneStaticEditContent(committedContent);
    applyStaticEditContent(editableElements, publishedContent, committedContent, sanitizeTrustedHtml);

    const params = new URLSearchParams(window.location.search);
    const draftSlug = cleanSlug(params.get("draft") || "");
    if (draftSlug && editorEntryAllowed(publicState)) {
      const localPreviewDraft = findPageDraftPreview(publicState, pageId, draftSlug);
      const targetedDraft = localPreviewDraft ? null : await loadDraftBySlug(draftSlug);
      const previewDraft = localPreviewDraft || (
        targetedDraft &&
        isPageDraft(targetedDraft) &&
        cleanSlug(targetedDraft.page_id || "") === pageId
          ? targetedDraft
          : null
      );
      if (previewDraft) {
        applyStaticEditContent(editableElements, previewDraft.page_content || {}, publishedContent, sanitizeTrustedHtml);
        renderReviewPreview(previewDraft);
        return;
      }
    }

    state.pageOverlay = {
      pageId,
      elements: editableElements,
      committedContent: cloneStaticEditContent(committedContent),
      publishedContent: cloneStaticEditContent(publishedContent),
      currentContent: cloneStaticEditContent(publishedContent),
      liveContent: null,
      controller: null,
      status: "idle"
    };

    void connectLiveOverlay();

    if (!editorEntryAllowed(publicState)) return;

    const storedSnapshot = loadStaticEditSnapshot(site, pageId);
    const savedContent = cloneStaticEditContent(storedSnapshot?.content || state.pageOverlay.currentContent);
    state.staticEdit = {
      pageId,
      elements: editableElements,
      originalContent: cloneStaticEditContent(state.pageOverlay.currentContent),
      savedContent,
      history: [cloneStaticEditContent(savedContent)],
      historyIndex: 0,
      enabled: false,
      status: storedSnapshot?.savedAt
        ? `Local snapshot ready from ${formatLocalTimestamp(storedSnapshot.savedAt)}. Press Ctrl+Shift+E to resume it.`
        : "Press Ctrl+Shift+E to edit this page.",
      savedAt: Number(storedSnapshot?.savedAt || 0),
      saveState: storedSnapshot?.savedAt ? "saved" : "idle",
      pendingLiveContent: null,
      livePublishTimer: 0
    };

    renderBar();
    ensureListenersBound();
  }

  async function connectLiveOverlay() {
    const overlayState = state.pageOverlay;
    if (!overlayState?.pageId || overlayState.controller) return;

    try {
      const secretKeyHex = await getRequestSignerSecretKey();
      if (!secretKeyHex) return;
      overlayState.controller = await connectStaticPageOverlay({
        pageId: overlayState.pageId,
        secretKeyHex,
        kind: site.nostr.kinds.collabDocument,
        getTrustedPubkeys: () => trustedAdminPubkeys(state.publicState),
        canPublish: () => editorEntryAllowed(state.publicState),
        onRemoteContent: (content, detail) => handleLiveContent(content, detail),
        onStatus: (detail) => handleLiveStatus(detail)
      });
    } catch {
      return;
    }
  }

  function destroyOverlay() {
    try {
      state.pageOverlay?.controller?.destroy?.();
    } catch {
      return;
    } finally {
      state.pageOverlay = null;
    }
  }

  function handleLiveStatus(detail) {
    if (!state.pageOverlay || detail?.pageId !== state.pageOverlay.pageId) return;
    state.pageOverlay.status = String(detail?.state || "idle");
  }

  function handleLiveContent(content, detail) {
    const overlayState = state.pageOverlay;
    if (!overlayState || detail?.pageId !== overlayState.pageId) return;

    const fallback = overlayState.publishedContent || overlayState.committedContent;
    const nextContent = detail?.hasLiveContent
      ? cloneStaticEditContent(content)
      : cloneStaticEditContent(fallback);

    overlayState.liveContent = detail?.hasLiveContent ? cloneStaticEditContent(content) : null;
    overlayState.currentContent = cloneStaticEditContent(nextContent);

    if (state.staticEdit?.enabled) {
      if (!staticEditContentMatches(state.staticEdit.history[state.staticEdit.historyIndex], nextContent)) {
        state.staticEdit.pendingLiveContent = cloneStaticEditContent(nextContent);
        state.staticEdit.status = "New live page updates are available. Snapshot or leave edit mode to refresh.";
        renderBar();
      }
      return;
    }

    applyStaticEditContent(overlayState.elements, nextContent, fallback, sanitizeTrustedHtml);

    if (state.staticEdit) {
      state.staticEdit.originalContent = cloneStaticEditContent(nextContent);
      if (!state.staticEdit.savedAt) {
        state.staticEdit.savedContent = cloneStaticEditContent(nextContent);
        state.staticEdit.history = [cloneStaticEditContent(nextContent)];
        state.staticEdit.historyIndex = 0;
        state.staticEdit.saveState = "idle";
      }
      if (!state.staticEdit.enabled) {
        state.staticEdit.status = state.staticEdit.savedAt
          ? `Local snapshot ready from ${formatLocalTimestamp(state.staticEdit.savedAt)}. Press Ctrl+Shift+E to resume it.`
          : "Press Ctrl+Shift+E to edit this page.";
        renderBar();
      }
    }
  }

  function queueLivePublish() {
    const editState = state.staticEdit;
    const overlayState = state.pageOverlay;
    if (!editState?.enabled || !overlayState?.controller) return;
    if (editState.livePublishTimer) window.clearTimeout(editState.livePublishTimer);
    editState.livePublishTimer = window.setTimeout(async () => {
      editState.livePublishTimer = 0;
      try {
        const nextContent = collectStaticEditContent(editState.elements, sanitizeTrustedHtml);
        const changed = await overlayState.controller.setContent(nextContent);
        if (changed) {
          await overlayState.controller.flush?.().catch(() => null);
          overlayState.currentContent = cloneStaticEditContent(nextContent);
        }
      } catch {
        return;
      }
    }, 220);
  }

  function renderBar() {
    const editState = state.staticEdit;
    if (!editState) return;
    let bar = document.querySelector("[data-static-edit-bar]");
    if (!(bar instanceof HTMLElement)) {
      bar = document.createElement("div");
      bar.className = "static-edit-bar";
      bar.setAttribute("data-static-edit-bar", "");
      document.body.append(bar);
    }
    bar.classList.toggle("is-visible", editState.enabled);
    bar.innerHTML = `
      <div class="static-edit-bar__copy">
        <strong>Page edit mode</strong>
        <span>${escapeHtml(editState.status)}</span>
      </div>
      <div class="static-edit-bar__actions">
        <button class="button-ghost static-edit-bar__button" type="button" data-static-edit-close>Close</button>
        <button class="button-ghost static-edit-bar__button" type="button" data-static-edit-revert>Revert</button>
        <button class="button-ghost static-edit-bar__button" type="button" data-static-edit-undo ${editState.historyIndex > 0 ? "" : "disabled"}>Undo</button>
        <button class="button-ghost static-edit-bar__button" type="button" data-static-edit-redo ${editState.historyIndex < editState.history.length - 1 ? "" : "disabled"}>Redo</button>
        <button class="button static-edit-bar__button" type="button" data-static-edit-snapshot>Snapshot</button>
      </div>
    `;
  }

  function handleShortcut(event) {
    if (!state.staticEdit) return;
    if (event.key === "Escape" && state.staticEdit.enabled) {
      event.preventDefault();
      cancelChanges();
      return;
    }
    if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== "e") return;
    event.preventDefault();
    toggleMode();
  }

  function toggleMode(force) {
    const editState = state.staticEdit;
    if (!editState) return;
    const next = typeof force === "boolean" ? force : !editState.enabled;
    if (next && editState.savedAt) {
      applyStaticEditContent(editState.elements, editState.savedContent, editState.originalContent, sanitizeTrustedHtml);
    }
    editState.enabled = next;
    document.body.classList.toggle("is-static-editing", next);
    for (const element of editState.elements) {
      element.contentEditable = next ? "true" : "false";
      element.spellcheck = next;
      element.classList.toggle("static-edit-target", next);
    }
    if (!next && editState.pendingLiveContent) {
      applyStaticEditContent(editState.elements, editState.pendingLiveContent, editState.originalContent, sanitizeTrustedHtml);
      editState.originalContent = cloneStaticEditContent(editState.pendingLiveContent);
      editState.pendingLiveContent = null;
    }
    editState.status = next
      ? editState.savedAt
        ? `Editing local snapshot from ${formatLocalTimestamp(editState.savedAt)}.`
        : "Editing this page directly. Snapshot when ready."
      : editState.savedAt
        ? `Local snapshot saved ${formatLocalTimestamp(editState.savedAt)}.`
        : "Press Ctrl+Shift+E to edit this page.";
    renderBar();
  }

  function handleInteraction(event) {
    const editState = state.staticEdit;
    if (!editState) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const action = target.closest("[data-static-edit-snapshot], [data-static-edit-undo], [data-static-edit-redo], [data-static-edit-revert], [data-static-edit-close]");
    if (action instanceof HTMLElement) {
      event.preventDefault();
      if (action.hasAttribute("data-static-edit-close")) {
        cancelChanges();
        return;
      }
      if (action.hasAttribute("data-static-edit-snapshot")) {
        void saveSnapshot();
        return;
      }
      if (action.hasAttribute("data-static-edit-undo")) {
        stepHistory(-1);
        return;
      }
      if (action.hasAttribute("data-static-edit-redo")) {
        stepHistory(1);
        return;
      }
      if (action.hasAttribute("data-static-edit-revert")) {
        revertToPublished();
      }
      return;
    }

    if (!editState.enabled) return;
    const editable = target.closest("[data-static-edit]");
    if (!(editable instanceof HTMLElement)) return;
    const link = target.closest("a");
    if (link) {
      event.preventDefault();
    }
  }

  function handleInput(event) {
    const editState = state.staticEdit;
    if (!editState?.enabled) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches("[data-static-edit]")) return;
    queueHistory();
    queueLivePublish();
  }

  function handlePaste(event) {
    const editState = state.staticEdit;
    if (!editState?.enabled) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches("[data-static-edit]")) return;
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") || "";
    if (!text) return;
    document.execCommand("insertText", false, text);
  }

  function queueHistory() {
    const editState = state.staticEdit;
    if (!editState) return;
    if (editState.historyTimer) window.clearTimeout(editState.historyTimer);
    editState.historyTimer = window.setTimeout(() => {
      editState.historyTimer = 0;
      const nextContent = collectStaticEditContent(editState.elements, sanitizeTrustedHtml);
      const currentContent = editState.history[editState.historyIndex] || editState.originalContent;
      if (staticEditContentMatches(currentContent, nextContent)) return;
      editState.history = editState.history.slice(0, editState.historyIndex + 1);
      editState.history.push(cloneStaticEditContent(nextContent));
      editState.historyIndex = editState.history.length - 1;
      editState.saveState = "dirty";
      editState.status = "Unsaved page edits.";
      renderBar();
    }, 120);
  }

  function stepHistory(direction) {
    const editState = state.staticEdit;
    if (!editState) return;
    const nextIndex = editState.historyIndex + direction;
    if (nextIndex < 0 || nextIndex >= editState.history.length) return;
    editState.historyIndex = nextIndex;
    applyStaticEditContent(editState.elements, editState.history[nextIndex], editState.originalContent, sanitizeTrustedHtml);
    editState.saveState = staticEditContentMatches(editState.history[nextIndex], editState.originalContent) ? "idle" : "dirty";
    editState.status = direction < 0 ? "Undid the last page edit." : "Restored the next page edit.";
    renderBar();
  }

  function revertToPublished() {
    const editState = state.staticEdit;
    if (!editState) return;
    clearStaticEditSnapshot(site, editState.pageId);
    applyStaticEditContent(editState.elements, editState.originalContent, editState.originalContent, sanitizeTrustedHtml);
    editState.savedContent = cloneStaticEditContent(editState.originalContent);
    editState.history = [cloneStaticEditContent(editState.originalContent)];
    editState.historyIndex = 0;
    editState.savedAt = 0;
    editState.saveState = "idle";
    editState.status = "Reverted to the published page.";
    renderBar();
  }

  function cancelChanges() {
    const editState = state.staticEdit;
    if (!editState) return;
    if (editState.historyTimer) {
      window.clearTimeout(editState.historyTimer);
      editState.historyTimer = 0;
    }
    if (editState.livePublishTimer) {
      window.clearTimeout(editState.livePublishTimer);
      editState.livePublishTimer = 0;
    }
    const baseline = cloneStaticEditContent(editState.pendingLiveContent || editState.originalContent);
    applyStaticEditContent(editState.elements, baseline, editState.originalContent, sanitizeTrustedHtml);
    editState.history = [cloneStaticEditContent(editState.savedContent || baseline)];
    editState.historyIndex = 0;
    editState.saveState = editState.savedAt ? "saved" : "idle";
    editState.enabled = false;
    editState.pendingLiveContent = null;
    document.body.classList.remove("is-static-editing");
    for (const element of editState.elements) {
      element.contentEditable = "false";
      element.spellcheck = false;
      element.classList.remove("static-edit-target");
    }
    editState.status = editState.savedAt
      ? `Discarded unsaved changes. Local snapshot is still ready from ${formatLocalTimestamp(editState.savedAt)}.`
      : "Discarded unsaved changes and returned to the published page.";
    renderBar();
  }

  async function saveSnapshot() {
    const editState = state.staticEdit;
    if (!editState) return;
    const content = collectStaticEditContent(editState.elements, sanitizeTrustedHtml);
    try {
      if (editState.livePublishTimer) {
        window.clearTimeout(editState.livePublishTimer);
        editState.livePublishTimer = 0;
      }
      if (state.pageOverlay?.controller) {
        await state.pageOverlay.controller.setContent(content).catch(() => false);
        await state.pageOverlay.controller.flush?.().catch(() => null);
        state.pageOverlay.currentContent = cloneStaticEditContent(content);
        editState.originalContent = cloneStaticEditContent(content);
      }
    } catch {
      // Snapshot review should still work even if the live overlay publish path is unavailable.
    }
    const savedAt = Date.now();
    persistStaticEditSnapshot(site, editState.pageId, savedAt, content);
    editState.savedContent = cloneStaticEditContent(content);
    editState.savedAt = savedAt;
    editState.saveState = "saved";
    editState.status = `Snapshot saved locally at ${formatLocalTimestamp(savedAt)}. Sending it to review...`;
    if (!staticEditContentMatches(editState.history[editState.historyIndex], content)) {
      editState.history.push(cloneStaticEditContent(content));
      editState.historyIndex = editState.history.length - 1;
    }
    renderBar();
    try {
      const secretKeyHex = state.session?.secretKeyHex || "";
      if (!secretKeyHex) throw new Error("Log in with an admin account first.");
      const payload = buildStaticPageDraftPayload(editState.pageId, content);
      await publishTaggedJson({
        kind: site.nostr.kinds.draft,
        secretKeyHex,
        tags: [
          ["d", payload.slug],
          ["status", payload.status],
          ["content", payload.content_type],
          ["page", payload.page_id]
        ],
        content: payload
      });
      await afterSnapshotReview();
      editState.status = `Snapshot saved locally at ${formatLocalTimestamp(savedAt)} and sent to review.`;
    } catch (error) {
      editState.status = `Snapshot saved locally at ${formatLocalTimestamp(savedAt)}. Review handoff failed: ${String(error?.message || error || "Unknown error")}`;
      editState.saveState = "dirty";
    }
    renderBar();
  }

  function renderReviewPreview(draft) {
    const main = document.querySelector(".page-shell main");
    if (!(main instanceof HTMLElement)) return;
    let shell = document.querySelector("[data-static-review-shell]");
    if (!(shell instanceof HTMLElement)) {
      shell = document.createElement("section");
      shell.className = "section section--tight";
      shell.setAttribute("data-static-review-shell", "");
      main.prepend(shell);
    }
    shell.innerHTML = `<div class="wrap"><div class="surface-panel" data-static-review-panel>${renderReviewPreviewPanel(draft, { publicState: state.publicState, formatDate })}</div></div>`;
    const panel = shell.querySelector("[data-static-review-panel]");
    if (panel instanceof HTMLElement) {
      bindReviewPreviewPanel(panel, draft, async (currentDraft, button) => {
        if (typeof deps.publishReviewDecision === "function") {
          await deps.publishReviewDecision(panel, currentDraft, button);
        }
      });
    }
  }

  return {
    init,
    destroyOverlay
  };
}

export function collectStaticEditContent(elements, sanitizeTrustedHtml = (value) => String(value || "")) {
  return Object.fromEntries(
    (Array.isArray(elements) ? elements : []).map((element) => [
      element.getAttribute("data-static-edit") || "",
      sanitizeTrustedHtml(element.innerHTML)
    ])
  );
}

export function applyStaticEditContent(elements, content, fallback = {}, sanitizeTrustedHtml = (value) => String(value || "")) {
  for (const element of Array.isArray(elements) ? elements : []) {
    const key = element.getAttribute("data-static-edit") || "";
    const primaryValue = resolveStaticEditValue(content, key);
    element.innerHTML = primaryValue.length
      ? sanitizeTrustedHtml(primaryValue)
      : sanitizeTrustedHtml(resolveStaticEditValue(fallback, key));
  }
}

export function mergeStaticEditContent(content, fallback = {}) {
  const merged = cloneStaticEditContent(fallback);
  for (const [key, value] of Object.entries(content && typeof content === "object" ? content : {})) {
    const resolved = resolveStaticEditValue({ [key]: value }, key);
    if (resolved.length) {
      merged[key] = resolved;
    }
  }
  return merged;
}

export function resolveStaticEditValue(content, key) {
  if (!Object.prototype.hasOwnProperty.call(content || {}, key)) return "";
  const raw = String(content[key] ?? "");
  return hasMeaningfulStaticEditValue(raw) ? raw : "";
}

export function hasMeaningfulStaticEditValue(value) {
  return stripHtml(String(value || "").replace(/&nbsp;/gi, " ").replace(/<br\s*\/?>/gi, " ")).length > 0;
}

export function loadStaticEditSnapshot(site, pageId) {
  try {
    const raw = window.localStorage.getItem(staticEditStorageKey(site, pageId));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && parsed.content ? parsed : null;
  } catch {
    return null;
  }
}

export function clearStaticEditSnapshot(site, pageId) {
  window.localStorage.removeItem(staticEditStorageKey(site, pageId));
}

export function persistStaticEditSnapshot(site, pageId, savedAt, content) {
  window.localStorage.setItem(staticEditStorageKey(site, pageId), JSON.stringify({
    pageId,
    savedAt,
    content
  }));
}

export function staticEditStorageKey(site, pageId) {
  return `${site.nostr.storageNamespace}.static-edit.${pageId}`;
}

export function staticEditContentMatches(left, right) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

export function cloneStaticEditContent(content) {
  return JSON.parse(JSON.stringify(content || {}));
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
