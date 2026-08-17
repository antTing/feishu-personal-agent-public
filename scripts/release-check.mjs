#!/usr/bin/env node

import { lstat, readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const scanArgument = process.argv[2];
const SCAN_TREE = Boolean(scanArgument);
const TARGET_DIR = scanArgument ? path.resolve(scanArgument) : ROOT_DIR;
const PUBLIC_ENTRIES = [
  ".gitignore",
  "AGENTS.md",
  "README.md",
  "INSTALL.md",
  "USAGE.md",
  "OPERATIONS.zh-CN.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY_NOTICES.zh-CN.md",
  "third-party",
  "agent-workspace",
  "config",
  "docs",
  "native",
  "feishu-connector",
  "scripts",
  "feishu-enterprise-app-setup.md",
  "permissions-and-capabilities.md",
  "cost-and-workspace-access.md",
  "personal-ai-agent-plan.md"
];
const REQUIRED_ENTRIES = [
  "README.md",
  "INSTALL.md",
  "USAGE.md",
  "OPERATIONS.zh-CN.md",
  "SECURITY.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY_NOTICES.zh-CN.md",
  "third-party/cc-connect-MIT.txt",
  "third-party/lark-node-sdk-MIT.txt",
  "config/cc-connect.example.toml",
  "config/cc-connect-native.example.toml",
  "config/aily-router.example.md",
  "config/feishu-connector.example.json",
  "native/README.md",
  "native/config-template.mjs",
  "native/dispatch-envelope.mjs",
  "docs/aily-dispatch-protocol.zh-CN.md",
  "docs/task-session-model.zh-CN.md",
  "docs/native-migration.zh-CN.md",
  "feishu-connector/package.json",
  "feishu-connector/package-lock.json",
  "feishu-connector/src/native-onboarding.js",
  "scripts/init-config.sh",
  "scripts/init-native-config.sh",
  "scripts/init-native-config.mjs",
  "scripts/onboard-native.sh",
  "scripts/onboard-native.mjs",
  "scripts/onboard-native-utils.mjs",
  "scripts/codex-cli-env.sh",
  "scripts/export-public.sh",
  "scripts/export-public.mjs",
  "scripts/build-cc-connect-local.sh",
  "scripts/patch-cc-connect-local.mjs",
  "scripts/start-native.sh",
  "scripts/start-background.sh",
  "scripts/start-feishu-connector.sh",
  "scripts/status.sh",
  "scripts/stop.sh",
  "scripts/rotate-secrets.sh",
  "scripts/rotate-secrets.mjs",
  "scripts/service-status.mjs",
  "scripts/service-state.mjs",
  "scripts/diagnose-startup.mjs",
  "scripts/detach-service.mjs",
  "scripts/service-endpoints.mjs",
  "scripts/validate-executable.mjs"
];
const DENIED_DIRS = new Set([
  ".git",
  ".idea",
  ".nyc_output",
  ".vscode",
  ".claude",
  ".cache",
  ".aws",
  ".codex",
  ".config",
  ".cursor",
  ".gnupg",
  ".ssh",
  "attachments",
  "cache",
  "caches",
  "chats",
  "conversations",
  "history",
  "images",
  "logs",
  "messages",
  "runtime",
  "managed-workspaces",
  "node_modules",
  "screenshots",
  "sessions",
  "data",
  "temp",
  "tmp",
  "transcripts"
]);
const DENIED_SUFFIXES = new Set([
  ".pem", ".key", ".p12", ".pfx", ".sqlite", ".sqlite3", ".db", ".log", ".jsonl",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".heic",
  ".zip", ".tar", ".gz", ".tgz", ".dmg", ".exe", ".dll", ".so", ".dylib",
  ".bin", ".wasm", ".class", ".jar", ".o", ".a", ".pyc", ".swp", ".bak",
  ".lock", ".pid", ".har", ".pcap", ".trace", ".out", ".map",
  ".svg", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".mp3", ".wav", ".m4a", ".mp4", ".mov", ".avi", ".mkv"
]);
const TOKEN_ID = /\b(?:app|cli|oc|od|oi|om|on|ou|un|usr)_[A-Za-z0-9_-]{8,}\b/g;
const ALLOWED_PROTOCOL_IDENTIFIERS = new Set(["app_server_url"]);
const PERSONAL_PATH = /(?:\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+|\/private\/var\/folders\/[A-Za-z0-9._/-]+|\/var\/folders\/[A-Za-z0-9._/-]+|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+)/g;
const FEISHU_PRIVATE_LINK = /https?:\/\/(?!open\.)[^\s"']*feishu\.cn\/(?:message|wiki|docx|base|sheets|drive)\/[A-Za-z0-9_-]{8,}/g;
const SECRET_ASSIGNMENT = /\b(?:appsecret|app_secret|bridge[_-]?token|management[_-]?token|token|secret|api[_-]?key|access[_-]?token|secret[_-]?key)\b\s*(?::|=)\s*["']([^"'\r\n]{12,})["']/gi;
const PRIVATE_KEY_HEADER = /-----BEGIN (?:EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/g;
const COMMON_CREDENTIAL = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{16,}\b|\bsk-[A-Za-z0-9_-]{20,}\b/g;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ALLOWED_SECRET_PREFIXES = [
  "replace-",
  "replace_with_",
  "example-",
  "example_",
  "placeholder-",
  "process.",
  "random",
  "required(",
  "optional(",
  "${",
  "<",
  "your_",
  "test-",
  "dummy-"
];
const EXECUTABLE_ENTRIES = [
  "scripts/export-public.sh",
  "scripts/export-public.mjs",
  "scripts/init-config.sh",
  "scripts/init-native-config.sh",
  "scripts/init-native-config.mjs",
  "scripts/onboard-native.sh",
  "scripts/onboard-native.mjs",
  "scripts/build-cc-connect-local.sh",
  "scripts/patch-cc-connect-local.mjs",
  "scripts/preflight.sh",
  "scripts/release-check.sh",
  "scripts/start.sh",
  "scripts/start-background.sh",
  "scripts/start-feishu-connector.sh",
  "scripts/start-native.sh",
  "scripts/status.sh",
  "scripts/stop.sh",
  "scripts/rotate-secrets.sh",
  "scripts/rotate-secrets.mjs",
  "scripts/service-status.mjs",
  "scripts/service-state.mjs",
  "scripts/diagnose-startup.mjs",
  "scripts/detach-service.mjs",
  "scripts/service-endpoints.mjs",
  "scripts/validate-executable.mjs"
];

function displayPath(filePath) {
  return path.relative(TARGET_DIR, filePath) || ".";
}

function isDeniedName(name) {
  if (name === ".DS_Store") return true;
  if (name === ".config.toml.lock") return true;
  if ([".npmrc", ".netrc", ".git-credentials", ".python_history", ".zsh_history", ".bash_history", ".node_repl_history"].includes(name)) return true;
  if (name === ".envrc") return true;
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return true;
  return [...DENIED_SUFFIXES].some((suffix) => name.toLowerCase().endsWith(suffix));
}

function deniedReason(filePath) {
  const relative = path.relative(TARGET_DIR, filePath);
  const parts = relative.split(path.sep);
  const hasDeniedDir = parts.some((part) => DENIED_DIRS.has(part));
  const hasDeniedFile = parts.some(isDeniedName);
  if (hasDeniedDir) return "private directory in release tree";
  if (hasDeniedFile) return "private file in release tree";
  return null;
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function collect(filePath, files, findings) {
  const metadata = await lstat(filePath);
  if (metadata.isSymbolicLink()) {
    findings.push({ file: displayPath(filePath), line: 1, label: "symbolic link in release tree" });
    return;
  }
  const denied = deniedReason(filePath);
  if (denied) {
    const hasDeniedDir = path.relative(TARGET_DIR, filePath).split(path.sep).some((part) => DENIED_DIRS.has(part));
    if (SCAN_TREE || !hasDeniedDir) findings.push({ file: displayPath(filePath), line: 1, label: denied });
    return;
  }
  if (metadata.isFile()) {
    if (metadata.nlink > 1) {
      findings.push({ file: displayPath(filePath), line: 1, label: "hard link in release tree" });
      return;
    }
    files.push(filePath);
    return;
  }
  if (!metadata.isDirectory()) {
    findings.push({ file: displayPath(filePath), line: 1, label: "special file in release tree" });
    return;
  }
  for (const entry of await readdir(filePath, { withFileTypes: true })) {
    await collect(path.join(filePath, entry.name), files, findings);
  }
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

function addMatches(findings, filePath, content, regex, label, filter = () => true) {
  regex.lastIndex = 0;
  for (const match of content.matchAll(regex)) {
    if (!filter(match)) continue;
    findings.push({ file: displayPath(filePath), line: lineNumber(content, match.index), label });
  }
}

const files = [];
const findings = [];
if (SCAN_TREE) {
  await collect(TARGET_DIR, files, findings);
} else {
  for (const entry of REQUIRED_ENTRIES) {
    if (!(await pathExists(path.join(TARGET_DIR, entry)))) {
      findings.push({ file: entry, line: 1, label: "required public entry is missing" });
    }
  }
  for (const entry of PUBLIC_ENTRIES) {
    const target = path.join(TARGET_DIR, entry);
    if (!(await pathExists(target))) {
      findings.push({ file: entry, line: 1, label: "required public entry is missing" });
      continue;
    }
    await collect(target, files, findings);
  }
}

for (const filePath of files) {
  const buffer = await readFile(filePath);
  if (buffer.includes(0)) {
    findings.push({ file: displayPath(filePath), line: 1, label: "binary file in public release" });
    continue;
  }
  const content = buffer.toString("utf8");
  addMatches(
    findings,
    filePath,
    content,
    TOKEN_ID,
    "Feishu-like concrete ID",
    (match) => !ALLOWED_PROTOCOL_IDENTIFIERS.has(match[0])
  );
  addMatches(findings, filePath, content, PERSONAL_PATH, "personal absolute path");
  addMatches(findings, filePath, content, FEISHU_PRIVATE_LINK, "private Feishu resource link");
  addMatches(findings, filePath, content, PRIVATE_KEY_HEADER, "private key material");
  addMatches(findings, filePath, content, COMMON_CREDENTIAL, "credential-like token");
  addMatches(findings, filePath, content, JWT, "JWT-like token");
  addMatches(findings, filePath, content, EMAIL, "email address in public release");
  addMatches(
    findings,
    filePath,
    content,
    SECRET_ASSIGNMENT,
    "concrete secret assignment",
    (match) => !ALLOWED_SECRET_PREFIXES.some((prefix) => match[1].toLowerCase().startsWith(prefix))
  );
}

if (!SCAN_TREE) {
  const ignored = await readFile(path.join(TARGET_DIR, ".gitignore"), "utf8");
  for (const requiredRule of ["runtime/", "node_modules/", ".env", ".claude/"]) {
    if (!ignored.split("\n").includes(requiredRule)) {
      findings.push({ file: ".gitignore", line: 1, label: `missing required ignore rule: ${requiredRule}` });
    }
  }
  for (const entry of EXECUTABLE_ENTRIES) {
    const metadata = await lstat(path.join(TARGET_DIR, entry));
    if ((metadata.mode & 0o111) === 0) {
      findings.push({ file: entry, line: 1, label: "script is not executable" });
    }
  }
}

if (SCAN_TREE && process.platform === "darwin") {
  const xattr = spawnSync("/usr/bin/xattr", ["-r", TARGET_DIR], { encoding: "utf8" });
  if (xattr.status !== 0) {
    findings.push({ file: ".", line: 1, label: "unable to verify macOS extended attributes" });
  } else {
    const unexpectedAttributes = xattr.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.slice(line.lastIndexOf(": ") + 2))
      .filter((name) => name !== "com.apple.provenance");
    if (unexpectedAttributes.length > 0) {
      findings.push({ file: ".", line: 1, label: "unexpected macOS extended attributes in release tree" });
    }
  }
}

if (findings.length > 0) {
  console.error(`Release check failed with ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`- ${finding.file}:${finding.line} ${finding.label}`);
  process.exit(1);
}

console.log(`Release check passed: ${files.length} public file(s) scanned.`);
console.log("Private runtime data and denied file types were excluded from the release tree.");
