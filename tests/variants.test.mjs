import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { applyVariant, resolveVariant, validateVariantRules } from "../scripts/lib/variants.mjs";

function fakeNode(id) {
  const attributes = new Map([["data-blog-element-id", id]]);
  return {
    id,
    textContent: "",
    children: [],
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    querySelectorAll() {
      return this.children;
    },
    append(child) {
      this.children = this.children.filter((candidate) => candidate !== child);
      this.children.push(child);
    },
  };
}

test("arbitrary UTM combinations select one allowlisted semantic patch", () => {
  const rules = [{
    id: "telegram-short",
    match: { utm_source: "telegram", offer: "short" },
    set: { "hero.title": { text: "Короткий заголовок" } },
  }];
  const result = resolveVariant(
    "https://example.test/?utm_source=telegram&offer=short&utm_campaign=launch",
    rules,
  );
  assert.equal(result.kind, "variant");
  assert.equal(result.id, "telegram-short");
  assert.deepEqual(result.set, rules[0].set);
});

test("duplicate referenced parameters fall back to editorial default", () => {
  const rules = [{ id: "a", match: { offer: "a" }, set: {} }];
  const result = resolveVariant("https://example.test/?offer=a&offer=a", rules);
  assert.deepEqual(result, { kind: "default", reason: "duplicate-parameter" });
});

test("unknown combinations fall back to editorial default", () => {
  const rules = [{ id: "a", match: { offer: "a" }, set: {} }];
  assert.deepEqual(
    resolveVariant("https://example.test/?offer=b", rules),
    { kind: "default", reason: "no-match" },
  );
});

test("ambiguous rules and unsafe mutations are rejected", () => {
  assert.throws(
    () => validateVariantRules([
      { id: "a", match: { offer: "one" }, set: {} },
      { id: "b", match: { offer: "one" }, set: {} },
    ]),
    /duplicate match/,
  );
  assert.throws(
    () => validateVariantRules([
      { id: "bad", match: { offer: "one" }, set: { "hero.title": { html: "<script>bad()</script>" } } },
    ]),
    /unsupported mutation/,
  );
  assert.throws(
    () => validateVariantRules([
      { id: "bad", match: { offer: "one" }, set: { "cta.primary": { href: "javascript:bad()" } } },
    ]),
    /unsafe href/,
  );
});

test("a query can never select two overlapping rules", () => {
  const rules = [
    { id: "source", match: { utm_source: "telegram" }, set: {} },
    { id: "source-offer", match: { utm_source: "telegram", offer: "short" }, set: {} },
  ];
  assert.deepEqual(
    resolveVariant("https://example.test/?utm_source=telegram&offer=short", rules),
    { kind: "default", reason: "ambiguous-match" },
  );
});

test("runtime changes only allowlisted semantic fields", () => {
  const title = fakeNode("hero.title");
  const cta = fakeNode("cta.primary");
  const first = fakeNode("case.first");
  const second = fakeNode("case.second");
  const list = fakeNode("cases");
  list.children = [first, second];
  const root = {
    querySelectorAll() {
      return [title, cta, list, first, second];
    },
  };

  assert.equal(applyVariant(root, {
    kind: "variant",
    set: {
      "hero.title": { text: "Новый заголовок" },
      "cta.primary": { href: "https://t.me/example" },
      cases: { order: ["case.second", "case.first"] },
      "missing.element": { text: "Не создаётся автоматически" },
    },
  }), true);

  assert.equal(title.textContent, "Новый заголовок");
  assert.equal(cta.getAttribute("href"), "https://t.me/example");
  assert.deepEqual(list.children.map((child) => child.id), ["case.second", "case.first"]);
});

test("browser runtime contains no raw HTML or code execution sink", async () => {
  const source = await readFile(new URL("../kit/shared/utm-runtime.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/);
});
