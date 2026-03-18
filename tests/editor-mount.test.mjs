import test from "node:test";
import assert from "node:assert/strict";

import { replaceEditorShellMarkup } from "../scripts/core/editor-mount.js";

test("replaceEditorShellMarkup destroys the existing editor before replacing shell markup", () => {
  const calls = [];
  const editorState = {
    editor: {
      destroy() {
        calls.push("destroy");
      }
    }
  };
  const shell = {
    _innerHTML: "",
    set innerHTML(value) {
      calls.push(`markup:${value}`);
      this._innerHTML = value;
    },
    get innerHTML() {
      return this._innerHTML;
    }
  };

  replaceEditorShellMarkup(shell, editorState, "<section>next</section>");

  assert.deepEqual(calls, ["destroy", "markup:<section>next</section>"]);
  assert.equal(editorState.editor, null);
  assert.equal(shell.innerHTML, "<section>next</section>");
});
