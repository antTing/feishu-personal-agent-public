import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  atomicPrivateWrite,
  nativeConfigMatchesPending,
  sanitizeDiagnostic,
  upgradeNativeWorkspacePolicy
} from "../../scripts/onboard-native-utils.mjs";

test("sanitizeDiagnostic removes credentials, URL data, identities, and absolute paths", () => {
  const clientSecret = ["highly", "sensitive", "client", "secret"].join("-");
  const legacySecret = ["legacy", "secret", "value"].join("-");
  const openId = ["ou", "sensitiveidentity123"].join("_");
  const chatId = ["oc", "sensitivechat123"].join("_");
  const url = ["https:", "", "open.feishu.cn", "callback?code=sensitive-code&state=sensitive-state"].join("/");
  const posixPath = path.join(path.sep, "private", "sensitive-user", "project name", "config.json");
  const windowsPath = ["C:", "Users", "sensitive-user", "project", "config.json"].join("\\");
  const error = new Error([
    `response={"clientSecret":"${clientSecret}","client_secret":"${legacySecret}"}`,
    `open_id=${openId}`,
    `chatId=${chatId}`,
    `authorize=${url}`,
    `config="${posixPath}"`,
    `fallback=${windowsPath}`,
    "Authorization: Bearer sensitive-bearer-value"
  ].join(" "));

  const result = sanitizeDiagnostic(error, ["sensitive-bearer-value"]);

  for (const value of [clientSecret, legacySecret, openId, chatId, "sensitive-code", "sensitive-state", posixPath, windowsPath, "sensitive-bearer-value"]) {
    assert.equal(result.includes(value), false);
  }
  assert.match(result, /\[已隐藏敏感值\]/);
  assert.match(result, /\[已隐藏身份值\]/);
  assert.match(result, /\[已隐藏链接\]/);
  assert.match(result, /\[已隐藏本地路径\]/);
});

test("sanitizeDiagnostic does not serialize arbitrary SDK error properties", () => {
  const hidden = ["property", "only", "secret"].join("-");
  const result = sanitizeDiagnostic({
    message: "request failed safely",
    response: { data: { client_secret: hidden } }
  });
  assert.equal(result, "request failed safely");
  assert.equal(result.includes(hidden), false);
});

test("sanitizeDiagnostic emits one bounded line without terminal controls", () => {
  const longMessage = `failure\u001B[31m\n${"x".repeat(3_000)}`;
  const result = sanitizeDiagnostic(new Error(longMessage));
  assert.equal(result.includes("\u001B"), false);
  assert.equal(result.includes("\n"), false);
  assert.ok(result.length <= 2_001);
});

test("sanitizeDiagnostic treats an absolute API path and its query as one diagnostic value", () => {
  const result = sanitizeDiagnostic(new Error("failure at /open-apis/example?client_secret=hidden-value"));
  assert.equal(result, "failure at [已隐藏本地路径]");
});

test("sanitizeDiagnostic hides cookie headers, protocol-relative URLs, and spaced paths", () => {
  const spacedPath = path.join(path.sep, "Users", "example-user", "Project Name", "config.toml");
  const values = [
    "top-secret-session",
    "top-secret-refresh",
    "sensitive-code",
    spacedPath
  ];
  const result = sanitizeDiagnostic(new Error([
    "Cookie: session=top-secret-session; refresh=top-secret-refresh",
    "callback=//open.feishu.cn/auth?code=sensitive-code",
    `path \`${spacedPath}\``
  ].join("\n")));
  for (const value of values) assert.equal(result.includes(value), false);
  assert.equal(result.includes("Project Name"), false);
  assert.match(result, /\[已隐藏敏感值\]/);
  assert.match(result, /\[已隐藏链接\]/);
  assert.match(result, /\[已隐藏本地路径\]/);
});

