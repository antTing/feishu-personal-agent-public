#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { lstat, open, readFile, rename, unlink, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertServiceStoppedLocked, withControlLock } from "./service-state.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const CONNECTOR_CONFIG = path.join(ROOT_DIR, "runtime", "feishu-connector", "config.json");
const CC_CONFIG = path.join(ROOT_DIR, "runtime", "cc-connect", "config.toml");
const ROTATION_JOURNAL = path.join(ROOT_DIR, "runtime", ".secret-rotation-journal.json");

function canonicalPath(value) {
  return path.resolve(value).replace(/^\/private\//, "/");
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

async function requirePrivateFile(filePath, label) {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file, not a symbolic link`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`${label} must use mode 600`);
  }
}

async function privateFileExists(filePath, label) {
  try {
    await requirePrivateFile(filePath, label);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function unlinkIfPresent(filePath) {
  await unlink(filePath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

function validateJournalEntry(entry) {
  if (!entry || ![canonicalPath(CC_CONFIG), canonicalPath(CONNECTOR_CONFIG)].includes(canonicalPath(entry.filePath))) {
    throw new Error("rotation journal contains an unexpected target");
  }
  const prefix = `${entry.filePath}.`;
  const tempSuffix = entry.tempPath?.startsWith(prefix) ? entry.tempPath.slice(prefix.length) : "";
  const match = tempSuffix.match(/^(\d+\.[a-f0-9]{16})\.tmp$/);
  if (!match || entry.backupPath !== `${prefix}${match[1]}.bak` ||
      path.resolve(path.dirname(entry.tempPath)) !== path.resolve(path.dirname(entry.filePath)) ||
      path.resolve(path.dirname(entry.backupPath)) !== path.resolve(path.dirname(entry.filePath))) {
    throw new Error("rotation journal contains an unexpected private path");
  }
}

async function writeRotationJournal(entries) {
  const tempPath = `${ROTATION_JOURNAL}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  const handle = await open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify({ version: 1, state: "prepared", entries })}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tempPath, ROTATION_JOURNAL).catch(async (error) => {
    await unlinkIfPresent(tempPath);
    throw error;
  });
}

async function recoverInterruptedRotation() {
  if (!await privateFileExists(ROTATION_JOURNAL, "rotation journal")) return false;
  const journal = JSON.parse(await readFile(ROTATION_JOURNAL, "utf8"));
  if (journal?.version !== 1 || journal.state !== "prepared" || !Array.isArray(journal.entries) || journal.entries.length !== 2) {
    throw new Error("rotation journal is invalid");
  }
  const targets = new Set(journal.entries.map((entry) => canonicalPath(entry.filePath)));
  if (targets.size !== 2 || !targets.has(canonicalPath(CC_CONFIG)) || !targets.has(canonicalPath(CONNECTOR_CONFIG))) {
    throw new Error("rotation journal target set is invalid");
  }
  journal.entries.forEach(validateJournalEntry);

  // The target set is fixed; restore both files before surfacing any failure.

  const observed = [];
  for (const entry of journal.entries) {
    observed.push({
      entry,
      backupExists: await privateFileExists(entry.backupPath, "rotation backup"),
      targetExists: await privateFileExists(entry.filePath, "private configuration"),
      tempExists: await privateFileExists(entry.tempPath, "rotation staging file")
    });
  }
  for (const value of observed) {
    if (!value.backupExists && !value.targetExists && !value.tempExists) {
      throw new Error("interrupted rotation cannot be recovered automatically");
    }
    }
    for (const { entry, backupExists, targetExists, tempExists } of [...observed].reverse()) {
      if (backupExists) {
        if (targetExists) await unlink(entry.filePath);
        await rename(entry.backupPath, entry.filePath);
    } else if (!targetExists) {
      await rename(entry.tempPath, entry.filePath);
      continue;
    }
    if (tempExists) await unlink(entry.tempPath);
  }
  await unlink(ROTATION_JOURNAL);
  return true;
}

function replaceSectionValue(source, section, key, value) {
  const lines = source.split("\n");
  let currentSection = "";
  let replacements = 0;
  const sectionPattern = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/;
  const keyPattern = new RegExp(`^\\s*${key}\\s*=`);

  for (let index = 0; index < lines.length; index += 1) {
    const sectionMatch = lines[index].match(sectionPattern);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      continue;
    }
    if (currentSection === section && keyPattern.test(lines[index])) {
      lines[index] = `${key} = ${JSON.stringify(value)}`;
      replacements += 1;
    }
  }

  if (replacements !== 1) {
    throw new Error(`expected exactly one ${section}.${key} value, found ${replacements}`);
  }
  return lines.join("\n");
}

