import { validateVariantRules } from "./variants.mjs";

const ROUTE_PATTERN = /^[a-z0-9]+(?:[a-z0-9-]*)(?:\/[a-z0-9]+(?:[a-z0-9-]*))*$/;
const TEMPLATE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

function string(value, name, { min = 1, max = 10_000 } = {}) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) {
    throw new Error(`${name} must be a string between ${min} and ${max} characters`);
  }
  return value;
}

function httpsOrRoot(value, name) {
  string(value, name, { max: 2048 });
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error(`${name} must use HTTPS or a root-relative path`);
  return value;
}

export function validateSiteConfig(input) {
  const value = object(input, "site config");
  const footer = object(value.footer, "footer");
  const parsedBase = new URL(string(value.baseUrl, "baseUrl", { max: 2048 }));
  if (parsedBase.protocol !== "https:") throw new Error("baseUrl must use HTTPS");
  return {
    siteName: string(value.siteName, "siteName", { max: 160 }),
    baseUrl: parsedBase.href.replace(/\/$/, ""),
    language: string(value.language ?? "ru", "language", { max: 16 }),
    author: { name: string(object(value.author, "author").name, "author.name", { max: 160 }) },
    footer: {
      phone: string(footer.phone, "footer.phone", { max: 80 }),
      email: string(footer.email, "footer.email", { max: 254 }),
      inn: string(footer.inn, "footer.inn", { max: 32 }),
      ogrn: string(footer.ogrn, "footer.ogrn", { max: 32 }),
      telegramUrl: httpsOrRoot(footer.telegramUrl, "footer.telegramUrl"),
      offerUrl: httpsOrRoot(footer.offerUrl, "footer.offerUrl"),
      privacyUrl: httpsOrRoot(footer.privacyUrl, "footer.privacyUrl"),
    },
    geoDefault: value.geoDefault !== false,
  };
}

export function validateArticle(input) {
  const value = object(input, "article");
  const route = string(value.route, "article.route", { max: 180 });
  if (!ROUTE_PATTERN.test(route)) throw new Error("article.route contains unsafe characters");
  const template = string(value.template, "article.template", { max: 80 });
  if (!TEMPLATE_PATTERN.test(template)) throw new Error("article.template contains unsafe characters");
  const published = string(value.published, "article.published", { max: 10 });
  const modified = string(value.modified, "article.modified", { max: 10 });
  if (!DATE_PATTERN.test(published) || !DATE_PATTERN.test(modified)) throw new Error("article dates must use YYYY-MM-DD");
  const tags = value.tags ?? [];
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || tag.length > 80)) throw new Error("article.tags is invalid");
  const variants = validateVariantRules(value.variants ?? []);
  const assets = value.assets ?? {};
  object(assets, "article.assets");
  for (const [assetId, assetUrl] of Object.entries(assets)) {
    string(assetId, "article asset id", { max: 128 });
    httpsOrRoot(assetUrl, `article.assets.${assetId}`);
  }
  return {
    id: string(value.id, "article.id", { max: 128 }),
    route,
    template,
    title: string(value.title, "article.title", { max: 240 }),
    description: string(value.description, "article.description", { max: 500 }),
    published,
    modified,
    tags: [...tags],
    socialImage: httpsOrRoot(value.socialImage, "article.socialImage"),
    geo: value.geo !== false,
    variants,
    assets: { ...assets },
  };
}
