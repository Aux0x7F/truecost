export function setText(selector, value, root = document) {
  const node = root?.querySelector?.(selector);
  if (node instanceof HTMLElement) {
    node.textContent = value;
  }
}

export function setHrefFor(selector, href, root = document) {
  const node = root?.querySelector?.(selector);
  if (node instanceof HTMLAnchorElement) {
    node.href = href;
  }
}

export function scrollElementWithinContainer(container, target, options = {}) {
  if (!(container instanceof HTMLElement) || !(target instanceof HTMLElement)) {
    return false;
  }
  const scrollRange = Math.max(0, container.scrollHeight - container.clientHeight);
  if (scrollRange <= 0) return false;

  const padding = Number.isFinite(options.padding) ? Number(options.padding) : 16;
  const behavior = options.behavior === "smooth" ? "smooth" : "auto";
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const currentTop = container.scrollTop;
  const targetTop = currentTop + (targetRect.top - containerRect.top);
  const targetBottom = currentTop + (targetRect.bottom - containerRect.top);
  const visibleTop = currentTop + padding;
  const visibleBottom = currentTop + container.clientHeight - padding;

  let nextTop = currentTop;
  if (targetTop < visibleTop) {
    nextTop = targetTop - padding;
  } else if (targetBottom > visibleBottom) {
    nextTop = targetBottom - container.clientHeight + padding;
  }

  nextTop = Math.max(0, Math.min(scrollRange, nextTop));
  if (Math.abs(nextTop - currentTop) < 1) return false;

  if (behavior === "smooth" && typeof container.scrollTo === "function") {
    container.scrollTo({ top: nextTop, behavior });
  } else {
    container.scrollTop = nextTop;
  }
  return true;
}
