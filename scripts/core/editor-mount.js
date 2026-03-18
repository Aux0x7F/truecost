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
  destroyMountedEditor(editorState);
  if (shell) shell.innerHTML = markup;
}
