#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderNativeConfig,
  validateFeishuIdentityValues
} from "../native/config-template.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const FORCE = process.argv.includes("--force");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(name) {
  return process.env[name]?.trim() || "";
}

function absolute(name, value) {
  if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return path.resolve(value);
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function realDirectory(candidate, name) {
  const metadata = await lstat(candidate);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${name} must be a real directory`);
  }
  return realpath(candidate);
}

async function privateDirectory(directory) {
  try {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("private runtime path must be a real directory");
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error("private runtime directory must use mode 700");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(directory, { mode: 0o700 });
  }
  await chmod(directory, 0o700);
}

async function privateFile(filePath, content) {
  if (!FORCE) {
    await writeFile(filePath, content, { mode: 0o600, flag: "wx" });
    await chmod(filePath, 0o600);
    return;
  }
  const tempPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(tempPath, content, { mode: 0o600, flag: "wx" });
  await chmod(tempPath, 0o600);
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

const appId = required("FEISHU_APP_ID");
const appSecret = required("FEISHU_APP_SECRET");
const ownerId = required("FEISHU_OWNER_OPEN_ID");
const dispatcherId = optional("FEISHU_DISPATCH_BOT_OPEN_ID");
const executionChatId = required("FEISHU_EXECUTION_CHAT_ID");
validateFeishuIdentityValues({ appId, ownerId, dispatcherId, executionChatId });
const initialWorkspaceValue = optional("INITIAL_WORKSPACE_PATH") || optional("WORKSPACE_PATH");
if (!initialWorkspaceValue) {
  throw new Error("INITIAL_WORKSPACE_PATH is required");
}
const workspace = await realDirectory(
  absolute("INITIAL_WORKSPACE_PATH", initialWorkspaceValue),
  "INITIAL_WORKSPACE_PATH"
);
const home = path.resolve(os.homedir());
if (workspace === path.parse(workspace).root || workspace === home) {
  throw new Error("INITIAL_WORKSPACE_PATH must not be a filesystem or home root");
}
if (isInside(workspace, ROOT_DIR) || isInside(ROOT_DIR, workspace)) {
  throw new Error("INITIAL_WORKSPACE_PATH must not expose the installation or private runtime tree");
}

const runtime = path.join(ROOT_DIR, "runtime", "native-cc-connect");
const dataDir = path.join(runtime, "data");
const configPath = path.join(runtime, "config.toml");
await privateDirectory(path.join(ROOT_DIR, "runtime"));
await privateDirectory(runtime);
await privateDirectory(dataDir);
try {
  const metadata = await lstat(configPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("native config target must be a regular file, not a symbolic link");
  }
  if ((metadata.mode & 0o077) !== 0) throw new Error("native config must use mode 600");
  if (!FORCE) throw new Error("native config already exists; use --force only intentionally");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const config = renderNativeConfig({
  appId,
  appSecret,
  ownerId,
  dispatcherId,
  executionChatId,
  workspace,
  dataDir
});

await privateFile(configPath, config);
console.log("已生成原生 cc-connect 私有配置。未输出密钥或身份值。");
