import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { doctor } from "../scripts/lib/doctor.mjs";
import {
  buildProject,
  createArticle,
  ensureLocalRepository,
  initProject,
  verifyProject,
} from "../scripts/lib/project.mjs";

const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "trainup-blog-kit-onboarding-"));
  await mkdir(path.join(root, "blog"), { recursive: true });
  await writeFile(
    path.join(root, "blog", "site.example.json"),
    JSON.stringify({ siteName: "Мой блог", baseUrl: "https://example.test" }, null, 2),
  );
  return root;
}

test("init creates user zones once and never overwrites them", async () => {
  const root = await fixtureRoot();
  const calls = [];
  const first = await initProject(root, {
    siteName: "Мой блог",
    runner: async (args) => calls.push(args),
  });
  assert.equal(first.created, true);
  await writeFile(path.join(root, "blog", "site.json"), '{"owner":"user-edit"}');

  const second = await initProject(root, {
    siteName: "Другое",
    runner: async (args) => calls.push(args),
  });
  assert.equal(second.created, false);
  assert.equal(await readFile(path.join(root, "blog", "site.json"), "utf8"), '{"owner":"user-edit"}');
});

test("doctor reports one plain-language next action and never requires GitHub", async () => {
  const result = await doctor({
    platform: "win32",
    nodeVersion: "20.18.0",
    which: async (name) => ["node", "git"].includes(name),
  });
  assert.equal(result.ok, false);
  assert.match(result.nextAction, /Yandex Cloud CLI/);
  assert.equal(result.nextAction.split("\n").filter(Boolean).length, 1);
  assert.doesNotMatch(JSON.stringify(result), /GitHub CLI|\bgh\b|gh auth/i);
});

test("init creates computer-only version history without a hosting connection", async () => {
  const root = await fixtureRoot();
  const calls = [];
  await ensureLocalRepository(root, async (args) => calls.push(args));
  assert.deepEqual(calls[0], ["git", "init", "-b", "main"]);
  assert.deepEqual(calls[1], ["git", "config", "--local", "user.name", "Blog Owner"]);
  assert.deepEqual(calls[2], ["git", "config", "--local", "user.email", "blog@local.invalid"]);
  assert.equal(calls.some((args) => args.includes("remote")), false);
});

test("onboarding uses the exact novice-friendly source-storage choices", async () => {
  const paths = [
    "AGENTS.md",
    "README.md",
    ".agents/skills/trainup-blog-client-kit/SKILL.md",
    ".agents/skills/trainup-blog-client-kit/references/onboarding.md",
  ];
  const texts = await Promise.all(paths.map((relative) => readFile(path.join(publicRoot, relative), "utf8")));
  const combined = texts.join("\n");

  assert.match(combined, /Где хранить исходники и историю блога\?/);
  assert.match(combined, /Только на этом компьютере[^\n]*рекомендуется/);
  assert.match(combined, /Локально на компе \+ Гитхаб/);
  assert.doesNotMatch(combined, /локальн(?:ый|ого|ом)\s+Git|необязательн|\bremote\b/i);
  assert.doesNotMatch(combined, /gh auth|gh repo|GitHub CLI/i);
});

test("launchers use one dependency-free doctor on macOS and Windows", async () => {
  const mac = await readFile(path.join(publicRoot, "scripts", "install-macos.command"), "utf8");
  const windows = await readFile(path.join(publicRoot, "scripts", "install-windows.ps1"), "utf8");
  for (const source of [mac, windows]) {
    assert.match(source, /node.+blog-kit\.mjs.+doctor/is);
    assert.doesNotMatch(source, /npm install|yarn|pnpm|\bgh\b|curl|Invoke-WebRequest/i);
  }
});

test("agent instructions collect secrets outside chat and advance one action at a time", async () => {
  const text = await readFile(
    path.join(publicRoot, ".agents", "skills", "trainup-blog-client-kit", "references", "onboarding.md"),
    "utf8",
  );
  assert.match(text, /одно простое действие за раз/i);
  assert.match(text, /никогда[^\n]+(?:чат|сообщени)/i);
  assert.match(text, /Ключ сохранён/);
  assert.match(text, /значок терминала[^\n]+>_/i);
});

test("a clean folder can create, build and verify its first article", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "trainup-blog-kit-clean-"));
  await mkdir(path.join(root, "blog"), { recursive: true });
  await mkdir(path.join(root, ".git"), { recursive: true });
  await cp(path.join(publicRoot, "kit"), path.join(root, "kit"), { recursive: true });
  await cp(path.join(publicRoot, "blog", "site.example.json"), path.join(root, "blog", "site.example.json"));

  await initProject(root, { siteName: "Проверочный блог" });
  await createArticle(root, { slug: "first-article", template: "basic", title: "Первая статья" });
  const manifest = await buildProject(root);
  const verification = await verifyProject(root);

  assert.ok(manifest.files.some((file) => file.path === "articles/first-article/index.html"));
  assert.equal(verification.ok, true);
  assert.equal(verification.candidateHash, manifest.candidateHash);
});
