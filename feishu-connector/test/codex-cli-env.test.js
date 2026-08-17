import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HELPER = path.join(ROOT_DIR, "scripts", "codex-cli-env.sh");
const temporaryRoots = [];

after(async () => {
  await Promise.all(temporaryRoots.map((root) => rm(root, { recursive: true, force: true })));
});

async function temporaryRoot(prefix) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

async function fakeCodex(filePath, marker) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(marker)}\n`, { mode: 0o700 });
  await chmod(filePath, 0o700);
}

function resolveWith(env) {
  return spawnSync("/bin/sh", ["-c", `. ${JSON.stringify(HELPER)}; ensure_codex_cli; codex`], {
    env,
    encoding: "utf8"
  });
}

test("uses a Codex CLI already available in PATH", async () => {
  const root = await temporaryRoot("codex-cli-path-");
  const bin = path.join(root, "bin");
  await fakeCodex(path.join(bin, "codex"), "from-path");

  const result = resolveWith({ HOME: root, PATH: `${bin}:/usr/bin:/bin` });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "from-path");
});

test("discovers the Codex executable bundled with the desktop app", async () => {
  const root = await temporaryRoot("codex-cli-app-");
  const bundled = path.join(root, "Applications", "ChatGPT.app", "Contents", "Resources", "codex");
  await fakeCodex(bundled, "from-app");

  const result = resolveWith({ HOME: root, PATH: "/usr/bin:/bin" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "from-app");
});

test("supports an explicit Codex executable without printing its path", async () => {
  const root = await temporaryRoot("codex-cli-explicit-");
  const explicit = path.join(root, "private bin", "codex");
  await fakeCodex(explicit, "from-explicit");

  const result = resolveWith({
    HOME: root,
    PATH: "/usr/bin:/bin",
    CODEX_CLI_PATH: explicit
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "from-explicit");
  assert.equal(result.stderr, "");
});

test("fails closed when an explicit Codex executable is invalid", async () => {
  const root = await temporaryRoot("codex-cli-invalid-");
  const result = resolveWith({
    HOME: root,
    PATH: "/usr/bin:/bin",
    CODEX_CLI_PATH: path.join(root, "missing", "codex")
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
});

test("rejects a relative or differently named explicit executable", async () => {
  const root = await temporaryRoot("codex-cli-name-");
  const wrongName = path.join(root, "bin", "agent-cli");
  await fakeCodex(wrongName, "must-not-run");

  const wrongNameResult = resolveWith({
    HOME: root,
    PATH: "/usr/bin:/bin",
    CODEX_CLI_PATH: wrongName
  });
  const relativeResult = resolveWith({
    HOME: root,
    PATH: "/usr/bin:/bin",
    CODEX_CLI_PATH: "bin/codex"
  });

  assert.notEqual(wrongNameResult.status, 0);
  assert.notEqual(relativeResult.status, 0);
  assert.equal(wrongNameResult.stdout, "");
  assert.equal(relativeResult.stdout, "");
});
