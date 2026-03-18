import { escapeAttribute, escapeHtml } from "./text-utils.js";

export function buildToc(article, target) {
  if (!(target instanceof HTMLElement) || !(article instanceof HTMLElement)) return;
  const items = [...article.querySelectorAll("h2, h3")];
  if (!items.length) {
    target.innerHTML = "<p>No sections available.</p>";
    return;
  }
  target.innerHTML = items
    .map(
      (item) => `
        <a class="toc-link toc-link--${item.tagName.toLowerCase()}" href="#${escapeAttribute(item.id)}">
          ${escapeHtml(item.textContent || "")}
        </a>
      `
    )
    .join("");
}

export function renderError(node, message) {
  if (!(node instanceof HTMLElement)) return;
  node.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

export function renderLoadingState(message) {
  const reloadHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `
    <div class="loading-state loading-state--panel" role="status" aria-live="polite">
      <div class="loading-state__message">
        <span class="loading-spinner" aria-hidden="true"></span>
        <span>${escapeHtml(message)}</span>
      </div>
      <div class="loading-state__slow">
        <span>This is taking longer than expected.</span>
        <a class="button-ghost loading-state__reload" href="${escapeAttribute(reloadHref)}">Reload</a>
      </div>
    </div>
  `;
}

export function renderTagList(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => `<a class="tag tag--link" href="./investigations.html?tag=${encodeURIComponent(String(tag || "").trim())}">${escapeHtml(String(tag))}</a>`)
    .join("");
}

export function renderRecordList(records) {
  if (!Array.isArray(records) || !records.length) {
    return `<div class="empty-state">No structured notes attached to this post.</div>`;
  }
  return records
    .map((record) => {
      const label = escapeHtml(String(record.label || "Untitled note"));
      const note = record.note ? `<small>${escapeHtml(String(record.note))}</small>` : "";
      if (record.href) {
        return `<a class="record-item" href="${escapeAttribute(record.href)}"><strong>${label}</strong>${note}</a>`;
      }
      return `<div class="record-item"><strong>${label}</strong>${note}</div>`;
    })
    .join("");
}

export function renderMiniMarkdown(markdown, sanitizeTrustedHtml) {
  return renderMarkedHtml(markdown, { breaks: true }, sanitizeTrustedHtml);
}

export function renderMarkedHtml(markdown, options = {}, sanitizeTrustedHtml = (value) => String(value || "")) {
  const source = String(markdown || "").trim();
  if (!source) return "";
  if (window.marked) {
    window.marked.setOptions({ gfm: true, breaks: Boolean(options.breaks) });
    const html = window.marked.parse(source);
    return sanitizeTrustedHtml(options.articleImages ? transformArticleImageMarkup(html) : html);
  }
  return sanitizeTrustedHtml(renderBasicMarkdown(source, options));
}

export function transformArticleImageMarkup(rawHtml) {
  if (typeof document === "undefined") return String(rawHtml || "");
  const template = document.createElement("template");
  template.innerHTML = String(rawHtml || "");
  for (const image of template.content.querySelectorAll("img")) {
    const parent = image.parentElement;
    if (!(parent instanceof HTMLElement) || parent.tagName !== "P") continue;
    const onlyImage = [...parent.childNodes].every((node) => {
      if (node === image) return true;
      return node.nodeType === Node.TEXT_NODE && !String(node.textContent || "").trim();
    });
    if (!onlyImage) continue;
    const spec = parseArticleImageSpec(image.getAttribute("title") || "");
    const figure = document.createElement("figure");
    figure.className = `article-image article-image--${spec.align}`;
    image.loading = "lazy";
    image.decoding = "async";
    image.removeAttribute("title");
    figure.append(image);
    if (spec.caption) {
      const caption = document.createElement("figcaption");
      caption.textContent = spec.caption;
      figure.append(caption);
    }
    parent.replaceWith(figure);
  }
  return template.innerHTML;
}

export function renderBasicMarkdown(markdown, options = {}) {
  const escaped = escapeHtml(String(markdown || ""));
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, options.breaks ? "<br>" : " ")}</p>`)
    .join("");
}

export function trimmed(value, length) {
  const text = String(value || "").trim();
  return text.length > length ? `${text.slice(0, Math.max(0, length - 1))}...` : text;
}

function parseArticleImageSpec(rawTitle) {
  const title = String(rawTitle || "").trim();
  if (!title) return { align: "full", caption: "" };
  const [alignPart, ...captionParts] = title.split("|");
  const alignMatch = String(alignPart || "").trim().match(/^align:(left|right|full)$/i);
  return {
    align: alignMatch ? alignMatch[1].toLowerCase() : "full",
    caption: captionParts.join("|").trim()
  };
}
