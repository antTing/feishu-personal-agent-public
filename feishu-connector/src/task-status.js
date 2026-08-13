const DEFAULT_RUNNING_DELAY_MS = 30_000;

export class TaskStatusTracker {
  constructor({ reply, runningDelayMs = DEFAULT_RUNNING_DELAY_MS, logger = console, onState = () => {} }) {
    this.reply = reply;
    this.runningDelayMs = runningDelayMs;
    this.logger = logger;
    this.onState = onState;
    this.tasks = new Map();
  }

  async start(messageId, { queued = false } = {}) {
    this.finish(messageId);
    this.onState(messageId, queued ? "queued" : "accepted");

    const task = {
      queued,
      timer: null
    };
    this.tasks.set(messageId, task);
    if (!queued) this.scheduleRunning(messageId);

    try {
      await this.reply(
        messageId,
        queued ? "已收到任务，正在排队等待当前会话完成。" : "已收到任务，正在思考并准备执行。"
      );
    } catch {
      this.logger.warn("task-status=accepted-reply-failed");
    }
  }

  scheduleRunning(messageId) {
    const task = this.tasks.get(messageId);
    if (!task || task.timer || task.queued) return;
    task.timer = setTimeout(() => this.sendRunning(messageId), this.runningDelayMs);
    task.timer.unref?.();
  }

  async markRunning(messageId) {
    const task = this.tasks.get(messageId);
    if (!task) return;
    const wasQueued = task.queued;
    task.queued = false;
    this.onState(messageId, "running");
    this.scheduleRunning(messageId);
    if (!wasQueued) return;
    try {
      await this.reply(messageId, "排队已结束，任务现在开始执行。");
    } catch {
      this.logger.warn("task-status=running-reply-failed");
    }
  }

  pause(messageId) {
    const task = this.tasks.get(messageId);
    if (!task?.timer) return;
    clearTimeout(task.timer);
    task.timer = null;
  }

  finish(messageId) {
    const task = this.tasks.get(messageId);
    if (!task) return;
    if (task.timer) clearTimeout(task.timer);
    this.tasks.delete(messageId);
    this.onState(messageId, "finished");
  }

  stop() {
    for (const task of this.tasks.values()) {
      if (task.timer) clearTimeout(task.timer);
    }
    this.tasks.clear();
  }

  async sendRunning(messageId) {
    const task = this.tasks.get(messageId);
    if (!task || task.queued) return;
    task.timer = null;
    this.onState(messageId, "running");

    try {
      await this.reply(messageId, "任务仍在执行中，完成后会在这里回复结果。")
    } catch {
      this.logger.warn("task-status=running-reply-failed");
    }
  }
}
