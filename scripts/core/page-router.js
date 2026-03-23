function scheduleNextFrame(callback) {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
    return;
  }
  setTimeout(callback, 0);
}

export function createPageRouter({ page = "", schedule = scheduleNextFrame } = {}) {
  const routes = [];
  const alwaysHandlers = [];

  function when(routePages, handler) {
    const pages = Array.isArray(routePages) ? routePages : [routePages];
    routes.push({ pages, handler });
    return api;
  }

  function always(handler) {
    alwaysHandlers.push(handler);
    return api;
  }

  function mount() {
    schedule(() => {
      for (const route of routes) {
        if (route.pages.includes(page)) {
          route.handler();
        }
      }
      for (const handler of alwaysHandlers) {
        handler();
      }
    });
  }

  const api = {
    always,
    mount,
    when
  };

  return api;
}

export default createPageRouter;
