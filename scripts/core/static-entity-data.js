function cloneValue(value) {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function normalizeStaticEntity(entity) {
  if (!entity || typeof entity !== "object") return null;
  const slug = String(entity.slug || "").trim();
  if (!slug) return null;
  const status = String(entity.status || "").trim().toLowerCase();
  if (status && status !== "approved") return null;
  return cloneValue(entity);
}

export function createStaticEntityLoader({ fetchJson, sourcePath = "./content/graph/wiki-seed.json" } = {}) {
  let entitiesPromise = null;

  return async function loadStaticApprovedEntities({ force = false } = {}) {
    if (!force && entitiesPromise) {
      return cloneValue(await entitiesPromise) || [];
    }
    entitiesPromise = Promise.resolve(fetchJson(sourcePath))
      .then((payload) =>
        (Array.isArray(payload?.entities) ? payload.entities : [])
          .map((entity) => normalizeStaticEntity(entity))
          .filter(Boolean)
      )
      .catch(() => []);
    return cloneValue(await entitiesPromise) || [];
  };
}

