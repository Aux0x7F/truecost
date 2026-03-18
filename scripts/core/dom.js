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
