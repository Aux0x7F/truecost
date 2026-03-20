import { applyObservedMarkup } from "./observed-regions.js";

export function destroyMountedEditor(editorState) {
  const editor = editorState?.editor;
  if (editor && typeof editor.destroy === "function") {
    try {
      editor.destroy();
    } catch {
      // Toast may already have detached some nodes; clear the reference anyway.
    }
  }
  if (editorState) editorState.editor = null;
}

export function replaceEditorShellMarkup(shell, editorState, markup) {
  if (!shell) return false;
  if (shell.innerHTML === String(markup ?? "")) return false;
  destroyMountedEditor(editorState);
  return applyObservedMarkup(shell, markup, { force: true });
}
