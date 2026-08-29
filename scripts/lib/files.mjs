import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export function safeResolve(projectRoot, relativePath) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error("Destination must be a non-empty relative path");
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error("Destination must be a relative path");
  }

  const root = path.resolve(projectRoot);
  const target = path.resolve(root, relativePath);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Destination is outside project root");
  }
  return target;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function rejectSymlinkParents(projectRoot, target) {
  const root = path.resolve(projectRoot);
  const parent = path.dirname(target);
  const relative = path.relative(root, parent);
  let current = root;

  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!(await pathExists(current))) continue;
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to write through symlink: ${path.relative(root, current)}`);
    }
  }
}

function simpleDiff(before, after, relativePath) {
  const beforeLines = String(before).replace(/\n$/, "").split("\n");
  const afterLines = String(after).replace(/\n$/, "").split("\n");
  return [
    `--- ${relativePath} (before)`,
    `+++ ${relativePath} (after)`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

export async function writeUserFile(relativePath, value, options) {
  const { projectRoot, replace = false, now = new Date().toISOString().replaceAll(/[-:.]/g, "") } = options ?? {};
  if (!projectRoot) throw new Error("projectRoot is required");

  const target = safeResolve(projectRoot, relativePath);
  await rejectSymlinkParents(projectRoot, target);
  await mkdir(path.dirname(target), { recursive: true });

  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  let before = null;
  if (await pathExists(target)) {
    before = await readFile(target);
    if (before.equals(bytes)) {
      return { written: false, backupPath: null, diff: "" };
    }
    if (!replace) {
      throw new Error(`${relativePath} already exists; review the diff before replacing it`);
    }
  }

  let backupPath = null;
  let diff = "";
  if (before) {
    const backupRelative = path.posix.join(
      ".blog-state",
      "backups",
      `${relativePath.replaceAll("\\", "/")}.${now}.bak`,
    );
    backupPath = safeResolve(projectRoot, backupRelative);
    await mkdir(path.dirname(backupPath), { recursive: true });
    await copyFile(target, backupPath);
    diff = simpleDiff(before.toString("utf8"), bytes.toString("utf8"), relativePath);
  }

  await writeFile(target, bytes);
  return { written: true, backupPath, diff };
}
