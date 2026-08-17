import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_STATE = path.resolve(TEST_DIR, "../../scripts/service-state.mjs");
const SOURCE_START = path.resolve(TEST_DIR, "../../scripts/start-feishu-connector.sh");
const SOURCE_CODEX_ENV = path.resolve(TEST_DIR, "../../scripts/codex-cli-env.sh");
const SOURCE_ENDPOINTS = path.resolve(TEST_DIR, "../../scripts/service-endpoints.mjs");
const SOURCE_CONFIG = path.resolve(TEST_DIR, "../src/config.js");

async function fixture() {
  const root = await mkdtemp(path.join("/tmp", "service-state-test-"));
  const scripts = path.join(root, "scripts");
  const runtime = path.join(root, "runtime");
  await Promise.all([
    mkdir(scripts, { recursive: true }),
    mkdir(runtime, { recursive: true, mode: 0o700 })
  ]);
  await writeFile(path.join(scripts, "service-state.mjs"), await readFile(SOURCE_STATE, "utf8"), { mode: 0o755 });
  await writeFile(path.join(scripts, "start-feishu-connector.sh"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return { root, scripts, runtime, statePath: path.join(scripts, "service-state.mjs") };
}

async function waitForActive(statePath, cwd) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = spawnSync(process.execPath, [statePath, "active"], { cwd });
    if (result.status === 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function delay(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

function runState(value, ...args) {
  return spawnSync(process.execPath, [value.statePath, ...args], {
    cwd: value.root,
    encoding: "utf8"
  });
}

test("refuses to clear stale state that points to an existing process", async (context) => {
  const value = await fixture();
  context.after(() => rm(value.root, { recursive: true, force: true }));
  const pidFile = path.join(value.runtime, "service.pid");
  await writeFile(pidFile, `${JSON.stringify({ version: 1, pid: process.pid, token: "a".repeat(32) })}\n`, { mode: 0o600 });

  const result = spawnSync(process.execPath, [value.statePath, "stop"], { cwd: value.root, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /主人在本机确认/);
  await assert.doesNotReject(readFile(pidFile, "utf8"));
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});

test("serves an authenticated local control channel", async (context) => {
  const value = await fixture();
  const child = spawn(process.execPath, [value.statePath, "serve"], { cwd: value.root, stdio: "ignore" });
  context.after(async () => {
    await stopChild(child);
    await rm(value.root, { recursive: true, force: true });
  });

  assert.equal(await waitForActive(value.statePath, value.root), true);
  const beforeReady = spawnSync(process.execPath, [value.statePath, "ready"], { cwd: value.root });
  assert.notEqual(beforeReady.status, 0);
  const marked = spawnSync(process.execPath, [value.statePath, "mark-ready", String(process.pid)], { cwd: value.root, encoding: "utf8" });
  assert.equal(marked.status, 0, marked.stderr);
  const afterReady = spawnSync(process.execPath, [value.statePath, "ready"], { cwd: value.root });
  assert.equal(afterReady.status, 0);
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
});

test("service ownership is limited to the wrapper PID", async (context) => {
  const value = await fixture();
  const child = spawn(process.execPath, [value.statePath, "serve"], { cwd: value.root, stdio: "ignore" });
  context.after(async () => {
    await stopChild(child);
    await rm(value.root, { recursive: true, force: true });
  });

  assert.equal(await waitForActive(value.statePath, value.root), true);
  const owner = runState(value, "owned-by", String(process.pid));
  assert.equal(owner.status, 0, owner.stderr);

  const unrelatedPid = process.pid === 2 ? 3 : 2;
  const unrelated = runState(value, "owned-by", String(unrelatedPid));
  assert.notEqual(unrelated.status, 0);
});

test("ready state can be withdrawn when Bridge disconnects", async (context) => {
  const value = await fixture();
  const child = spawn(process.execPath, [value.statePath, "serve"], { cwd: value.root, stdio: "ignore" });
  context.after(async () => {
    await stopChild(child);
    await rm(value.root, { recursive: true, force: true });
  });

  assert.equal(await waitForActive(value.statePath, value.root), true);
  assert.notEqual(runState(value, "ready").status, 0);
  assert.equal(runState(value, "mark-ready", String(process.pid)).status, 0);
  assert.equal(runState(value, "ready").status, 0);
  assert.notEqual(runState(value, "mark-not-ready", "2").status, 0);
  assert.equal(runState(value, "ready").status, 0);
  assert.equal(runState(value, "mark-not-ready", String(process.pid)).status, 0);
  assert.notEqual(runState(value, "ready").status, 0);
});

test("control process survives empty and partial command files", async (context) => {
  const value = await fixture();
  const child = spawn(process.execPath, [value.statePath, "serve"], { cwd: value.root, stdio: "ignore" });
  context.after(async () => {
    await stopChild(child);
    await rm(value.root, { recursive: true, force: true });
  });
  const commandFile = path.join(value.runtime, ".service-command");

  assert.equal(await waitForActive(value.statePath, value.root), true);
  await writeFile(commandFile, "", { mode: 0o600, flag: "wx" });
  await delay(250);
  assert.equal(child.exitCode, null, "control process exited after observing an empty command file");
  await unlink(commandFile);

  await writeFile(commandFile, '{"version":1,"command":"stop"', { mode: 0o600, flag: "wx" });
  await delay(250);
  assert.equal(child.exitCode, null, "control process exited after observing a partial command file");
  await unlink(commandFile);

  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
});

test("stops only through the authenticated service control process", async (context) => {
  const value = await fixture();
  const wrapper = path.join(value.scripts, "wrapper.sh");
  await writeFile(wrapper, [
    "#!/bin/sh",
    "set -eu",
    `node ${JSON.stringify(value.statePath)} serve &`,
    "control_pid=$!",
    "trap 'kill -TERM $control_pid 2>/dev/null || true; wait $control_pid 2>/dev/null || true; exit 0' EXIT TERM INT",
    "while :; do sleep 1; done",
    ""
  ].join("\n"), { mode: 0o755 });
  const service = spawn("/bin/sh", [wrapper], { cwd: value.root, stdio: "ignore" });
  context.after(async () => {
    await stopChild(service);
    await rm(value.root, { recursive: true, force: true });
  });
  assert.equal(await waitForActive(value.statePath, value.root), true);

  const stopped = spawnSync(process.execPath, [value.statePath, "stop"], { cwd: value.root, encoding: "utf8", timeout: 5_000 });
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.match(stopped.stdout, /已停止/);
  await new Promise((resolve) => service.once("exit", resolve));
  const active = spawnSync(process.execPath, [value.statePath, "active"], { cwd: value.root });
  assert.notEqual(active.status, 0);
});

test("rejects a symbolic-link PID file", async (context) => {
  const value = await fixture();
  context.after(() => rm(value.root, { recursive: true, force: true }));
  const target = path.join(value.runtime, "target.json");
  await writeFile(target, "{}\n", { mode: 0o600 });
  await symlink(target, path.join(value.runtime, "service.pid"));

  const result = spawnSync(process.execPath, [value.statePath, "active"], { cwd: value.root, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /私有文件类型或权限不安全/);
});

test("start preflight resolves modules from the install root, not the caller cwd", async (context) => {
  const root = await mkdtemp(path.join("/tmp", "service-start-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, "scripts");
  const runtime = path.join(root, "runtime");
  const hostileCwd = path.join(root, "caller-cwd");
  const fakeBin = path.join(root, "fake-bin");
  const marker = path.join(root, "preflight-cwd.txt");
  await Promise.all([
    mkdir(scripts, { recursive: true }),
    mkdir(path.join(runtime, "feishu-connector"), { recursive: true, mode: 0o700 }),
    mkdir(path.join(runtime, "bin"), { recursive: true, mode: 0o700 }),
    mkdir(path.join(hostileCwd, "feishu-connector", "src"), { recursive: true }),
    mkdir(fakeBin, { recursive: true })
  ]);
  const startPath = path.join(scripts, "start-feishu-connector.sh");
  await writeFile(startPath, await readFile(SOURCE_START, "utf8"), { mode: 0o755 });
  await writeFile(path.join(scripts, "codex-cli-env.sh"), await readFile(SOURCE_CODEX_ENV, "utf8"), { mode: 0o600 });
  await writeFile(path.join(runtime, "feishu-connector", "config.json"), "{}\n", { mode: 0o600 });
  await writeFile(path.join(runtime, "bin", "cc-connect-local"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  await writeFile(path.join(hostileCwd, "feishu-connector", "src", "config.js"), "throw new Error('caller module loaded');\n");
  await writeFile(path.join(fakeBin, "node"), [
    "#!/bin/sh",
    "case \"${1:-}\" in *validate-executable.mjs) exit 0 ;; esac",
    "if [ \"${1:-}\" = '--input-type=module' ]; then pwd > \"$TEST_CWD_MARKER\"; fi",
    "exit 9",
    ""
  ].join("\n"), { mode: 0o755 });
  await writeFile(path.join(fakeBin, "codex"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  const result = spawnSync("/bin/sh", [startPath], {
    cwd: hostileCwd,
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, TEST_CWD_MARKER: marker },
    encoding: "utf8"
  });
  assert.notEqual(result.status, 0);
  const observedCwd = (await readFile(marker, "utf8")).trim();
  assert.equal(path.basename(observedCwd), path.basename(root));
  assert.notEqual(path.basename(observedCwd), path.basename(hostileCwd));
  assert.doesNotMatch(result.stderr, /caller module loaded/);
});

test("reads custom loopback service ports from validated configuration", async (context) => {
  const root = await mkdtemp(path.join("/tmp", "service-endpoints-test-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, "scripts");
  const source = path.join(root, "feishu-connector", "src");
  const runtime = path.join(root, "runtime", "feishu-connector");
  const ccRuntime = path.join(root, "runtime", "cc-connect");
  await Promise.all([
    mkdir(scripts, { recursive: true }),
    mkdir(source, { recursive: true }),
    mkdir(runtime, { recursive: true, mode: 0o700 }),
    mkdir(ccRuntime, { recursive: true, mode: 0o700 }),
    mkdir(path.join(root, "managed-workspaces"), { recursive: true }),
    mkdir(path.join(root, "approved"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(scripts, "service-endpoints.mjs"), await readFile(SOURCE_ENDPOINTS, "utf8"), { mode: 0o755 }),
    writeFile(path.join(source, "config.js"), await readFile(SOURCE_CONFIG, "utf8"), { mode: 0o644 })
  ]);
  const configPath = path.join(runtime, "config.json");
  await writeFile(path.join(ccRuntime, "config.toml"), "[bridge]\nenabled = true\n", { mode: 0o600 });
  await writeFile(configPath, `${JSON.stringify({
    feishu: {
      appId: "example-app",
      appSecret: "example-secret-value",
      allowedUserIds: ["example-owner"],
      allowedBotIds: [],
      allowedBotChatIds: [],
      allowGroupMessages: true
    },
    bridge: {
      url: "ws://127.0.0.1:19810/bridge/ws",
      token: "example-bridge-token-value",
      platform: "example-platform",
      project: "example-project"
    },
    workspaces: {
      statePath: path.join(runtime, "workspaces.json"),
      ccConfigPath: path.join(root, "runtime", "cc-connect", "config.toml"),
      managedRoot: path.join(root, "managed-workspaces"),
      searchRoots: [path.join(root, "approved")],
      managementUrl: "http://localhost:19820",
      managementToken: "example-management-token-value",
      approved: []
    },
    permissions: { statePath: path.join(runtime, "permissions.json") }
  })}\n`, { mode: 0o600 });

  const env = { ...process.env, FEISHU_CONNECTOR_CONFIG: configPath };
  const bridge = spawnSync(process.execPath, [path.join(scripts, "service-endpoints.mjs"), "bridge-port"], {
    cwd: root,
    env,
    encoding: "utf8"
  });
  const management = spawnSync(process.execPath, [path.join(scripts, "service-endpoints.mjs"), "management-port"], {
    cwd: root,
    env,
    encoding: "utf8"
  });
  assert.equal(bridge.status, 0, bridge.stderr);
  assert.equal(bridge.stdout.trim(), "19810");
  assert.equal(management.status, 0, management.stderr);
  assert.equal(management.stdout.trim(), "19820");
});
