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
    schedule(() => {
      for (const key of list) {
        if (!has(key)) continue;
        void load(key).catch(() => null);
      }
    });
  }

  return {
    has,
    load,
    preload
  };
}

export default createFeatureManifest;
