export function createWorkspaceMutationController({
  site,
  state,
  accessController,
  deps = {},
  callbacks = {}
} = {}) {
  const runtime = {
    buildDraftMarkdown: () => "",
    createUniqueSlug: (value) => value,
    draftOwnerPubkey: () => "",
    isPageDraft: () => false,
    parseMaybeNumber: (value) => value,
    publishAdminKeyShare: async () => {},
    publishTaggedJson: async () => {},
    safeJson: JSON.parse,
    splitTags: (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean),
    ...deps
  };
  const hooks = {
    applyLocalCommentModeration: () => {},
    deriveSubmissionReviewState: () => ({}),
    refreshWorkspace: async () => {},
    renderWorkspace: () => {},
    resolveEntityByNameOrSlug: () => null,
    rotateSiteInboxKey: async () => {},
    userNeedsCurrentSiteKey: () => false,
    ...callbacks
  };

  async function performUserAction(targetPubkey, action, mode = "") {
    if (!accessController.isAdmin() || !targetPubkey) return;
    const user = hooks.resolveWorkspaceUser?.(targetPubkey);
    const isRootAdmin = targetPubkey === state.publicState?.rootAdminPubkey;
    if (isRootAdmin) return;
    if (action === "share-site-key" && state.siteKeyShare) {
      if (user && !hooks.userNeedsCurrentSiteKey(user)) return;
      await runtime.publishAdminKeyShare(
        state.session.secretKeyHex,
        targetPubkey,
        state.siteKeyShare.siteSecretKeyHex
      );
    }

    if (action === "admin") {
      await runtime.publishTaggedJson({
        kind: site.nostr.kinds.adminRole,
        secretKeyHex: state.session.secretKeyHex,
        tags: [["d", `admin-role:${targetPubkey}`], ["p", targetPubkey], ["op", mode]],
        content: {
          action: mode,
          target_pubkey: targetPubkey
        }
      });
      if (mode === "grant" && state.siteKeyShare && targetPubkey !== state.viewer?.pubkey) {
        await runtime.publishAdminKeyShare(
          state.session.secretKeyHex,
          targetPubkey,
          state.siteKeyShare.siteSecretKeyHex
        );
      }
      if (mode === "revoke") {
        try {
          await hooks.rotateSiteInboxKey([targetPubkey], "admin-revoke");
        } catch (error) {
          window.alert(`Admin revoked, but site inbox key rotation failed: ${String(error?.message || error || "Unknown error.")}`);
        }
      }
    }

    if (action === "mod") {
      if (user?.isAdmin) return;
      await runtime.publishTaggedJson({
        kind: site.nostr.kinds.userMod,
        secretKeyHex: state.session.secretKeyHex,
        tags: [["d", `user-mod:${targetPubkey}`], ["p", targetPubkey], ["op", mode]],
        content: {
          action: mode,
          target_pubkey: targetPubkey
        }
      });
    }
  }

  async function handleEntitySave(form) {
    const formData = new FormData(form);
    const name = String(formData.get("name") || "").trim();
    if (!name) return;
    const existingSlug = String(formData.get("slug") || "").trim().toLowerCase();
    const taken = (state.publicState?.entities || [])
      .map((entity) => entity.slug)
      .filter((slug) => slug !== existingSlug);
    const slug = existingSlug || runtime.createUniqueSlug(name, taken);
    const nextStatus = String(formData.get("status") || "").trim() || (accessController.isAdmin() ? "approved" : "pending");
    await runtime.publishTaggedJson({
      kind: site.nostr.kinds.entity,
      secretKeyHex: state.session.secretKeyHex,
      tags: [["d", slug]],
      content: {
        slug,
        name,
        location: String(formData.get("location") || "").trim(),
        type: String(formData.get("type") || "").trim() || "entity",
        lat: runtime.parseMaybeNumber(formData.get("lat")),
        lng: runtime.parseMaybeNumber(formData.get("lng")),
        notes: String(formData.get("notes") || "").trim(),
        status: nextStatus
      }
    });
    state.entityModal = null;
    await hooks.refreshWorkspace(true);
  }

  async function handleEntityAction(button) {
    if (!accessController.isAdmin()) return;
    const slug = button.getAttribute("data-entity-slug") || "";
    const action = button.getAttribute("data-entity-action") || "";
    const entity = (state.publicState?.entities || []).find((item) => item.slug === slug);
    if (!entity) return;
    await runtime.publishTaggedJson({
      kind: site.nostr.kinds.entity,
      secretKeyHex: state.session.secretKeyHex,
      tags: [["d", entity.slug]],
      content: {
        slug: entity.slug,
        name: entity.name,
        location: entity.location,
        type: entity.type,
        lat: entity.lat,
        lng: entity.lng,
        notes: entity.notes,
        aliases: entity.aliases || [],
        status: action === "approve" ? "approved" : action === "deny" ? "denied" : "deleted"
      }
    });
    await hooks.refreshWorkspace(true);
  }

  async function handleCommentAction(button) {
    if (!accessController.isAdmin()) return;
    const action = button.getAttribute("data-comment-action") || "";
    const commentId = button.getAttribute("data-comment-id") || "";
    if (!commentId || !action) return;
    const noteField = document.querySelector(`[data-comment-note="${commentId}"]`);
    const note = noteField instanceof HTMLTextAreaElement ? noteField.value.trim() : "";
    await runtime.publishTaggedJson({
      kind: site.nostr.kinds.commentMod,
      secretKeyHex: state.session.secretKeyHex,
      tags: [["e", commentId], ["op", action]],
      content: {
        target_id: commentId,
        action,
        note
      }
    });
    hooks.applyLocalCommentModeration(commentId, action, note);
    hooks.renderWorkspace();
    window.setTimeout(() => {
      void hooks.refreshWorkspace(true);
    }, 1800);
  }

  async function handleCommentActionForm(form) {
    const formData = new FormData(form);
    const commentId = String(formData.get("commentId") || "").trim();
    const mode = String(formData.get("mode") || "").trim().toLowerCase();
    const comment = (state.publicState?.allComments || []).find((item) => item.id === commentId);
    if (!comment || !state.session) return;

    if (mode === "moderate" && accessController.isAdmin()) {
      const action = comment.visibility === "hidden" ? "restore" : "hide";
      const note = String(formData.get("note") || "").trim();
      await runtime.publishTaggedJson({
        kind: site.nostr.kinds.commentMod,
        secretKeyHex: state.session.secretKeyHex,
        tags: [["e", commentId], ["op", action]],
        content: {
          target_id: commentId,
          action,
          note
        }
      });
      state.commentActionModal = null;
      hooks.applyLocalCommentModeration(commentId, action, note);
      hooks.renderWorkspace({ soft: true });
      window.setTimeout(() => void hooks.refreshWorkspace(true), 900);
      return;
    }

    if (comment.author !== state.viewer?.pubkey) return;
    if (mode === "edit") {
      const markdown = String(formData.get("markdown") || "").trim();
      if (!markdown) return;
      await runtime.publishTaggedJson({
        kind: site.nostr.kinds.comment,
        secretKeyHex: state.session.secretKeyHex,
        tags: [
          ["d", comment.id],
          ["a", comment.post_slug],
          ...(comment.parent_id ? [["e", comment.parent_id], ["parent", comment.parent_id]] : []),
          ...(comment.root_id ? [["root", comment.root_id]] : [])
        ],
        content: {
          post_slug: comment.post_slug,
          markdown,
          parent_id: comment.parent_id || "",
          root_id: comment.root_id || ""
        }
      });
    }
    if (mode === "delete") {
      await runtime.publishTaggedJson({
        kind: site.nostr.kinds.commentMod,
        secretKeyHex: state.session.secretKeyHex,
        tags: [["e", commentId], ["op", "hide"]],
        content: {
          target_id: commentId,
          action: "hide",
          note: "Deleted by author"
        }
      });
    }
    state.commentActionModal = null;
    await hooks.refreshWorkspace(true);
  }

  async function handleReviewAction(button) {
    if (!accessController.isAdmin() || !state.session) return;
    const action = button.getAttribute("data-review-action") || "";
    const slug = String(button.getAttribute("data-draft-slug") || "").trim().toLowerCase();
    const draft = (state.publicState?.drafts || []).find((item) => item.slug === slug);
    if (!draft || !["approve", "revise", "deny"].includes(action)) return;
    const nextStatus = action === "approve" ? "approved" : action === "deny" ? "denied" : "revision";
    button.setAttribute("disabled", "disabled");
    try {
      await runtime.publishTaggedJson({
        kind: site.nostr.kinds.draft,
        secretKeyHex: state.session.secretKeyHex,
        tags: [
          ["d", draft.slug],
          ["status", nextStatus],
          ["review", action],
          ...(runtime.isPageDraft(draft) ? [["content", "page"], ["page", String(draft.page_id || "").trim().toLowerCase()]] : [])
        ],
        content: {
          ...draft,
          author_pubkey: runtime.draftOwnerPubkey(draft),
          status: nextStatus,
          reviewed_at: new Date().toISOString(),
          reviewed_by: state.viewer?.pubkey || "",
          review_action: action
        }
      });
      await hooks.refreshWorkspace(true);
    } finally {
      button.removeAttribute("disabled");
    }
  }

  async function handleDraftSave(form) {
    if (!accessController.isAdmin()) return;
    const formData = new FormData(form);
    const title = String(formData.get("title") || "").trim();
    if (!title) return;
    const primaryEntityInput = String(formData.get("primaryEntity") || "").trim();
    const primaryEntity = hooks.resolveEntityByNameOrSlug(primaryEntityInput);
    const additionalEntityRefs = runtime.splitTags(formData.get("entityRefs"));
    const entityRefs = runtime.dedupe([
      primaryEntity?.slug || "",
      ...additionalEntityRefs.map((value) => hooks.resolveEntityByNameOrSlug(value)?.slug || String(value || "").trim().toLowerCase())
    ]);
    const taken = [...state.staticSlugs, ...(state.publicState?.drafts || []).map((draft) => draft.slug)];
    const slug = runtime.createUniqueSlug(title, taken);
    const draft = {
      slug,
      title,
      date: String(formData.get("date") || "").trim() || new Date().toISOString().slice(0, 10),
      location: primaryEntity?.name || primaryEntity?.location || "Undisclosed location",
      status: String(formData.get("status") || "draft").trim(),
      summary: String(formData.get("summary") || "").trim(),
      tags: runtime.splitTags(formData.get("tags")),
      entity_refs: entityRefs,
      featured: false,
      markdown: String(formData.get("markdown") || "").trim(),
      records: []
    };
    await runtime.publishTaggedJson({
      kind: site.nostr.kinds.draft,
      secretKeyHex: state.session.secretKeyHex,
      tags: [["d", draft.slug], ["status", draft.status]],
      content: draft
    });
    state.exportValue = runtime.buildDraftMarkdown(draft);
    await hooks.refreshWorkspace(true);
    state.exportValue = runtime.buildDraftMarkdown(draft);
    hooks.renderWorkspace();
  }

  async function handleSubmissionAction(button) {
    if (!accessController.isAdmin()) return;
    const submissionId = button.getAttribute("data-submission-id") || "";
    const authorPubkey = button.getAttribute("data-author-pubkey") || "";
    const status = button.getAttribute("data-status") || "viewed";
    const reviewState = hooks.deriveSubmissionReviewState(
      state.inboxSubmissions.find((item) => item.id === submissionId)
    );
    if (status === "deleted" && reviewState.confirmCount) return;
    await runtime.publishTaggedJson({
      kind: site.nostr.kinds.submissionStatus,
      secretKeyHex: state.session.secretKeyHex,
      tags: [["d", submissionId], ["p", authorPubkey]],
      content: {
        submission_id: submissionId,
        author_pubkey: authorPubkey,
        status
      }
    });
    await hooks.refreshWorkspace(true);
  }

  async function handleSnapshotRequest(button) {
    if (!accessController.isAdmin() || !state.session) return;
    button.setAttribute("disabled", "disabled");
    try {
      const requestId = `snapshot:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      await runtime.publishTaggedJson({
        kind: site.nostr.kinds.snapshotRequest,
        secretKeyHex: state.session.secretKeyHex,
        tags: [
          ["d", requestId],
          ["req", requestId],
          ["op", "bake"]
        ],
        content: {
          protocol: `${site.nostr.protocolPrefix}-snapshot-request/v1`,
          request_id: requestId,
          op: "bake",
          requested_at: new Date().toISOString()
        }
      });
      state.dashboardStatus = "Snapshot request sent. The pinner can now build the latest approved content and update the review branch.";
      await hooks.refreshWorkspace(true);
    } catch (error) {
      state.dashboardStatus = String(error?.message || error || "Snapshot request failed.");
      hooks.renderWorkspace();
    } finally {
      button.removeAttribute("disabled");
    }
  }

  return {
    handleCommentAction,
    handleCommentActionForm,
    handleDraftSave,
    handleEntityAction,
    handleEntitySave,
    handleReviewAction,
    handleSnapshotRequest,
    handleSubmissionAction,
    performUserAction
  };
}
