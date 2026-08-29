function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function articleUrl(site, article) {
  return `${site.baseUrl.replace(/\/$/, "")}/${article.route.replace(/^\/+|\/+$/g, "")}/`;
}

function isoDate(value) {
  return new Date(`${value}T00:00:00.000Z`).toISOString();
}

function safeJson(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function buildIndex(site, articles) {
  const baseUrl = site.baseUrl.replace(/\/$/, "");
  const cards = articles.map((article) => `
        <article class="card">
          <p class="date"><time datetime="${xml(article.published)}">${xml(article.published)}</time></p>
          <h2><a href="${xml(articleUrl(site, article))}">${xml(article.title)}</a></h2>
          <p>${xml(article.description)}</p>
          <a class="read" href="${xml(articleUrl(site, article))}">Читать статью <span aria-hidden="true">→</span></a>
        </article>`).join("");
  const structured = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: site.siteName,
    url: `${baseUrl}/`,
    blogPost: articles.map((article) => ({
      "@type": "BlogPosting",
      headline: article.title,
      url: articleUrl(site, article),
      datePublished: article.published,
      dateModified: article.modified,
    })),
  };
  return `<!doctype html>
<html lang="${xml(site.language ?? "ru")}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${xml(site.siteName)}</title>
    <meta name="description" content="Статьи блога ${xml(site.siteName)}">
    <meta name="robots" content="index,follow">
    <link rel="canonical" href="${xml(`${baseUrl}/`)}">
    <link rel="alternate" type="application/atom+xml" title="${xml(site.siteName)}" href="${xml(`${baseUrl}/feed.xml`)}">
    <script type="application/ld+json">${safeJson(structured)}</script>
    <style>
      :root{color-scheme:light;--bg:#f6f5f2;--card:#fff;--text:#171717;--muted:#706b65;--accent:#ffd21e;--line:rgba(23,23,23,.1)}
      *{box-sizing:border-box}html{-webkit-text-size-adjust:100%;text-size-adjust:100%;background:var(--bg)}
      body{margin:0;color:var(--text);background:linear-gradient(180deg,#fbfaf7,var(--bg) 420px);font-family:"YS Text","Helvetica Neue",Arial,sans-serif;font-size:18px;line-height:1.6}
      main{width:min(100% - 36px,980px);margin:0 auto;padding:clamp(52px,10vw,104px) 0 80px}
      header{max-width:720px;margin-bottom:clamp(34px,7vw,64px)}h1{margin:0;font-size:clamp(38px,8vw,72px);line-height:1.02;letter-spacing:-.035em}
      .lead{max-width:620px;margin:22px 0 0;color:var(--muted);font-size:clamp(18px,2.4vw,22px)}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:18px}
      .card{display:flex;min-width:0;min-height:270px;flex-direction:column;padding:clamp(24px,4vw,34px);border:1px solid var(--line);border-radius:20px;background:var(--card);box-shadow:0 20px 54px rgba(23,23,23,.06)}
      .date{margin:0 0 18px;color:var(--muted);font-size:14px}.card h2{margin:0;font-size:clamp(24px,4vw,32px);line-height:1.16;letter-spacing:-.02em}.card h2 a{text-decoration:none}.card h2 a:hover{text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:4px}
      .card>p:not(.date){margin:18px 0 28px;color:#3f3c39}.read{align-self:flex-start;margin-top:auto;padding:11px 16px;border-radius:999px;background:var(--accent);color:#171717;font-weight:700;text-decoration:none}.read:focus-visible,.card h2 a:focus-visible{outline:3px solid #1f5eff;outline-offset:4px}
      .empty{padding:28px;border:1px solid var(--line);border-radius:18px;background:var(--card);color:var(--muted)}
    </style>
  </head>
  <body>
    <main>
      <header><h1>${xml(site.siteName)}</h1><p class="lead">Статьи, материалы и обновления.</p></header>
      ${articles.length > 0 ? `<section class="grid" aria-label="Все статьи">${cards}\n      </section>` : '<p class="empty">Опубликованных статей пока нет.</p>'}
    </main>
  </body>
</html>
`;
}

export function buildDiscovery(site, articles) {
  const baseUrl = site.baseUrl.replace(/\/$/, "");
  const visible = [...articles].filter((article) => article.geo !== false);
  const sitemapEntries = visible.map((article) => [
    "  <url>",
    `    <loc>${xml(articleUrl(site, article))}</loc>`,
    `    <lastmod>${xml(article.modified)}</lastmod>`,
    "  </url>",
  ].join("\n")).join("\n");
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries}\n</urlset>\n`;

  const updated = visible.length > 0
    ? isoDate([...visible].sort((a, b) => b.modified.localeCompare(a.modified))[0].modified)
    : new Date(0).toISOString();
  const feedEntries = visible.map((article) => [
    "  <entry>",
    `    <title>${xml(article.title)}</title>`,
    `    <link href="${xml(articleUrl(site, article))}"/>`,
    `    <id>${xml(articleUrl(site, article))}</id>`,
    `    <updated>${xml(isoDate(article.modified))}</updated>`,
    `    <summary>${xml(article.description)}</summary>`,
    "  </entry>",
  ].join("\n")).join("\n");
  const feed = `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${xml(site.language ?? "ru")}">\n  <title>${xml(site.siteName)}</title>\n  <id>${xml(site.baseUrl)}</id>\n  <updated>${xml(updated)}</updated>\n${feedEntries}\n</feed>\n`;

  const cards = visible.map((article) => ({
    id: article.id,
    url: articleUrl(site, article),
    title: article.title,
    description: article.description,
    published: article.published,
    modified: article.modified,
    tags: article.tags ?? [],
  }));
  const inventory = `${JSON.stringify({ siteName: site.siteName, articles: cards }, null, 2)}\n`;
  const lines = visible.map((article) => `- [${article.title}](${articleUrl(site, article)}): ${article.description}`);
  const llms = `# ${site.siteName}\n\n## Articles\n\n${lines.join("\n")}\n`;
  const robots = `User-agent: *\nAllow: /\nSitemap: ${baseUrl}/sitemap.xml\n`;
  const index = buildIndex(site, visible);

  return new Map([
    ["index.html", index],
    ["sitemap.xml", sitemap],
    ["robots.txt", robots],
    ["feed.xml", feed],
    ["articles.json", inventory],
    ["llms.txt", llms],
  ]);
}
