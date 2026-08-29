import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { safeResolve, sha256, writeUserFile } from "../scripts/lib/files.mjs";

test("safeResolve keeps relative paths inside the project", () => {
  const root = path.resolve("/tmp/blog-kit-project");
  assert.equal(
    safeResolve(root, "blog/articles/example/content.html"),
    path.join(root, "blog", "articles", "example", "content.html"),
  );
});

test("safeResolve rejects traversal and absolute destinations", () => {
  const root = path.resolve("/tmp/blog-kit-project");
  assert.throws(() => safeResolve(root, "../secret"), /outside project root/);
  assert.throws(() => safeResolve(root, "/tmp/elsewhere"), /relative path/);
});

test("writeUserFile refuses silent overwrite and backs up explicit replacement", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "blog-kit-files-"));
  const relativePath = "blog/articles/a/content.html";
  const target = safeResolve(root, relativePath);

  const first = await writeUserFile(relativePath, "first\n", { projectRoot: root });
  assert.equal(first.written, true);
  assert.equal(first.backupPath, null);

  await assert.rejects(
    writeUserFile(relativePath, "second\n", { projectRoot: root }),
    /already exists/,
  );

  const result = await writeUserFile(relativePath, "second\n", {
    projectRoot: root,
    replace: true,
    now: "20260829T120000Z",
  });

  assert.equal(await readFile(target, "utf8"), "second\n");
  assert.equal(await readFile(result.backupPath, "utf8"), "first\n");
  assert.match(result.diff, /-first/);
  assert.match(result.diff, /\+second/);
});

test("sha256 is deterministic for strings and bytes", () => {
  const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  assert.equal(sha256("abc"), expected);
  assert.equal(sha256(Buffer.from("abc")), expected);
});
