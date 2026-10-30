#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TEXT_EXTENSIONS = new Set([
  ".command", ".css", ".html", ".js", ".json", ".md", ".mjs", ".ps1", ".txt", ".yaml", ".yml",
]);
const SPECIAL_TEXT = new Set([".gitignore", "AGENTS.md", "LICENSE", "README.md"]);
const ALLOWED_HOSTS = new Set([
  "example.test",
  "example.invalid",
  "getcourse.ru",
  "github.com",
  "schema.org",
  "t.me",
  "trainup.ru",
  "website.yandexcloud.net",
  "www.sitemaps.org",
  "www.w3.org",
  "yandex.cloud",
  "yandex.ru",
]);
const CONSENT_RUNTIME_DIGESTS = {
  'guard.js': '1e3ecc4b70ee442bdc509de8e61f6f39af3ccf934162229fa1ec1111a19849ec',
  'cookie-consent.js': '1fee34cbeb91b563b5ae71da02e02cd05830a5cffcf0758800d82370e0dc77c7',
  'consent-analytics.js': '59fbc72f70a9caf7f7aac9e47771e5e11ec79a0b4655c1680e2cae3347cf80a2',
};
const TEMPLATE_TAILS = [
  /kinescope/i,
  /mc\.yandex\./i,
  /(?:ya\.)?metrika/i,
  /data-oto|offer-timer|checkout-(?:modal|popup)/i,
  /powerstate-metrica|__TRAINUP|data-trainup|\brsya\b/i,
  /<(?:video|iframe)\b|\.(?:mp4|webm)(?:[?#"']|$)/i,
];

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function portable(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

async function walk(root, current = root, files = [], findings = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    const relative = portable(root, absolute);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      findings.push({ type: "symlink", path: relative, message: "Symbolic links are forbidden" });
      continue;
    }
    if (info.isDirectory()) {
      if (entry.name === ".git") findings.push({ type: "git-history", path: relative, message: "Git history is forbidden" });
      await walk(root, absolute, files, findings);
    } else if (info.isFile()) {
      files.push({ absolute, relative, bytes: info.size });
    }
  }
  return { files, findings };
}

function isText(relative, bytes) {
  return SPECIAL_TEXT.has(path.posix.basename(relative))
    || TEXT_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())
    || (!bytes.includes(0) && bytes.length < 1024 * 1024);
}

function finding(type, relative, message) {
  return { type, path: relative, message };
}

