import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_SCRIPT = path.resolve(TEST_DIR, "../../scripts/rotate-secrets.mjs");
const SOURCE_STATE = path.resolve(TEST_DIR, "../../scripts/service-state.mjs");

async function fixture() {
  const root = await mkdtemp(path.join("/tmp", "rotate-secrets-test-"));
  const scripts = path.join(root, "scripts");
  const connectorRuntime = path.join(root, "runtime", "feishu-connector");
  const ccRuntime = path.join(root, "runtime", "cc-connect");
  await Promise.all([
    mkdir(scripts, { recursive: true }),
    mkdir(connectorRuntime, { recursive: true, mode: 0o700 }),
    mkdir(ccRuntime, { recursive: true, mode: 0o700 })
  ]);

  const [script, stateScript] = await Promise.all([
    readFile(SOURCE_SCRIPT, "utf8"),
    readFile(SOURCE_STATE, "utf8")
  ]);
  await Promise.all([
    writeFile(path.join(scripts, "rotate-secrets.mjs"), script, { mode: 0o755 }),
    writeFile(path.join(scripts, "service-state.mjs"), stateScript, { mode: 0o755 })
  ]);

  const connectorPath = path.join(connectorRuntime, "config.json");
  const ccPath = path.join(ccRuntime, "config.toml");
  const connector = {
    feishu: {
      appId: "example-app-id",
      appSecret: "example-old-app-secret",
      allowedUserIds: ["example-owner"]
    },
    bridge: {
      url: "ws://127.0.0.1:9810/bridge/ws",
      token: "example-old-bridge-token"
    },
    workspaces: {
      managementToken: "example-old-management-token",
      approved: [{ name: "example-workspace", path: "/example/workspace" }]
    }
  };
  const cc = [
    "[management]",
    "enabled = true",
    'token = "example-old-management-token"',
    "",
    "[bridge]",
    "enabled = true",
    'token = "example-old-bridge-token"',
    ""
  ].join("\n");
  await Promise.all([
    writeFile(connectorPath, `${JSON.stringify(connector, null, 2)}\n`, { mode: 0o600 }),
    writeFile(ccPath, cc, { mode: 0o600 })
  ]);
  await Promise.all([chmod(connectorPath, 0o600), chmod(ccPath, 0o600)]);
  return { root, connectorPath, ccPath };
}

function run(root, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.FEISHU_APP_ID;
  delete env.FEISHU_APP_SECRET;
  Object.assign(env, extraEnv);
  return spawnSync(process.execPath, [path.join(root, "scripts", "rotate-secrets.mjs")], {
    cwd: root,
    env,
    encoding: "utf8"
  });
}

test("rotates both local tokens without changing identities or workspaces", async (context) => {
  const value = await fixture();
  context.after(() => rm(value.root, { recursive: true, force: true }));

  const result = run(value.root);
  assert.equal(result.status, 0, result.stderr);
  const connector = JSON.parse(await readFile(value.connectorPath, "utf8"));
  const cc = await readFile(value.ccPath, "utf8");

  assert.equal(connector.feishu.appId, "example-app-id");
  assert.equal(connector.feishu.appSecret, "example-old-app-secret");
  assert.equal(connector.workspaces.approved[0].name, "example-workspace");
  assert.notEqual(connector.bridge.token, "example-old-bridge-token");
  assert.notEqual(connector.workspaces.managementToken, "example-old-management-token");
  assert.match(cc, new RegExp(`token = ${JSON.stringify(connector.bridge.token)}`));
  assert.match(cc, new RegExp(`token = ${JSON.stringify(connector.workspaces.managementToken)}`));
  assert.doesNotMatch(result.stdout, new RegExp(connector.bridge.token));
  assert.doesNotMatch(result.stdout, new RegExp(connector.workspaces.managementToken));
  assert.equal((await stat(value.connectorPath)).mode & 0o077, 0);
  assert.equal((await stat(value.ccPath)).mode & 0o077, 0);
});

test("updates a Feishu App Secret without printing it", async (context) => {
  const value = await fixture();
  context.after(() => rm(value.root, { recursive: true, force: true }));
  const nextSecret = "example-new-app-secret";

  const result = run(value.root, { FEISHU_APP_SECRET: nextSecret });
  assert.equal(result.status, 0, result.stderr);
  const connector = JSON.parse(await readFile(value.connectorPath, "utf8"));
  assert.equal(connector.feishu.appSecret, nextSecret);
  assert.doesNotMatch(result.stdout, new RegExp(nextSecret));
  assert.doesNotMatch(result.stderr, new RegExp(nextSecret));
});

test("refuses rotation while the service PID is active", async (context) => {
  const value = await fixture();
  context.after(() => rm(value.root, { recursive: true, force: true }));
  const beforeConnector = await readFile(value.connectorPath, "utf8");
  const beforeCc = await readFile(value.ccPath, "utf8");
  const pidPath = path.join(value.root, "runtime", "service.pid");
  const service = spawn(process.execPath, [path.join(value.root, "scripts", "service-state.mjs"), "serve"], {
    cwd: value.root,
    stdio: "ignore"
  });
  context.after(() => service.kill("SIGTERM"));
  let active = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = spawnSync(process.execPath, [path.join(value.root, "scripts", "service-state.mjs"), "active"], {
      cwd: value.root,
      encoding: "utf8"
    });
    if (status.status === 0) { active = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(active, true);
  await assert.doesNotReject(readFile(pidPath, "utf8"));
  const result = run(value.root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /服务仍在运行或状态需要主人在本机确认/);
  assert.equal(await readFile(value.connectorPath, "utf8"), beforeConnector);
  assert.equal(await readFile(value.ccPath, "utf8"), beforeCc);
  service.kill("SIGTERM");
  await new Promise((resolve) => service.once("exit", resolve));
});

test("rolls back an interrupted two-file rotation before a new request", async (context) => {
  const value = await fixture();
  context.after(() => rm(value.root, { recursive: true, force: true }));
  const originalConnector = await readFile(value.connectorPath, "utf8");
  const originalCc = await readFile(value.ccPath, "utf8");
  const suffix = `${process.pid}.0123456789abcdef`;
  const entries = [value.ccPath, value.connectorPath].map((filePath) => ({
    filePath,
    tempPath: `${filePath}.${suffix}.tmp`,
    backupPath: `${filePath}.${suffix}.bak`
  }));

  await rename(entries[0].filePath, entries[0].backupPath);
  await writeFile(entries[0].filePath, "partial replacement\n", { mode: 0o600 });
  await rename(entries[1].filePath, entries[1].backupPath);
  await writeFile(entries[1].tempPath, "partial staged replacement\n", { mode: 0o600 });
  const journalPath = path.join(value.root, "runtime", ".secret-rotation-journal.json");
  await writeFile(journalPath, `${JSON.stringify({ version: 1, state: "prepared", entries })}\n`, { mode: 0o600 });

  const result = run(value.root, { FEISHU_APP_ID: "example-new-app-id" });
  assert.notEqual(result.status, 0);
  assert.equal(await readFile(value.connectorPath, "utf8"), originalConnector);
  assert.equal(await readFile(value.ccPath, "utf8"), originalCc);
  for (const privatePath of [journalPath, entries[0].backupPath, entries[1].backupPath, entries[1].tempPath]) {
    await assert.rejects(readFile(privatePath, "utf8"), { code: "ENOENT" });
  }
});
