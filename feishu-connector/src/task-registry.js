import { createHash } from "node:crypto";

const PHASE_LABELS = {
  accepted: "已收到",
  queued: "排队中",
  running: "执行中",
  waiting_approval: "等待操作审批",
  stopping: "停止中"
};

function taskId(messageId) {
  return `T-${createHash("sha256").update(messageId).digest("hex").slice(0, 8).toUpperCase()}`;
}

function sameSession(left, right) {
  return left.project === right.project && left.sessionKey === right.sessionKey;
}

export class TaskRegistry {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.byMessageId = new Map();
    this.byChatId = new Map();
  }

  add(task) {
    const chatTasks = this.byChatId.get(task.chatId) || new Map();
    const queued = [...this.byMessageId.values()].some((existing) => sameSession(existing, task));
    const tracked = {
      ...task,
      taskId: task.taskId || taskId(task.messageId),
      startedAt: task.startedAt || this.now(),
      phase: queued ? "queued" : (task.phase || "accepted")
    };
    this.byMessageId.set(tracked.messageId, tracked);
    chatTasks.set(tracked.messageId, tracked);
    this.byChatId.set(tracked.chatId, chatTasks);
    return tracked;
  }

  get(messageId) {
    return this.byMessageId.get(messageId);
  }

  update(messageId, phase) {
    const task = this.get(messageId);
    if (task) task.phase = phase;
    return task;
  }

  finish(messageId) {
    const task = this.byMessageId.get(messageId);
    if (!task) return null;
    this.byMessageId.delete(messageId);
    const chatTasks = this.byChatId.get(task.chatId);
    chatTasks?.delete(messageId);
    if (chatTasks?.size === 0) this.byChatId.delete(task.chatId);
    return task;
  }

  list(chatId) {
    return [...(this.byChatId.get(chatId)?.values() || [])]
      .sort((left, right) => left.startedAt - right.startedAt);
  }

  resolve(chatId, identifier) {
    const tasks = this.list(chatId);
    if (!identifier) return tasks.length === 1 ? tasks[0] : null;
    const normalized = identifier.trim().toLowerCase();
    return tasks.find((task) =>
      task.taskId.toLowerCase() === normalized || task.messageId.toLowerCase() === normalized
    ) || null;
  }

  sameSession(task) {
    return [...this.byMessageId.values()]
      .filter((candidate) => sameSession(candidate, task))
      .sort((left, right) => left.startedAt - right.startedAt);
  }

  format(chatId) {
    const tasks = this.list(chatId);
    if (tasks.length === 0) return "当前没有正在执行或排队的任务。";
    const lines = tasks.map((task, index) => {
      const elapsedSeconds = Math.max(0, Math.floor((this.now() - task.startedAt) / 1_000));
      const phase = PHASE_LABELS[task.phase] || task.phase;
      return `${index + 1}. ${task.taskId} | ${phase} | ${task.project} | ${elapsedSeconds} 秒`;
    });
    return `当前共有 ${tasks.length} 个活动任务：\n${lines.join("\n")}\n\n停止指定任务：停止任务 T-XXXXXXXX`;
  }
}
