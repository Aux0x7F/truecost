import test from "node:test";
import assert from "node:assert/strict";

import { createContentPostStore } from "../scripts/core/posts-store.js";

test("content post store loads cached posts from runtime local state before network refresh", async () => {
  const store = createContentPostStore({
    cacheKey: "truecost.posts",
    initialPosts: [],
    getCachedProjection: () => null,
    loadProjection: async () => ([{ slug: "cached-post", title: "Cached post", date: "2026-03-21" }]),
    subscribeProjection: async () => () => {}
  });

  const posts = await store.load();

  assert.deepEqual(posts.map((post) => post.slug), ["cached-post"]);
  assert.deepEqual(store.current().map((post) => post.slug), ["cached-post"]);
});

test("content post store remembers refreshed posts through runtime local state", async () => {
  const store = createContentPostStore({
    cacheKey: "truecost.posts",
    initialPosts: [],
    getCachedProjection: () => null,
    loadProjection: async () => ([{
      slug: "example",
      title: "Example",
      summary: "Example",
      date: "2026-03-21",
      body: "Body"
    }]),
    subscribeProjection: async () => () => {}
  });

  const posts = await store.refresh();

  assert.deepEqual(posts.map((post) => post.slug), ["example"]);
  assert.deepEqual(store.current().map((post) => post.slug), ["example"]);
});
