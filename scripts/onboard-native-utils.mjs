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
  const expected = [
    `app_id = ${tomlString(pending.appId)}`,
    `app_secret = ${tomlString(pending.appSecret)}`,
    `work_dir = ${tomlString(pending.workspace)}`
  ];
  if (pending.agentType === "codex") expected.push('type = "codex"');
  if (pending.agentType === "claudecode") expected.push('type = "claudecode"');
  if (pending.agentType === "acp") expected.push('type = "acp"');
  return expected.every((line) => configText.split("\n").includes(line));
}

export function upgradeNativeWorkspacePolicy(configText) {
  if (typeof configText !== "string" || !configText.trim()) {
    throw new Error("native config is empty or invalid");
  }
  const hadFinalNewline = configText.endsWith("\n");
  const lines = configText.split("\n");
  if (hadFinalNewline) lines.pop();

  const projectStart = lines.findIndex((line) => line.trim() === "[[projects]]");
  const platformStart = lines.findIndex((line) => line.trim() === "[[projects.platforms]]");
  const platformOptions = lines.findIndex(
    (line, index) => index > platformStart && line.trim() === "[projects.platforms.options]"
  );
  if (projectStart < 0 || platformStart <= projectStart || platformOptions <= platformStart) {
    throw new Error("native config layout is not supported for automatic policy migration");
  }

  const projectAdminLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => index > projectStart && index < platformStart && /^\s*admin_from\s*=/.test(line));
  if (projectAdminLines.length !== 1) {
    throw new Error("native config must contain exactly one project admin policy");
  }
  const adminMatch = projectAdminLines[0].line.match(/^\s*admin_from\s*=\s*("(?:\\.|[^"\\])*")\s*$/);
  if (!adminMatch) throw new Error("native project admin policy is invalid");
  const ownerId = JSON.parse(adminMatch[1]);
  if (typeof ownerId !== "string" || !/^ou_[A-Za-z0-9]+$/.test(ownerId)) {
    throw new Error("native project admin policy is invalid");
  }

  const nextSection = lines.findIndex(
    (line, index) => index > platformOptions && /^\s*\[/.test(line)
  );
  const platformEnd = nextSection < 0 ? lines.length : nextSection;
  const platformAdminLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => index > platformOptions && index < platformEnd && /^\s*admin_from\s*=/.test(line));
  if (platformAdminLines.length > 1) {
    throw new Error("native platform admin policy is ambiguous");
  }
  if (platformAdminLines.length === 1) {
    const platformMatch = platformAdminLines[0].line.match(/^\s*admin_from\s*=\s*("(?:\\.|[^"\\])*")\s*$/);
    if (!platformMatch || JSON.parse(platformMatch[1]) !== ownerId) {
      throw new Error("native project and platform admin policies do not match");
    }
  } else {
    const approvalIndex = lines.findIndex(
      (line, index) => index > platformOptions && index < platformEnd && /^\s*approval_from\s*=/.test(line)
    );
    const insertAt = approvalIndex > platformOptions ? approvalIndex : platformOptions + 1;
    lines.splice(insertAt, 0, `admin_from = ${JSON.stringify(ownerId)}`);
  }

  const disabledLines = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line, index }) => index > projectStart && index < platformStart && /^\s*disabled_commands\s*=/.test(line));
  if (disabledLines.length !== 1) {
    throw new Error("native config must contain exactly one disabled command policy");
  }
  const disabledMatch = disabledLines[0].line.match(/^(\s*)disabled_commands\s*=\s*(\[.*\])\s*$/);
  if (!disabledMatch) throw new Error("native disabled command policy is invalid");
  let disabled;
  try {
    disabled = JSON.parse(disabledMatch[2]);
  } catch {
    throw new Error("native disabled command policy is invalid");
  }
  if (!Array.isArray(disabled) || disabled.some((command) => typeof command !== "string")) {
    throw new Error("native disabled command policy is invalid");
  }
  const nextDisabled = disabled.filter((command) => !["dir", "workspace"].includes(command));
  lines[disabledLines[0].index] = `${disabledMatch[1]}disabled_commands = ${JSON.stringify(nextDisabled)}`;

  const content = `${lines.join("\n")}${hadFinalNewline ? "\n" : ""}`;
  return { content, changed: content !== configText };
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
