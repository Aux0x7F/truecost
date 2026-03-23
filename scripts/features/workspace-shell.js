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

  function ensureShellRegions(shell) {
    if (!(shell instanceof HTMLElement)) {
      return {
        shell: null,
        tabs: null,
        pane: null,
        overlays: null
      };
    }
    let tabs = shell.querySelector("[data-workspace-tabs]");
    let pane = shell.querySelector("[data-workspace-pane]");
    let overlays = shell.querySelector("[data-workspace-overlays]");
    if (!(tabs instanceof HTMLElement)) {
      tabs = document.createElement("div");
      tabs.className = "workspace-tabs";
      tabs.setAttribute("data-workspace-tabs", "");
      shell.prepend(tabs);
    }
    if (!(pane instanceof HTMLElement)) {
      pane = document.createElement("div");
      pane.className = "workspace-pane";
      pane.setAttribute("data-workspace-pane", "");
      if (tabs.nextSibling) {
        shell.insertBefore(pane, tabs.nextSibling);
      } else {
        shell.append(pane);
      }
    }
    if (!(overlays instanceof HTMLElement)) {
      overlays = document.createElement("div");
      overlays.setAttribute("data-workspace-overlays", "");
      shell.append(overlays);
    }
    return { shell, tabs, pane, overlays };
  }

  function renderLoading(message) {
    const shell = document.querySelector("[data-workspace-shell]");
    const title = document.querySelector("[data-workspace-title]");
    const lede = document.querySelector("[data-workspace-lede]");
    const regionsState = ensureShellRegions(shell);
    if (title) title.textContent = "Workspace";
    if (lede) lede.textContent = message;
    regions.apply([
      { name: "workspace-title", kind: "text", element: title, value: "Workspace" },
      { name: "workspace-lede", kind: "text", element: lede, value: message },
      { name: "workspace-tabs", kind: "markup", element: regionsState.tabs, value: "" },
      { name: "workspace-pane", kind: "markup", element: regionsState.pane, value: runtime.renderLoadingState(message) },
      { name: "workspace-overlays", kind: "markup", element: regionsState.overlays, value: "" }
    ]);
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
    const regionState = ensureShellRegions(shell);
    const surfaceDeps = hooks.createSurfaceDeps();

    const view = runtime.renderWorkspaceView({
      workspaceState: state,
      deps: surfaceDeps
    });
    const sharedRegions = [
      { name: "workspace-title", kind: "text", element: title, value: view.title },
      { name: "workspace-lede", kind: "text", element: lede, value: view.lede }
    ];

    const focusState = captureFocusState();
    const routeRegions = [
      ...sharedRegions,
      { name: "workspace-tabs", kind: "markup", element: regionState.tabs, value: view.tabsMarkup },
      { name: "workspace-pane", kind: "markup", element: regionState.pane, value: view.paneMarkup },
      { name: "workspace-overlays", kind: "markup", element: regionState.overlays, value: view.overlayMarkup }
    ];

    const changedRegions = regions.apply(routeRegions);
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
