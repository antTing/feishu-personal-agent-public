import { createHash } from "node:crypto";

const ID_PATTERNS = {
  chain: /^DS-[A-Z0-9]{8}$/,
  task: /^T-[A-Z0-9]{8}$/
};
const WORKSPACE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{1,79}$/;
const BLOCK_RE = /(?:^|\n)\s*\[LOCAL_TASK\]\s*\n([\s\S]*?)\n\s*\[\/LOCAL_TASK\]\s*(?:\n|$)/i;

function requiredString(value, field, max = 20_000) {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function validateId(value, field, pattern) {
  const normalized = requiredString(value, field, 32).toUpperCase();
  if (!pattern.test(normalized)) throw new Error(`${field} has an invalid format`);
  return normalized;
}

function validateEnvelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("local task envelope must be an object");
  }
  const version = value.version ?? 1;
  if (version !== 1) throw new Error("unsupported local task envelope version");
  const chainId = validateId(value.chain_id, "chain_id", ID_PATTERNS.chain);
  const taskId = validateId(value.task_id, "task_id", ID_PATTERNS.task);
  const workspace = requiredString(value.workspace || "default-workspace", "workspace", 80);
  if (!WORKSPACE_NAME.test(workspace)) throw new Error("workspace has an invalid format");
  const permission = value.permission || "read";
  if (!["read", "development"].includes(permission)) {
    throw new Error("permission must be read or development");
  }
  const request = requiredString(value.request, "request");
  const branch = value.branch == null || value.branch === "" ? null : requiredString(value.branch, "branch", 200);
  return {
    version: 1,
    chain_id: chainId,
    task_id: taskId,
    workspace,
    permission,
    branch,
    request,
    context: typeof value.context === "string" ? value.context.trim().slice(0, 10_000) : ""
  };
}

export function buildDispatchEnvelope(input) {
  const value = validateEnvelope(input);
  return [
    "[LOCAL_TASK]",
    JSON.stringify(value),
    "[/LOCAL_TASK]",
    "",
    value.request
  ].join("\n");
}

export function parseDispatchEnvelope(text) {
  if (typeof text !== "string") return null;
  const match = text.match(BLOCK_RE);
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new Error("local task envelope JSON is invalid");
  }
  return validateEnvelope(parsed);
}

export function stripDispatchEnvelope(text) {
  if (typeof text !== "string") return "";
  return text.replace(BLOCK_RE, "").trim();
}

export function deriveChainId({ dispatcher, sourceChat, sourceRoot, topic = "" }) {
  const requiredParts = [dispatcher, sourceChat, sourceRoot]
    .map((part) => requiredString(part, "source key", 512));
  const normalizedTopic = typeof topic === "string" ? topic.trim().slice(0, 512) : "";
  const input = [...requiredParts, normalizedTopic].join("\u001f");
  return `DS-${createHash("sha256").update(input).digest("hex").slice(0, 8).toUpperCase()}`;
}

export function deriveTaskId({ chainId, sourceMessage }) {
  const chain = validateId(chainId, "chain_id", ID_PATTERNS.chain);
  const message = requiredString(sourceMessage, "source_message", 512);
  return `T-${createHash("sha256").update(`${chain}\u001f${message}`).digest("hex").slice(0, 8).toUpperCase()}`;
}

export function sessionBoundary({ sourceChat, sourceRoot }) {
  const chat = requiredString(sourceChat, "source_chat", 512);
  const root = requiredString(sourceRoot || sourceChat, "source_root", 512);
  return `${chat}:${root}`;
}

export function sameTaskChain(left, right) {
  return Boolean(left?.chain_id && right?.chain_id && left.chain_id === right.chain_id);
}
