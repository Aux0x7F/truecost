import test from "node:test";
import assert from "node:assert/strict";

import {
  renderEditorModalView,
  renderEditorRailView,
  renderEditorShellView,
  renderEditorToolbarView
} from "../scripts/surfaces/editor-shell.js";

test("renderEditorShellView returns the compact investigation shell for admins", () => {
  const view = renderEditorShellView({
    editorState: {
      session: { username: "aux" },
      currentSlug: "",
      activeRailPanel: "document",
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

  assert.equal(view.title, "Draft title");
  assert.match(view.shellMarkup, /data-editor-toolbar/);
  assert.match(view.shellMarkup, /data-editor-surface/);
  assert.match(view.shellMarkup, /data-editor-open-panel="document"/);
  assert.doesNotMatch(view.shellMarkup, /Save snapshot/);
});

test("renderEditorToolbarView returns grouped ribbon controls", () => {
  const markup = renderEditorToolbarView({
    toolbarState: {
      bold: true,
      paragraph: true
    },
    editorState: {
      wrappedInsertMenuOpen: true
    }
  });

  assert.match(markup, /data-editor-command="toggle-format-menu"/);
  assert.match(markup, /data-editor-command="bold"/);
  assert.match(markup, /data-editor-command="toggle-wrapped-menu"/);
  assert.match(markup, /data-editor-wrapped-kind="image"/);
  assert.match(markup, /data-editor-wrapped-kind="banner"/);
  assert.match(markup, /data-editor-wrapped-kind="entityTile"/);
  assert.match(markup, /editor-ribbon__divider/);
  assert.match(markup, /is-active/);
});

test("renderEditorRailView returns multimedia rail with crop tray and search", () => {
  const markup = renderEditorRailView({
    editorState: {
      activeRailPanel: "multimedia",
      multimediaEditorMode: "create",
      multimediaDraft: {
        variant: "image"
      },
      filteredImageAssets: [
        {
          id: "img-1",
          name: "Warehouse front",
          localDataUrl: "data:image/png;base64,abc",
          alt: "Warehouse front",
          linkedEntities: ["county-yard"],
          focusX: 0.5,
          focusY: 0.5,
          cropX: 0.1,
          cropY: 0.1,
          cropWidth: 0.8,
          cropHeight: 0.8,
          uploadStatus: "local"
        }
      ],
      activeImageAssetId: "img-1",
      activeImageAsset: {
        id: "img-1",
        name: "Warehouse front",
        localDataUrl: "data:image/png;base64,abc",
        alt: "Warehouse front",
        linkedEntities: ["county-yard"],
        focusX: 0.5,
        focusY: 0.5,
        cropX: 0.1,
        cropY: 0.1,
        cropWidth: 0.8,
        cropHeight: 0.8,
        uploadStatus: "local"
      }
    },
    deps: {
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  });

  assert.match(markup, /data-editor-crop-surface/);
  assert.match(markup, /data-editor-crop-box/);
  assert.match(markup, /Upload image/);
  assert.match(markup, /Search images/);
  assert.match(markup, /data-editor-image-transform="rotate-90"/);
  assert.match(markup, /name="mediaVariant"/);
  assert.match(markup, /Done/);
});

test("renderEditorRailView returns the banner library with create row and insert buttons", () => {
  const markup = renderEditorRailView({
    editorState: {
      activeRailPanel: "multimedia",
      multimediaDraft: {
        variant: "banner",
        title: "Budget banner",
        text: "Text"
      },
      bannerPresets: [
        {
          id: "banner-1",
          variant: "banner",
          title: "Budget banner",
          text: "Text",
          backgroundColor: "#8f2017",
          textColor: "#fff7ef"
        }
      ]
    },
    deps: {
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  });

  assert.match(markup, /Create banner/);
  assert.match(markup, /data-editor-banner-entry="banner-1"/);
  assert.match(markup, /data-editor-banner-insert="banner-1"/);
});

test("renderEditorRailView returns the entity tile panel", () => {
  const markup = renderEditorRailView({
    editorState: {
      activeRailPanel: "entityTile",
      entityTileDraft: {
        query: "county",
        selected: {
          slug: "county-yard",
          name: "County Yard",
          type: "facility",
          location: "Phoenix",
          summary: "Local summary"
        }
      },
      entityTileMatches: [
        {
          slug: "county-yard",
          name: "County Yard",
          type: "facility",
          location: "Phoenix"
        }
      ]
    },
    deps: {
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  });

  assert.match(markup, /Insert an entity/);
  assert.match(markup, /data-editor-entity-tile-pick/);
  assert.match(markup, /editor-library-row__insert/);
});

test("renderEditorRailView returns citation rail with eyebrow title and create row", () => {
  const markup = renderEditorRailView({
    editorState: {
      activeRailPanel: "citation",
      documentCitations: [
        {
          id: "citation-1",
          title: "Budget memo",
          page: "12"
        }
      ]
    },
    deps: {
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  });

  assert.match(markup, /<div class="eyebrow">Citations<\/div>/);
  assert.match(markup, /Create citation/);
  assert.doesNotMatch(markup, /data-editor-save/);
});

test("renderEditorModalView returns the mobile rail modal when active", () => {
  const markup = renderEditorModalView({
    editorState: {
      mobileRailOpen: true,
      activeRailPanel: "document",
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
      escapeAttribute: (value) => String(value || ""),
      escapeHtml: (value) => String(value || "")
    }
  });

  assert.match(markup, /modal-card--rail/);
  assert.match(markup, /Page options/);
  assert.match(markup, /name="title"/);
});
