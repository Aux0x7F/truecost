export function createDocumentProjectionSync({
  window,
  state,
  canEdit,
  resolveDocId,
  createController,
  buildDocument,
  projectionToDocument,
  readCurrentDocument,
  createBlankDocument,
  fingerprintDocument,
  applyDocument,
  updateMetaPanel,
  restoreMessage = ""
} = {}) {
  async function ensure(force = false) {
    if (!canEdit?.()) {
      destroy();
      return null;
    }
    const docId = String(resolveDocId?.() || "").trim();
    if (!docId) {
      destroy();
      return null;
    }
    if (!force && state.documentController && state.documentControllerId === docId) {
      return state.documentController;
    }

    destroy();
    const controller = await createController?.({
      docId,
      initialDocument: buildDocument?.()
    });
    if (!controller) return null;

    state.documentController = controller;
    state.documentControllerId = docId;
    controller.subscribe((projection, meta = {}) => {
      handleProjection(projection, meta);
    });
    const opened = await controller.open();
    handleProjection(opened, { source: "open" });
    return controller;
  }

  function destroy() {
    if (state.documentSyncTimer) {
      window?.clearTimeout?.(state.documentSyncTimer);
      state.documentSyncTimer = 0;
    }
    try {
      state.documentController?.destroy?.();
    } catch {
      return;
    } finally {
      state.documentController = null;
      state.documentControllerId = "";
      state.documentProjection = null;
      state.documentProjectionFingerprint = "";
    }
  }

  function schedule(force = false, delayMs = force ? 20 : 240) {
    if (state.documentSyncTimer) window?.clearTimeout?.(state.documentSyncTimer);
    state.documentSyncTimer = window?.setTimeout?.(() => {
      state.documentSyncTimer = 0;
      void syncNow(force);
    }, delayMs) || 0;
  }

  async function syncNow(force = false) {
    if (!canEdit?.()) return;
    const controller = await ensure();
    if (!controller) return;
    const nextDocument = buildDocument?.();
    const nextFingerprint = JSON.stringify(nextDocument);
    if (!force && nextFingerprint === state.documentProjectionFingerprint) return;
    const projection = await controller.replaceDocument(nextDocument);
    state.documentProjection = projection || null;
    state.documentProjectionFingerprint = JSON.stringify(projection?.document || nextDocument);
  }

  function handleProjection(projection, meta = {}) {
    if (!projection?.document) return;
    state.documentProjection = projection;
    const nextFingerprint = JSON.stringify(projection.document);
    if (nextFingerprint === state.documentProjectionFingerprint) return;
    state.documentProjectionFingerprint = nextFingerprint;
    if (state.suppressSyncDepth > 0) return;

    const nextDocument = projectionToDocument?.(projection);
    if (!nextDocument) return;
    const currentDocument = readCurrentDocument?.() || createBlankDocument?.();
    if (
      fingerprintDocument?.(currentDocument, state.draftStatus || "draft") ===
      fingerprintDocument?.(nextDocument, state.draftStatus || "draft")
    ) {
      return;
    }
    applyDocument?.(nextDocument);
    if ((meta?.source === "open" || meta?.cached) && restoreMessage) {
      updateMetaPanel?.(restoreMessage);
    }
  }

  return {
    destroy,
    ensure,
    handleProjection,
    schedule,
    syncNow
  };
}
