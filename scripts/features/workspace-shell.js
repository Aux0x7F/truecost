import { createObservedRegionRouter } from "../core/observed-regions.js";

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
  const regions = createObservedRegionRouter();

  function renderShellMarkup(view) {
    const tabsMarkup = String(view?.tabsMarkup || "").trim();
    return `
      ${tabsMarkup ? `<div class="workspace-tabs" data-workspace-tabs>${tabsMarkup}</div>` : ""}
      <div class="workspace-pane" data-workspace-pane>
        ${view?.paneMarkup || ""}
      </div>
      <div data-workspace-overlays>
        ${view?.overlayMarkup || ""}
      </div>
    `;
  }

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
    const shell = document.querySelector("[data-workspace-shell]");
    const title = document.querySelector("[data-workspace-title]");
    const lede = document.querySelector("[data-workspace-lede]");
    if (!shell || !title || !lede) return;
    const surfaceDeps = hooks.createSurfaceDeps();

    const view = runtime.renderWorkspaceView({
      workspaceState: state,
      deps: surfaceDeps
    });
    const sharedRegions = [
      { name: "workspace-title", kind: "text", element: title, value: view.title },
      { name: "workspace-lede", kind: "text", element: lede, value: view.lede }
    ];

    if (!state.session) {
      const shellMarkup = renderShellMarkup(view);
      regions.apply(sharedRegions);
      const changed = regions.apply(
        [{ name: "workspace-shell", kind: "markup", element: shell, value: shellMarkup }],
        { force: !shell.innerHTML }
      );
      if (changed.has("workspace-shell")) {
        regions.reset();
      }
      hooks.hydrateWorkspaceEnhancements();
      return;
    }

    const tabs = shell.querySelector("[data-workspace-tabs]");
    const pane = shell.querySelector("[data-workspace-pane]");
    const overlays = shell.querySelector("[data-workspace-overlays]");
    const focusState = captureFocusState();
    const routeRegions = [
      ...sharedRegions,
      { name: "workspace-tabs", kind: "markup", element: tabs, value: view.tabsMarkup },
      { name: "workspace-pane", kind: "markup", element: pane, value: view.paneMarkup },
      { name: "workspace-overlays", kind: "markup", element: overlays, value: view.overlayMarkup }
    ];

    let changedRegions = new Set();
    if (tabs && pane && overlays) {
      changedRegions = regions.apply(routeRegions);
    } else {
      const shellMarkup = renderShellMarkup(view);
      regions.apply(sharedRegions);
      const shellChanged = regions.apply(
        [{ name: "workspace-shell", kind: "markup", element: shell, value: shellMarkup }],
        { force: true }
      );
      changedRegions = new Set([...changedRegions, ...shellChanged]);
      const nextTabs = shell.querySelector("[data-workspace-tabs]");
      const nextPane = shell.querySelector("[data-workspace-pane]");
      const nextOverlays = shell.querySelector("[data-workspace-overlays]");
      regions.reset();
      regions.remember([
        ...sharedRegions,
        { name: "workspace-tabs", kind: "markup", element: nextTabs, value: view.tabsMarkup },
        { name: "workspace-pane", kind: "markup", element: nextPane, value: view.paneMarkup },
        { name: "workspace-overlays", kind: "markup", element: nextOverlays, value: view.overlayMarkup }
      ]);
    }
    hooks.hydrateWorkspaceEnhancements();
    if (focusState && changedRegions.size) restoreFocusState(focusState);
  }

  return {
    captureDataState,
    captureFocusState,
    render,
    renderLoading,
    restoreFocusState
  };
}
