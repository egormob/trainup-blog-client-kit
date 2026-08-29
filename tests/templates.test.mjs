import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderArticle } from "../scripts/lib/build.mjs";

const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templatesRoot = path.join(publicRoot, "kit", "templates");

async function buildExample(name) {
  const root = path.join(templatesRoot, name);
  const [template, content, article, site, utmRuntimeSource] = await Promise.all([
    readFile(path.join(root, "template.html"), "utf8"),
    readFile(path.join(root, "example", "content.html"), "utf8"),
    readFile(path.join(root, "example", "article.json"), "utf8").then(JSON.parse),
    readFile(path.join(publicRoot, "blog", "site.example.json"), "utf8").then(JSON.parse),
    readFile(path.join(publicRoot, "kit", "shared", "utm-runtime.js"), "utf8"),
  ]);
  const result = renderArticle({ site, article, template, content, utmRuntimeSource });
  return { ...result, root, template, content };
}

async function readOptional(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function listFiles(root, relative = "") {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else files.push(child.split(path.sep).join("/"));
  }
  return files;
}

function localReferences(source) {
  const values = [];
  for (const match of source.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
    const value = match[1];
    if (value.startsWith("./") && !value.includes("?") && !value.includes("#")) values.push(value.slice(2));
  }
  for (const match of source.matchAll(/url\(["']?(\.\/[^)'"?#]+)["']?\)/gi)) {
    values.push(match[1].slice(2));
  }
  return [...new Set(values)];
}

const forbidden = [
  "kinescope",
  "Павел",
  "Лана",
  "data-oto",
  "offer-timer",
  "checkout-modal",
  "checkout-popup",
  "data-video",
  "video-modal",
  "mc.yandex.ru",
  "powerstate-metrica",
  "__TRAINUP",
  "data-trainup",
  "ltBlock",
  "how-to-get-training-cases-from-first-lesson",
  "how-to-switch-on-state-of-power",
];

for (const [name, expectedTitle, expectedDescription, cta, price] of [
  [
    "basic",
    "Как быстро получить первые кейсы и кратно увеличить продажи",
    "Как получить первые кейсы во время обучения, усилить мотивацию участников и использовать результаты для роста продаж.",
    "Получить сейчас",
    null,
  ],
  [
    "advanced",
    "Как «включить» состояние силы",
    "Как найти фоновое эмоциональное состояние, которое усиливает продажи, выступления и желание клиентов выбирать вас.",
    "К покупке",
    "30 000 руб.",
  ],
]) {
  test(`${name} contains the approved copy and no forbidden runtime`, async () => {
    const built = await buildExample(name);
    const styles = await readFile(path.join(built.root, "styles.css"), "utf8");
    const interactions = await readOptional(path.join(built.root, "interactions.js"));
    const completeSource = `${built.html}\n${styles}\n${interactions}`;
    assert.match(styles, /\.skip-link[\s\S]*translateY\(-180%\)/);
    assert.equal(built.article.title, expectedTitle);
    assert.equal(built.article.description, expectedDescription);
    assert.match(built.html, new RegExp(`<h1[^>]*>${expectedTitle}</h1>`));
    assert.match(built.html, new RegExp(cta));
    assert.match(built.html, /https:\/\/t\.me\/egor_bulygin/);
    if (price) assert.match(built.html, /30 000 руб\./);
    for (const marker of forbidden) assert.doesNotMatch(completeSource, new RegExp(marker, "i"));
    assert.match(built.html, /ИНН 000000000000 · ОГРН 000000000000000/);
    assert.match(built.html, /\+7 \(000\) 000-00-00/);
    assert.match(built.html, /vash@email\.tut/);
    assert.match(built.html, /getcourse\.ru\/blog\/1209778#oferta/);
    assert.match(built.html, /getcourse\.ru\/blog\/1209778#politika-obrabotki/);
    assert.doesNotMatch(built.html, /<strong>\s*(?:ИНН|ОГРН|Вставьте сюда)/i);
    assert.doesNotMatch(built.html, /ИНН\s+(?!0{12}\b)\d{12}\b|ОГРН\s+(?!0{15}\b)\d{15}\b/);
    assert.equal((built.html.match(/<h1\b/gi) ?? []).length, 1);
    assert.equal((built.html.match(/<!-- BLOG-KIT:ANALYTICS-SLOT -->/g) ?? []).length, 1);
    if (name === "basic") {
      assert.match(styles, /\.page\s*>\s*\.article-footer\s*\{[^}]*border-top:\s*0;/s);
      assert.match(styles, /\.page\s*>\s*\.article-footer::before\s*\{[^}]*width:\s*min\(78%, var\(--measure\)\);[^}]*background:\s*rgba\(20, 20, 20, 0\.055\);/s);
    }
    if (name === "advanced") {
      assert.match(styles, /\.proof-shot\s*\{[^}]*width:\s*min\(100%, 390px\);[^}]*margin:\s*22px auto 0;/s);
      assert.match(styles, /\.tariff-button\s*\{[^}]*text-decoration:\s*none;/s);
      assert.match(styles, /@media print[\s\S]*\.reviews-controls\s*,\s*\.tariff-button\s*\{[^}]*display:\s*none !important;/s);
      const footerIndex = built.html.indexOf('<footer class="article-footer"');
      const articleCloseIndex = built.html.lastIndexOf("</article>");
      assert.ok(footerIndex > 0 && footerIndex < articleCloseIndex, "advanced footer must stay inside the article card");
    }
  });

  test(`${name} has a closed local asset inventory`, async () => {
    const built = await buildExample(name);
    const styleSource = await readFile(path.join(built.root, "styles.css"), "utf8");
    const references = localReferences(`${built.template}\n${built.content}\n${styleSource}`);
    assert.ok(references.length > 0);
    for (const reference of references) await access(path.join(built.root, reference));
    const socialPrefix = `/templates/${name}/`;
    assert.ok(built.article.socialImage.startsWith(socialPrefix));
    await access(path.join(built.root, built.article.socialImage.slice(socialPrefix.length)));
    const files = await listFiles(built.root);
    assert.equal(files.some((file) => /(?:pavel|lana|poster)/i.test(file)), false);
  });
}

test("advanced keeps a single static commercial price and Telegram CTAs", async () => {
  const { html } = await buildExample("advanced");
  assert.equal((html.match(/30 000 руб\./g) ?? []).length, 1);
  assert.doesNotMatch(html, /<del\b|old.price|deadline|timer|950\s*₽|9 500/gi);
  const ctas = [...html.matchAll(/<a\b[^>]*class="[^"]*(?:tariff-button|article-cta)[^"]*"[^>]*href="([^"]+)"[^>]*>[\s\S]*?<span>([^<]+)<\/span>/gi)];
  assert.ok(ctas.length >= 3);
  for (const [, href, label] of ctas) {
    assert.equal(href, "https://t.me/egor_bulygin");
    assert.equal(label.trim(), "К покупке");
  }
});
