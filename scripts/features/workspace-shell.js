export function createWorkspaceShellController({
  state,
  deps = {},
  callbacks = {}
} = {}) {
  const runtime = {
    renderLoadingState: () => "",
    renderWorkspaceView: () => ({ title: "Workspace", lede: "", tabsMarkup: "", paneMarkup: "", overlayMarkup: "" }),
    ...deps
  };
  const hooks = {
    createSurfaceDeps: () => ({}),
    hydrateWorkspaceEnhancements: () => {},
    ...callbacks
  };

  function renderLoading(message) {
    const shell = document.querySelector("[data-workspace-shell]");
    const title = document.querySelector("[data-workspace-title]");
    const lede = document.querySelector("[data-workspace-lede]");
    if (title) title.textContent = "Workspace";
    if (lede) lede.textContent = message;
    if (shell) shell.innerHTML = runtime.renderLoadingState(message);
  }

  function captureDataState() {
    const publicState = state.publicState || {};
    return JSON.stringify({
      tab: state.activeTab,
      keyState: state.keyRequestState || "",
      users: (publicState.users || []).map((user) => `${user.pubkey}:${user.isAdmin ? 1 : 0}:${user.submissionCount || 0}:${user.commentCount || 0}`),
      pendingKeyRequests: (publicState.pendingAdminKeyRequests || []).map((request) => `${request.id}:${request.requester_pubkey}:${request.site_pubkey}`),
      submissions: (state.inboxSubmissions || []).map((submission) => `${submission.id}:${submission.latest?.status || submission.status || ""}`),
      entities: (publicState.entities || []).map((entity) => `${entity.slug}:${entity.status}`),
      drafts: (publicState.drafts || []).map((draft) => `${draft.slug}:${draft.status}:${draft.id || draft.created_at || ""}`),
      comments: (publicState.allComments || []).map((comment) => `${comment.id}:${comment.visibility || "visible"}`),
      snapshot: publicState.snapshotInfo?.id || "",
      metrics: publicState.metrics || {}
    });
  }

  function captureFocusState() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return null;
    const selector =
      active.matches("[data-comment-filter-query]")
        ? "[data-comment-filter-query]"
        : active.matches("[data-comment-filter-role]")
          ? "[data-comment-filter-role]"
          : active.matches("[data-comment-filter-karma]")
            ? "[data-comment-filter-karma]"
          : active.matches("[data-user-filter-karma]")
            ? "[data-user-filter-karma]"
            : active.matches("[data-entity-filter-query]")
              ? "[data-entity-filter-query]"
              : active.matches("[data-entity-filter-status]")
                ? "[data-entity-filter-status]"
                : active.matches("[data-entity-filter-location]")
                  ? "[data-entity-filter-location]"
                  : active.matches("[data-entity-filter-author]")
                    ? "[data-entity-filter-author]"
          : active.matches("[data-submission-filter-input]")
            ? "[data-submission-filter-input]"
            : active.matches("[data-quick-user-input]")
              ? "[data-quick-user-input]"
              : "";
    if (!selector) return null;
    const supportsSelection = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    return {
      selector,
      start: supportsSelection ? active.selectionStart : null,
      end: supportsSelection ? active.selectionEnd : null
    };
  }

  function restoreFocusState(focusState) {
    if (!focusState?.selector) return;
    const next = document.querySelector(focusState.selector);
    if (!(next instanceof HTMLElement)) return;
    next.focus({ preventScroll: true });
    if (
      (next instanceof HTMLInputElement || next instanceof HTMLTextAreaElement) &&
      Number.isInteger(focusState.start) &&
      Number.isInteger(focusState.end)
    ) {
      next.setSelectionRange(focusState.start, focusState.end);
    }
  }

  function render(options = {}) {
    const soft = Boolean(options.soft);
    const shell = document.querySelector("[data-workspace-shell]");
    const title = document.querySelector("[data-workspace-title]");
    const lede = document.querySelector("[data-workspace-lede]");
    if (!shell || !title || !lede) return;
    const surfaceDeps = hooks.createSurfaceDeps();

    const view = runtime.renderWorkspaceView({
      workspaceState: state,
      deps: surfaceDeps
    });
    title.textContent = view.title;
    lede.textContent = view.lede;

    if (!state.session) {
      shell.innerHTML = `
        <div class="workspace-tabs" data-workspace-tabs>
          ${view.tabsMarkup}
        </div>
        <div class="workspace-pane" data-workspace-pane>
          ${view.paneMarkup}
        </div>
        <div data-workspace-overlays>
          ${view.overlayMarkup}
        </div>
      `;
      return;
    }

    const tabs = shell.querySelector("[data-workspace-tabs]");
    const pane = shell.querySelector("[data-workspace-pane]");
    const overlays = shell.querySelector("[data-workspace-overlays]");
    const focusState = soft ? captureFocusState() : null;

    if (soft && tabs && pane && overlays) {
      tabs.innerHTML = view.tabsMarkup;
      pane.innerHTML = view.paneMarkup;
      overlays.innerHTML = view.overlayMarkup;
    } else {
      shell.innerHTML = `
        <div class="workspace-tabs" data-workspace-tabs>
          ${view.tabsMarkup}
        </div>
        <div class="workspace-pane" data-workspace-pane>
          ${view.paneMarkup}
        </div>
        <div data-workspace-overlays>
          ${view.overlayMarkup}
        </div>
      `;
    }
    hooks.hydrateWorkspaceEnhancements();
    if (focusState) restoreFocusState(focusState);
  }

  return {
    captureDataState,
    captureFocusState,
    render,
    renderLoading,
    restoreFocusState
  };
}
