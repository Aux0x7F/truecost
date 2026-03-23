export function createWorkspacePageController({
  state,
  site,
  deps = {},
  callbacks = {}
} = {}) {
  const runtime = {
    document: globalThis.document,
    window: globalThis.window,
    getStoredSession: () => null,
    cycleHighlightIndex: (current, total, direction) => {
      if (!Number.isFinite(total) || total <= 0) return -1;
      const index = Number.isFinite(current) ? current : -1;
      const delta = direction >= 0 ? 1 : -1;
      return (index + delta + total) % total;
    },
    sessionChangedEvent: "truecost:session-changed",
    ...deps
  };
  const hooks = {
    applyEntityLocationSuggestion: () => {},
    applyEntityPick: () => {},
    applySubmissionFilterSuggestion: (value) => value,
    clearWorkspaceLinkedUser: () => {},
    clearWorkspaceUserLookup: () => {},
    createEntityModalState: () => null,
    entityLocationSuggestions: () => [],
    focusWorkspaceSearchField: () => {},
    handleAttachmentDownload: async () => {},
    handleChatSend: async () => {},
    handleCommentAction: async () => {},
    handleCommentActionForm: async () => {},
    handleDirectUserAction: async () => {},
    handleDirectUserLookup: async () => {},
    handleEntityAction: async () => {},
    handleEntitySave: async () => {},
    handleLogin: async () => {},
    handlePasswordRotation: async () => {},
    handleProfileSave: async () => {},
    handleReviewAction: async () => {},
    handleSnapshotRequest: async () => {},
    handleSubmissionAction: async () => {},
    handleUserAction: async () => {},
    handleAppendNextAvailableUsername: async () => {},
    hydrateChatModal: async () => {},
    hydrateWorkspaceEnhancements: () => {},
    markSubmissionViewed: () => {},
    refreshWorkspace: async () => {},
    renderLoginStatusPreview: () => {},
    renderWorkspace: () => {},
    scheduleUserLookup: () => {},
    setActiveTab: () => {},
    submissionFilterSuggestions: () => [],
    syncWorkspace: async () => {},
    ...callbacks
  };

  let started = false;

  function sameSession(left = null, right = null) {
    return JSON.stringify({
      username: String(left?.username || "").trim().toLowerCase(),
      pubkey: String(left?.pubkey || "").trim().toLowerCase(),
      secretKeyHex: String(left?.secretKeyHex || "").trim().toLowerCase()
    }) === JSON.stringify({
      username: String(right?.username || "").trim().toLowerCase(),
      pubkey: String(right?.pubkey || "").trim().toLowerCase(),
      secretKeyHex: String(right?.secretKeyHex || "").trim().toLowerCase()
    });
  }

  function sameLogicalSession(left = null, right = null) {
    const leftUsername = String(left?.username || "").trim().toLowerCase();
    const rightUsername = String(right?.username || "").trim().toLowerCase();
    const leftSecretKeyHex = String(left?.secretKeyHex || "").trim().toLowerCase();
    const rightSecretKeyHex = String(right?.secretKeyHex || "").trim().toLowerCase();
    if (!leftUsername && !rightUsername && !leftSecretKeyHex && !rightSecretKeyHex) return true;
    return leftUsername === rightUsername && leftSecretKeyHex === rightSecretKeyHex;
  }

  function start() {
    if (started) return false;
    if (!runtime.document?.querySelector?.("[data-workspace-page]")) return false;
    bindWorkspace();
    runtime.window?.addEventListener?.(runtime.sessionChangedEvent, handleSessionChanged);
    runtime.document?.addEventListener?.("visibilitychange", handleVisibilityChange);
    runtime.window?.addEventListener?.("focus", handleWindowFocus);
    started = true;
    void hooks.refreshWorkspace();
    return true;
  }

  async function handleSessionChanged() {
    const nextSession = runtime.getStoredSession();
    if (sameSession(state.session, nextSession)) return;
    if (sameLogicalSession(state.session, nextSession)) {
      state.session = nextSession;
      return;
    }
    state.session = nextSession;
    state.viewer = null;
    state.passwordRotationModal = null;
    await hooks.refreshWorkspace(true);
  }

  function handleVisibilityChange() {
    if (runtime.document?.visibilityState === "visible") {
      void hooks.syncWorkspace(true);
    }
  }

  function handleWindowFocus() {
    void hooks.syncWorkspace(true);
  }

  function bindWorkspace() {
    const shell = runtime.document?.querySelector?.("[data-workspace-shell]");
    if (!shell?.addEventListener) return;

    shell.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const tab = target.closest("[data-workspace-tab]");
      if (tab) {
        hooks.setActiveTab(tab.getAttribute("data-workspace-tab") || "profile");
        hooks.renderWorkspace();
        return;
      }

      const openEntityModal = target.closest("[data-open-entity-modal], [data-edit-entity]");
      if (openEntityModal) {
        state.entityModal = hooks.createEntityModalState(openEntityModal);
        hooks.renderWorkspace();
        return;
      }

      const userModalTrigger = target.closest("[data-open-user-modal]");
      if (userModalTrigger) {
        state.userModalPubkey = userModalTrigger.getAttribute("data-open-user-modal") || "";
        hooks.renderWorkspace();
        return;
      }

      const userActionTrigger = target.closest("[data-open-user-action]");
      if (userActionTrigger) {
        state.userActionModal = {
          pubkey: userActionTrigger.getAttribute("data-open-user-action") || ""
        };
        hooks.renderWorkspace();
        return;
      }

      const commentMenuTrigger = target.closest("[data-comment-menu-toggle]");
      if (commentMenuTrigger) {
        const commentId = commentMenuTrigger.getAttribute("data-comment-menu-toggle") || "";
        state.commentMenuId = state.commentMenuId === commentId ? "" : commentId;
        hooks.renderWorkspace({ soft: true });
        return;
      }

      const ownCommentMenuTrigger = target.closest("[data-own-comment-menu-toggle]");
      if (ownCommentMenuTrigger) {
        const commentId = ownCommentMenuTrigger.getAttribute("data-own-comment-menu-toggle") || "";
        state.ownCommentMenuId = state.ownCommentMenuId === commentId ? "" : commentId;
        hooks.renderWorkspace({ soft: true });
        return;
      }

      const commentActionTrigger = target.closest("[data-open-comment-action]");
      if (commentActionTrigger) {
        state.commentActionModal = {
          commentId: commentActionTrigger.getAttribute("data-open-comment-action") || "",
          mode: commentActionTrigger.getAttribute("data-comment-mode") || "moderate"
        };
        hooks.renderWorkspace();
        return;
      }

      const openSubmission = target.closest("[data-open-submission]");
      if (openSubmission) {
        const submissionId = openSubmission.getAttribute("data-open-submission") || "";
        state.submissionModal = { submissionId };
        if (state.chatModal?.submissionId && state.chatModal.submissionId !== submissionId) {
          state.chatModal = null;
        }
        hooks.renderWorkspace();
        void hooks.markSubmissionViewed(submissionId, site?.nostr?.kinds);
        return;
      }

      const submissionSuggestion = target.closest("[data-submission-filter-suggestion]");
      if (submissionSuggestion) {
        state.submissionFilters.query = hooks.applySubmissionFilterSuggestion(
          submissionSuggestion.getAttribute("data-submission-filter-suggestion") || ""
        );
        state.submissionFilterOpen = false;
        state.submissionFilterHighlight = -1;
        hooks.renderWorkspace({ soft: true });
        hooks.focusWorkspaceSearchField("[data-submission-filter-input]");
        return;
      }

      const moderationButton = target.closest("[data-user-action]");
      if (moderationButton) {
        await hooks.handleUserAction(moderationButton);
        return;
      }

      const directUserAction = target.closest("[data-quick-user-action]");
      if (directUserAction) {
        await hooks.handleDirectUserAction(directUserAction);
        return;
      }

      const clearUserLookup = target.closest("[data-clear-user-lookup]");
      if (clearUserLookup) {
        hooks.clearWorkspaceUserLookup();
        hooks.renderWorkspace({ soft: true });
        hooks.focusWorkspaceSearchField("[data-quick-user-input]");
        return;
      }

      const clearCommentFilter = target.closest("[data-clear-comment-filter]");
      if (clearCommentFilter) {
        state.commentFilters.query = "";
        hooks.clearWorkspaceLinkedUser();
        hooks.renderWorkspace({ soft: true });
        hooks.focusWorkspaceSearchField("[data-comment-filter-query]");
        return;
      }

      const clearSubmissionFilter = target.closest("[data-clear-submission-filter]");
      if (clearSubmissionFilter) {
        state.submissionFilters.query = "";
        state.submissionFilterHighlight = -1;
        state.submissionFilterOpen = false;
        hooks.renderWorkspace({ soft: true });
        hooks.focusWorkspaceSearchField("[data-submission-filter-input]");
        return;
      }

      const clearEntityFilter = target.closest("[data-clear-entity-filter]");
      if (clearEntityFilter) {
        const field = clearEntityFilter.getAttribute("data-clear-entity-filter") || "";
        if (field && Object.prototype.hasOwnProperty.call(state.entityFilters || {}, field)) {
          state.entityFilters[field] = "";
          if (field === "location") {
            state.entityLocationFilterHighlight = -1;
            state.entityLocationFilterOpen = false;
          }
          hooks.renderWorkspace({ soft: true });
          hooks.focusWorkspaceSearchField(`[data-entity-filter-${field}]`);
        }
        return;
      }

      const entityLocationSuggestion = target.closest("[data-entity-location-suggestion]");
      if (entityLocationSuggestion) {
        hooks.applyEntityLocationSuggestion(
          entityLocationSuggestion.getAttribute("data-entity-location-suggestion") || ""
        );
        hooks.renderWorkspace({ soft: true });
        hooks.focusWorkspaceSearchField("[data-entity-filter-location]");
        return;
      }

      const userStatsFilter = target.closest("[data-user-stats-filter]");
      if (userStatsFilter) {
        state.userFilters.karma = String(userStatsFilter.getAttribute("data-user-stats-filter") || "").trim().toLowerCase();
        hooks.renderWorkspace({ soft: true });
        return;
      }

      const findUserAction = target.closest("[data-find-user]");
      if (findUserAction) {
        await hooks.handleDirectUserLookup();
        return;
      }

      const passwordRotationTrigger = target.closest("[data-open-password-rotation]");
      if (passwordRotationTrigger) {
        state.passwordRotationModal = {
          status: "",
          state: "",
          pending: false
        };
        hooks.renderWorkspace();
        return;
      }

      const appendUsernameAction = target.closest("[data-append-next-available-username]");
      if (appendUsernameAction) {
        await hooks.handleAppendNextAvailableUsername(appendUsernameAction);
        return;
      }

      const entityAction = target.closest("[data-entity-action]");
      if (entityAction) {
        await hooks.handleEntityAction(entityAction);
        return;
      }

      const commentAction = target.closest("[data-comment-action]");
      if (commentAction) {
        await hooks.handleCommentAction(commentAction);
        return;
      }

      const reviewAction = target.closest("[data-review-action]");
      if (reviewAction) {
        await hooks.handleReviewAction(reviewAction);
        return;
      }

      const entityPick = target.closest("[data-entity-pick]");
      if (entityPick) {
        hooks.applyEntityPick(entityPick);
        return;
      }

      const submissionAction = target.closest("[data-submission-action]");
      if (submissionAction) {
        await hooks.handleSubmissionAction(submissionAction);
        return;
      }

      const attachmentAction = target.closest("[data-download-attachment]");
      if (attachmentAction) {
        await hooks.handleAttachmentDownload(attachmentAction);
        return;
      }

      const snapshotRequest = target.closest("[data-request-snapshot]");
      if (snapshotRequest) {
        await hooks.handleSnapshotRequest(snapshotRequest);
        return;
      }

      const openChat = target.closest("[data-open-chat]");
      if (openChat) {
        const submissionId = openChat.getAttribute("data-open-chat") || "";
        const targetPubkey = openChat.getAttribute("data-chat-target") || "";
        if (state.chatModal?.submissionId === submissionId) {
          state.chatModal = null;
          hooks.renderWorkspace({ soft: true });
          return;
        }
        state.submissionModal = { submissionId };
        state.chatModal = {
          submissionId,
          targetPubkey,
          loading: true,
          messages: []
        };
        hooks.renderWorkspace({ soft: true });
        await hooks.hydrateChatModal();
        return;
      }

      if (target.closest("[data-modal-close]")) {
        state.entityModal = null;
        state.chatModal = null;
        state.userModalPubkey = "";
        state.userActionModal = null;
        state.commentActionModal = null;
        state.submissionModal = null;
        state.passwordRotationModal = null;
        hooks.renderWorkspace();
      }
    });

    shell.addEventListener("focusin", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.matches("[data-submission-filter-input]")) {
        const nextOpen = Boolean(String(target.value || "").trim() && hooks.submissionFilterSuggestions().length);
        if (state.submissionFilterOpen !== nextOpen) {
          state.submissionFilterOpen = nextOpen;
          hooks.renderWorkspace({ soft: true });
        }
        return;
      }
      if (target.matches("[data-entity-filter-location]")) {
        const nextOpen = Boolean(
          String(target.value || "").trim() && hooks.entityLocationSuggestions().length
        );
        if (state.entityLocationFilterOpen !== nextOpen) {
          state.entityLocationFilterOpen = nextOpen;
          state.entityLocationFilterHighlight = nextOpen ? 0 : -1;
          hooks.renderWorkspace({ soft: true });
        }
      }
    });

    runtime.document?.addEventListener?.("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      let didRefresh = false;
      const activeSearch = runtime.document?.querySelector?.("[data-submission-filter-input]")?.closest(".workspace-search");
      if (!(activeSearch instanceof HTMLElement && activeSearch.contains(target)) && state.submissionFilterOpen) {
        state.submissionFilterOpen = false;
        state.submissionFilterHighlight = -1;
        didRefresh = true;
      }
      const entityLocationSearch = runtime.document?.querySelector?.("[data-entity-filter-location]")?.closest(".workspace-search");
      if (!(entityLocationSearch instanceof HTMLElement && entityLocationSearch.contains(target)) && state.entityLocationFilterOpen) {
        state.entityLocationFilterOpen = false;
        state.entityLocationFilterHighlight = -1;
        didRefresh = true;
      }
      if (didRefresh) {
        hooks.renderWorkspace({ soft: true });
      }
    });

    shell.addEventListener("submit", async (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      event.preventDefault();

      if (form.matches("[data-login-form]")) {
        await hooks.handleLogin(form);
        return;
      }
      if (form.matches("[data-profile-form]")) {
        await hooks.handleProfileSave(form);
        return;
      }
      if (form.matches("[data-password-rotation-form]")) {
        await hooks.handlePasswordRotation(form);
        return;
      }
      if (form.matches("[data-entity-form]")) {
        await hooks.handleEntitySave(form);
        return;
      }
      if (form.matches("[data-chat-form]")) {
        await hooks.handleChatSend(form);
        return;
      }
      if (form.matches("[data-comment-action-form]")) {
        await hooks.handleCommentActionForm(form);
      }
    });

    shell.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.matches("[data-entity-picker-input], [data-location-input]")) {
        hooks.hydrateWorkspaceEnhancements();
        return;
      }
      if (target.matches('[data-login-form] [name="username"], [data-login-form] [name="password"]')) {
        hooks.renderLoginStatusPreview(target.closest("form"));
        return;
      }
      if (target.matches("[data-comment-filter-query]")) {
        state.commentFilters.query = String(target.value || "");
        hooks.clearWorkspaceLinkedUser();
        hooks.renderWorkspace({ soft: true });
        return;
      }
      if (target.matches("[data-comment-filter-role]")) {
        state.commentFilters.role = String(target.value || "").trim().toLowerCase();
        hooks.renderWorkspace({ soft: true });
        return;
      }
      if (target.matches("[data-comment-filter-karma]")) {
        state.commentFilters.karma = String(target.value || "").trim().toLowerCase();
        hooks.renderWorkspace({ soft: true });
        return;
      }
      if (target.matches("[data-submission-filter-input]")) {
        state.submissionFilters.query = String(target.value || "");
        const suggestions = hooks.submissionFilterSuggestions();
        state.submissionFilterOpen = Boolean(String(target.value || "").trim() && suggestions.length);
        state.submissionFilterHighlight = suggestions.length ? 0 : -1;
        hooks.renderWorkspace({ soft: true });
        return;
      }
      if (target.matches("[data-user-filter-karma]")) {
        state.userFilters.karma = String(target.value || "").trim().toLowerCase();
        hooks.renderWorkspace({ soft: true });
        return;
      }
      if (target.matches("[data-user-filter-role]")) {
        state.userFilters.role = String(target.value || "").trim().toLowerCase();
        hooks.renderWorkspace({ soft: true });
        return;
      }
      if (target.matches("[data-entity-filter-query]")) {
        state.entityFilters.query = String(target.value || "");
        hooks.renderWorkspace({ soft: true });
        return;
      }
      if (target.matches("[data-entity-filter-status]")) {
        state.entityFilters.status = String(target.value || "").trim().toLowerCase();
        hooks.renderWorkspace({ soft: true });
        return;
      }
      if (target.matches("[data-entity-filter-location]")) {
        state.entityFilters.location = String(target.value || "");
        const suggestions = hooks.entityLocationSuggestions();
        state.entityLocationFilterOpen = Boolean(String(target.value || "").trim() && suggestions.length);
        state.entityLocationFilterHighlight = suggestions.length ? 0 : -1;
        hooks.renderWorkspace({ soft: true });
        return;
      }
      if (target.matches("[data-entity-filter-author]")) {
        state.entityFilters.author = String(target.value || "");
        hooks.renderWorkspace({ soft: true });
        return;
      }
      if (target.matches("[data-quick-user-input]")) {
        state.userLookupRequestId += 1;
        state.userLookupQuery = String(target.value || "");
        state.userLookupResult = null;
        state.userDirectStatus = "";
        state.userLookupLoading = Boolean(state.userLookupQuery.trim());
        hooks.clearWorkspaceLinkedUser();
        hooks.scheduleUserLookup();
        hooks.renderWorkspace({ soft: true });
      }
    });

    shell.addEventListener("keydown", async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.matches("[data-quick-user-input]") && event.key === "Enter") {
        event.preventDefault();
        await hooks.handleDirectUserLookup();
        return;
      }
      if (target.matches("[data-entity-filter-location]")) {
        const suggestions = hooks.entityLocationSuggestions();
        if (event.key === "ArrowDown" && suggestions.length) {
          event.preventDefault();
          state.entityLocationFilterOpen = true;
          state.entityLocationFilterHighlight = runtime.cycleHighlightIndex(state.entityLocationFilterHighlight, suggestions.length, 1);
          hooks.renderWorkspace({ soft: true });
          return;
        }
        if (event.key === "ArrowUp" && suggestions.length) {
          event.preventDefault();
          state.entityLocationFilterOpen = true;
          state.entityLocationFilterHighlight = runtime.cycleHighlightIndex(state.entityLocationFilterHighlight, suggestions.length, -1);
          hooks.renderWorkspace({ soft: true });
          return;
        }
        if (event.key === "Escape") {
          state.entityLocationFilterOpen = false;
          state.entityLocationFilterHighlight = -1;
          hooks.renderWorkspace({ soft: true });
          return;
        }
        if (event.key === "Enter" && suggestions.length) {
          event.preventDefault();
          const selected = suggestions[Math.max(0, state.entityLocationFilterHighlight)];
          hooks.applyEntityLocationSuggestion(selected);
          hooks.renderWorkspace({ soft: true });
          return;
        }
      }
      if (!target.matches("[data-submission-filter-input]")) return;
      const suggestions = hooks.submissionFilterSuggestions();
      if (event.key === "ArrowDown" && suggestions.length) {
        event.preventDefault();
        state.submissionFilterHighlight = runtime.cycleHighlightIndex(state.submissionFilterHighlight, suggestions.length, 1);
        hooks.renderWorkspace({ soft: true });
        return;
      }
      if (event.key === "ArrowUp" && suggestions.length) {
        event.preventDefault();
        state.submissionFilterHighlight = runtime.cycleHighlightIndex(state.submissionFilterHighlight, suggestions.length, -1);
        hooks.renderWorkspace({ soft: true });
        return;
      }
      if (event.key === "Escape") {
        state.submissionFilterOpen = false;
        state.submissionFilterHighlight = -1;
        hooks.renderWorkspace({ soft: true });
        return;
      }
      if (event.key === "Enter" && suggestions.length) {
        event.preventDefault();
        const selected = suggestions[Math.max(0, state.submissionFilterHighlight)];
        state.submissionFilters.query = hooks.applySubmissionFilterSuggestion(selected);
        state.submissionFilterOpen = false;
        state.submissionFilterHighlight = -1;
        hooks.renderWorkspace({ soft: true });
      }
    });
  }

  return {
    handleSessionChanged,
    handleVisibilityChange,
    handleWindowFocus,
    start
  };
}

export default createWorkspacePageController;
