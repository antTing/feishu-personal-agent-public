import { chmod, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";

const PERMISSION_DECISION = /^\s*(允许|批准|拒绝|不允许)操作\s+(PA-[A-F0-9]{8})\s*$/i;
const PERMISSION_TTL_MS = 5 * 60_000;

function requestId() {
  return `PA-${randomBytes(4).toString("hex").toUpperCase()}`;
}

async function atomicWriteJson(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(tempPath, 0o600);
  await rename(tempPath, filePath);
}

export class PermissionCoordinator {
  constructor({ statePath, ownerUserIds }) {
    this.statePath = statePath;
    this.ownerUserId = ownerUserIds[0] || null;
    this.state = { version: 1, pending: [] };
    this.saveQueue = Promise.resolve();
  }

  async initialize() {
    try {
      const metadata = await stat(this.statePath);
      if ((metadata.mode & 0o077) !== 0) throw new Error("permission state must use mode 600");
      this.state = JSON.parse(await readFile(this.statePath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    this.state.pending ||= [];
    this.pruneExpired();
    await this.save();
  }

  async remember({ project, sessionKey, replyCtx, sourceMessageId, sourceChatId, toolName, toolInput }) {
    const id = requestId();
    this.state.pending.push({
      id,
      project,
      sessionKey,
      replyCtx,
      sourceMessageId,
      sourceChatId: sourceChatId || String(sessionKey || "").split(":")[1],
      toolName,
      toolInputPresent: Boolean(toolInput),
      createdAt: Date.now(),
      expiresAt: Date.now() + PERMISSION_TTL_MS
    });
    await this.save();
    return id;
  }

  async decide({ text, senderId, senderType, chatId }) {
    const match = text.match(PERMISSION_DECISION);
    if (!match) return null;

    this.pruneExpired();
    const id = match[2].toUpperCase();
    const index = this.state.pending.findIndex((entry) => entry.id === id);
    if (index === -1) return { type: "reply", text: `没有找到待审批的操作 ${id}。` };

    const pending = this.state.pending[index];
    if (senderType !== "user" || senderId !== this.ownerUserId || chatId !== pending.sourceChatId) {
      return { type: "reply", text: "该操作只能由主人本人在原任务会话中审批。" };
    }

    const allowed = ["允许", "批准"].includes(match[1]);
    return { type: "decision", allowed, pending };
  }

  async complete(id) {
    const index = this.state.pending.findIndex((entry) => entry.id === id);
    if (index === -1) return;
    this.state.pending.splice(index, 1);
    await this.save();
  }

  pruneExpired(now = Date.now()) {
    this.state.pending = this.state.pending.filter((entry) =>
      Number(entry.expiresAt || entry.createdAt + PERMISSION_TTL_MS) > now
    );
  }

  async save() {
    this.saveQueue = this.saveQueue.then(() => atomicWriteJson(this.statePath, this.state));
    await this.saveQueue;
  }
}
