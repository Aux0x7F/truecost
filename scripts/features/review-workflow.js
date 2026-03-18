export function createReviewWorkflow({
  site,
  state,
  viewerController,
  publicStateStore,
  notificationState,
  cleanSlug,
  ensureEventToolsLoaded,
  publishTaggedJson,
  pageDrafts,
  getPublicState,
  hydrateNotifications
} = {}) {
  const draftOwnerPubkey = pageDrafts?.draftOwnerPubkey || (() => "");
  const isPageDraft = pageDrafts?.isPageDraft || (() => false);
  const pageDraftHref = pageDrafts?.pageDraftHref || (() => "./");
  const reviewActionMessage = pageDrafts?.reviewActionMessage || (() => "Saved.");
  const reviewStatusForAction = pageDrafts?.reviewStatusForAction || (() => "revision");

  async function loadDraftBySlug(slug) {
    const clean = cleanSlug(slug || "");
    if (!clean) return null;
    await ensureEventToolsLoaded();
    const tools = window.EventTools || window.NostrTools;
    if (!tools?.SimplePool) return null;
    const relays = [...new Set([...(site.nostr.authorityRelays || []), ...(site.nostr.relays || [])].filter(Boolean))];
    if (!relays.length) return null;
    const pool = new tools.SimplePool();
    try {
      const events = await Promise.race([
        pool.querySync(relays, {
          kinds: [site.nostr.kinds.draft],
          "#d": [clean],
          "#t": [site.nostr.appTag],
          limit: 24
        }, {}),
        timeoutAfter(Math.max(Number(site.nostr.authorityConnectTimeoutMs || 0), 9000))
      ]);
      const ordered = (Array.isArray(events) ? events : [])
        .map(parseDraftEvent)
        .filter(Boolean)
        .sort(compareDraftEventsDesc);
      if (!ordered.length) return null;
      return {
        ...ordered[0],
        revisions: ordered,
        revisionCount: ordered.length
      };
    } catch {
      return null;
    } finally {
      pool.close(relays);
    }
  }

  async function publishReviewDecision(panel, draft, button) {
    const action = button.getAttribute("data-review-action") || "";
    let statusBox = panel.querySelector("[data-review-status]");
    if (!state.session || !viewerController.canEdit(state.publicState)) return;
    if (!(statusBox instanceof HTMLElement)) {
      statusBox = document.createElement("div");
      statusBox.className = "status-box";
      statusBox.setAttribute("data-review-status", "");
      statusBox.setAttribute("aria-live", "polite");
      panel.append(statusBox);
    }
    button.setAttribute("disabled", "disabled");
    if (statusBox instanceof HTMLElement) {
      statusBox.textContent = "Saving review decision...";
      statusBox.dataset.state = "pending";
    }
    try {
      const viewer = state.viewer || await viewerController.get().catch(() => viewerController.primeFromSession(false));
      await publishTaggedJson({
        kind: site.nostr.kinds.draft,
        secretKeyHex: state.session.secretKeyHex,
        tags: [
          ["d", draft.slug],
          ["status", reviewStatusForAction(action)],
          ["review", action],
          ...(isPageDraft(draft) ? [["content", "page"], ["page", cleanSlug(draft.page_id || "")]] : [])
        ],
        content: {
          ...draft,
          author_pubkey: draftOwnerPubkey(draft),
          status: reviewStatusForAction(action),
          reviewed_at: new Date().toISOString(),
          reviewed_by: viewer?.pubkey || "",
          review_action: action
        }
      });
      state.publicState = (await publicStateStore.hydrate({ force: true, reason: "review-action" })).value;
      notificationState.reset();
      void hydrateNotifications(true);
      if (statusBox instanceof HTMLElement) {
        statusBox.textContent = reviewActionMessage(action, draft);
        statusBox.dataset.state = "success";
      }
      const destination = isPageDraft(draft)
        ? pageDraftHref(draft, reviewStatusForAction(action))
        : "./investigations.html";
      window.setTimeout(() => {
        window.location.href = destination;
      }, 700);
    } catch (error) {
      if (statusBox instanceof HTMLElement) {
        statusBox.textContent = String(error?.message || error || "Review action failed.");
        statusBox.dataset.state = "error";
      }
    } finally {
      button.removeAttribute("disabled");
    }
  }

  function parseDraftEvent(event) {
    if (!event || Number(event.kind) !== Number(site.nostr.kinds.draft)) return null;
    let payload = {};
    try {
      payload = JSON.parse(String(event.content || ""));
    } catch {
      payload = {};
    }
    const slug = cleanSlug(payload?.slug || eventTagValue(event, "d"));
    if (!slug) return null;
    const contentType = String(payload?.content_type || payload?.contentType || "post").trim().toLowerCase() || "post";
    return {
      slug,
      author: String(event.pubkey || "").trim().toLowerCase(),
      title: String(payload?.title || slug).trim(),
      summary: String(payload?.summary || "").trim(),
      location: String(payload?.location || "Undisclosed location").trim(),
      status: String(payload?.status || "draft").trim(),
      tags: Array.isArray(payload?.tags) ? payload.tags : [],
      markdown: String(payload?.markdown || "").trim(),
      featured: Boolean(payload?.featured),
      date: String(payload?.date || new Date(Number(event.created_at || 0) * 1000 || Date.now()).toISOString().slice(0, 10)),
      entity_refs: Array.isArray(payload?.entity_refs) ? payload.entity_refs : [],
      content_type: contentType,
      page_id: cleanSlug(payload?.page_id || payload?.pageId || ""),
      page_path: String(payload?.page_path || payload?.pagePath || "").trim(),
      page_content: payload?.page_content && typeof payload.page_content === "object"
        ? payload.page_content
        : payload?.pageContent && typeof payload.pageContent === "object"
          ? payload.pageContent
          : null,
      created_at: Number(event.created_at || 0) || 0,
      id: event.id,
      _event: event
    };
  }

  function eventTagValue(event, key) {
    const tag = (event?.tags || []).find((item) => Array.isArray(item) && item[0] === key);
    return String(tag?.[1] || "");
  }

  function compareDraftEventsDesc(left, right) {
    const leftTime = Number(left?.created_at || left?._event?.created_at || 0);
    const rightTime = Number(right?.created_at || right?._event?.created_at || 0);
    if (leftTime !== rightTime) return rightTime - leftTime;
    return String(right?.id || right?._event?.id || "").localeCompare(String(left?.id || left?._event?.id || ""));
  }

  return {
    loadDraftBySlug,
    publishReviewDecision
  };
}

function timeoutAfter(ms) {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error("Relay connection timed out.")), Number(ms) || 0);
  });
}