function scanText(relative, text) {
  const findings = [];
  const secretPatterns = [
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
    /\b(?:ghp|github_pat|glpat)-[A-Za-z0-9_-]{16,}\b/,
    /\bAKIA[A-Z0-9]{16}\b/,
    /\b(?:YC_[A-Z0-9_]*(?:KEY|TOKEN|SECRET)|ACCESS_KEY|SECRET_KEY|PASSWORD|AUTH_TOKEN|COOKIE)\s*[:=]\s*["']?(?!placeholder|example|replace|your-|<|ИМЯ_|КЛЮЧ_)[^\s"',]{8,}/i,
    /["'](?:private_key|secret_key|access_token|refresh_token|session_cookie)["']\s*:\s*["'](?!placeholder|example|replace|your-)[^"']{8,}["']/i,
    /(?:^|\n)\s*(?:Cookie|Authorization)\s*:\s*(?!placeholder|example)[^\n]{8,}/i,
  ];
  for (const pattern of secretPatterns) {
    if (pattern.test(text)) findings.push(finding("secret", relative, `Secret-shaped content matches ${pattern.source}`));
  }

  const absolutePaths = [
    /(?:^|["'`\s])\/Users\/[A-Za-z0-9._-]+\//,
    /(?:^|["'`\s])\/home\/[A-Za-z0-9._-]+\//,
    /(?:^|["'`\s])[A-Za-z]:\\Users\\[^\\\s]+\\/,
    /file:\/\//i,
  ];
  for (const pattern of absolutePaths) {
    if (pattern.test(text)) findings.push(finding("local-path", relative, "Absolute local path found"));
  }

  if (/ИНН\s*(?!0{12}\b)\d{10}(?:\d{2})?\b/.test(text) || /ОГРН\s*(?!0{15}\b)\d{13}(?:\d{2})?\b/.test(text)) {
    findings.push(finding("legal-identity", relative, "Non-placeholder legal identifier found"));
  }
  if (/\b(?:b1g|aje|fpq|e2e|d4e)[a-z0-9]{15,}\b/i.test(text)) {
    findings.push(finding("provider-id", relative, "Cloud provider resource identifier found"));
  }

  for (const match of text.matchAll(/https?:\/\/[A-Za-z0-9.-]+(?::\d+)?/g)) {
    const url = new URL(match[0]);
    const host = url.hostname.toLowerCase();
    const frozenConsent = relative === 'kit/consent/consent-analytics.js' && hash(text) === CONSENT_RUNTIME_DIGESTS['consent-analytics.js'];
    const scannerReference = relative === "release/scan-public.mjs" && match[0] === "https://mc.yandex.ru";
    const allowed = scannerReference || (frozenConsent && match[0] === 'https://mc.yandex.ru') || ALLOWED_HOSTS.has(host)
      || host.endsWith(".trainup.ru")
      || host.endsWith(".yandexcloud.net")
      || host.endsWith(".getcourse.ru");
    if (!allowed) findings.push(finding("external-url", relative, `Domain is not allowlisted: ${host}`));
  }

  if (relative.startsWith("kit/templates/") || relative.startsWith("kit/shared/")) {
    for (const pattern of TEMPLATE_TAILS) {
      if (pattern.test(text)) findings.push(finding("template-tail", relative, `Forbidden template runtime matches ${pattern.source}`));
    }
  }
  return findings;
}

function referenceBase(root, relative) {
  const match = relative.match(/^kit\/templates\/([^/]+)\/example\//);
  if (match) return path.join(root, "kit", "templates", match[1]);
  return path.dirname(path.join(root, relative));
}

function referenceTarget(root, relative, value) {
  if (relative.startsWith('kit/consent/') && /\{\{[A-Za-z][A-Za-z0-9]*\}\}/.test(value)) return null;
  const clean = value.split("#")[0].split("?")[0];
  if (!clean || clean.startsWith("#") || /^(?:https?:|mailto:|tel:|data:|javascript:|\/\/)/i.test(clean)) return null;
  if (clean.startsWith("/")) return path.join(root, clean.slice(1));
  return path.resolve(referenceBase(root, relative), clean);
}

function collectTextReferences(root, relative, text) {
  const targets = [];
  if (relative.endsWith(".html")) {
    for (const match of text.matchAll(/srcset=["']([^"']+)["']/gi)) {
      for (const item of match[1].split(',')) {
        const value = item.trim().split(/\s+/)[0];
        const target = referenceTarget(root, relative, value);
        if (target) targets.push({ target, value });
      }
    }
    for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
      const target = referenceTarget(root, relative, match[1]);
      if (target) targets.push({ target, value: match[1] });
    }
  }
  if (relative.endsWith(".css")) {
    for (const match of text.matchAll(/url\(["']?([^)'"?#]+)["']?\)/gi)) {
      const target = referenceTarget(root, relative, match[1]);
      if (target) targets.push({ target, value: match[1] });
    }
  }
  if (/^kit\/templates\/[^/]+\/example\/article\.json$/.test(relative)) {
    try {
      const article = JSON.parse(text);
      for (const value of [article.socialImage, ...Object.values(article.assets ?? {})]) {
        if (typeof value !== "string" || !value.startsWith("/templates/")) continue;
        targets.push({ target: path.join(root, "kit", value.slice(1)), value });
      }
    } catch {
      // Contract tests report invalid JSON separately; the scanner only checks references here.
    }
  }
  return targets;
}

function forbiddenName(relative) {
  const parts = relative.split("/");
  return parts.some((part) => part === ".git" || part === ".env" || part.startsWith(".env."))
    || /(?:authorized-key|service-account-key|credentials|cookies?)\.json$/i.test(relative)
    || /\.(?:pem|key|p12|pfx)$/i.test(relative);
}

export async function scanPublic(rootInput, options = {}) {
  const root = path.resolve(rootInput);
  const walked = await walk(root);
  const findings = [...walked.findings];
  const manifestFiles = [];
  const referencedAssets = new Set();

  for (const file of walked.files.sort((left, right) => left.relative < right.relative ? -1 : 1)) {
    const bytes = await readFile(file.absolute);
    if (file.relative.startsWith('kit/consent/') && CONSENT_RUNTIME_DIGESTS[path.posix.basename(file.relative)]
      && hash(bytes) !== CONSENT_RUNTIME_DIGESTS[path.posix.basename(file.relative)]) {
      findings.push(finding('consent-integrity', file.relative, 'Frozen consent runtime checksum mismatch'));
    }
    manifestFiles.push({ path: file.relative, bytes: bytes.length, sha256: hash(bytes) });
    if (forbiddenName(file.relative)) findings.push(finding("forbidden-file", file.relative, "Credential or history file name is forbidden"));
    if (!isText(file.relative, bytes)) continue;
    const text = bytes.toString("utf8");
    const productionFile = options.productionTemplates === true && file.relative.startsWith("kit/production-templates/");
    if (!productionFile) findings.push(...scanText(file.relative, text));
    for (const reference of (productionFile ? [] : collectTextReferences(root, file.relative, text))) {
      const resolved = path.resolve(reference.target);
      if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
        findings.push(finding("broken-reference", file.relative, `Reference escapes package: ${reference.value}`));
        continue;
      }
      try {
        const info = await lstat(resolved);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error("not a regular file");
        referencedAssets.add(portable(root, resolved));
      } catch {
        findings.push(finding("broken-reference", file.relative, `Missing relative reference: ${reference.value}`));
      }
    }
  }

  for (const file of manifestFiles) {
    if (/^kit\/templates\/[^/]+\/assets\//.test(file.path) && !referencedAssets.has(file.path)) {
      findings.push(finding("orphan-asset", file.path, "Template asset is not referenced"));
    }
  }

  if (options.productionTemplates === true) {
    const {scanProductionTemplates} = await import(pathToFileURL(path.join(root, "scripts/scan-production-templates.mjs")).href);
    const profile = await scanProductionTemplates(path.join(root, "kit/production-templates"));
    findings.push(...profile.findings.map(item => ({...item, path: "kit/production-templates/" + item.path})));
  }
  return {
    ok: findings.length === 0,
    findings,
    manifest: {
      version: 1,
      files: manifestFiles,
      fileCount: manifestFiles.length,
      totalBytes: manifestFiles.reduce((sum, file) => sum + file.bytes, 0),
      aggregateSha256: hash(JSON.stringify(manifestFiles)),
    },
  };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const report = await scanPublic(process.argv[2] ?? process.cwd());
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
