export function applyObservedText(element, nextValue, { force = false } = {}) {
  if (!element) return false;
  const value = String(nextValue ?? "");
  if (!force && element.textContent === value) return false;
  element.textContent = value;
  return true;
}

export function applyObservedMarkup(element, nextValue, { force = false } = {}) {
  if (!element) return false;
  const value = String(nextValue ?? "");
  if (!force && element.innerHTML === value) return false;
  element.innerHTML = value;
  return true;
}

export function createObservedRegionRouter({ getElement = (selector) => document.querySelector(selector) } = {}) {
  const cache = new Map();

  function normalizeRegion(region = {}) {
    const name = String(region.name || region.selector || "");
    return {
      name,
      selector: region.selector || "",
      kind: region.kind === "text" ? "text" : "markup",
      element: region.element || null,
      value: String(region.value ?? "")
    };
  }

  function remember(regions = []) {
    for (const region of regions) {
      const next = normalizeRegion(region);
      if (!next.name) continue;
      cache.set(next.name, next.value);
    }
  }

  function reset() {
    cache.clear();
  }

  function apply(regions = [], { force = false } = {}) {
    const changed = new Set();
    for (const region of regions) {
      const next = normalizeRegion(region);
      if (!next.name) continue;
      const previous = cache.get(next.name);
      if (!force && previous === next.value) continue;
      const element = next.element || (next.selector ? getElement(next.selector) : null);
      const didChange =
        next.kind === "text"
          ? applyObservedText(element, next.value, { force })
          : applyObservedMarkup(element, next.value, { force });
      cache.set(next.name, next.value);
      if (didChange) changed.add(next.name);
    }
    return changed;
  }

  return {
    apply,
    remember,
    reset
  };
}
