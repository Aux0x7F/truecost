export function createRuntimeDocumentLocalState({
  getRuntimeClient,
  resolveParams,
  projectionName = "documentLocalState",
  draftKey = "draft",
  historyKey = "history"
} = {}) {
  if (typeof getRuntimeClient !== "function") {
    throw new TypeError("createRuntimeDocumentLocalState requires getRuntimeClient");
  }
  if (typeof resolveParams !== "function") {
    throw new TypeError("createRuntimeDocumentLocalState requires resolveParams");
  }

  async function loadValue(slug, reason) {
    const runtimeClient = await getRuntimeClient().catch(() => null);
    if (!runtimeClient) return null;
    return runtimeClient.getProjection(projectionName, resolveParams(slug), {
      preferFresh: false,
      reason
    }).catch(() => null);
  }

  async function updateState(slug, updater = (current) => current, source = "document-local-state") {
    const runtimeClient = await getRuntimeClient().catch(() => null);
    if (!runtimeClient || typeof updater !== "function") return null;
    const params = resolveParams(slug);
    const current = await runtimeClient.getProjection(projectionName, params, {
      preferFresh: false,
      reason: `${source}-read`
    }).catch(() => null);
    const nextValue = updater(current?.value && typeof current.value === "object" ? current.value : {});
    const projection = await runtimeClient.rememberProjection(projectionName, params, nextValue, { source }).catch(() => null);
    return projection?.value ?? null;
  }

  async function moveState(fromSlug, toSlug, { source = "document-local-state-move" } = {}) {
    if (!toSlug) return null;
    const runtimeClient = await getRuntimeClient().catch(() => null);
    if (!runtimeClient) return null;
    const fromParams = resolveParams(fromSlug);
    const toParams = resolveParams(toSlug);
    if (JSON.stringify(fromParams) === JSON.stringify(toParams)) return null;
    const current = await runtimeClient.getProjection(projectionName, fromParams, {
      preferFresh: false,
      reason: source
    }).catch(() => null);
    if (current?.value === null || typeof current?.value === "undefined") return null;
    await runtimeClient.rememberProjection(projectionName, toParams, current.value, {
      source,
      movedFrom: fromParams.docId || fromParams.slug || ""
    }).catch(() => null);
    await runtimeClient.rememberProjection(projectionName, fromParams, null, {
      source: `${source}-clear`,
      movedTo: toParams.docId || toParams.slug || ""
    }).catch(() => null);
    return current.value;
  }

  return {
    paramsForSlug(slug = "") {
      return resolveParams(slug);
    },
    updateState,
    moveState,
    async loadDraft(slug, { reason = "document-local-draft-load" } = {}) {
      const projection = await loadValue(slug, reason);
      return projection?.value?.[draftKey] ?? null;
    },
    async saveDraft(slug, draft, { source = "document-local-draft" } = {}) {
      return updateState(slug, (current) => ({
        ...current,
        [draftKey]: draft
      }), source);
    },
    async loadHistory(slug, { reason = "document-local-history-load" } = {}) {
      const projection = await loadValue(slug, reason);
      return Array.isArray(projection?.value?.[historyKey]) ? projection.value[historyKey] : [];
    },
    async saveHistory(slug, history, { source = "document-local-history" } = {}) {
      return updateState(slug, (current) => ({
        ...current,
        [historyKey]: Array.isArray(history) ? history : []
      }), source);
    }
  };
}
