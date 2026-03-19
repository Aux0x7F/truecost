export function createWorkspaceInboxController({
  state,
  accessController,
  deps = {},
  callbacks = {}
} = {}) {
  const runtime = {
    loadSubmissionThread: async () => [],
    publishSubmissionChat: async () => {},
    publishTaggedJson: async () => {},
    safeJson: JSON.parse,
    ...deps
  };
  const hooks = {
    deriveSubmissionReviewState: () => ({}),
    hydrateInboxSubmissions: async () => {},
    refreshWorkspace: async () => {},
    renderWorkspace: () => {},
    ...callbacks
  };

  async function hydrateChatModal() {
    if (!state.chatModal || !accessController.hasInboxAccess()) return;
    state.chatModal.loading = true;
    hooks.renderWorkspace();
    state.chatModal.messages = await runtime.loadSubmissionThread(
      state.siteKeyShares,
      state.chatModal.submissionId,
      state.chatModal.targetPubkey
    ).catch(() => []);
    state.chatModal.loading = false;
    hooks.renderWorkspace();
  }

  async function maybeOpenAdminChatFromUrl() {
    if (!accessController.hasInboxAccess()) return;
    const params = new URLSearchParams(window.location.search);
    const submissionId = String(params.get("chat") || "").trim().toLowerCase();
    const targetPubkey = String(params.get("with") || "").trim().toLowerCase();
    if (!submissionId) return;
    const submission = state.inboxSubmissions.find((item) => item.id === submissionId);
    if (!submission) return;
    const nextTargetPubkey = targetPubkey || submission.author;
    if (
      state.chatModal?.submissionId === submissionId &&
      state.chatModal?.targetPubkey === nextTargetPubkey
    ) {
      return;
    }
    state.submissionModal = { submissionId };
    state.chatModal = {
      submissionId,
      targetPubkey: nextTargetPubkey,
      loading: true,
      messages: []
    };
    hooks.renderWorkspace();
    await hydrateChatModal();
  }

  async function markSubmissionViewed(submissionId, siteKinds) {
    if (!accessController.isAdmin() || !state.session) return;
    const item = state.inboxSubmissions.find((entry) => entry.id === submissionId);
    if (!item) return;
    const reviewState = hooks.deriveSubmissionReviewState(item);
    if (reviewState.viewerViewed) return;
    await runtime.publishTaggedJson({
      kind: siteKinds.submissionStatus,
      secretKeyHex: state.session.secretKeyHex,
      tags: [["d", submissionId], ["p", item.author]],
      content: {
        submission_id: submissionId,
        author_pubkey: item.author,
        status: "viewed"
      }
    }).catch(() => {});
    window.setTimeout(() => void hooks.refreshWorkspace(true), 600);
  }

  async function handleChatSend(form) {
    if (!accessController.hasInboxAccess()) return;
    const formData = new FormData(form);
    const body = String(formData.get("body") || "").trim();
    if (!body) return;
    if (!state.siteKeyShare) {
      window.alert("This admin account does not have the current inbox key yet.");
      return;
    }
    await runtime.publishSubmissionChat(state.siteKeyShare.siteSecretKeyHex, {
      targetPubkey: String(formData.get("targetPubkey") || ""),
      submissionId: String(formData.get("submissionId") || ""),
      body,
      role: "admin"
    });
    await hydrateChatModal();
  }

  return {
    handleChatSend,
    hydrateChatModal,
    markSubmissionViewed,
    maybeOpenAdminChatFromUrl
  };
}
