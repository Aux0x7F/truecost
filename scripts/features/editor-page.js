export function createEditorPageController({
  deps = {},
  callbacks = {}
} = {}) {
  const documentRef = deps.document || globalThis.document;
  const windowRef = deps.window || globalThis.window;
  const sessionChangedEvent = String(deps.sessionChangedEvent || "truecost:session-changed");

  let started = false;

  async function handleSessionChanged() {
    await callbacks.beforeSessionRefresh?.();
    await callbacks.initPage?.(true);
  }

  async function handlePageHide() {
    await callbacks.beforePageHide?.();
  }

  function start() {
    if (started || !documentRef?.querySelector?.("[data-editor-page]")) return false;
    started = true;
    windowRef?.addEventListener?.(sessionChangedEvent, handleSessionChanged);
    windowRef?.addEventListener?.("pagehide", handlePageHide);
    void callbacks.initPage?.(false);
    return true;
  }

  return {
    handlePageHide,
    handleSessionChanged,
    start
  };
}

export default createEditorPageController;
