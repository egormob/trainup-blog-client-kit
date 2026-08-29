import test from "node:test";
import assert from "node:assert/strict";

import { buildDiscovery } from "../scripts/lib/discovery.mjs";

const site = {
  siteName: "Мой блог",
  baseUrl: "https://example.test",
  language: "ru",
  author: { name: "Автор" },
};

const article = {
  id: "public-article",
  route: "articles/public-article",
  title: "Публичная статья",
  description: "Описание публичной статьи",
  published: "2026-08-29",
  modified: "2026-08-29",
  tags: ["обучение"],
  socialImage: "/assets/social.jpg",
  geo: true,
};

test("GEO on generates every discovery surface from one article list", () => {
  const files = buildDiscovery(site, [article]);
  assert.deepEqual(
    [...files.keys()].sort(),
    ["articles.json", "feed.xml", "index.html", "llms.txt", "robots.txt", "sitemap.xml"],
  );
  assert.equal(
    files.get("robots.txt"),
    "User-agent: *\nAllow: /\nSitemap: https://example.test/sitemap.xml\n",
  );
  assert.match(files.get("sitemap.xml"), /https:\/\/example\.test\/articles\/public-article\//);
  assert.match(files.get("feed.xml"), /Публичная статья/);
  assert.match(files.get("llms.txt"), /Описание публичной статьи/);
  assert.match(files.get("index.html"), /href="https:\/\/example\.test\/articles\/public-article\/"/);
  assert.match(files.get("index.html"), /Публичная статья/);
  assert.equal(JSON.parse(files.get("articles.json")).articles.length, 1);
});

test("GEO off omits the route from every discovery surface", () => {
  const files = buildDiscovery(site, [{ ...article, id: "private", route: "private", geo: false }]);
  for (const value of files.values()) assert.doesNotMatch(value, /\/private\//);
  assert.equal(JSON.parse(files.get("articles.json")).articles.length, 0);
});

test("discovery output escapes editorial text", () => {
  const files = buildDiscovery(site, [{ ...article, title: "A & <B>" }]);
  assert.match(files.get("sitemap.xml"), /public-article/);
  assert.match(files.get("feed.xml"), /A &amp; &lt;B&gt;/);
});
