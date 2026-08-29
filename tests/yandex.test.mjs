import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256 } from "../scripts/lib/files.mjs";
import {
  createPublishPlan,
  createYcObjectStore,
  publishRelease,
  rollbackRelease,
} from "../scripts/lib/yandex.mjs";

function manifest(paths) {
  const files = paths.map((item) => {
    const body = item.body ?? item.path;
    return { path: item.path, bytes: Buffer.byteLength(body), sha256: sha256(body) };
  });
  return { version: 1, files, candidateHash: sha256(JSON.stringify(files)) };
}

test("publish plan hard-denies both original article routes", () => {
  for (const route of [
    "how-to-get-training-cases-from-first-lesson/index.html",
    "how-to-switch-on-state-of-power/assets/timer.js",
  ]) {
    assert.throws(
      () => createPublishPlan({ bucket: "safe-blog", manifest: manifest([{ path: route }]) }),
      /protected original route/,
    );
  }
});

test("assets precede HTML and discovery entrypoints", () => {
  const input = manifest([
    { path: "articles/one/index.html" },
    { path: "articles/one/styles.css" },
    { path: "sitemap.xml" },
    { path: "articles/one/assets/photo.webp" },
  ]);
  const plan = createPublishPlan({ bucket: "safe-blog", prefix: "preview", manifest: input });
  assert.ok(plan.uploads.slice(0, plan.entrypointStart).every((item) => item.kind === "asset"));
  assert.ok(plan.uploads.slice(plan.entrypointStart).every((item) => item.kind === "entrypoint"));
  assert.equal(plan.candidateHash, input.candidateHash);
  assert.equal(plan.uploads[0].key.startsWith("preview/"), true);
});

test("hash mismatch stops before the first cloud read", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "trainup-yandex-no-write-"));
  const input = manifest([{ path: "index.html", body: "safe" }]);
  const plan = createPublishPlan({ bucket: "safe-blog", manifest: input });
  let calls = 0;
  const store = {
    head: async () => { calls += 1; return null; },
    download: async () => { calls += 1; },
    upload: async () => { calls += 1; },
    delete: async () => { calls += 1; },
  };
  await assert.rejects(
    publishRelease({ projectRoot: root, outputRoot: root, plan, confirmHash: "0".repeat(64), store }),
    /control hash mismatch/i,
  );
  assert.equal(calls, 0);
});

test("publish snapshots exact targets, verifies reads and rollback restores only its map", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "trainup-yandex-release-"));
  const output = path.join(root, "output");
  await mkdir(path.join(output, "assets"), { recursive: true });
  await writeFile(path.join(output, "assets", "app.css"), "new-css");
  await writeFile(path.join(output, "index.html"), "new-html");
  const input = manifest([
    { path: "assets/app.css", body: "new-css" },
    { path: "index.html", body: "new-html" },
  ]);
  const plan = createPublishPlan({ bucket: "safe-blog", manifest: input });
  const objects = new Map([
    ["index.html", Buffer.from("old-html")],
    ["untouched.txt", Buffer.from("keep-me")],
  ]);
  const operations = [];
  const store = {
    head: async ({ key }) => objects.has(key) ? { contentType: "text/plain", cacheControl: "old" } : null,
    download: async ({ key, destination }) => {
      operations.push(["download", key]);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, objects.get(key));
    },
    upload: async ({ key, source }) => {
      operations.push(["upload", key]);
      objects.set(key, await readFile(source));
    },
    delete: async ({ key }) => {
      operations.push(["delete", key]);
      objects.delete(key);
    },
  };

  const release = await publishRelease({
    projectRoot: root,
    outputRoot: output,
    plan,
    confirmHash: plan.candidateHash,
    store,
    now: "2026-08-29T18:00:00.000Z",
  });
  assert.equal(objects.get("index.html").toString(), "new-html");
  assert.equal(objects.get("assets/app.css").toString(), "new-css");
  assert.deepEqual(
    operations.filter(([kind]) => kind === "upload").map(([, key]) => key),
    ["assets/app.css", "index.html"],
  );

  await rollbackRelease({
    projectRoot: root,
    releaseId: release.releaseId,
    confirmHash: plan.candidateHash,
    store,
  });
  assert.equal(objects.get("index.html").toString(), "old-html");
  assert.equal(objects.has("assets/app.css"), false);
  assert.equal(objects.get("untouched.txt").toString(), "keep-me");
  const reportText = await readFile(path.join(root, ".blog-state", "releases", release.releaseId, "release.json"), "utf8");
  assert.doesNotMatch(reportText, new RegExp(root.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("yc adapter passes an explicit profile without token arguments or a shell", async () => {
  const calls = [];
  const runner = async (args) => {
    calls.push(args);
    return { stdout: '{"content_type":"text/html","cache_control":"no-cache"}', stderr: "" };
  };
  const store = createYcObjectStore({ profile: "blog-profile", runner });
  const metadata = await store.head({ bucket: "safe-blog", key: "index.html" });
  await store.upload({
    bucket: "safe-blog",
    key: "index.html",
    source: "output/index.html",
    contentType: "text/html; charset=utf-8",
    cacheControl: "no-cache",
  });

  assert.deepEqual(metadata, { contentType: "text/html", cacheControl: "no-cache" });
  assert.deepEqual(calls[0].slice(0, 4), ["yc", "--profile", "blog-profile", "storage"]);
  assert.equal(calls.flat().some((part) => /token|secret|password/i.test(part)), false);
});

test("yc adapter retries a transient transport failure but not a permanent error", async () => {
  let transientCalls = 0;
  const transientStore = createYcObjectStore({
    profile: "blog-profile",
    wait: async () => {},
    runner: async () => {
      transientCalls += 1;
      if (transientCalls === 1) throw new Error("unexpected EOF");
      return { stdout: "{}", stderr: "" };
    },
  });
  await transientStore.head({ bucket: "safe-blog", key: "index.html" });
  assert.equal(transientCalls, 2);

  let permanentCalls = 0;
  const permanentStore = createYcObjectStore({
    profile: "blog-profile",
    wait: async () => {},
    runner: async () => {
      permanentCalls += 1;
      throw new Error("AccessDenied");
    },
  });
  await assert.rejects(
    permanentStore.head({ bucket: "safe-blog", key: "index.html" }),
    /AccessDenied/,
  );
  assert.equal(permanentCalls, 1);
});
