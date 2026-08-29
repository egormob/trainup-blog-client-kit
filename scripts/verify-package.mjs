#!/usr/bin/env node

import assert from "node:assert/strict";
import { access, cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildProject, createArticle, initProject, verifyProject } from "./lib/project.mjs";

const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "AGENTS.md",
  "README.md",
  ".agents/skills/trainup-blog-client-kit/SKILL.md",
  "kit/templates/basic/template.html",
  "kit/templates/advanced/template.html",
  "scripts/blog-kit.mjs",
];

for (const relative of required) await access(path.join(publicRoot, relative));

const instructions = `${await readFile(path.join(publicRoot, "AGENTS.md"), "utf8")}\n${await readFile(path.join(publicRoot, "README.md"), "utf8")}`;
assert.match(instructions, /Только на этом компьютере[^\n]*рекомендуется/);
assert.match(instructions, /Локально на компе \+ Гитхаб/);
assert.doesNotMatch(instructions, /локальн(?:ый|ого|ом)\s+Git|необязательн|\bremote\b|gh auth|gh repo|GitHub CLI/i);

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "trainup-blog-kit-verify-"));
try {
  await mkdir(path.join(temporaryRoot, "blog"), { recursive: true });
  await mkdir(path.join(temporaryRoot, ".git"), { recursive: true });
  await cp(path.join(publicRoot, "kit"), path.join(temporaryRoot, "kit"), { recursive: true });
  await cp(path.join(publicRoot, "blog", "site.example.json"), path.join(temporaryRoot, "blog", "site.example.json"));
  await initProject(temporaryRoot, { siteName: "Проверочный блог" });
  await createArticle(temporaryRoot, { slug: "basic-example", template: "basic" });
  await createArticle(temporaryRoot, { slug: "advanced-example", template: "advanced" });
  const manifest = await buildProject(temporaryRoot);
  const verification = await verifyProject(temporaryRoot);
  assert.equal(verification.ok, true);
  for (const relative of [
    "index.html",
    "articles/basic-example/index.html",
    "articles/advanced-example/index.html",
    "sitemap.xml",
    "feed.xml",
    "articles.json",
    "llms.txt",
  ]) {
    await access(path.join(temporaryRoot, "output", relative));
  }
  console.log(JSON.stringify({ ok: true, files: manifest.files.length, candidateHash: manifest.candidateHash }));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
