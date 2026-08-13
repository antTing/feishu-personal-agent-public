#!/usr/bin/env node

import { constants, realpathSync } from "node:fs";
import { chmod, lstat, mkdir, open, readFile, rename, unlink, utimes, writeFile } from "node:fs/promises";
import { randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const RUNTIME_ROOT = path.join(ROOT_DIR, "runtime");
const PID_FILE = path.join(RUNTIME_ROOT, "service.pid");
const CONTROL_LOCK = path.join(RUNTIME_ROOT, ".service-control.lock");
const HEARTBEAT_FILE = path.join(RUNTIME_ROOT, ".service-heartbeat");
const COMMAND_FILE = path.join(RUNTIME_ROOT, ".service-command");
const READY_FILE = path.join(RUNTIME_ROOT, ".service-ready");
const LOG_FILE = path.join(RUNTIME_ROOT, "personal-agent.log");
const HEARTBEAT_MAX_AGE_MS = 5_000;

function publicFailure(error) {
  if (error?.code === "EACCES" || error?.code === "EPERM") return "私有文件权限不足";
  if (error?.code === "ENOENT") return "缺少必要的私有运行文件";
  if (error?.code === "EEXIST") return "另一个服务控制操作正在进行";
  if (/unsafe file type|accessible by group|symbolic link/i.test(String(error?.message))) {
    return "私有文件类型或权限不安全";
  }
  if (/stale service state/i.test(String(error?.message))) return "服务状态已过期，但记录的进程仍存在；请由主人在本机确认";
  if (/service is running/i.test(String(error?.message))) return "服务仍在运行";
  if (/control operation|private lock/i.test(String(error?.message))) return "另一个服务控制操作正在进行，或控制锁需要本机确认";
  if (/did not stop/i.test(String(error?.message))) return "服务未在限定时间内停止，未发送强制终止信号";
  return "未分类的本地服务控制错误";
}

function privateMode(metadata, label, expectedType) {
  if (metadata.isSymbolicLink() || !metadata[expectedType]()) {
    throw new Error(`${label} has an unsafe file type`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`${label} must not be accessible by group or other users`);
  }
}

export async function ensurePrivateRuntime() {
  try {
    const metadata = await lstat(RUNTIME_ROOT);
    privateMode(metadata, "runtime directory", "isDirectory");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(RUNTIME_ROOT, { mode: 0o700 });
  }
  await chmod(RUNTIME_ROOT, 0o700);
}

async function readPrivateJson(filePath, label, { allowMissing = false } = {}) {
  let metadata;
  try {
    metadata = await lstat(filePath);
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null;
    throw error;
  }
  privateMode(metadata, label, "isFile");
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function readServiceRecord() {
  const value = await readPrivateJson(PID_FILE, "service state file", { allowMissing: true });
  if (value === null) return null;
  if (value?.version !== 1 || !Number.isSafeInteger(value.pid) || typeof value.token !== "string" || value.token.length < 32) {
    throw new Error("service state file is invalid; inspect the private runtime directory locally");
  }
  return value;
}

function sameToken(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function isServiceRecordActive(record) {
  if (!record) return false;
  try {
    const metadata = await lstat(HEARTBEAT_FILE);
    privateMode(metadata, "service heartbeat", "isFile");
    const heartbeat = JSON.parse(await readFile(HEARTBEAT_FILE, "utf8"));
    const age = Date.now() - metadata.mtimeMs;
    return sameToken(heartbeat?.token, record.token) && age >= 0 && age <= HEARTBEAT_MAX_AGE_MS;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function isServiceReady(record) {
  if (!await isServiceRecordActive(record)) return false;
  const ready = await readPrivateJson(READY_FILE, "service ready state", { allowMissing: true });
  return Boolean(ready && sameToken(ready.token, record.token));
}

export async function isServiceOwnedBy(pid) {
  const record = await readServiceRecord();
  return Boolean(record?.pid === pid && await isServiceRecordActive(record));
}

async function acquireControlLock() {
  await ensurePrivateRuntime();
  const token = randomBytes(16).toString("hex");
  try {
    const handle = await open(CONTROL_LOCK, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ version: 1, token })}\n`);
    await handle.sync();
    await handle.close();
    return token;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const metadata = await lstat(CONTROL_LOCK);
    privateMode(metadata, "service control lock", "isFile");
    throw new Error("another service control operation is in progress, or a stale private lock needs local inspection");
  }
}

async function releaseControlLock(token) {
  const current = await readPrivateJson(CONTROL_LOCK, "service control lock", { allowMissing: true });
  if (current?.token === token) await unlink(CONTROL_LOCK);
}

export async function withControlLock(callback) {
  const token = await acquireControlLock();
  try {
    return await callback();
  } finally {
    await releaseControlLock(token);
  }
}

async function unlinkIfPresent(filePath) {
  await unlink(filePath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

async function unlinkOwnedJson(filePath, token, predicate = () => true) {
  const value = await readPrivateJson(filePath, "private service state", { allowMissing: true });
  if (value && sameToken(value.token, token) && predicate(value)) await unlinkIfPresent(filePath);
}

export async function assertServiceStoppedLocked() {
  const record = await readServiceRecord();
  if (record) {
    if (await isServiceRecordActive(record)) {
      throw new Error("service is running; stop it before changing private configuration");
    }
    if (processExists(record.pid)) {
      throw new Error("stale service state still points to an existing process; owner inspection is required");
    }
    await unlinkOwnedJson(HEARTBEAT_FILE, record.token);
    await unlinkOwnedJson(COMMAND_FILE, record.token);
    await unlinkOwnedJson(READY_FILE, record.token);
    await unlinkOwnedJson(PID_FILE, record.token, (value) => value.pid === record.pid);
    return;
  }
  const [heartbeat, command, ready] = await Promise.all([
    readPrivateJson(HEARTBEAT_FILE, "service heartbeat", { allowMissing: true }),
    readPrivateJson(COMMAND_FILE, "service command", { allowMissing: true }),
    readPrivateJson(READY_FILE, "service ready state", { allowMissing: true })
  ]);
  if (heartbeat || command || ready) {
    throw new Error("service state is incomplete; owner inspection is required");
  }
}

async function atomicPrivateJson(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  await chmod(tempPath, 0o600);
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await unlinkIfPresent(tempPath);
    throw error;
  }
}

async function serveControl() {
  const expectedParentPid = process.ppid;
  if (!Number.isSafeInteger(expectedParentPid) || expectedParentPid <= 1) {
    throw new Error("service control must be started by the service wrapper");
  }
  const token = randomBytes(32).toString("base64url");
  let heartbeatTimer;
  let commandTimer;
  let parentTimer;
  let stopping = false;

  await withControlLock(async () => {
    await assertServiceStoppedLocked();
    await atomicPrivateJson(PID_FILE, { version: 1, pid: expectedParentPid, token });
    await atomicPrivateJson(HEARTBEAT_FILE, { version: 1, token });
  });

  const cleanup = async () => {
    if (stopping) return;
    stopping = true;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (commandTimer) clearInterval(commandTimer);
    if (parentTimer) clearInterval(parentTimer);
    await withControlLock(async () => {
      await unlinkOwnedJson(COMMAND_FILE, token);
      await unlinkOwnedJson(READY_FILE, token);
      await unlinkOwnedJson(HEARTBEAT_FILE, token);
      await unlinkOwnedJson(PID_FILE, token, (value) => value.pid === expectedParentPid);
    }).catch(() => {});
  };

  let heartbeatBusy = false;
  heartbeatTimer = setInterval(async () => {
    if (heartbeatBusy || stopping) return;
    heartbeatBusy = true;
    try {
      const [record, heartbeat] = await Promise.all([
        readServiceRecord(),
        readPrivateJson(HEARTBEAT_FILE, "service heartbeat")
      ]);
      if (record?.pid !== expectedParentPid || !sameToken(record?.token, token) || !sameToken(heartbeat?.token, token)) {
        throw new Error("service control ownership changed");
      }
      const now = new Date();
      await utimes(HEARTBEAT_FILE, now, now);
    } catch {
      await cleanup();
      process.exit(1);
    } finally {
      heartbeatBusy = false;
    }
  }, 500);

  let commandBusy = false;
  commandTimer = setInterval(async () => {
    if (commandBusy || stopping) return;
    commandBusy = true;
    try {
      const request = await readPrivateJson(COMMAND_FILE, "service command", { allowMissing: true });
      if (!request) return;
      if (request.command === "stop" && sameToken(request.token, token) && process.ppid === expectedParentPid) {
        await unlinkOwnedJson(COMMAND_FILE, token);
        process.kill(expectedParentPid, "SIGTERM");
      }
    } catch {
      // Malformed command files are untrusted input. Keep the authenticated
      // controller alive and leave the file for local owner inspection.
    } finally {
      commandBusy = false;
    }
  }, 100);

  parentTimer = setInterval(() => {
    if (process.ppid !== expectedParentPid) cleanup().finally(() => process.exit(0));
  }, 500);
  process.once("SIGTERM", () => cleanup().finally(() => process.exit(0)));
  process.once("SIGINT", () => cleanup().finally(() => process.exit(0)));
}

async function unregisterService(pid) {
  await withControlLock(async () => {
    const record = await readServiceRecord();
    if (record?.pid === pid) await assertServiceStoppedLocked();
  });
}

function requireExpectedOwner(record, expectedOwnerPid) {
  if (!Number.isSafeInteger(expectedOwnerPid) || expectedOwnerPid <= 1 || record?.pid !== expectedOwnerPid) {
    throw new Error("service state owner does not match the requesting wrapper");
  }
}

async function markReady(expectedOwnerPid) {
  await withControlLock(async () => {
    const record = await readServiceRecord();
    if (!record || !await isServiceRecordActive(record)) {
      throw new Error("service is not active");
    }
    requireExpectedOwner(record, expectedOwnerPid);
    await atomicPrivateJson(READY_FILE, { version: 1, token: record.token });
  });
}

async function markNotReady(expectedOwnerPid) {
  await withControlLock(async () => {
    const record = await readServiceRecord();
    if (!record) return;
    requireExpectedOwner(record, expectedOwnerPid);
    await unlinkOwnedJson(READY_FILE, record.token);
  });
}

async function stopService() {
  let record;
  await withControlLock(async () => {
    record = await readServiceRecord();
    if (!record || !await isServiceRecordActive(record)) {
      await assertServiceStoppedLocked();
      record = null;
      return;
    }
    if (await readPrivateJson(COMMAND_FILE, "service command", { allowMissing: true })) {
      throw new Error("a service command is already pending");
    }
    await atomicPrivateJson(COMMAND_FILE, { version: 1, command: "stop", token: record.token });
  });

  if (!record) {
    console.log("服务未运行；已清理可能存在的过期状态。");
    return;
  }

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const current = await readServiceRecord();
    if (!current || (!await isServiceRecordActive(current) && !processExists(current.pid))) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const current = await readServiceRecord();
  if (current && (await isServiceRecordActive(current) || processExists(current.pid))) {
    throw new Error("service did not stop within 15 seconds; no force signal was sent");
  }
  await withControlLock(() => assertServiceStoppedLocked());
  console.log("服务已停止。");
}

async function prepareLog() {
  await withControlLock(async () => {
    await assertServiceStoppedLocked();
    const flags = constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | (constants.O_NOFOLLOW || 0);
    const handle = await open(LOG_FILE, flags, 0o600);
    await handle.close();
    await chmod(LOG_FILE, 0o600);
  });
}

async function main() {
  const command = process.argv[2];
  if (command === "serve") return serveControl();
  if (command === "unregister") return unregisterService(Number(process.argv[3]));
  if (command === "active") {
    const record = await readServiceRecord();
    process.exitCode = await isServiceRecordActive(record) ? 0 : 1;
    return;
  }
  if (command === "ready") {
    const record = await readServiceRecord();
    process.exitCode = await isServiceReady(record) ? 0 : 1;
    return;
  }
  if (command === "owned-by") {
    process.exitCode = await isServiceOwnedBy(Number(process.argv[3])) ? 0 : 1;
    return;
  }
  if (command === "stop") return stopService();
  if (command === "prepare-log") return prepareLog();
  if (command === "mark-ready") return markReady(Number(process.argv[3]));
  if (command === "mark-not-ready") return markNotReady(Number(process.argv[3]));
  throw new Error("unknown service state command");
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`服务控制失败：${publicFailure(error)}。`);
    process.exitCode = 1;
  });
}
