import { validateArticle, validateSiteConfig } from "./contracts.mjs";

const TEMPLATE_MARKERS = ["HEAD", "ARTICLE", "ANALYTICS-SLOT"];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function absoluteUrl(baseUrl, value) {
  return new URL(value, `${baseUrl.replace(/\/$/, "")}/`).href;
}

function routeUrl(site, article) {
  return `${site.baseUrl}/${article.route}/`;
}

function markerCount(source, marker) {
  const token = `<!-- BLOG-KIT:${marker} -->`;
  return source.split(token).length - 1;
}

function assertTemplate(template, content) {
  for (const marker of TEMPLATE_MARKERS) {
    const token = `<!-- BLOG-KIT:${marker} -->`;
    const count = markerCount(template, marker);
    if (count !== 1) throw new Error(`Template must contain exactly one ${marker} marker`);
    if (content.includes(token)) throw new Error(`Article content contains a reserved ${marker} marker`);
  }
  const footerCount = markerCount(template, "FOOTER") + markerCount(content, "FOOTER");
  if (footerCount !== 1) throw new Error("Template and article content must contain exactly one FOOTER marker in total");
}

function renderHead(site, article) {
  const canonical = routeUrl(site, article);
  const common = [
    `<title>${escapeHtml(article.title)}</title>`,
    `<meta name="description" content="${escapeHtml(article.description)}">`,
    `<meta name="robots" content="${article.geo ? "index,follow" : "noindex,follow"}">`,
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
  ];
  if (article.geo) {
    const image = absoluteUrl(site.baseUrl, article.socialImage);
    const structured = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: article.title,
      description: article.description,
      datePublished: article.published,
      dateModified: article.modified,
      author: { "@type": "Person", name: site.author.name },
      mainEntityOfPage: canonical,
      image: [image],
      keywords: article.tags.join(", "),
    };
    common.push(
      '<meta property="og:type" content="article">',
      `<meta property="og:title" content="${escapeHtml(article.title)}">`,
      `<meta property="og:description" content="${escapeHtml(article.description)}">`,
      `<meta property="og:url" content="${escapeHtml(canonical)}">`,
      `<meta property="og:image" content="${escapeHtml(image)}">`,
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="twitter:title" content="${escapeHtml(article.title)}">`,
      `<meta name="twitter:description" content="${escapeHtml(article.description)}">`,
      `<meta name="twitter:image" content="${escapeHtml(image)}">`,
      `<meta property="article:published_time" content="${escapeHtml(article.published)}">`,
      `<meta property="article:modified_time" content="${escapeHtml(article.modified)}">`,
      `<script type="application/ld+json">${safeJson(structured)}</script>`,
    );
  }
  if (article.variants.length > 0) {
    common.push(
      `<script id="blog-kit-utm-config" type="application/json">${safeJson({ rules: article.variants, assets: article.assets })}</script>`,
      '<script type="module" src="/assets/blog-kit-utm-runtime.js"></script>',
    );
  }
  return common.join("\n    ");
}

function renderFooter(footer) {
  return [
    '<footer class="article-footer" data-section-id="footer">',
    `  <p class="article-footer__legal"><a href="${escapeHtml(footer.offerUrl)}" rel="noopener">Создать публичную оферту</a> · <a href="${escapeHtml(footer.privacyUrl)}" rel="noopener">Создать политику обработки персональных данных</a></p>`,
    `  <p class="article-footer__requisites">ИНН ${escapeHtml(footer.inn)} · ОГРН ${escapeHtml(footer.ogrn)}</p>`,
    '  <address class="article-footer__contacts" aria-label="Контакты">',
    `    <a class="article-footer__telegram" href="${escapeHtml(footer.telegramUrl)}" rel="noopener">Связаться в Телеграм</a>`,
    '    <span class="article-footer__contact-details">',
    `      <a href="tel:${escapeHtml(footer.phone.replaceAll(/[^+\d]/g, ""))}">${escapeHtml(footer.phone)}</a>`,
    `      <a href="mailto:${escapeHtml(footer.email)}">${escapeHtml(footer.email)}</a>`,
    "    </span>",
    "  </address>",
    "</footer>",
  ].join("\n");
}

export function renderArticle(input) {
  const site = validateSiteConfig(input.site);
  const article = validateArticle(input.article);
  const template = String(input.template ?? "");
  const content = String(input.content ?? "");
  assertTemplate(template, content);
  const headingCount = (content.match(/<h1\b/gi) ?? []).length;
  if (headingCount !== 1) throw new Error("Article content must contain exactly one h1");
  if ((content.match(/<article\b/gi) ?? []).length !== 1) throw new Error("Article content must contain exactly one article element");

  let html = template;
  html = html.replace("<!-- BLOG-KIT:HEAD -->", renderHead(site, article));
  html = html.replace("<!-- BLOG-KIT:ARTICLE -->", content);
  html = html.replace("<!-- BLOG-KIT:FOOTER -->", renderFooter(site.footer));

  const files = new Map([[`${article.route}/index.html`, html]]);
  if (article.variants.length > 0 && input.utmRuntimeSource) {
    files.set("assets/blog-kit-utm-runtime.js", String(input.utmRuntimeSource));
  }
  return { html, files, site, article };
}
