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

  function renderShellMarkup(view, { showHeader = false } = {}) {
    const groupMarkup = String(view?.groupMarkup || "").trim();
    const tabsMarkup = String(view?.tabsMarkup || "").trim();
    const title = String(view?.title || "").trim();
    const lede = String(view?.lede || "").trim();
    return `
      ${
        showHeader
          ? `
            <div class="workspace-page__header" data-workspace-header>
              <div class="eyebrow">Account</div>
              <h1 data-workspace-header-title>${title}</h1>
              <p class="workspace-page__lede" data-workspace-header-lede>${lede}</p>
            </div>
          `
          : ""
      }
      ${groupMarkup ? `<div class="workspace-switcher" data-workspace-groups>${groupMarkup}</div>` : ""}
      ${tabsMarkup ? `<div class="workspace-tabs" data-workspace-tabs>${tabsMarkup}</div>` : ""}
      <div class="workspace-pane" data-workspace-pane>
        ${view?.paneMarkup || ""}
      </div>
      <div data-workspace-overlays>
        ${view?.overlayMarkup || ""}
      </div>
    `;
  }

  function queryShellRegions(shell) {
    return {
      headerTitle: shell?.querySelector("[data-workspace-header-title]") || null,
      headerLede: shell?.querySelector("[data-workspace-header-lede]") || null,
      groups: shell?.querySelector("[data-workspace-groups]") || null,
      tabs: shell?.querySelector("[data-workspace-tabs]") || null,
      pane: shell?.querySelector("[data-workspace-pane]") || null,
      overlays: shell?.querySelector("[data-workspace-overlays]") || null
    };
  }

  function renderLoading(message) {
    const shell = document.querySelector("[data-workspace-shell]");
    if (!shell) return;
    shell.innerHTML = renderShellMarkup(
      {
        title: state.session ? "Loading workspace" : "Log in",
        lede: message,
        paneMarkup: runtime.renderLoadingState(message),
        overlayMarkup: ""
      },
      { showHeader: !state.session }
    );
  }

  function captureDataState() {
    const publicState = state.publicState || {};
    return JSON.stringify({
      tab: state.activeTab,
      keyState: state.keyRequestState || "",
      users: (publicState.users || []).map((user) => `${user.pubkey}:${user.isAdmin ? 1 : 0}:${user.submissionCount || 0}:${user.commentCount || 0}`),
      pendingKeyRequests: (publicState.pendingAdminKeyRequests || []).map((request) => `${request.id}:${request.requester_pubkey}:${request.site_pubkey}`),
      submissions: (state.inboxSubmissions || []).map((submission) => `${submission.id}:${submission.latest?.status || submission.status || ""}`),
      publishedPosts: (state.publishedPosts || []).map((post) => `${post.slug}:${post.date || ""}`),
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
    if (!shell) return;
    const surfaceDeps = hooks.createSurfaceDeps();
    const showHeader = !state.session;

    const view = runtime.renderWorkspaceView({
      workspaceState: state,
      deps: surfaceDeps
    });
    const elements = queryShellRegions(shell);

    if (!state.session) {
      const shellMarkup = renderShellMarkup(view, { showHeader });
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

    const focusState = captureFocusState();
    const routeRegions = [
      { name: "workspace-groups", kind: "markup", element: elements.groups, value: view.groupMarkup },
      { name: "workspace-tabs", kind: "markup", element: elements.tabs, value: view.tabsMarkup },
      { name: "workspace-pane", kind: "markup", element: elements.pane, value: view.paneMarkup },
      { name: "workspace-overlays", kind: "markup", element: elements.overlays, value: view.overlayMarkup }
    ];
    const needsShellReset =
      Boolean(elements.headerTitle || elements.headerLede) ||
      !elements.pane ||
      !elements.overlays ||
      (String(view.groupMarkup || "").trim() && !elements.groups) ||
      (String(view.tabsMarkup || "").trim() && !elements.tabs);

    let changedRegions = new Set();
    if (!needsShellReset) {
      changedRegions = regions.apply(routeRegions);
    } else {
      const shellMarkup = renderShellMarkup(view, { showHeader });
      const shellChanged = regions.apply(
        [{ name: "workspace-shell", kind: "markup", element: shell, value: shellMarkup }],
        { force: true }
      );
      changedRegions = new Set([...changedRegions, ...shellChanged]);
      const nextElements = queryShellRegions(shell);
      regions.reset();
      regions.remember([
        { name: "workspace-groups", kind: "markup", element: nextElements.groups, value: view.groupMarkup },
        { name: "workspace-tabs", kind: "markup", element: nextElements.tabs, value: view.tabsMarkup },
        { name: "workspace-pane", kind: "markup", element: nextElements.pane, value: view.paneMarkup },
        { name: "workspace-overlays", kind: "markup", element: nextElements.overlays, value: view.overlayMarkup }
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
