function escapeHtml(value = "") {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderAttributes(attributes = {}) {
  return Object.entries(attributes)
    .filter(([, value]) => value !== null && value !== undefined && value !== false)
    .map(([key, value]) => {
      if (value === true) return key;
      return `${key}="${escapeHtml(value)}"`;
    })
    .join(" ");
}

function renderHead({ page, site, inlineStyles = "" }) {
  const preloadStyles = page.preloadStyles === false
    ? ""
    : '<link rel="preload" href="./styles.css" as="style">';
  const inlineStyleTag = String(inlineStyles || "").trim()
    ? `  <style data-inline-styles>${String(inlineStyles || "").trim()}</style>`
    : "";
  const extraStyles = (Array.isArray(page.extraStyles) ? page.extraStyles : [])
    .map((style) => {
      if (typeof style === "string") {
        return `<link rel="stylesheet" href="${escapeHtml(style)}">`;
      }
      return `<link ${renderAttributes({ rel: "stylesheet", ...(style || {}) })}>`;
    })
    .join("\n");

  const lines = [
    "<!doctype html>",
    `<html lang="${escapeHtml(site.lang || "en")}">`,
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeHtml(page.title)}</title>`,
    `  <meta name="description" content="${escapeHtml(page.description)}">`,
    site.themeColor ? `  <meta name="theme-color" content="${escapeHtml(site.themeColor)}">` : "",
    `  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(site.csp)}">`,
    `  <meta name="referrer" content="${escapeHtml(site.referrer || "strict-origin-when-cross-origin")}">`,
    `  <meta http-equiv="Permissions-Policy" content="${escapeHtml(site.permissionsPolicy || "camera=(), microphone=(), geolocation=()")}">`,
    '  <link rel="icon" href="./favicon.svg" type="image/svg+xml">',
    preloadStyles ? `  ${preloadStyles}` : "",
    inlineStyleTag,
    '  <link rel="stylesheet" href="./styles.css">',
    extraStyles,
    "</head>"
  ].filter((line) => String(line || "").trim().length > 0);
  return lines.join("\n");
}

function renderHeader({ site }) {
  return `
  <header class="site-header">
    <div class="wrap site-header__inner">
      <a class="brand" href="./index.html">
        <span class="brand__mark">${escapeHtml(site.brandMark)}</span>
        <span class="brand__text">
          <strong>${escapeHtml(site.brandTitle)}</strong>
          <span>${escapeHtml(site.brandTagline)}</span>
        </span>
      </a>
      <button class="nav-toggle" type="button" data-nav-toggle aria-label="Open navigation" title="Open navigation" aria-expanded="false" aria-controls="siteNav"></button>
      <nav id="siteNav" class="site-nav" data-site-nav></nav>
    </div>
  </header>`;
}

function renderFooter({ site }) {
  const renderLinks = (links = []) =>
    links
      .map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`)
      .join("");

  return `
  <footer class="site-footer">
    <div class="wrap site-footer__grid">
      <div>
        <div class="eyebrow" data-static-edit="footer.brand.eyebrow">${escapeHtml(site.footer.brandEyebrow)}</div>
        <h3 data-static-edit="footer.brand.title">${escapeHtml(site.footer.brandTitle)}</h3>
        <p data-static-edit="footer.brand.body">${escapeHtml(site.footer.brandBody)}</p>
      </div>
      <div>
        <h3>${escapeHtml(site.footer.columnOneTitle)}</h3>
        <ul>${renderLinks(site.footer.columnOneLinks)}</ul>
      </div>
      <div>
        <h3>${escapeHtml(site.footer.columnTwoTitle)}</h3>
        <ul>${renderLinks(site.footer.columnTwoLinks)}</ul>
      </div>
    </div>
  </footer>`;
}

function renderScripts({ page }) {
  const extraScripts = (Array.isArray(page.extraScripts) ? page.extraScripts : [])
    .map((script) => {
      if (typeof script === "string") {
        return `  <script src="${escapeHtml(script)}"></script>`;
      }
      return `  <script ${renderAttributes(script)}></script>`;
    })
    .join("\n");
  const entryScripts = (Array.isArray(page.entryScripts) ? page.entryScripts : [])
    .map((src) => `  <script type="module" src="${escapeHtml(src)}"></script>`)
    .join("\n");
  return [extraScripts, entryScripts].filter(Boolean).join("\n");
}

export function renderPageHtml({ page, site, mainHtml, inlineStyles = "" }) {
  return `${renderHead({ page, site, inlineStyles })}
<body data-page="${escapeHtml(page.dataPage)}">
${renderHeader({ site })}

  <div class="page-shell">
${String(mainHtml || "").trim()}
  </div>

${renderFooter({ site })}

${renderScripts({ page })}
</body>
</html>
`;
}

export default renderPageHtml;
