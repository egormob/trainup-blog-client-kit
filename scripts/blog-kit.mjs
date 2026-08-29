#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { readFile } from "node:fs/promises";

import { doctor } from "./lib/doctor.mjs";
import { buildProject, createArticle, initProject, verifyProject } from "./lib/project.mjs";
import { createPublishPlan, publishRelease, rollbackRelease } from "./lib/yandex.mjs";

function options(args) {
  const parsed = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      parsed._.push(value);
      continue;
    }
    const key = value.slice(2);
    if (key === "replace") parsed[key] = true;
    else parsed[key] = args[index += 1];
  }
  return parsed;
}

function showDoctor(result) {
  for (const check of result.checks) console.log(`${check.ok ? "✓" : "○"} ${check.label}`);
  console.log(`\nСледующее действие: ${result.nextAction}`);
}

async function loadPlan(root, flags) {
  const manifest = JSON.parse(await readFile(path.join(root, "output", "manifest.json"), "utf8"));
  return createPublishPlan({ bucket: flags.bucket, prefix: flags.prefix, manifest });
}

function showPublishPlan(plan) {
  console.log(`Бакет: ${plan.bucket}`);
  console.log(`Контрольный код: ${plan.candidateHash}`);
  console.log(`Объём: ${plan.totalBytes} байт`);
  console.log("Файлы в порядке загрузки:");
  for (const item of plan.uploads) {
    console.log(`- ${item.key} — ${item.bytes} байт, ${item.contentType}, ${item.cacheControl}`);
  }
  console.log("\nYandex Object Storage может тарифицироваться. До запуска получите явное подтверждение владельца именно этого контрольного кода.");
}

async function main() {
  const [command = "doctor", ...rest] = process.argv.slice(2);
  const flags = options(rest);
  const root = path.resolve(flags.root ?? process.cwd());

  if (command === "doctor") {
    const result = await doctor();
    showDoctor(result);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (command === "init") {
    const result = await initProject(root, { siteName: flags.name });
    console.log(result.created ? "Проект блога создан" : "Проект блога уже настроен; ваши файлы не изменены");
    return;
  }

  if (command === "create-article") {
    const result = await createArticle(root, {
      slug: flags.slug,
      template: flags.template ?? "basic",
      title: flags.title,
      replace: flags.replace === true,
    });
    console.log(`Черновик статьи создан: blog/articles/${result.slug}`);
    return;
  }

  if (command === "build") {
    const manifest = await buildProject(root);
    console.log(`Сборка готова: ${manifest.files.length} файлов, контрольный код ${manifest.candidateHash}`);
    return;
  }

  if (command === "verify") {
    const result = await verifyProject(root);
    if (!result.ok) {
      throw new Error(`Проверка не пройдена: ${result.failures.join(", ")}`);
    }
    console.log(`Проверка пройдена: ${result.candidateHash}`);
    return;
  }

  if (command === "publish-plan") {
    const plan = await loadPlan(root, flags);
    showPublishPlan(plan);
    return;
  }

  if (command === "publish") {
    const plan = await loadPlan(root, flags);
    const result = await publishRelease({
      projectRoot: root,
      outputRoot: path.join(root, "output"),
      plan,
      confirmHash: flags["confirm-hash"],
      profile: flags.profile,
    });
    const prefix = plan.prefix ? `/${plan.prefix}` : "";
    console.log(`Публикация проверена: https://${plan.bucket}.website.yandexcloud.net${prefix}/`);
    console.log(`Точка возврата: ${result.releaseId}`);
    return;
  }

  if (command === "rollback") {
    const result = await rollbackRelease({
      projectRoot: root,
      releaseId: flags.release,
      confirmHash: flags["confirm-hash"],
      profile: flags.profile,
    });
    console.log(`Версия ${result.releaseId} восстановлена и проверена`);
    return;
  }

  throw new Error(`Неизвестная команда: ${command}`);
}

main().catch((error) => {
  console.error(`Ошибка: ${error.message}`);
  process.exitCode = 1;
});
