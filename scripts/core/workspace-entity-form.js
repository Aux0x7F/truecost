import { cleanSlug } from "./nostr.js";
import { lastCommaValue } from "./text-utils.js";

export function createEntityModalDraft({
  trigger = null,
  entities = [],
  sourceValue = "",
  locationValue = ""
} = {}) {
  const editSlug = String(trigger?.getAttribute?.("data-edit-entity") || "").trim();
  if (editSlug) {
    const entity = (Array.isArray(entities) ? entities : []).find((item) => item.slug === editSlug);
    if (entity) {
      return {
        mode: "edit",
        slug: entity.slug,
        status: entity.status,
        seedName: entity.name,
        seedLocation: entity.location,
        seedType: entity.type,
        seedLat: entity.lat ?? "",
        seedLng: entity.lng ?? "",
        seedNotes: entity.notes || ""
      };
    }
  }
  const fieldName = String(trigger?.getAttribute?.("data-entity-seed-from") || "").trim();
  const seedName = fieldName === "entityRefs" ? lastCommaValue(sourceValue) : String(sourceValue || "").trim();
  return {
    mode: "create",
    seedName,
    seedLocation: String(locationValue || "").trim()
  };
}

export function matchWorkspaceEntities(entities = [], query = "") {
  const clean = String(query || "").trim().toLowerCase();
  if (!clean) return [];
  return (Array.isArray(entities) ? entities : []).filter((entity) => {
    const haystacks = [
      entity?.name,
      entity?.slug,
      entity?.location,
      ...(Array.isArray(entity?.aliases) ? entity.aliases : [])
    ]
      .map((value) => String(value || "").toLowerCase())
      .filter(Boolean);
    return haystacks.some((value) => value.includes(clean));
  });
}

export function applyEntityPickValue({
  fieldName = "",
  currentValue = "",
  entity = null,
  splitTags = () => [],
  resolveEntityByNameOrSlug = () => null
} = {}) {
  if (!entity || !fieldName) return String(currentValue || "");
  if (fieldName === "entityRefs") {
    const existing = splitTags(currentValue)
      .map((value) => resolveEntityByNameOrSlug(value)?.slug || cleanSlug(value))
      .filter(Boolean);
    return [...new Set([...existing, entity.slug])].join(", ");
  }
  return entity.name;
}

export function uniqueWorkspaceLocations(entities = [], dedupeStrings = (values) => values) {
  return dedupeStrings((Array.isArray(entities) ? entities : []).map((entity) => entity?.location));
}
