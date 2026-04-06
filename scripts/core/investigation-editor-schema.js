import { Node, mergeAttributes } from "@tiptap/core";
import {
  createTemplateEditorExtensions,
  createEmptyTemplateBody,
  editorToolbarState as genericEditorToolbarState,
  editorNodeNames as genericEditorNodeNames,
  findSelectedEditorNode as findGenericSelectedEditorNode,
  imagePlacementOptions as genericImagePlacementOptions,
  isInspectableEditorNode as isGenericInspectableNode,
  normalizeCitationAttrs,
  normalizeMultimediaAttrs,
  updateSelectedTemplateNode
} from "../../vendor/nostr-site-support.esm.js";

const ENTITY_TILE_NODE_NAME = "investigationEntityTile";
const ENTITY_REF_NODE_NAME = "investigationEntityRef";
const RELATIONSHIP_REF_NODE_NAME = "investigationRelationshipRef";
const INVESTIGATION_IMAGE_PLACEMENTS = genericImagePlacementOptions();
const LEGACY_TO_STRUCTURED_PLACEMENT = Object.freeze({
  left: "float-left",
  right: "float-right",
  full: "full-width",
  "full-width": "full-width",
  center: "center",
  "fill-crop": "fill-crop"
});

const InvestigationEntityTile = Node.create({
  name: ENTITY_TILE_NODE_NAME,
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      entity: { default: "" },
      label: { default: "" },
      summary: { default: "" },
      meta: { default: "" },
      href: { default: "" },
      displayStyle: { default: "smart" },
      placement: { default: "center" },
      widthRatio: { default: 0.46 }
    };
  },

  parseHTML() {
    return [{ tag: "article[data-investigation-entity-tile]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = normalizeEntityTileAttrs(HTMLAttributes);
    return ["article", mergeAttributes({
      "data-investigation-entity-tile": "true",
      "data-editor-wrapped-object": "entityTile",
      "data-placement": attrs.placement,
      class: `editor-reference-card editor-reference-card--entity-tile editor-reference-card--${attrs.placement}`,
      style: `--editor-media-width:${attrs.widthRatio};`
    }), ...compactChildren(
      ["div", { class: "editor-reference-card__eyebrow" }, "Entity"],
      ["strong", { class: "editor-reference-card__title" }, attrs.label || attrs.entity || "Entity"],
      attrs.meta ? ["span", { class: "editor-reference-card__meta" }, attrs.meta] : null,
      attrs.summary ? ["p", { class: "editor-reference-card__summary" }, attrs.summary] : null,
      attrs.href ? ["a", { class: "editor-reference-card__link", href: attrs.href, target: "_blank", rel: "noreferrer noopener", "data-editor-entity-link": "true" }, "Open wiki"] : null,
      ["div", { class: "editor-reference-card__arrange", "data-editor-arrange-controls": "true" },
        ["button", { class: "editor-reference-card__resize editor-reference-card__resize--left", type: "button", "data-editor-entity-resize-handle": "w", "aria-label": "Resize from left" }],
        ["button", { class: "editor-reference-card__resize editor-reference-card__resize--right", type: "button", "data-editor-entity-resize-handle": "e", "aria-label": "Resize from right" }]
      ]
    )];
  },

  addCommands() {
    return {
      insertInvestigationEntityTile:
        (attrs = {}) =>
        ({ commands }) => commands.insertContent({
          type: this.name,
          attrs: normalizeEntityTileAttrs(attrs)
        })
    };
  }
});

const InvestigationEntityRef = Node.create({
  name: ENTITY_REF_NODE_NAME,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      entity: { default: "" },
      label: { default: "" }
    };
  },

  parseHTML() {
    return [{ tag: "article[data-investigation-entity-ref]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = normalizeEntityRefAttrs(HTMLAttributes);
    return ["article", mergeAttributes({
      "data-investigation-entity-ref": "true",
      class: "editor-reference-card editor-reference-card--entity"
    }), ...compactChildren(
      ["div", { class: "editor-reference-card__eyebrow" }, "Entity"],
      ["strong", { class: "editor-reference-card__title" }, attrs.label || attrs.entity || "Entity"],
      attrs.entity ? ["span", { class: "editor-reference-card__meta" }, attrs.entity] : null
    )];
  }
});

