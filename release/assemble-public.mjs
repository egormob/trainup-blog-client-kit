#!/usr/bin/env node

import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { scanPublic } from "./scan-public.mjs";

const execFileAsync = promisify(execFile);

function safeRelative(value) {
  const relative = String(value ?? "");
  const parts = relative.split("/");
  if (
    !relative || path.posix.isAbsolute(relative) || relative.includes("\\") || /[*?\[\]{}!]/.test(relative)
    || parts.some((part) => !part || part === "." || part === ".." || part === ".git")
  ) {
    throw new Error(`Invalid allowlist path: ${relative}`);
  }
  return relative;
}

async function listSourceFiles(root, current = root, result = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const info = await lstat(absolute);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (info.isSymbolicLink()) {
      result.push({ path: relative, type: "symlink" });
    } else if (info.isDirectory()) {
      await listSourceFiles(root, absolute, result);
    } else if (info.isFile()) {
      result.push({ path: relative, type: "file" });
    }
  }
  return result;
}

async function readAllowlist(value) {
  if (typeof value === "string") return JSON.parse(await readFile(value, "utf8"));
  return value;
}

export async function assemblePublic(options = {}) {
  const sourceRoot = path.resolve(options.sourceRoot ?? "");
  const outputRoot = path.resolve(options.outputRoot ?? "");
  if (!options.sourceRoot || !options.outputRoot || sourceRoot === outputRoot) throw new Error("Distinct sourceRoot and outputRoot are required");
  const outputInfo = await lstat(outputRoot).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (outputInfo?.isSymbolicLink()) throw new Error("Output directory cannot be a symlink");
  if (outputInfo && !outputInfo.isDirectory()) throw new Error("Output path must be a directory");
  if (!outputInfo) await mkdir(outputRoot, { recursive: true });
  if ((await readdir(outputRoot)).length !== 0) throw new Error("Output directory must be empty");

  const allowlist = await readAllowlist(options.allowlist);
  if (!allowlist || !Array.isArray(allowlist.files) || allowlist.files.length === 0) throw new Error("Allowlist must contain explicit files");
  const files = allowlist.files.map(safeRelative);
  if (new Set(files).size !== files.length) throw new Error("Allowlist contains duplicates");
  const sorted = [...files].sort();
  if (JSON.stringify(files) !== JSON.stringify(sorted)) throw new Error("Allowlist must be sorted");

  const sourceEntries = await listSourceFiles(sourceRoot);
  const allowed = new Set(files);
  for (const entry of sourceEntries) {
    if (entry.type === "symlink") throw new Error(`Symlink is forbidden: ${entry.path}`);
    if (!allowed.has(entry.path)) throw new Error(`Source file is not allowlisted: ${entry.path}`);
  }
  const present = new Set(sourceEntries.filter((entry) => entry.type === "file").map((entry) => entry.path));
  for (const relative of files) {
    if (!present.has(relative)) throw new Error(`Allowlisted file is missing: ${relative}`);
    const source = path.join(sourceRoot, ...relative.split("/"));
    const destination = path.join(outputRoot, ...relative.split("/"));
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Allowlisted path is not a regular file: ${relative}`);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination, constants.COPYFILE_EXCL);
  }

  const scan = await scanPublic(outputRoot, {productionTemplates: options.productionTemplates === true});
  if (!scan.ok) {
    const error = new Error(`Public candidate failed safety scan: ${scan.findings.map((item) => `${item.type}:${item.path}`).join(", ")}`);
    error.report = scan;
    throw error;
  }
  let cleanInstall = null;
  if (options.cleanInstall === true) {
    await execFileAsync(process.execPath, ["--test"], { cwd: outputRoot, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    const verification = await execFileAsync(process.execPath, ["scripts/verify-package.mjs"], {
      cwd: outputRoot,
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    cleanInstall = { ok: true, command: "node --test && node scripts/verify-package.mjs", output: verification.stdout.trim() };
  }
  return { root: outputRoot, allowlistedFiles: files, scan, manifest: scan.manifest, cleanInstall };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const [sourceRoot, outputRoot, allowlistPath] = process.argv.slice(2);
  const report = await assemblePublic({ sourceRoot, outputRoot, allowlist: allowlistPath, cleanInstall: true, productionTemplates: process.argv.includes("--production-templates") });
  console.log(JSON.stringify(report, null, 2));
}
