import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = path.resolve(MODULE_DIR, "../../runtime/feishu-connector/config.json");

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing configuration value: ${name}`);
  }
  return value;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()) : [];
}

function loopbackUrl(value, name, protocols) {
  const raw = requireString(value, name);
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`Invalid URL configuration value: ${name}`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use ${protocols.join(" or ")}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error(`${name} must use a loopback host`);
  }
  if (parsed.username || parsed.password) throw new Error(`${name} must not contain URL credentials`);
  if (parsed.search || parsed.hash) throw new Error(`${name} must not contain query parameters or fragments`);
  return raw;
}

async function exactPrivatePath(value, expected, name) {
  const configured = path.resolve(requireString(value, name));
  const canonicalParent = await realpath(path.dirname(configured));
  const canonical = path.join(canonicalParent, path.basename(configured));
  if (canonical !== expected) {
    throw new Error(`${name} must stay in the private runtime layout`);
  }
  return canonical;
}

async function privateRegularFile(filePath, name, { allowMissing = false } = {}) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch (error) {
    if (!allowMissing || error?.code !== "ENOENT") throw error;
    const parent = await lstat(path.dirname(filePath));
    if (!parent.isDirectory() || parent.isSymbolicLink()) {
      throw new Error(`${name} parent must be a directory, not a symbolic link`);
    }
    return filePath;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${name} must be a regular file, not a symbolic link`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`${name} must not be accessible by group or other users (expected mode 600)`);
  }
  return realpath(filePath);
}

export async function loadConfig(filePath = process.env.FEISHU_CONNECTOR_CONFIG || DEFAULT_CONFIG) {
  const canonicalConfigPath = await privateRegularFile(filePath, "Feishu Connector config");
  const connectorRuntime = path.dirname(canonicalConfigPath);
  const runtimeRoot = path.dirname(connectorRuntime);

  const raw = await readFile(canonicalConfigPath, "utf8");
  const config = JSON.parse(raw);
  const workspaceStatePath = await exactPrivatePath(
    config.workspaces?.statePath,
    path.join(connectorRuntime, "workspaces.json"),
    "workspaces.statePath"
  );
  const permissionStatePath = await exactPrivatePath(
    config.permissions?.statePath,
    path.join(connectorRuntime, "permissions.json"),
    "permissions.statePath"
  );
  const ccConfigPath = await exactPrivatePath(
    config.workspaces?.ccConfigPath,
    path.join(runtimeRoot, "cc-connect", "config.toml"),
    "workspaces.ccConfigPath"
  );
  await Promise.all([
    privateRegularFile(workspaceStatePath, "workspaces.statePath", { allowMissing: true }),
    privateRegularFile(permissionStatePath, "permissions.statePath", { allowMissing: true })
  ]);
  await privateRegularFile(ccConfigPath, "cc-connect config");

  return {
    feishu: {
      appId: requireString(config.feishu?.appId, "feishu.appId"),
      appSecret: requireString(config.feishu?.appSecret, "feishu.appSecret"),
      allowedUserIds: stringArray(config.feishu?.allowedUserIds),
      allowedBotIds: stringArray(config.feishu?.allowedBotIds),
      allowedBotChatIds: stringArray(config.feishu?.allowedBotChatIds),
      allowGroupMessages: config.feishu?.allowGroupMessages === true
    },
    bridge: {
      url: loopbackUrl(config.bridge?.url, "bridge.url", ["ws:", "wss:"]),
      token: requireString(config.bridge?.token, "bridge.token"),
      platform: requireString(config.bridge?.platform, "bridge.platform"),
      project: requireString(config.bridge?.project, "bridge.project")
    },
    workspaces: {
      statePath: workspaceStatePath,
      ccConfigPath,
      managedRoot: requireString(config.workspaces?.managedRoot, "workspaces.managedRoot"),
      searchRoots: stringArray(config.workspaces?.searchRoots),
      managementUrl: loopbackUrl(config.workspaces?.managementUrl, "workspaces.managementUrl", ["http:", "https:"]),
      managementToken: requireString(config.workspaces?.managementToken, "workspaces.managementToken"),
      approved: Array.isArray(config.workspaces?.approved)
        ? config.workspaces.approved.map((workspace, index) => ({
            name: requireString(workspace?.name, `workspaces.approved[${index}].name`),
            aliases: stringArray(workspace?.aliases),
            path: requireString(workspace?.path, `workspaces.approved[${index}].path`),
            readProject: requireString(workspace?.readProject, `workspaces.approved[${index}].readProject`),
            devProject: requireString(workspace?.devProject, `workspaces.approved[${index}].devProject`)
          }))
        : []
    },
    permissions: {
      statePath: permissionStatePath
    }
  };
}