const InvestigationRelationshipRef = Node.create({
  name: RELATIONSHIP_REF_NODE_NAME,
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      source: { default: "" },
      target: { default: "" },
      relationshipType: { default: "" },
      label: { default: "" }
    };
  },

  parseHTML() {
    return [{ tag: "article[data-investigation-relationship-ref]" }];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = normalizeRelationshipRefAttrs(HTMLAttributes);
    const label = attrs.label || `${attrs.source} ${attrs.relationshipType} ${attrs.target}`.trim();
    return ["article", mergeAttributes({
      "data-investigation-relationship-ref": "true",
      class: "editor-reference-card editor-reference-card--relationship"
    }), ...compactChildren(
      ["div", { class: "editor-reference-card__eyebrow" }, "Relationship"],
      ["strong", { class: "editor-reference-card__title" }, label || "Relationship"],
      ["span", { class: "editor-reference-card__meta" }, [attrs.source, attrs.relationshipType, attrs.target].filter(Boolean).join(" · ")]
    )];
  }
});

export function createInvestigationEditorExtensions(fragment = null, { placeholder = "Start writing the investigation." } = {}) {
  return [
    ...createTemplateEditorExtensions({ placeholder }),
    InvestigationEntityTile,
    InvestigationEntityRef,
    InvestigationRelationshipRef
  ];
}

export function createEmptyInvestigationBody() {
  return createEmptyTemplateBody();
}

export function findSelectedEditorNode(editor) {
  return findGenericSelectedEditorNode(editor);
}

export function isInspectableEditorNode(node) {
  return Boolean(node && (
    isGenericInspectableNode(node) ||
    [ENTITY_TILE_NODE_NAME, ENTITY_REF_NODE_NAME, RELATIONSHIP_REF_NODE_NAME].includes(node.name)
  ));
}

export function updateSelectedInvestigationNode(editor, name, attrs = {}) {
  if (name === genericEditorNodeNames().multimedia || name === genericEditorNodeNames().citation) {
    return updateSelectedTemplateNode(editor, name, attrs);
  }
  if (!editor) return false;
  const selected = findGenericSelectedEditorNode(editor);
  if (!selected || selected.name !== name) return false;
  editor.chain().focus().setNodeSelection(selected.pos).updateAttributes(name, attrs).run();
  return true;
}

export function editorToolbarState(editor) {
  return genericEditorToolbarState(editor);
}

export function editorNodeNames() {
  return {
    ...genericEditorNodeNames(),
    entityTile: ENTITY_TILE_NODE_NAME,
    entityRef: ENTITY_REF_NODE_NAME,
    relationshipRef: RELATIONSHIP_REF_NODE_NAME
  };
}

export function normalizeEntityTileAttrs(attrs = {}) {
  return {
    entity: String(attrs.entity || "").trim(),
    label: String(attrs.label || "").trim(),
    summary: String(attrs.summary || "").trim(),
    meta: String(attrs.meta || "").trim(),
    href: String(attrs.href || "").trim(),
    displayStyle: normalizeDisplayStyle(attrs.displayStyle),
    placement: normalizeImagePlacement(attrs.placement, "center"),
    widthRatio: clampRange(attrs.widthRatio ?? attrs.width, 0.46, 0.24, 1)
  };
}

export function normalizeEntityRefAttrs(attrs = {}) {
  return {
    entity: String(attrs.entity || "").trim(),
    label: String(attrs.label || "").trim()
  };
}

export function normalizeRelationshipRefAttrs(attrs = {}) {
  return {
    source: String(attrs.source || "").trim(),
    target: String(attrs.target || "").trim(),
    relationshipType: String(attrs.relationshipType || attrs.type || "").trim(),
    label: String(attrs.label || "").trim()
  };
}

export function imagePlacementOptions() {
  return INVESTIGATION_IMAGE_PLACEMENTS.slice();
}

function normalizeImagePlacement(value, fallback = "full-width") {
  const cleanValue = String(value || "").trim().toLowerCase();
  const normalized = LEGACY_TO_STRUCTURED_PLACEMENT[cleanValue] || cleanValue;
  return INVESTIGATION_IMAGE_PLACEMENTS.includes(normalized) ? normalized : fallback;
}

function normalizeDisplayStyle(value = "") {
  const clean = String(value || "").trim().toLowerCase();
  if (["smart", "compact", "feature"].includes(clean)) return clean;
  return "smart";
}

function clampRange(value, fallback = 0, minimum = 0, maximum = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, numeric));
}

function compactChildren(...children) {
  return children.filter(Boolean);
}

export {
  normalizeCitationAttrs,
  normalizeMultimediaAttrs
};
