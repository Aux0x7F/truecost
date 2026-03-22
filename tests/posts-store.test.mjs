import test from "node:test";
import assert from "node:assert/strict";

import { createContentPostStore } from "../scripts/core/posts-store.js";

test("content post store loads cached posts from runtime local state before network refresh", async () => {
  const store = createContentPostStore({
    indexPath: "./content/investigations/index.json",
    contentDir: "./content/investigations",
    cacheKey: "truecost.posts",
    initialPosts: [],
    fetchJson: async () => ({ files: [] }),
    fetchText: async () => "",
    parseContentDocument: () => ({ meta: {}, body: "" }),
    slugify: (value) => value,
    loadCachedPosts: async () => ([{ slug: "cached-post", title: "Cached post", date: "2026-03-21" }]),
    rememberCachedPosts: async () => {}
  });

  const posts = await store.load();

  assert.deepEqual(posts.map((post) => post.slug), ["cached-post"]);
  assert.deepEqual(store.current().map((post) => post.slug), ["cached-post"]);
});

test("content post store remembers refreshed posts through runtime local state", async () => {
  const remembered = [];
  const store = createContentPostStore({
    indexPath: "./content/investigations/index.json",
    contentDir: "./content/investigations",
    cacheKey: "truecost.posts",
    initialPosts: [],
    fetchJson: async () => ({ files: ["example.md"] }),
    fetchText: async () => "---\ntitle: Example\nsummary: Example\n---\nBody",
    parseContentDocument: () => ({
      meta: {
        title: "Example",
        summary: "Example",
        date: "2026-03-21"
      },
      body: "Body"
    }),
    slugify: (value) => value.replace(/\.md$/i, ""),
    loadCachedPosts: async () => [],
    rememberCachedPosts: async (...args) => {
      remembered.push(args);
    }
  });

  const posts = await store.refresh();

  assert.deepEqual(posts.map((post) => post.slug), ["example"]);
  assert.equal(remembered.length, 1);
  assert.equal(remembered[0][0], "contentPosts");
  assert.deepEqual(remembered[0][1], { cacheKey: "truecost.posts" });
});
