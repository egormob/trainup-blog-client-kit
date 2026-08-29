import test from "node:test";
import assert from "node:assert/strict";

import { renderArticle } from "../scripts/lib/build.mjs";

const template = `<!doctype html>
<html lang="ru"><head><!-- BLOG-KIT:HEAD --><!-- BLOG-KIT:ANALYTICS-SLOT --></head>
<body><main><!-- BLOG-KIT:ARTICLE --></main><!-- BLOG-KIT:FOOTER --></body></html>`;

const site = {
  siteName: "Мой блог",
  baseUrl: "https://example.test",
  language: "ru",
  author: { name: "Автор" },
  footer: {
    phone: "+7 (000) 000-00-00",
    email: "vash@email.tut",
    inn: "000000000000",
    ogrn: "000000000000000",
    telegramUrl: "https://t.me/egor_bulygin",
    offerUrl: "https://getcourse.ru/blog/1209778#oferta",
    privacyUrl: "https://getcourse.ru/blog/1209778#politika-obrabotki",
  },
};

const article = {
  id: "example",
  route: "articles/example",
  template: "basic",
  title: "Заголовок статьи",
  description: "Описание статьи",
  published: "2026-08-29",
  modified: "2026-08-29",
  tags: ["пример"],
  socialImage: "/articles/example/social.jpg",
  geo: true,
  variants: [{
    id: "telegram",
    match: { utm_source: "telegram" },
    set: { "hero.title": { text: "Другой заголовок" } },
  }],
};

const content = `<article data-section-id="article"><header><h1 data-blog-element-id="hero.title">Заголовок статьи</h1></header><p>Текст</p><a data-blog-event="cta_click" data-blog-element-id="cta.primary" href="https://example.test">Кнопка</a></article>`;

test("indexable article receives canonical, social and Article metadata", () => {
  const { html, files } = renderArticle({ site, article, template, content, utmRuntimeSource: "window.blogKitUtm=true;" });
  assert.match(html, /name="robots" content="index,follow"/);
  assert.match(html, /rel="canonical" href="https:\/\/example\.test\/articles\/example\/"/);
  assert.match(html, /property="og:type" content="article"/);
  assert.match(html, /"@type":"Article"/);
  assert.match(html, /id="blog-kit-utm-config"/);
  assert.match(html, /<!-- BLOG-KIT:ANALYTICS-SLOT -->/);
  assert.equal(files.get("assets/blog-kit-utm-runtime.js"), "window.blogKitUtm=true;");
});

test("GEO-off article is noindex and has no bot discovery payload", () => {
  const { html } = renderArticle({ site, article: { ...article, geo: false }, template, content, utmRuntimeSource: "" });
  assert.match(html, /name="robots" content="noindex,follow"/);
  assert.doesNotMatch(html, /application\/ld\+json/);
  assert.doesNotMatch(html, /property="og:/);
});

test("renderer rejects missing or duplicate markers and heading drift", () => {
  assert.throws(() => renderArticle({ site, article, template: template.replace("<!-- BLOG-KIT:FOOTER -->", ""), content }), /FOOTER/);
  assert.throws(() => renderArticle({ site, article, template, content: `${content}<h1>Лишний</h1>` }), /exactly one h1/);
});

test("renderer can keep the shared footer at the article-owned design position", () => {
  const inlineFooterTemplate = template.replace("<!-- BLOG-KIT:FOOTER -->", "");
  const inlineFooterContent = content.replace("</article>", "<!-- BLOG-KIT:FOOTER --></article>");
  const { html } = renderArticle({ site, article, template: inlineFooterTemplate, content: inlineFooterContent });
  const footerIndex = html.indexOf('<footer class="article-footer"');
  const articleCloseIndex = html.lastIndexOf("</article>");
  assert.ok(footerIndex > 0 && footerIndex < articleCloseIndex);
  assert.equal((html.match(/<footer class="article-footer"/g) ?? []).length, 1);
});

test("footer preserves design weight and uses only safe placeholders", () => {
  const { html } = renderArticle({ site, article, template, content });
  assert.match(html, /vash@email\.tut/);
  assert.match(html, /ИНН 000000000000 · ОГРН 000000000000000/);
  assert.match(html, /<address class="article-footer__contacts"/);
  assert.match(html, /class="article-footer__telegram"/);
  assert.match(html, /Создать публичную оферту/);
  assert.match(html, /Создать политику обработки персональных данных/);
  assert.doesNotMatch(html, /<strong>\s*(?:ИНН|ОГРН|Вставьте сюда)/i);
  assert.doesNotMatch(html, /ИНН\s+(?!0{12}\b)\d{12}\b|ОГРН\s+(?!0{15}\b)\d{15}\b/);
});
