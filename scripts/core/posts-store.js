export function createContentPostStore({
  indexPath,
  contentDir,
  cacheKey,
  initialPosts = [],
  fetchJson,
  fetchText,
  parseContentDocument,
  slugify
} = {}) {
  let posts = clonePosts(initialPosts);
  let postsPromise = null;

  function current() {
    return clonePosts(posts);
  }

  function hydrateCache() {
    posts = loadCachedPosts(cacheKey);
    return current();
  }

  function remember(nextPosts) {
    posts = clonePosts(nextPosts);
    persistCachedPosts(cacheKey, posts);
    return current();
  }

  async function load() {
    if (postsPromise) return postsPromise;
    if (posts.length) return current();
    return refresh();
  }

  async function refresh() {
    if (postsPromise) return postsPromise;
    postsPromise = fetchJson(indexPath)
      .then((data) => Promise.all((Array.isArray(data.files) ? data.files : []).map((file) => loadOne(file))))
      .then((entries) => {
        const nextPosts = entries
          .filter(Boolean)
          .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
        remember(nextPosts);
        return current();
      })
      .catch((error) => {
        if (posts.length) return current();
        throw error;
      })
      .finally(() => {
        postsPromise = null;
      });
    return postsPromise;
  }

  async function loadOne(file) {
    const text = await fetchText(`${contentDir}/${file}`);
    const parsed = parseContentDocument(text, {
      file,
      slug: slugify(file.replace(/\.md$/i, ""))
    });
    return {
      ...parsed.meta,
      file,
      slug: parsed.meta.slug || slugify(file.replace(/\.md$/i, "")),
      body: parsed.body
    };
  }

  return {
    current,
    hydrateCache,
    load,
    refresh,
    remember
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

function clonePosts(posts) {
  return Array.isArray(posts)
    ? posts.map((post) => ({
        ...post,
        tags: Array.isArray(post?.tags) ? [...post.tags] : post?.tags,
        entity_refs: Array.isArray(post?.entity_refs) ? [...post.entity_refs] : post?.entity_refs
      }))
    : [];
}

function loadCachedPosts(cacheKey) {
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? clonePosts(parsed) : [];
  } catch {
    return [];
  }
}

function persistCachedPosts(cacheKey, posts) {
  try {
    window.localStorage.setItem(cacheKey, JSON.stringify(clonePosts(posts)));
  } catch {
    return;
  }
}
