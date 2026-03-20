import test from "node:test";
import assert from "node:assert/strict";

import {
  applyOptimisticIdentityRotation,
  normalizePublicState,
  publicStateHasAdminPubkey,
  resolveCanonicalIdentityPubkey
} from "../scripts/core/public-state.js";

test("normalizePublicState filters removed actors from visible state", () => {
  const normalized = normalizePublicState(
    {
      removedPubkeys: ["b".repeat(64)],
      removedUsers: [{ pubkey: "b".repeat(64), claimedUsername: "aux2", displayName: "Aux 2" }],
      admins: ["a".repeat(64), "b".repeat(64)],
      users: [
        { pubkey: "a".repeat(64), username: "aux", claimedUsername: "aux" },
        { pubkey: "b".repeat(64), username: "aux2", claimedUsername: "aux2" }
      ],
      entities: [
        { slug: "kept", author: "a".repeat(64), status: "approved" },
        { slug: "removed", author: "b".repeat(64), status: "approved" }
      ],
      approvedEntities: [
        { slug: "kept", author: "a".repeat(64), status: "approved" },
        { slug: "removed", author: "b".repeat(64), status: "approved" }
      ],
      drafts: [
        { slug: "draft-kept", author: "a".repeat(64) },
        { slug: "draft-removed", author: "b".repeat(64) }
      ],
      allComments: [
        { id: "kept-comment", author: "a".repeat(64), post_slug: "post-1" },
        { id: "removed-comment", author: "b".repeat(64), post_slug: "post-1" }
      ],
      commentVotes: new Map(),
      submissionCountByAuthor: new Map([
        ["a".repeat(64), 2],
        ["b".repeat(64), 1]
      ]),
      rawEvents: [
        { id: "event-1", pubkey: "a".repeat(64), kind: 1, created_at: 1, tags: [], content: "" },
        { id: "event-2", pubkey: "b".repeat(64), kind: 1, created_at: 2, tags: [], content: "" }
      ]
    },
    null
  );

  assert.deepEqual(normalized.removedPubkeys, ["b".repeat(64)]);
  assert.equal(normalized.users.length, 1);
  assert.equal(normalized.users[0].pubkey, "a".repeat(64));
  assert.equal(normalized.entities.length, 1);
  assert.equal(normalized.entities[0].slug, "kept");
  assert.equal(normalized.approvedEntities.length, 1);
  assert.equal(normalized.drafts.length, 1);
  assert.equal(normalized.comments.length, 1);
  assert.equal(normalized.comments[0].id, "kept-comment");
  assert.equal(normalized.submissionCountByAuthor.has("b".repeat(64)), false);
  assert.equal(normalized.rawEvents.some((event) => event.pubkey === "b".repeat(64)), false);
});

test("normalizePublicState lets fresh removal state clear a stale cached removal", () => {
  const canonicalAux = "fb95955ef16311f57a75ec4cc4ce4c11d4c132d80557d10d09b23de72c1e51dd";
  const normalized = normalizePublicState(
    {
      removedPubkeys: [],
      removedUsers: [],
      users: [
        {
          pubkey: canonicalAux,
          username: "aux",
          claimedUsername: "aux",
          displayName: "Aux"
        }
      ],
      usernameRegistry: [
        {
          username: "aux",
          owner_pubkey: canonicalAux,
          claimant_pubkeys: [canonicalAux],
          conflict: false
        }
      ],
      allComments: [],
      comments: [],
      rawEvents: [{ id: "fresh-event", pubkey: canonicalAux, kind: 0, created_at: 2, tags: [], content: "" }]
    },
    {
      removedPubkeys: [canonicalAux],
      removedUsers: [{ pubkey: canonicalAux, claimedUsername: "aux", displayName: "Aux" }],
      users: [],
      allComments: [],
      comments: [],
      rawEvents: [{ id: "stale-event", pubkey: canonicalAux, kind: 0, created_at: 1, tags: [], content: "" }]
    }
  );

  assert.deepEqual(normalized.removedPubkeys, []);
  assert.deepEqual(normalized.removedUsers, []);
  assert.equal(normalized.users.length, 1);
  assert.equal(normalized.users[0].pubkey, canonicalAux);
});

test("publicState admin resolution follows the canonical identity chain", () => {
  const rootPubkey = "a".repeat(64);
  const rotatedPubkey = "b".repeat(64);
  const publicState = normalizePublicState(
    {
      connected: true,
      admins: [rootPubkey],
      rootAdminPubkey: rootPubkey,
      identityChain: {
        validLinks: [{ old_pubkey: rootPubkey, new_pubkey: rotatedPubkey }],
        pendingLinks: [],
        predecessorByPubkey: new Map([[rotatedPubkey, rootPubkey]]),
        successorByPubkey: new Map([[rootPubkey, rotatedPubkey]]),
        canonicalByPubkey: new Map([
          [rootPubkey, rootPubkey],
          [rotatedPubkey, rootPubkey]
        ]),
        membersByCanonical: new Map([[rootPubkey, [rootPubkey, rotatedPubkey]]])
      },
      users: [{ pubkey: rootPubkey, username: "aux", claimedUsername: "aux" }],
      allComments: [],
      comments: [],
      rawEvents: []
    },
    null
  );

  assert.equal(resolveCanonicalIdentityPubkey(publicState, rotatedPubkey), rootPubkey);
  assert.equal(publicStateHasAdminPubkey(publicState, rotatedPubkey), true);
});

test("applyOptimisticIdentityRotation immediately grants canonical admin continuity to the rotated pubkey", () => {
  const rootPubkey = "a".repeat(64);
  const rotatedPubkey = "b".repeat(64);
  const nextState = applyOptimisticIdentityRotation(
    normalizePublicState(
      {
        connected: false,
        admins: [rootPubkey],
        rootAdminPubkey: rootPubkey,
        users: [{ pubkey: rootPubkey, username: "aux", claimedUsername: "aux" }],
        allComments: [],
        comments: [],
        rawEvents: []
      },
      null
    ),
    rootPubkey,
    rotatedPubkey
  );

  assert.equal(resolveCanonicalIdentityPubkey(nextState, rotatedPubkey), rootPubkey);
  assert.equal(publicStateHasAdminPubkey(nextState, rotatedPubkey), true);
  assert.deepEqual(nextState.identityChain.membersByCanonical.get(rootPubkey), [rootPubkey, rotatedPubkey]);
});
