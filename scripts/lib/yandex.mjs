import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { safeResolve, sha256 } from "./files.mjs";

const execFileAsync = promisify(execFile);
const HASH = /^[a-f0-9]{64}$/;
const BUCKET = /^(?=.{3,63}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/;
const PROFILE = /^[A-Za-z0-9_.-]+$/;
const DISCOVERY = new Set(["articles.json", "feed.xml", "llms.txt", "robots.txt", "sitemap.xml"]);
const PROTECTED_ROUTES = [
  "how-to-get-training-cases-from-first-lesson",
  "how-to-switch-on-state-of-power",
];

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

function assertBucket(value) {
  const bucket = String(value ?? "");
  if (
    !BUCKET.test(bucket) || bucket.includes("..") || bucket.includes(".-") || bucket.includes("-.")
    || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(bucket)
  ) {
    throw new Error("Invalid Yandex Object Storage bucket name");
  }
  return bucket;
}

function assertRelativeKey(value, label = "object key") {
  const key = String(value ?? "");
  const parts = key.split("/");
  if (
    !key || path.posix.isAbsolute(key) || key.includes("\\") || /[\u0000-\u001f\u007f]/.test(key)
    || parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Unsafe ${label}: ${key}`);
  }
  return key;
}

function normalizePrefix(value) {
  const prefix = String(value ?? "").replace(/^\/+|\/+$/g, "");
  if (!prefix) return "";
  assertRelativeKey(prefix, "publish prefix");
  return prefix;
}

function isProtected(key) {
  return PROTECTED_ROUTES.some((route) => key.split("/").includes(route));
}

function kindFor(relative) {
  return relative.endsWith(".html") || DISCOVERY.has(relative) ? "entrypoint" : "asset";
}

function contentTypeFor(relative) {
  return CONTENT_TYPES.get(path.posix.extname(relative).toLowerCase()) ?? "application/octet-stream";
}

function cacheFor(kind) {
  return kind === "entrypoint" ? "no-cache" : "public,max-age=3600";
}

function computedManifestHash(files) {
  return sha256(JSON.stringify(files));
}

export function createPublishPlan(input = {}) {
  const bucket = assertBucket(input.bucket);
  const prefix = normalizePrefix(input.prefix);
  const manifest = input.manifest;
  if (!manifest || !Array.isArray(manifest.files) || !HASH.test(String(manifest.candidateHash ?? ""))) {
    throw new Error("Invalid build manifest");
  }
  if (computedManifestHash(manifest.files) !== manifest.candidateHash) {
    throw new Error("Build manifest control hash is invalid");
  }

  const seen = new Set();
  const deniedKeys = [];
  const uploads = [];
  for (const file of manifest.files) {
    const relative = assertRelativeKey(file.path, "manifest path");
    if (relative === "manifest.json") continue;
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !HASH.test(String(file.sha256 ?? ""))) {
      throw new Error(`Invalid manifest record: ${relative}`);
    }
    const key = prefix ? `${prefix}/${relative}` : relative;
    if (seen.has(key)) throw new Error(`Duplicate object key: ${key}`);
    seen.add(key);
    if (isProtected(key)) deniedKeys.push(key);
    const kind = kindFor(relative);
    uploads.push({
      sourceRelative: relative,
      key,
      kind,
      bytes: file.bytes,
      sha256: file.sha256,
      contentType: contentTypeFor(relative),
      cacheControl: cacheFor(kind),
    });
  }
  if (deniedKeys.length > 0) {
    const error = new Error(`protected original route: ${deniedKeys.join(", ")}`);
    error.deniedKeys = deniedKeys;
    throw error;
  }

  uploads.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "asset" ? -1 : 1;
    return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
  });
  const entrypointStart = uploads.findIndex((item) => item.kind === "entrypoint");
  return {
    version: 1,
    bucket,
    prefix,
    candidateHash: manifest.candidateHash,
    uploads,
    entrypoints: uploads.filter((item) => item.kind === "entrypoint").map((item) => item.key),
    entrypointStart: entrypointStart === -1 ? uploads.length : entrypointStart,
    deniedKeys: [],
    totalBytes: uploads.reduce((sum, item) => sum + item.bytes, 0),
  };
}

function assertPublishPlan(plan) {
  assertBucket(plan?.bucket);
  if (!HASH.test(String(plan?.candidateHash ?? "")) || !Array.isArray(plan?.uploads)) throw new Error("Invalid publish plan");
  const keys = new Set();
  for (const item of plan.uploads) {
    assertRelativeKey(item.sourceRelative, "publish source");
    const key = assertRelativeKey(item.key, "publish key");
    if (isProtected(key)) throw new Error(`protected original route: ${key}`);
    if (keys.has(key)) throw new Error(`Duplicate object key: ${key}`);
    keys.add(key);
    if (!HASH.test(String(item.sha256 ?? "")) || !Number.isSafeInteger(item.bytes) || item.bytes < 0) {
      throw new Error(`Invalid publish item: ${key}`);
    }
  }
}

async function defaultRunner(args, options = {}) {
  const [command, ...commandArgs] = args;
  return execFileAsync(command, commandArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
}

function missingObject(error) {
  const message = `${error?.message ?? ""}\n${error?.stderr ?? ""}`;
  return /NoSuchKey|Not Found|not found|status code: 404|\b404\b/i.test(message);
}

function baseCommand(profile) {
  if (profile && !PROFILE.test(profile)) throw new Error("Invalid Yandex Cloud profile name");
  return ["yc", ...(profile ? ["--profile", profile] : []), "storage", "s3api"];
}

function transientTransportError(error) {
  const message = `${error?.message ?? ""}\n${error?.stderr ?? ""}`;
  return /unexpected EOF|ECONNRESET|EPIPE|ETIMEDOUT|network is unreachable|temporary failure|SlowDown|ServiceUnavailable|RequestTimeout|status code: 50[0234]/i.test(message);
}

export function createYcObjectStore(options = {}) {
  const runner = options.runner ?? defaultRunner;
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const base = baseCommand(options.profile);
  const run = async (args) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await runner(args);
      } catch (error) {
        if (attempt === 3 || !transientTransportError(error)) throw error;
        await wait(250 * attempt);
      }
    }
    throw new Error("Yandex Object Storage retry loop ended unexpectedly");
  };
  return {
    async head({ bucket, key }) {
      try {
        const result = await run([...base, "head-object", "--bucket", bucket, "--key", key, "--format", "json"]);
        const data = JSON.parse(result.stdout || "{}");
        return {
          contentType: data.content_type ?? data.contentType ?? null,
          cacheControl: data.cache_control ?? data.cacheControl ?? null,
        };
      } catch (error) {
        if (missingObject(error)) return null;
        throw error;
      }
    },
    async download({ bucket, key, destination }) {
      await run([...base, "get-object", "--bucket", bucket, "--key", key, destination]);
    },
    async upload({ bucket, key, source, contentType, cacheControl }) {
      const args = [...base, "put-object", "--bucket", bucket, "--key", key, "--body", source];
      if (contentType) args.push("--content-type", contentType);
      if (cacheControl) args.push("--cache-control", cacheControl);
      await run(args);
    },
    async delete({ bucket, key }) {
      await run([...base, "delete-object", "--bucket", bucket, "--key", key]);
    },
  };
}

async function exists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function releaseIdFor(now) {
  const iso = new Date(now ?? Date.now()).toISOString();
  return iso.replaceAll(/[-:.]/g, "");
}

async function writeReport(reportPath, report) {
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

async function verifyLocalSources(outputRoot, plan) {
  for (const item of plan.uploads) {
    const bytes = await readFile(safeResolve(outputRoot, item.sourceRelative));
    if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) {
      throw new Error(`Local build changed after planning: ${item.sourceRelative}`);
    }
  }
}

async function restoreRecords({ projectRoot, releaseId, report, store, records = report.objects }) {
  for (const item of [...records].reverse()) {
    if (item.existed) {
      const source = safeResolve(projectRoot, `.blog-state/releases/${releaseId}/before/${item.key}`);
      await store.upload({
        bucket: report.bucket,
        key: item.key,
        source,
        contentType: item.before.contentType,
        cacheControl: item.before.cacheControl,
      });
    } else {
      await store.delete({ bucket: report.bucket, key: item.key });
    }
  }
}

export async function publishRelease(options = {}) {
  const { projectRoot, outputRoot, plan } = options;
  if (!projectRoot || !outputRoot || !plan) throw new Error("projectRoot, outputRoot and plan are required");
  assertPublishPlan(plan);
  if (options.confirmHash !== plan.candidateHash) throw new Error("Control hash mismatch; cloud was not changed");
  await verifyLocalSources(outputRoot, plan);

  const store = options.store ?? createYcObjectStore({ profile: options.profile, runner: options.runner });
  const releaseId = releaseIdFor(options.now);
  const releaseRoot = safeResolve(projectRoot, `.blog-state/releases/${releaseId}`);
  const reportPath = path.join(releaseRoot, "release.json");
  if (await exists(reportPath)) throw new Error(`Release ${releaseId} already exists`);
  await mkdir(releaseRoot, { recursive: true });

  const report = {
    version: 1,
    releaseId,
    createdAt: new Date(options.now ?? Date.now()).toISOString(),
    status: "snapshotting",
    bucket: plan.bucket,
    prefix: plan.prefix,
    candidateHash: plan.candidateHash,
    objects: [],
  };

  for (const upload of plan.uploads) {
    const metadata = await store.head({ bucket: plan.bucket, key: upload.key });
    const record = {
      key: upload.key,
      existed: metadata !== null,
      before: metadata ? { ...metadata, sha256: null } : null,
      published: { sha256: upload.sha256, contentType: upload.contentType, cacheControl: upload.cacheControl },
      uploaded: false,
      verified: false,
    };
    if (metadata) {
      const destination = safeResolve(projectRoot, `.blog-state/releases/${releaseId}/before/${upload.key}`);
      await mkdir(path.dirname(destination), { recursive: true });
      await store.download({ bucket: plan.bucket, key: upload.key, destination });
      record.before.sha256 = sha256(await readFile(destination));
    }
    report.objects.push(record);
  }
  report.status = "snapshotted";
  await writeReport(reportPath, report);

  try {
    for (let index = 0; index < plan.uploads.length; index += 1) {
      const upload = plan.uploads[index];
      const source = safeResolve(outputRoot, upload.sourceRelative);
      await store.upload({
        bucket: plan.bucket,
        key: upload.key,
        source,
        contentType: upload.contentType,
        cacheControl: upload.cacheControl,
      });
      report.objects[index].uploaded = true;
      const verifiedCopy = safeResolve(projectRoot, `.blog-state/releases/${releaseId}/after/${upload.key}`);
      await mkdir(path.dirname(verifiedCopy), { recursive: true });
      await store.download({ bucket: plan.bucket, key: upload.key, destination: verifiedCopy });
      if (sha256(await readFile(verifiedCopy)) !== upload.sha256) {
        throw new Error(`Read-back verification failed: ${upload.key}`);
      }
      report.objects[index].verified = true;
      report.status = "publishing";
      await writeReport(reportPath, report);
    }
    report.status = "published";
    report.completedAt = new Date().toISOString();
    await writeReport(reportPath, report);
    return report;
  } catch (error) {
    report.status = "publish-failed";
    report.failure = error.message;
    await writeReport(reportPath, report);
    try {
      await restoreRecords({
        projectRoot,
        releaseId,
        report,
        store,
        records: report.objects.filter((item) => item.uploaded),
      });
      report.status = "rolled-back-after-failure";
      await writeReport(reportPath, report);
    } catch (rollbackError) {
      report.status = "rollback-failed";
      report.rollbackFailure = rollbackError.message;
      await writeReport(reportPath, report);
      throw new AggregateError([error, rollbackError], "Publish and automatic rollback failed");
    }
    throw error;
  }
}

export async function rollbackRelease(options = {}) {
  const { projectRoot, releaseId } = options;
  if (!projectRoot || !/^\d{8}T\d{9}Z$/.test(String(releaseId ?? ""))) throw new Error("Invalid release id");
  const reportPath = safeResolve(projectRoot, `.blog-state/releases/${releaseId}/release.json`);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assertBucket(report.bucket);
  if (!HASH.test(String(report.candidateHash ?? ""))) throw new Error("Invalid release report");
  if (options.confirmHash !== report.candidateHash) throw new Error("Control hash mismatch; cloud was not changed");
  if (!Array.isArray(report.objects)) throw new Error("Invalid release report");
  for (const item of report.objects) {
    const key = assertRelativeKey(item.key, "release key");
    if (isProtected(key)) throw new Error(`protected original route: ${key}`);
  }
  const store = options.store ?? createYcObjectStore({ profile: options.profile, runner: options.runner });
  await restoreRecords({ projectRoot, releaseId, report, store });

  for (const item of report.objects) {
    if (item.existed) {
      const destination = safeResolve(projectRoot, `.blog-state/releases/${releaseId}/rollback-check/${item.key}`);
      await mkdir(path.dirname(destination), { recursive: true });
      await store.download({ bucket: report.bucket, key: item.key, destination });
      if (sha256(await readFile(destination)) !== item.before.sha256) throw new Error(`Rollback verification failed: ${item.key}`);
    } else if (await store.head({ bucket: report.bucket, key: item.key })) {
      throw new Error(`Rollback verification failed: ${item.key} still exists`);
    }
  }
  report.status = "rolled-back";
  report.rolledBackAt = new Date().toISOString();
  await writeReport(reportPath, report);
  return report;
}
