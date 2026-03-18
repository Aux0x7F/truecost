import {
  draftOwnerPubkey,
  draftReviewAction,
  isPageDraft,
  normalizeDraftStatus,
  pageDraftHref,
  pageDraftLabel
} from "./page-drafts.js";
import { dedupeStrings as dedupe } from "./text-utils.js";
import { trimmed } from "./rendering.js";

export function createSiteNotificationBuilder({
  deps = {}
} = {}) {
  const publicStateHasAdminPubkey = deps.publicStateHasAdminPubkey || (() => false);
  const loadUserSubmissions = deps.loadUserSubmissions || (async () => []);
  const loadSubmissionThread = deps.loadSubmissionThread || (async () => []);
  const loadAdminKeyShare = deps.loadAdminKeyShare || (async () => null);
  const loadInboxSubmissions = deps.loadInboxSubmissions || (async () => []);

  return async function buildNotifications({ publicState, viewer, sessionSecretKeyHex }) {
    if (!viewer?.pubkey) return [];
    const notifications = [];
    const isAdmin = publicStateHasAdminPubkey(publicState, viewer.pubkey);
    const commentMap = new Map((publicState?.allComments || []).map((comment) => [comment.id, comment]));

    for (const comment of publicState?.comments || []) {
      if (!comment.parent_id || comment.author === viewer.pubkey) continue;
      const parent = commentMap.get(comment.parent_id);
      if (!parent || parent.author !== viewer.pubkey) continue;
      notifications.push({
        id: `comment-reply:${comment.id}`,
        createdAt: comment.created_at,
        href: `./investigation.html?slug=${encodeURIComponent(comment.post_slug)}#comment-${encodeURIComponent(comment.id)}`,
        label: "Comment reply",
        title: "Someone replied to your comment",
        detail: trimmed(comment.markdown, 100)
      });
    }

    for (const status of publicState?.submissionStatuses?.values?.() || []) {
      if (status.author_pubkey !== viewer.pubkey || status.by === viewer.pubkey) continue;
      notifications.push({
        id: `submission-status:${status.submission_id}:${status.updated_at}`,
        createdAt: status.updated_at,
        href: "./submit.html",
        label: "Submission update",
        title: `Submission ${status.status}`,
        detail: status.note || "A submission you sent has a new status."
      });
    }

    for (const draft of publicState?.drafts || []) {
      const reviewAction = draftReviewAction(draft);
      const ownerPubkey = draftOwnerPubkey(draft);
      const draftStatus = normalizeDraftStatus(draft.status);
      const isPending = ["candidate", "review", "submitted"].includes(draftStatus);
      const pageDraft = isPageDraft(draft);
      const reviewHref = pageDraft
        ? pageDraftHref(draft, draft.status)
        : draftStatus === "revision"
          ? `./editor.html?slug=${encodeURIComponent(draft.slug)}`
          : `./investigation.html?draft=${encodeURIComponent(draft.slug)}`;
      const reviewLabel = pageDraft ? "Page review" : "Investigation review";
      const reviewDetail = pageDraft ? pageDraftLabel(draft) : draft.title;
      if (ownerPubkey === viewer.pubkey && ["approve", "revise", "deny"].includes(reviewAction)) {
        notifications.push({
          id: `draft-review:${draft.slug}:${draft.created_at}`,
          createdAt: draft.created_at,
          href: reviewHref,
          label: reviewLabel,
          title: reviewNotificationTitle(reviewAction, pageDraft),
          detail: reviewDetail
        });
      }
      if (isAdmin && isPending) {
        notifications.push({
          id: `pending-draft:${draft.slug}:${draft.created_at}`,
          createdAt: draft.created_at,
          href: pageDraft ? pageDraftHref(draft, "candidate") : `./investigation.html?draft=${encodeURIComponent(draft.slug)}`,
          label: "Review queue",
          title: pageDraft ? "New page update pending review" : "New investigation pending review",
          detail: reviewDetail
        });
      }
    }

    if (isAdmin) {
      for (const comment of publicState?.comments || []) {
        if (comment.author === viewer.pubkey) continue;
        notifications.push({
          id: `post-comment:${comment.id}`,
          createdAt: comment.created_at,
          href: `./investigation.html?slug=${encodeURIComponent(comment.post_slug)}#comment-${encodeURIComponent(comment.id)}`,
          label: "Post reply",
          title: "New comment on a published investigation",
          detail: trimmed(comment.markdown, 100)
        });
      }
    }

    const submissionNotifications = await loadSubmissionNotifications({
      publicState,
      viewerPubkey: viewer.pubkey,
      isAdmin,
      sessionSecretKeyHex,
      loadUserSubmissions,
      loadSubmissionThread,
      loadAdminKeyShare,
      loadInboxSubmissions
    });
    notifications.push(...submissionNotifications);

    return notifications
      .sort((left, right) => right.createdAt - left.createdAt)
      .filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);
  };
}

