import test from "node:test";
import assert from "node:assert/strict";

import { renderEditorModalView, renderEditorShellView } from "../scripts/surfaces/editor-shell.js";

test("renderEditorShellView returns the admin editor shell", () => {
  const view = renderEditorShellView({
    editorState: {
      session: { username: "aux" },
      currentSlug: "",
      document: {
        title: "Draft title",
        summary: "Draft summary",
        date: "2026-03-17",
        tags: ["records"],
        primaryEntity: "County Line",
        entityRefs: ["Phoenix"]
      }
    },
    deps: {
      currentUserIsAdmin: () => true,
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  });

  assert.equal(view.title, "Create investigation");
  assert.match(view.shellMarkup, /data-editor-form/);
  assert.match(view.shellMarkup, /Snapshot/);
  assert.match(view.shellMarkup, /County Line/);
});

test("renderEditorModalView returns image modal markup when image modal is active", () => {
  const markup = renderEditorModalView({
    editorState: {
      imageModal: {
        alt: "Alt text",
        caption: "Caption",
        placement: "float-left",
        drag: { x: 0.5, y: 0.5 },
        crop: { x: 0, y: 0, width: 1, height: 1 }
      }
    },
    deps: {
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  });

  assert.match(markup, /Insert image/);
  assert.match(markup, /Alt text/);
  assert.match(markup, /option value="float-left" selected/);
  assert.match(markup, /name="focusX"/);
  assert.match(markup, /name="cropWidth"/);
});
