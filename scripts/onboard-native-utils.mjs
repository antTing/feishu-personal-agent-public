import { randomBytes } from "node:crypto";
import { link, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

const HIDDEN_SECRET = "[已隐藏敏感值]";
const HIDDEN_IDENTITY = "[已隐藏身份值]";
const HIDDEN_LINK = "[已隐藏链接]";
const HIDDEN_PATH = "[已隐藏本地路径]";
const MAX_DIAGNOSTIC_LENGTH = 2_000;

const SECRET_FIELD = /((?:["']?(?:app[_-]?secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|tenant[_-]?access[_-]?token|user[_-]?access[_-]?token|api[_-]?key|secret[_-]?key|authorization|cookie|token|secret)["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}\]]+)/gi;
const IDENTITY_FIELD = /((?:["']?(?:app[_-]?id|client[_-]?id|open[_-]?id|union[_-]?id|user[_-]?id|chat[_-]?id|message[_-]?id|tenant[_-]?key)["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}\]]+)/gi;
const FEISHU_ID = /\b(?:app|cli|oc|od|oi|om|on|ou|un|usr)_[A-Za-z0-9_-]+\b/g;
const AUTHORIZATION_VALUE = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const COOKIE_HEADER = /\b(?:cookie|set-cookie)\s*:\s*[^\r\n]*/gi;
const URL = /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"']+/g;
const PROTOCOL_RELATIVE_URL = /(^|[\s([{:=>])\/\/[^\s<>"']+/gm;
const QUOTED_ABSOLUTE_PATH = /(["'])(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\)[^"'\r\n]*\1/g;
const BACKTICK_ABSOLUTE_PATH = /`(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\)[^`\r\n]*`/g;
const ABSOLUTE_PATH_WITH_SPACES = /(?:\/(?:Users|home|private|var|tmp|Volumes)\/[^\r\n,;)}\]]+|\b[A-Za-z]:[\\/][^\r\n,;)}\]]+|\\\\[^\r\n,;)}\]]+)/g;
const WINDOWS_ABSOLUTE_PATH = /(?:\b[A-Za-z]:[\\/]|\\\\)[^\s,;)\]}]+/g;
const POSIX_ABSOLUTE_PATH = /(^|[\s([{:=>])\/(?!\/)[^\s,;)\]}]+/gm;
const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/g;

function tomlString(value) {
  return JSON.stringify(String(value));
}

function sourceDiagnostic(error) {
  if (typeof error === "string") return error;
  if (typeof error === "number" || typeof error === "bigint" || typeof error === "boolean") {
    return String(error);
  }
  try {
    if (typeof error?.message === "string") return error.message;
  } catch {
    // An SDK error may expose message through an unsafe getter. Do not inspect it further.
  }
  return "安装失败";
}

function replaceKnownSensitiveValues(message, values) {
  const ordered = [...new Set([...values]
    .filter((value) => value !== undefined && value !== null && String(value) !== "")
    .map(String))]
    .sort((left, right) => right.length - left.length);
  for (const value of ordered) message = message.split(value).join(HIDDEN_SECRET);
  return message;
}

export function nativeConfigMatchesPending(configText, pending) {
  if (typeof configText !== "string" || !pending || typeof pending !== "object") return false;
  return [
    `app_id = ${tomlString(pending.appId)}`,
    `app_secret = ${tomlString(pending.appSecret)}`,
    `work_dir = ${tomlString(pending.workspace)}`
  ].every((line) => configText.split("\n").includes(line));
}

export function sanitizeDiagnostic(error, sensitiveValues = []) {
  let message = sourceDiagnostic(error)
    .replace(ANSI_ESCAPE, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");

  message = message
    .replace(COOKIE_HEADER, HIDDEN_SECRET)
    .replace(AUTHORIZATION_VALUE, HIDDEN_SECRET)
    .replace(URL, HIDDEN_LINK)
    .replace(PROTOCOL_RELATIVE_URL, (_match, prefix) => `${prefix}${HIDDEN_LINK}`)
    .replace(QUOTED_ABSOLUTE_PATH, (_match, quote) => `${quote}${HIDDEN_PATH}${quote}`)
    .replace(BACKTICK_ABSOLUTE_PATH, "`" + HIDDEN_PATH + "`")
    .replace(ABSOLUTE_PATH_WITH_SPACES, HIDDEN_PATH)
    .replace(WINDOWS_ABSOLUTE_PATH, HIDDEN_PATH)
    .replace(POSIX_ABSOLUTE_PATH, (_match, prefix) => `${prefix}${HIDDEN_PATH}`);
  message = replaceKnownSensitiveValues(message, sensitiveValues)
    .replace(SECRET_FIELD, (_match, prefix) => `${prefix}${HIDDEN_SECRET}`)
    .replace(IDENTITY_FIELD, (_match, prefix) => `${prefix}${HIDDEN_IDENTITY}`)
    .replace(FEISHU_ID, HIDDEN_IDENTITY)
    .replace(/\s+/g, " ")
    .trim();

  if (!message) return "安装失败";
  if (message.length > MAX_DIAGNOSTIC_LENGTH) {
    return `${message.slice(0, MAX_DIAGNOSTIC_LENGTH)}…`;
  }
  return message;
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (process.platform === "win32" && ["EACCES", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(error?.code)) {
      return;
    }
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function atomicPrivateWrite(filePath, content, { exclusive = false } = {}) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
  );
  let tempExists = false;
  let handle;

  try {
    try {
      handle = await open(tempPath, "wx", 0o600);
      tempExists = true;
      await handle.writeFile(content);
      await handle.chmod(0o600);
      await handle.sync();
    } finally {
      await handle?.close().catch(() => {});
    }

    if (exclusive) {
      // link() installs the already-synced inode without replacing an existing target.
      // Filesystems without atomic hard-link support fail closed instead of falling back
      // to a direct, interruptible write of the destination.
      await link(tempPath, filePath);
      await unlink(tempPath);
    } else {
      await rename(tempPath, filePath);
    }
    tempExists = false;
    await syncDirectory(directory);
  } catch (error) {
    if (tempExists) await unlink(tempPath).catch(() => {});
    throw error;
  }
}
