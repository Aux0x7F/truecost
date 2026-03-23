export function createEditorLiveOverlayController({
  window,
  state,
  connectStructuredUnitOverlay,
  kind,
  resolveSlug,
  investigationDocumentId,
  currentUserIsAdmin,
  trustedAdminPubkeys,
  buildDraftPayload,
  draftToDocument,
  fingerprintDocument,
  readCurrentDocument,
  applyDocument,
  updateMetaPanel
} = {}) {
  async function ensure() {
    if (!state.session || !currentUserIsAdmin?.()) return;
    const slug = resolveSlug?.();
    if (!slug) return;
    const documentId = investigationDocumentId?.(slug);
    if (!documentId) return;
    if (state.liveController && state.liveDocumentId === documentId) return;
    destroy();
    state.liveDocumentId = documentId;
    state.liveController = await connectStructuredUnitOverlay?.({
      documentId,
      secretKeyHex: state.session.secretKeyHex,
      kind,
      getTrustedPubkeys: trustedAdminPubkeys,
      canPublish: currentUserIsAdmin,
      onRemoteContent: handleContent,
      onStatus: handleStatus
    });
    const initialContent = state.liveController?.getContent?.() || {};
    if (Object.keys(initialContent).length) {
      handleContent(initialContent, {
        documentId,
        hasLiveContent: true,
        origin: "initial"
      });
    }
  }

  function destroy() {
    if (state.livePublishTimer) {
      window?.clearTimeout?.(state.livePublishTimer);
      state.livePublishTimer = 0;
    }
    try {
      state.liveController?.destroy?.();
    } catch {
      return;
    } finally {
      state.liveController = null;
      state.liveDocumentId = "";
      state.liveStatus = "idle";
    }
  }

  function schedule(delayMs = 260) {
    if (state.livePublishTimer) window?.clearTimeout?.(state.livePublishTimer);
    state.livePublishTimer = window?.setTimeout?.(async () => {
      state.livePublishTimer = 0;
      if (!state.session || !currentUserIsAdmin?.()) return;
      await ensure().catch(() => null);
      if (!state.liveController) return;
      const payload = buildDraftPayload?.(state.draftStatus || "draft");
      if (!payload?.title?.trim() && !payload?.markdown?.trim()) return;
      await state.liveController.setContent(payload).catch(() => false);
      await state.liveController.flush?.().catch(() => null);
    }, delayMs) || 0;
  }

  function handleStatus(detail) {
    if (detail?.documentId !== state.liveDocumentId) return;
    state.liveStatus = String(detail?.state || "idle");
  }

  function handleContent(content, detail) {
    if (detail?.documentId !== state.liveDocumentId || !detail?.hasLiveContent) return;
    const nextDocument = draftToDocument?.(content);
    if (!nextDocument) return;
    if (
      fingerprintDocument?.(nextDocument, state.draftStatus || "draft") ===
      fingerprintDocument?.(readCurrentDocument?.(), state.draftStatus || "draft")
    ) {
      return;
    }
    applyDocument?.(nextDocument);
    updateMetaPanel?.("Applied live updates from another admin.");
  }

  return {
    destroy,
    ensure,
    handleContent,
    handleStatus,
    schedule
  };
}
