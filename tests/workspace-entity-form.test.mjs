import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEntityPickValue,
  createEntityModalDraft,
  matchWorkspaceEntities,
  uniqueWorkspaceLocations
} from "../scripts/core/workspace-entity-form.js";

test("createEntityModalDraft reuses existing entity data for edit mode and seeds create mode from the form", () => {
  const trigger = {
    getAttribute(name) {
      return name === "data-edit-entity" ? "county-line" : "";
    }
  };
  const editDraft = createEntityModalDraft({
    trigger,
    entities: [{
      slug: "county-line",
      status: "approved",
      name: "County Line",
      location: "Phoenix, Arizona",
      type: "yard",
      lat: 33.45,
      lng: -112.07,
      notes: "Tracked"
    }]
  });
  assert.equal(editDraft.mode, "edit");
  assert.equal(editDraft.seedName, "County Line");

  const createTrigger = {
    getAttribute(name) {
      return name === "data-entity-seed-from" ? "entityRefs" : "";
    }
  };
  const createDraft = createEntityModalDraft({
    trigger: createTrigger,
    sourceValue: "Mesa Terminal, County Line",
    locationValue: "Phoenix, Arizona"
  });
  assert.equal(createDraft.mode, "create");
  assert.equal(createDraft.seedName, "County Line");
  assert.equal(createDraft.seedLocation, "Phoenix, Arizona");
});

test("applyEntityPickValue appends normalized entity refs and replaces single-value fields", () => {
  const entity = { slug: "county-line", name: "County Line" };
  const refsValue = applyEntityPickValue({
    fieldName: "entityRefs",
    currentValue: "mesa-terminal, Mesa Terminal",
    entity,
    splitTags: (value) => String(value || "").split(",").map((part) => part.trim()).filter(Boolean),
    resolveEntityByNameOrSlug: (value) => String(value || "").toLowerCase() === "mesa terminal" ? { slug: "mesa-terminal" } : null
  });
  assert.equal(refsValue, "mesa-terminal, county-line");

  const singleValue = applyEntityPickValue({
    fieldName: "primaryEntity",
    currentValue: "",
    entity
  });
  assert.equal(singleValue, "County Line");
});

test("matchWorkspaceEntities and uniqueWorkspaceLocations derive normalized entity suggestions", () => {
  const entities = [
    { name: "County Line", slug: "county-line", location: "Phoenix, Arizona", aliases: ["County Yard"] },
    { name: "Mesa Terminal", slug: "mesa-terminal", location: "Mesa, Arizona", aliases: [] }
  ];
  const matches = matchWorkspaceEntities(entities, "yard");
  assert.deepEqual(matches.map((entity) => entity.slug), ["county-line"]);

  const locations = uniqueWorkspaceLocations(
    [
      { location: "Phoenix, Arizona" },
      { location: "Phoenix, Arizona" },
      { location: "Mesa, Arizona" }
    ],
    (values) => [...new Set(values.filter(Boolean))]
  );
  assert.deepEqual(locations, ["Phoenix, Arizona", "Mesa, Arizona"]);
});
