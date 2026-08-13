import test from "node:test";
import assert from "node:assert/strict";
import { TaskStatusTracker } from "../src/task-status.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("sends accepted and running status for a long bot task", async () => {
  const replies = [];
  const tracker = new TaskStatusTracker({
    reply: async (messageId, text) => replies.push({ messageId, text }),
    runningDelayMs: 10
  });

  await tracker.start("message-1");
  await delay(20);
  tracker.finish("message-1");

  assert.deepEqual(replies, [
    { messageId: "message-1", text: "已收到任务，正在思考并准备执行。" },
    { messageId: "message-1", text: "任务仍在执行中，完成后会在这里回复结果。" }
  ]);
});

test("cancels the running status when a task finishes quickly", async () => {
  const replies = [];
  const tracker = new TaskStatusTracker({
    reply: async (messageId, text) => replies.push({ messageId, text }),
    runningDelayMs: 15
  });

  await tracker.start("message-2");
  tracker.finish("message-2");
  await delay(25);

  assert.deepEqual(replies, [
    { messageId: "message-2", text: "已收到任务，正在思考并准备执行。" }
  ]);
});

test("status reply failures do not reject task forwarding", async () => {
  const warnings = [];
  const tracker = new TaskStatusTracker({
    reply: async () => {
      throw new Error("reply failed");
    },
    runningDelayMs: 10,
    logger: { warn: (message) => warnings.push(message) }
  });

  await tracker.start("message-3");
  await delay(20);
  tracker.finish("message-3");

  assert.deepEqual(warnings, [
    "task-status=accepted-reply-failed",
    "task-status=running-reply-failed"
  ]);
});

test("a queued task stays queued until the bridge reports it has started", async () => {
  const replies = [];
  const states = [];
  const tracker = new TaskStatusTracker({
    reply: async (messageId, text) => replies.push({ messageId, text }),
    runningDelayMs: 10,
    onState: (messageId, state) => states.push({ messageId, state })
  });

  await tracker.start("message-queued", { queued: true });
  await delay(20);
  assert.deepEqual(states, [{ messageId: "message-queued", state: "queued" }]);
  assert.deepEqual(replies, [
    { messageId: "message-queued", text: "已收到任务，正在排队等待当前会话完成。" }
  ]);

  await tracker.markRunning("message-queued");
  await delay(20);
  tracker.finish("message-queued");

  assert.deepEqual(states.map((entry) => entry.state), ["queued", "running", "running", "finished"]);
  assert.deepEqual(replies, [
    { messageId: "message-queued", text: "已收到任务，正在排队等待当前会话完成。" },
    { messageId: "message-queued", text: "排队已结束，任务现在开始执行。" },
    { messageId: "message-queued", text: "任务仍在执行中，完成后会在这里回复结果。" }
  ]);
});