test("nativeConfigMatchesPending only accepts the matching private configuration", () => {
  const pending = {
    appId: ["cli", "exampleapplication"].join("_"),
    appSecret: "example-secret-value",
    workspace: "/private/example-user/Example Project"
  };
  const config = [
    `app_id = ${JSON.stringify(pending.appId)}`,
    `app_secret = ${JSON.stringify(pending.appSecret)}`,
    `work_dir = ${JSON.stringify(pending.workspace)}`
  ].join("\n");
  assert.equal(nativeConfigMatchesPending(config, pending), true);
  assert.equal(nativeConfigMatchesPending(config.replace("example-secret-value", "other"), pending), false);
  assert.equal(nativeConfigMatchesPending(config, { ...pending, workspace: "/private/example-user/Other" }), false);
});

test("upgradeNativeWorkspacePolicy enables native directory commands for the owner only", () => {
  const ownerId = ["ou", "exampleowner"].join("_");
  const dispatcherId = ["ou", "exampledispatcher"].join("_");
  const executionChatId = ["oc", "exampleexecution"].join("_");
  const config = [
    "[[projects]]",
    `admin_from = ${JSON.stringify(ownerId)}`,
    `approval_from = ${JSON.stringify(ownerId)}`,
    'disabled_commands = ["dir", "workspace", "status", "usage"]',
    "",
    "[[projects.platforms]]",
    'type = "feishu"',
    "",
    "[projects.platforms.options]",
    `allow_from = ${JSON.stringify(`${ownerId},${dispatcherId}`)}`,
    `approval_from = ${JSON.stringify(ownerId)}`,
    `allow_chat = ${JSON.stringify(executionChatId)}`,
    ""
  ].join("\n");

  const upgraded = upgradeNativeWorkspacePolicy(config);

  assert.equal(upgraded.changed, true);
  const disabledLine = upgraded.content.split("\n").find((line) => line.startsWith("disabled_commands = "));
  assert.doesNotMatch(disabledLine, /"dir"|"workspace"/);
  assert.match(disabledLine, /"status"/);
  assert.equal(
    upgraded.content.split("\n").filter((line) => line === `admin_from = ${JSON.stringify(ownerId)}`).length,
    2
  );
  const repeated = upgradeNativeWorkspacePolicy(upgraded.content);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.content, upgraded.content);
});

test("upgradeNativeWorkspacePolicy rejects a mismatched platform administrator", () => {
  const ownerId = ["ou", "exampleowner"].join("_");
  const anotherOwnerId = ["ou", "anotherowner"].join("_");
  const config = [
    "[[projects]]",
    `admin_from = ${JSON.stringify(ownerId)}`,
    'disabled_commands = ["dir", "workspace"]',
    "[[projects.platforms]]",
    "[projects.platforms.options]",
    `admin_from = ${JSON.stringify(anotherOwnerId)}`,
    ""
  ].join("\n");

  assert.throws(
    () => upgradeNativeWorkspacePolicy(config),
    /project and platform admin policies do not match/
  );
});

test("atomicPrivateWrite installs a complete mode-600 file exclusively", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "onboard-atomic-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "private-state.json");

  await atomicPrivateWrite(target, "complete-content\n", { exclusive: true });

  assert.equal(await readFile(target, "utf8"), "complete-content\n");
  assert.equal((await stat(target)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(directory), ["private-state.json"]);
});

test("exclusive atomicPrivateWrite fails closed and preserves an existing target", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "onboard-exclusive-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "config.toml");
  await writeFile(target, "original\n", { mode: 0o600 });

  await assert.rejects(
    atomicPrivateWrite(target, "replacement\n", { exclusive: true }),
    (error) => error?.code === "EEXIST"
  );

  assert.equal(await readFile(target, "utf8"), "original\n");
  assert.deepEqual(await readdir(directory), ["config.toml"]);
});

test("atomicPrivateWrite removes its staging file when content cannot be written", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "onboard-write-error-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "private-state.json");

  await assert.rejects(atomicPrivateWrite(target, {}));

  assert.deepEqual(await readdir(directory), []);
});

test("non-exclusive atomicPrivateWrite atomically replaces an existing target", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "onboard-replace-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "pairing-guide.html");
  await writeFile(target, "old", { mode: 0o600 });

  await atomicPrivateWrite(target, "new", { exclusive: false });

  assert.equal(await readFile(target, "utf8"), "new");
  assert.equal((await stat(target)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(directory), ["pairing-guide.html"]);
});
