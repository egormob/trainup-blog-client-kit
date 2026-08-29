import { execFile } from "node:child_process";
import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { renderArticle } from "./build.mjs";
import { buildDiscovery } from "./discovery.mjs";
import { safeResolve, sha256, writeUserFile } from "./files.mjs";

const execFileAsync = promisify(execFile);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEMPLATES = new Set(["basic", "advanced"]);

async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function defaultRunner(args, options = {}) {
  const [command, ...commandArgs] = args;
  return execFileAsync(command, commandArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}

export async function ensureLocalRepository(projectRoot, runner = defaultRunner) {
  const root = path.resolve(projectRoot);
  if (await exists(path.join(root, ".git"))) return { created: false };
  await runner(["git", "init", "-b", "main"], { cwd: root });
  await runner(["git", "config", "--local", "user.name", "Blog Owner"], { cwd: root });
  await runner(["git", "config", "--local", "user.email", "blog@local.invalid"], { cwd: root });
  return { created: true };
}

export async function initProject(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  await mkdir(root, { recursive: true });
  for (const relative of [
    "blog/articles",
    "blog/assets",
    ".blog-state/backups",
    ".blog-state/releases",
    "output",
  ]) {
    await mkdir(safeResolve(root, relative), { recursive: true });
  }

  const sitePath = safeResolve(root, "blog/site.json");
  let created = false;
  if (!(await exists(sitePath))) {
    const examplePath = safeResolve(root, "blog/site.example.json");
    const example = JSON.parse(await readFile(examplePath, "utf8"));
    const site = { ...example, siteName: options.siteName || example.siteName };
    await writeUserFile("blog/site.json", `${JSON.stringify(site, null, 2)}\n`, { projectRoot: root });
    created = true;
  }

  const history = await ensureLocalRepository(root, options.runner ?? defaultRunner);
  return { created, historyCreated: history.created, root };
}

function assertArticleInput(slug, template) {
  if (!SLUG.test(String(slug ?? ""))) {
    throw new Error("Адрес статьи должен состоять из строчных латинских букв, цифр и дефисов");
  }
  if (!TEMPLATES.has(template)) throw new Error("Шаблон должен быть basic или advanced");
}

export async function createArticle(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const slug = String(options.slug ?? "");
  const template = String(options.template ?? "basic");
  assertArticleInput(slug, template);

  const sourceRoot = safeResolve(root, `kit/templates/${template}/example`);
  const article = JSON.parse(await readFile(path.join(sourceRoot, "article.json"), "utf8"));
  article.id = slug;
  article.route = `articles/${slug}`;
  article.template = template;
  if (options.title) article.title = String(options.title);
  const socialPath = new URL(article.socialImage, "https://example.test").pathname.split("/assets/")[1];
  if (socialPath) article.socialImage = `/articles/${slug}/assets/${socialPath}`;

  const content = await readFile(path.join(sourceRoot, "content.html"), "utf8");
  const relativeRoot = `blog/articles/${slug}`;
  const targets = [`${relativeRoot}/article.json`, `${relativeRoot}/content.html`];
  if (!options.replace) {
    for (const target of targets) {
      if (await exists(safeResolve(root, target))) {
        throw new Error(`Статья ${slug} уже существует; сначала покажите владельцу изменения`);
      }
    }
  }

  const articleResult = await writeUserFile(targets[0], `${JSON.stringify(article, null, 2)}\n`, {
    projectRoot: root,
    replace: options.replace === true,
  });
  const contentResult = await writeUserFile(targets[1], content, {
    projectRoot: root,
    replace: options.replace === true,
  });
  return { slug, template, articleResult, contentResult };
}

async function copyTemplateFiles(templateRoot, destination) {
  await cp(path.join(templateRoot, "styles.css"), path.join(destination, "styles.css"), { errorOnExist: false });
  for (const name of ["interactions.js", "assets"]) {
    const source = path.join(templateRoot, name);
    if (await exists(source)) await cp(source, path.join(destination, name), { recursive: true, errorOnExist: false });
  }
}

async function listFiles(root, current = root) {
  const result = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(root, absolute));
    else if (entry.isFile()) result.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return result.sort();
}

export async function buildProject(projectRoot) {
  const root = path.resolve(projectRoot);
  const site = JSON.parse(await readFile(safeResolve(root, "blog/site.json"), "utf8"));
  const articleRoot = safeResolve(root, "blog/articles");
  const stage = safeResolve(root, ".blog-state/build-next");
  const output = safeResolve(root, "output");
  await rm(stage, { recursive: true, force: true });
  await mkdir(stage, { recursive: true });

  const articles = [];
  const names = (await readdir(articleRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    const inputRoot = path.join(articleRoot, name);
    const article = JSON.parse(await readFile(path.join(inputRoot, "article.json"), "utf8"));
    const content = await readFile(path.join(inputRoot, "content.html"), "utf8");
    const templateRoot = safeResolve(root, `kit/templates/${article.template}`);
    const template = await readFile(path.join(templateRoot, "template.html"), "utf8");
    const runtime = await readFile(safeResolve(root, "kit/shared/utm-runtime.js"), "utf8");
    const rendered = renderArticle({ site, article, template, content, utmRuntimeSource: runtime });
    const destination = safeResolve(stage, article.route);
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, "index.html"), rendered.html);
    await copyTemplateFiles(templateRoot, destination);
    if (rendered.files.has("assets/blog-kit-utm-runtime.js")) {
      const runtimeTarget = safeResolve(stage, "assets/blog-kit-utm-runtime.js");
      await mkdir(path.dirname(runtimeTarget), { recursive: true });
      await writeFile(runtimeTarget, rendered.files.get("assets/blog-kit-utm-runtime.js"));
    }
    articles.push(rendered.article);
  }

  for (const [relative, value] of buildDiscovery(site, articles)) {
    await writeFile(safeResolve(stage, relative), value);
  }

  const generated = await listFiles(stage);
  const manifestFiles = [];
  for (const relative of generated) {
    const bytes = await readFile(safeResolve(stage, relative));
    manifestFiles.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const candidateHash = sha256(JSON.stringify(manifestFiles));
  const manifest = { version: 1, candidateHash, files: manifestFiles };
  await writeFile(safeResolve(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const previous = safeResolve(root, ".blog-state/build-previous");
  await rm(previous, { recursive: true, force: true });
  if (await exists(output)) await rename(output, previous);
  await rename(stage, output);
  return manifest;
}

export async function verifyProject(projectRoot) {
  const root = path.resolve(projectRoot);
  const output = safeResolve(root, "output");
  const manifest = JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8"));
  const failures = [];
  for (const expected of manifest.files) {
    const target = safeResolve(output, expected.path);
    try {
      const info = await stat(target);
      const bytes = await readFile(target);
      if (!info.isFile() || bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) failures.push(expected.path);
    } catch {
      failures.push(expected.path);
    }
  }
  return { ok: failures.length === 0, candidateHash: manifest.candidateHash, failures };
}
