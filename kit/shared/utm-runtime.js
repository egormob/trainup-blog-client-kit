const PARAMETER_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ELEMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VALUE_LIMIT = 256;

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function assertSafeHref(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    throw new Error("unsafe href");
  }
  if (value.startsWith("/") && !value.startsWith("//")) return;
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("unsafe href");
}

function validateMutation(elementId, mutation) {
  if (!ELEMENT_PATTERN.test(elementId)) throw new Error(`invalid element id: ${elementId}`);
  if (!mutation || typeof mutation !== "object" || Array.isArray(mutation)) {
    throw new Error(`unsupported mutation for ${elementId}`);
  }
  const keys = Object.keys(mutation);
  if (keys.length !== 1 || !["text", "href", "src", "order"].includes(keys[0])) {
    throw new Error(`unsupported mutation for ${elementId}`);
  }
  const [kind] = keys;
  const value = mutation[kind];
  if (kind === "text" && (typeof value !== "string" || value.length > 10_000)) {
    throw new Error(`invalid text mutation for ${elementId}`);
  }
  if (kind === "href") assertSafeHref(value);
  if (kind === "src" && (typeof value !== "string" || !ELEMENT_PATTERN.test(value))) {
    throw new Error(`invalid asset id for ${elementId}`);
  }
  if (kind === "order") {
    if (!Array.isArray(value) || value.length === 0 || new Set(value).size !== value.length) {
      throw new Error(`invalid order mutation for ${elementId}`);
    }
    for (const childId of value) {
      if (typeof childId !== "string" || !ELEMENT_PATTERN.test(childId)) {
        throw new Error(`invalid ordered element id for ${elementId}`);
      }
    }
  }
}

export function validateVariantRules(rules = []) {
  if (!Array.isArray(rules)) throw new Error("variant rules must be an array");
  const ids = new Set();
  const signatures = new Set();

  for (const rule of rules) {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new Error("invalid variant rule");
    if (typeof rule.id !== "string" || !ELEMENT_PATTERN.test(rule.id) || ids.has(rule.id)) {
      throw new Error(`invalid or duplicate variant id: ${rule.id ?? ""}`);
    }
    ids.add(rule.id);
    if (!rule.match || typeof rule.match !== "object" || Array.isArray(rule.match) || Object.keys(rule.match).length === 0) {
      throw new Error(`variant ${rule.id} must declare a match`);
    }
    const pairs = Object.entries(rule.match).sort(([a], [b]) => a.localeCompare(b));
    for (const [parameter, value] of pairs) {
      if (!PARAMETER_PATTERN.test(parameter)) throw new Error(`invalid parameter: ${parameter}`);
      if (typeof value !== "string" || value.length === 0 || value.length > VALUE_LIMIT) {
        throw new Error(`invalid value for ${parameter}`);
      }
    }
    const signature = JSON.stringify(pairs);
    if (signatures.has(signature)) throw new Error(`duplicate match for variant ${rule.id}`);
    signatures.add(signature);
    if (!rule.set || typeof rule.set !== "object" || Array.isArray(rule.set)) {
      throw new Error(`variant ${rule.id} must declare a set`);
    }
    for (const [elementId, mutation] of Object.entries(rule.set)) validateMutation(elementId, mutation);
  }
  return rules;
}

export function resolveVariant(inputUrl, rules = []) {
  validateVariantRules(rules);
  const url = inputUrl instanceof URL ? inputUrl : new URL(inputUrl);
  const referenced = new Set(rules.flatMap((rule) => Object.keys(rule.match)));
  for (const parameter of referenced) {
    if (url.searchParams.getAll(parameter).length > 1) {
      return { kind: "default", reason: "duplicate-parameter" };
    }
  }
  const matches = rules.filter((rule) => Object.entries(rule.match).every(
    ([parameter, value]) => url.searchParams.get(parameter) === value,
  ));
  if (matches.length === 0) return { kind: "default", reason: "no-match" };
  if (matches.length > 1) return { kind: "default", reason: "ambiguous-match" };
  return { kind: "variant", id: matches[0].id, set: matches[0].set };
}

function findElement(root, elementId) {
  return [...root.querySelectorAll("[data-blog-element-id]")].find(
    (node) => node.getAttribute("data-blog-element-id") === elementId,
  ) ?? null;
}

export function applyVariant(root, selection, assets = {}) {
  if (selection?.kind !== "variant") return false;
  for (const [elementId, mutation] of Object.entries(selection.set)) {
    const node = findElement(root, elementId);
    if (!node) continue;
    if (own(mutation, "text")) node.textContent = mutation.text;
    if (own(mutation, "href")) {
      assertSafeHref(mutation.href);
      node.setAttribute("href", mutation.href);
    }
    if (own(mutation, "src")) {
      const source = assets[mutation.src];
      if (typeof source !== "string") continue;
      assertSafeHref(source.startsWith("/") ? source : new URL(source).href);
      node.setAttribute("src", source);
    }
    if (own(mutation, "order")) {
      const children = mutation.order.map((childId) => findElement(node, childId));
      if (children.every(Boolean)) children.forEach((child) => node.append(child));
    }
  }
  return true;
}

export function bootUtmRuntime(windowObject = globalThis.window, documentObject = globalThis.document) {
  const configNode = documentObject?.getElementById("blog-kit-utm-config");
  if (!windowObject || !documentObject || !configNode) return { kind: "default", reason: "missing-config" };
  try {
    const config = JSON.parse(configNode.textContent || "{}");
    const selection = resolveVariant(windowObject.location.href, config.rules ?? []);
    applyVariant(documentObject, selection, config.assets ?? {});
    documentObject.documentElement.dataset.blogVariant = selection.kind === "variant" ? selection.id : "default";
    return selection;
  } catch (_error) {
    documentObject.documentElement.dataset.blogVariant = "default";
    return { kind: "default", reason: "invalid-config" };
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") bootUtmRuntime(window, document);
