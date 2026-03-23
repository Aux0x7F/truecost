function defaultSchedule(task) {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(task, { timeout: 1200 });
    return;
  }
  setTimeout(task, 16);
}

export function createFeatureManifest(definitions = {}, { schedule = defaultSchedule } = {}) {
  const loaders = new Map(Object.entries(definitions));
  const cache = new Map();
  const preloadQueue = [];
  const queuedKeys = new Set();
  let preloadScheduled = false;

  function has(key) {
    return loaders.has(key);
  }

  function load(key) {
    if (!loaders.has(key)) {
      return Promise.reject(new Error(`Unknown feature manifest key: ${key}`));
    }
    if (!cache.has(key)) {
      cache.set(
        key,
        Promise.resolve()
          .then(() => loaders.get(key)())
      );
    }
    return cache.get(key);
  }

  function preload(keys = []) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const key of list) {
      if (!has(key) || cache.has(key) || queuedKeys.has(key)) continue;
      queuedKeys.add(key);
      preloadQueue.push(key);
    }
    schedulePreloadDrain();
  }

  function schedulePreloadDrain() {
    if (preloadScheduled || !preloadQueue.length) return;
    preloadScheduled = true;
    schedule(() => {
      preloadScheduled = false;
      const nextKey = preloadQueue.shift();
      if (!nextKey) return;
      queuedKeys.delete(nextKey);
      void load(nextKey)
        .catch(() => null)
        .finally(() => {
          schedulePreloadDrain();
        });
    });
  }

  return {
    has,
    load,
    preload
  };
}

export default createFeatureManifest;
