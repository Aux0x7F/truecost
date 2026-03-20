import test from "node:test";
import assert from "node:assert/strict";

import { renderComment } from "../scripts/surfaces/comments.js";

test("renderComment highlights the signed-in author label when the viewer owns the comment", () => {
  const markup = renderComment(
    {
      id: "comment-1",
      author: "pubkey-a",
      markdown: "Hello",
      replies: [],
      created_at: 1
    },
    {
      users: [{ pubkey: "pubkey-a", displayName: "Aux" }]
    },
    {
      viewerPubkey: "pubkey-a",
      canVote: true
    },
    {
      formatDateTime: () => "Now",
      renderMiniMarkdown: (value) => value,
      renderAvatarBadge: () => "<span>A</span>"
    }
  );

  assert.match(markup, /comment-card__author-button is-self/);
  assert.match(markup, /data-user-pubkey="pubkey-a"/);
});

test("renderComment leaves other authors unhighlighted", () => {
  const markup = renderComment(
    {
      id: "comment-2",
      author: "pubkey-b",
      markdown: "Hello",
      replies: [],
      created_at: 1
    },
    {
      users: [{ pubkey: "pubkey-b", displayName: "Clippy" }]
    },
    {
      viewerPubkey: "pubkey-a",
      canVote: true
    },
    {
      formatDateTime: () => "Now",
      renderMiniMarkdown: (value) => value,
      renderAvatarBadge: () => "<span>C</span>"
    }
  );

  assert.doesNotMatch(markup, /comment-card__author-button is-self/);
});
