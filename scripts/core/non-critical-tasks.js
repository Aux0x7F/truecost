export function scheduleBackgroundTasks(tasks = [], { initialDelayMs = 0, gapMs = 96 } = {}) {
  const queue = Array.isArray(tasks) ? tasks.slice() : [];
  const scheduleNext = (delay = gapMs) => {
    if (!queue.length) return;
    scheduleNonCriticalTask(() => {
      const nextTask = queue.shift();
      try {
        nextTask?.();
      } catch {
        return;
      } finally {
        if (queue.length) scheduleNext(gapMs);
      }
    }, { initialDelayMs: delay });
  };
  scheduleNext(Math.max(0, initialDelayMs));
}

export function scheduleNonCriticalTask(task = () => {}, { initialDelayMs = 0 } = {}) {
  const run = () => {
    try {
      task?.();
    } catch {
      return;
    }
  };
  if (typeof window.requestIdleCallback === "function") {
    window.setTimeout(() => {
      window.requestIdleCallback(() => run(), { timeout: 2500 });
    }, Math.max(0, initialDelayMs));
    return;
  }
  window.setTimeout(run, Math.max(0, initialDelayMs));
}
