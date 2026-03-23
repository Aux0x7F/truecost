import { createRuntimeProjectionStore } from "./runtime-projection-store.js";

export function createContentPostStore({
  cacheKey,
  initialPosts = [],
  getCachedProjection = null,
  loadProjection = null,
  rememberProjection = null,
  subscribeProjection = null
} = {}) {
  const scopedParams = {
    cacheKey: String(cacheKey || "content-posts").trim() || "content-posts",
    __projectionScope: "global"
  };
  const postsProjection = createRuntimeProjectionStore({
    channel: "contentPosts",
    params: scopedParams,
    createDigest: createContentPostsDigest,
    refreshDelayMs: () => 0,
    shouldRefresh: () => true,
    deps: {
      ...(typeof getCachedProjection === "function"
        ? {
            getCachedProjection: () => getCachedProjection("contentPosts", scopedParams)
          }
        : {}),
      ...(typeof loadProjection === "function"
        ? {
            loadProjection: (force = false, reason = "content-posts") =>
              loadProjection("contentPosts", scopedParams, { preferFresh: Boolean(force), reason })
          }
        : {}),
      ...(typeof rememberProjection === "function"
        ? {
            rememberProjection: (value, meta = {}) =>
              createProjectionEnvelope(
                rememberProjection("contentPosts", scopedParams, value, meta),
                value
              )
          }
        : {}),
      ...(typeof subscribeProjection === "function"
        ? {
            subscribeProjection: (listener, options = {}) =>
              subscribeProjection("contentPosts", scopedParams, listener, options)
          }
        : {})
    }
  });

  let posts = clonePosts(Array.isArray(initialPosts) && initialPosts.length
    ? initialPosts
    : postsProjection.value);
  let postsPromise = null;

  postsProjection.subscribe(({ value }) => {
    if (Array.isArray(value)) {
      posts = clonePosts(value);
    }
  }, { emitCurrent: true });

  function current() {
    return clonePosts(posts);
  }

  async function hydrateCache() {
    const result = await postsProjection.hydrate({
      force: false,
      reason: "content-post-cache",
      requestRepair: false
    });
    if (Array.isArray(result?.value)) {
      posts = clonePosts(result.value);
    }
    return current();
  }

  async function remember(nextPosts) {
    posts = clonePosts(nextPosts);
    postsProjection.remember(posts, {
      notify: false,
      reason: "content-post-cache"
    });
    return current();
  }

  async function load() {
    if (postsPromise) return postsPromise;
    if (posts.length) return current();
    await hydrateCache();
    if (posts.length) return current();
    return refresh();
  }

  async function refresh() {
    if (postsPromise) return postsPromise;
    postsPromise = postsProjection.sync({
      force: true,
      reason: "content-post-refresh"
    })
      .then((result) => {
        if (Array.isArray(result?.value)) {
          posts = clonePosts(result.value);
        }
        return current();
      })
      .finally(() => {
        postsPromise = null;
      });
    return postsPromise;
  }

  return {
    current,
    hydrateCache,
    load,
    refresh,
    remember,
    subscribe: postsProjection.subscribe
  };
}

export function buildEntityUsage(posts, entities, collectEntityRefsFromText) {
  const usage = new Map();
  for (const post of Array.isArray(posts) ? posts : []) {
    const refs = new Set([
      ...(Array.isArray(post?.entity_refs) ? post.entity_refs : []),
      ...collectEntityRefsFromText(post?.body, entities)
    ]);
    for (const slug of refs) {
      const list = usage.get(slug) || [];
      list.push({
        slug: post.slug,
        title: post.title,
        date: post.date
      });
      usage.set(slug, list);
    }
  }
  return usage;
}

function createContentPostsDigest(posts) {
  return JSON.stringify(
    (Array.isArray(posts) ? posts : []).map((post) => [
      String(post?.slug || "").trim(),
      String(post?.date || "").trim(),
      String(post?.title || "").trim(),
      Array.isArray(post?.entity_refs) ? [...post.entity_refs] : []
    ])
  );
}

function createProjectionEnvelope(envelope, fallbackValue) {
  if (envelope && typeof envelope === "object" && "value" in envelope) {
    return envelope;
  }
  return {
    value: Array.isArray(envelope) ? envelope : fallbackValue ?? null,
    status: Array.isArray(envelope) || Array.isArray(fallbackValue) ? "ready" : "idle",
    digest: createContentPostsDigest(Array.isArray(envelope) ? envelope : fallbackValue),
    updatedAt: Date.now(),
    meta: {}
  };
}

function clonePosts(posts) {
  return Array.isArray(posts)
    ? posts.map((post) => ({
        ...post,
        tags: Array.isArray(post?.tags) ? [...post.tags] : post?.tags,
        entity_refs: Array.isArray(post?.entity_refs) ? [...post.entity_refs] : post?.entity_refs
      }))
    : [];
}