async function loadSubmissionNotifications({
  publicState,
  viewerPubkey,
  isAdmin,
  sessionSecretKeyHex,
  loadUserSubmissions,
  loadSubmissionThread,
  loadAdminKeyShare,
  loadInboxSubmissions
}) {
  if (!sessionSecretKeyHex) return [];
  const notifications = [];
  const knownSitePubkeys = notificationSitePubkeys(publicState);
  const ownSubmissions = await loadUserSubmissions(sessionSecretKeyHex).catch(() => []);
  const ownThreads = await Promise.all(
    ownSubmissions.slice(0, 8).map(async (submission) => ({
      submissionId: submission.id,
      messages: await loadSubmissionThread(sessionSecretKeyHex, submission.id, knownSitePubkeys).catch(() => [])
    }))
  );
  for (const thread of ownThreads) {
    for (const message of thread.messages) {
      if (message.author === viewerPubkey) continue;
      notifications.push({
        id: `submission-chat:${thread.submissionId}:${message.id}`,
        createdAt: Number(message.event?.created_at || 0),
        href: `./submit.html?chat=${encodeURIComponent(thread.submissionId)}`,
        label: "Submission chat",
        title: "New message in a submission thread",
        detail: trimmed(message.payload?.body || "", 100)
      });
    }
  }
  if (isAdmin) {
    const activeSitePubkey = publicState?.siteInfo?.activePubkey || "";
    const share = activeSitePubkey
      ? await loadAdminKeyShare(sessionSecretKeyHex, activeSitePubkey).catch(() => null)
      : null;
    if (share?.siteSecretKeyHex) {
      const inboxSubmissions = await loadInboxSubmissions(share.siteSecretKeyHex).catch(() => []);
      const inboxThreads = await Promise.all(
        inboxSubmissions.slice(0, 8).map(async (submission) => ({
          submissionId: submission.id,
          messages: await loadSubmissionThread(share.siteSecretKeyHex, submission.id, [submission.author]).catch(() => [])
        }))
      );
      for (const thread of inboxThreads) {
        for (const message of thread.messages) {
          if (message.author === viewerPubkey) continue;
          notifications.push({
            id: `admin-chat:${thread.submissionId}:${message.id}`,
            createdAt: Number(message.event?.created_at || 0),
            href: `./admin.html?tab=submissions&chat=${encodeURIComponent(thread.submissionId)}&with=${encodeURIComponent(submissionAuthor(thread.submissionId, inboxSubmissions))}`,
            label: "Submission chat",
            title: "New submission message in the shared inbox",
            detail: trimmed(message.payload?.body || "", 100)
          });
        }
      }
    }
  }
  return notifications;
}

function submissionAuthor(submissionId, submissions) {
  return submissions.find((submission) => submission.id === submissionId)?.author || "";
}

function notificationSitePubkeys(publicState) {
  return dedupe([
    publicState?.siteInfo?.activePubkey || "",
    publicState?.siteInfo?.fallbackPubkey || "",
    ...((publicState?.siteInfo?.events || []).map((event) => event.site_pubkey || ""))
  ]);
}

function reviewNotificationTitle(action, isPage = false) {
  if (isPage) {
    if (action === "approve") return "Your page update was approved";
    if (action === "deny") return "A page update was denied";
    return "Revision was requested on your page update";
  }
  if (action === "approve") return "Your investigation was approved";
  if (action === "deny") return "An investigation was denied";
  return "Revision was requested on your investigation";
}
