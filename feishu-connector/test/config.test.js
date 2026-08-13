import test, { after } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";

const testRoot = await mkdtemp(path.join(os.tmpdir(), "connector-config-test-"));
after(() => rm(testRoot, { recursive: true, force: true }));

async function writeConfig(overrides = {}) {
  const fixtureRoot = await mkdtemp(path.join(testRoot, "fixture-"));
  const connectorRuntime = path.join(fixtureRoot, "runtime", "feishu-connector");
  const ccRuntime = path.join(fixtureRoot, "runtime", "cc-connect");
  await Promise.all([
    mkdir(connectorRuntime, { recursive: true, mode: 0o700 }),
    mkdir(ccRuntime, { recursive: true, mode: 0o700 })
  ]);
  const ccConfigPath = path.join(ccRuntime, "config.toml");
  await writeFile(ccConfigPath, "# private test config\n", { mode: 0o600 });
  await chmod(ccConfigPath, 0o600);

  const filePath = path.join(connectorRuntime, "config.json");
  const defaults = {
    feishu: {
      appId: "replace-with-app-id",
      appSecret: "replace-with-app-secret",
      allowedUserIds: ["example-owner-user"]
    },
    bridge: {
      url: "ws://127.0.0.1:9810/bridge/ws",
      token: "test-bridge-token",
      platform: "feishu-self-built-app",
      project: "personal-agent"
    },
    workspaces: {
      statePath: path.join(connectorRuntime, "workspaces.json"),
      ccConfigPath,
      managedRoot: path.join(fixtureRoot, "managed-workspaces"),
      searchRoots: [],
      managementUrl: "http://localhost:9820",
      managementToken: "test-management-token",
      approved: []
    },
    permissions: { statePath: path.join(connectorRuntime, "permissions.json") }
  };
  const resolvedOverrides = typeof overrides === "function"
    ? overrides({ fixtureRoot, connectorRuntime, ccRuntime, ccConfigPath })
    : overrides;
  const config = {
    ...defaults,
    ...resolvedOverrides,
    feishu: { ...defaults.feishu, ...resolvedOverrides.feishu },
    bridge: { ...defaults.bridge, ...resolvedOverrides.bridge },
    workspaces: { ...defaults.workspaces, ...resolvedOverrides.workspaces },
    permissions: { ...defaults.permissions, ...resolvedOverrides.permissions }
  };
  await writeFile(filePath, JSON.stringify(config), { mode: 0o600 });
  await chmod(filePath, 0o600);
  return { filePath, config, fixtureRoot, connectorRuntime, ccRuntime, ccConfigPath };
}

test("accepts loopback Bridge and Management URLs", async () => {
  const { filePath } = await writeConfig();
  const config = await loadConfig(filePath);
  assert.equal(config.bridge.url, "ws://127.0.0.1:9810/bridge/ws");
  assert.equal(config.workspaces.managementUrl, "http://localhost:9820");
});

test("accepts missing state files when their private parent directory exists", async () => {
  const value = await writeConfig();
  const config = await loadConfig(value.filePath);
  const connectorRuntime = await realpath(value.connectorRuntime);
  assert.equal(config.workspaces.statePath, path.join(connectorRuntime, "workspaces.json"));
  assert.equal(config.permissions.statePath, path.join(connectorRuntime, "permissions.json"));
});

test("rejects remote Bridge and Management URLs", async () => {
  const remoteBridge = await writeConfig({
    bridge: {
      url: "wss://bridge.example.invalid/bridge/ws"
    }
  });
  await assert.rejects(loadConfig(remoteBridge.filePath), /loopback host/);

  const remoteManagement = await writeConfig({
    workspaces: {
      managementUrl: "https://management.example.invalid"
    }
  });
  await assert.rejects(loadConfig(remoteManagement.filePath), /loopback host/);
});

test("rejects credentials and tokens embedded in local URLs", async () => {
  const queryToken = await writeConfig({
    bridge: {
      url: "ws://127.0.0.1:9810/bridge/ws?token=test-secret-value"
    }
  });
  await assert.rejects(loadConfig(queryToken.filePath), /query parameters/);

  const userInfo = await writeConfig({
    workspaces: {
      managementUrl: "http://user:password@127.0.0.1:9820"
    }
  });
  await assert.rejects(loadConfig(userInfo.filePath), /URL credentials/);
});

test("requires fixed state filenames in the configuration directory", async () => {
  const workspaceState = await writeConfig({
    workspaces: { statePath: path.join(testRoot, "outside-workspaces.json") }
  });
  await assert.rejects(loadConfig(workspaceState.filePath), /private runtime layout/);

  const permissionState = await writeConfig({
    permissions: { statePath: path.join(testRoot, "outside-permissions.json") }
  });
  await assert.rejects(loadConfig(permissionState.filePath), /private runtime layout/);

  const renamedWorkspaceState = await writeConfig(({ connectorRuntime }) => ({
    workspaces: { statePath: path.join(connectorRuntime, "workspace-state.json") }
  }));
  await assert.rejects(loadConfig(renamedWorkspaceState.filePath), /private runtime layout/);

  const renamedPermissionState = await writeConfig(({ connectorRuntime }) => ({
    permissions: { statePath: path.join(connectorRuntime, "permission-state.json") }
  }));
  await assert.rejects(loadConfig(renamedPermissionState.filePath), /private runtime layout/);
});

test("rejects a cc-connect configuration outside the sibling private runtime directory", async () => {
  const value = await writeConfig({
    workspaces: { ccConfigPath: path.join(testRoot, "outside-config.toml") }
  });
  await assert.rejects(loadConfig(value.filePath), /private runtime layout/);

  const renamed = await writeConfig(({ ccRuntime }) => ({
    workspaces: { ccConfigPath: path.join(ccRuntime, "bridge.toml") }
  }));
  await assert.rejects(loadConfig(renamed.filePath), /private runtime layout/);
});

test("rejects symbolic links and non-regular private state files", async () => {
  const linked = await writeConfig();
  const target = path.join(linked.fixtureRoot, "state-target.json");
  await writeFile(target, "{}\n", { mode: 0o600 });
  await symlink(target, linked.config.workspaces.statePath);
  await assert.rejects(loadConfig(linked.filePath), /workspaces\.statePath must be a regular file/);

  const directory = await writeConfig();
  await mkdir(directory.config.permissions.statePath, { mode: 0o700 });
  await assert.rejects(loadConfig(directory.filePath), /permissions\.statePath must be a regular file/);
});

test("rejects private state and cc-connect files with loose permissions", async () => {
  const state = await writeConfig();
  await writeFile(state.config.workspaces.statePath, "{}\n", { mode: 0o644 });
  await chmod(state.config.workspaces.statePath, 0o644);
  await assert.rejects(loadConfig(state.filePath), /workspaces\.statePath must not be accessible/);

  const ccConfig = await writeConfig();
  await chmod(ccConfig.ccConfigPath, 0o644);
  await assert.rejects(loadConfig(ccConfig.filePath), /cc-connect config must not be accessible/);
});
