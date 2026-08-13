#!/usr/bin/env node

import { chmod, lstat, mkdir, open, readdir, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_DEST = path.join(process.env.TMPDIR || "/tmp", "feishu-personal-agent-public");
const DEST = path.resolve(process.argv[2] || DEFAULT_DEST);
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
  "feishu-connector",
  "scripts",
  "feishu-enterprise-app-setup.md",
  "permissions-and-capabilities.md",
  "cost-and-workspace-access.md",
  "personal-ai-agent-plan.md"
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

function isDeniedName(name) {
  if (name === ".DS_Store") return true;
  if (name === ".config.toml.lock") return true;
  if ([".npmrc", ".netrc", ".git-credentials", ".python_history", ".zsh_history", ".bash_history", ".node_repl_history"].includes(name)) return true;
  if (name === ".envrc") return true;
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return true;
  return [...DENIED_SUFFIXES].some((suffix) => name.toLowerCase().endsWith(suffix));
}

function isDenied(relativePath) {
  const parts = relativePath.split(path.sep);
  return parts.some((part) => DENIED_DIRS.has(part) || isDeniedName(part));
}

function assertDestination() {
  if (!DEST || DEST === path.parse(DEST).root || DEST === ROOT_DIR || DEST.startsWith(`${ROOT_DIR}${path.sep}`)) {
    throw new Error("Release destination must be a new directory outside the source tree");
  }
}

async function ensureDestination() {
  assertDestination();
  try {
    const metadata = await lstat(DEST);
    if (metadata.isSymbolicLink() || metadata.isDirectory() || metadata.isFile()) {
      throw new Error("Release destination already exists; choose a new path");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const parent = path.dirname(DEST);
  const canonicalParent = await realpath(parent);
  const canonicalDestination = path.join(canonicalParent, path.basename(DEST));
  if (canonicalDestination === ROOT_DIR || canonicalDestination.startsWith(`${ROOT_DIR}${path.sep}`)) {
    throw new Error("Release destination must resolve outside the source tree");
  }
  await mkdir(DEST, { recursive: false, mode: 0o755 });
}

async function copyEntry(source, relative) {
  if (isDenied(relative)) return;
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${relative}`);
  const target = path.join(DEST, relative);
  if (metadata.isDirectory()) {
    await mkdir(target, { recursive: true, mode: 0o755 });
    for (const entry of await readdir(source, { withFileTypes: true })) {
      await copyEntry(path.join(source, entry.name), path.join(relative, entry.name));
    }
    return;
  }
  if (!metadata.isFile()) return;
  await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
  const sourceHandle = await open(source, "r");
  const targetHandle = await open(target, "wx", metadata.mode & 0o111 ? 0o755 : 0o644);
  try {
    const content = await sourceHandle.readFile();
    await targetHandle.writeFile(content);
    await targetHandle.sync();
  } finally {
    await Promise.allSettled([sourceHandle.close(), targetHandle.close()]);
  }
  await chmod(target, metadata.mode & 0o111 ? 0o755 : 0o644);
}

await ensureDestination();
for (const entry of PUBLIC_ENTRIES) {
  const source = path.join(ROOT_DIR, entry);
  try {
    await lstat(source);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Missing public entry: ${entry}`);
    throw error;
  }
  await copyEntry(source, entry);
}

if (process.platform === "darwin") {
  const xattr = spawnSync("/usr/bin/xattr", ["-cr", DEST], { encoding: "utf8" });
  if (xattr.status !== 0) throw new Error("Unable to remove macOS extended attributes from the release tree");
}

const check = spawnSync(process.execPath, [path.join(DEST, "scripts", "release-check.mjs"), DEST], {
  cwd: DEST,
  encoding: "utf8"
});
if (check.status !== 0) {
  process.stderr.write(check.stderr || check.stdout || "Release check failed for exported tree.\n");
  throw new Error("Exported release tree did not pass the release check");
}

console.log(`Public release tree created: ${DEST}`);
console.log("Release check passed for the exported tree.");