async function writePrivatePair(entries) {
  const suffix = `${process.pid}.${randomBytes(8).toString("hex")}`;
  const staged = entries.map(([filePath, content]) => ({
    filePath,
    content,
    tempPath: `${filePath}.${suffix}.tmp`,
    backupPath: `${filePath}.${suffix}.bak`
  }));

  let journalCreated = false;
  try {
    for (const entry of staged) {
      await writeFile(entry.tempPath, entry.content, { mode: 0o600, flag: "wx" });
      await chmod(entry.tempPath, 0o600);
    }
    await writeRotationJournal(staged.map(({ filePath, tempPath, backupPath }) => ({
      filePath,
      tempPath,
      backupPath
    })));
    journalCreated = true;
    for (const entry of staged) {
      await rename(entry.filePath, entry.backupPath);
    }
    for (const entry of staged) {
      await rename(entry.tempPath, entry.filePath);
    }
    await unlink(ROTATION_JOURNAL);
    journalCreated = false;
  } catch (error) {
    if (journalCreated) {
      await recoverInterruptedRotation();
    } else {
      for (const entry of staged) await unlinkIfPresent(entry.tempPath);
    }
    throw error;
  }

  let backupCleanupIncomplete = false;
  for (const entry of staged) {
    try {
      await unlink(entry.backupPath);
    } catch {
      // New files are committed. A leftover private backup is safer than
      // deleting a committed file when cleanup alone fails.
      backupCleanupIncomplete = true;
    }
  }
  return { backupCleanupIncomplete };
}

async function main() {
  let changedFeishuCredentials = false;
  let backupCleanupIncomplete = false;
  await withControlLock(async () => {
    await assertServiceStoppedLocked();
    const recoveredInterruptedRotation = await recoverInterruptedRotation();
    if (recoveredInterruptedRotation) {
      throw new Error("interrupted rotation was rolled back; rerun after local verification");
    }
    await Promise.all([
      requirePrivateFile(CONNECTOR_CONFIG, "Connector config"),
      requirePrivateFile(CC_CONFIG, "cc-connect config")
    ]);

    const [connectorRaw, ccRaw] = await Promise.all([
      readFile(CONNECTOR_CONFIG, "utf8"),
      readFile(CC_CONFIG, "utf8")
    ]);
    const connector = JSON.parse(connectorRaw);
    if (!connector.feishu || !connector.bridge || !connector.workspaces) {
      throw new Error("Connector config is missing required sections");
    }

    const nextAppSecret = process.env.FEISHU_APP_SECRET;
    const nextAppId = process.env.FEISHU_APP_ID;
    if (nextAppSecret !== undefined && !nextAppSecret.trim()) {
      throw new Error("FEISHU_APP_SECRET must not be empty");
    }
    if (nextAppId !== undefined && !nextAppId.trim()) {
      throw new Error("FEISHU_APP_ID must not be empty");
    }
    if (nextAppId !== undefined && nextAppSecret === undefined) {
      throw new Error("FEISHU_APP_SECRET is required when changing FEISHU_APP_ID");
    }

    const bridgeToken = randomToken();
    const managementToken = randomToken();
    connector.bridge.token = bridgeToken;
    connector.workspaces.managementToken = managementToken;
    if (nextAppSecret !== undefined) connector.feishu.appSecret = nextAppSecret;
    if (nextAppId !== undefined) connector.feishu.appId = nextAppId;
    changedFeishuCredentials = nextAppSecret !== undefined;

    let nextCc = replaceSectionValue(ccRaw, "bridge", "token", bridgeToken);
    nextCc = replaceSectionValue(nextCc, "management", "token", managementToken);

    ({ backupCleanupIncomplete } = await writePrivatePair([
      [CC_CONFIG, nextCc],
      [CONNECTOR_CONFIG, `${JSON.stringify(connector, null, 2)}\n`]
    ]));
  });

  console.log("Local Bridge and Management tokens rotated successfully.");
  if (changedFeishuCredentials) console.log("Feishu application credentials updated successfully.");
  console.log("No secret value was printed. Run preflight before restarting the service.");
  if (backupCleanupIncomplete) {
    console.error("警告：轮换已完成，但一个私有备份未能删除；请在本机检查 runtime 目录，服务保持停止状态。");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const category = error?.code === "EACCES" || error?.code === "EPERM"
    ? "私有文件权限不足"
    : error?.code === "ENOENT"
      ? "缺少必要的私有配置"
      : /service is running|stale service state/i.test(String(error?.message))
        ? "服务仍在运行或状态需要主人在本机确认"
        : "配置校验或原子更新失败";
  console.error(`凭据轮换失败：${category}。未输出路径或凭据。`);
  process.exitCode = 1;
});
