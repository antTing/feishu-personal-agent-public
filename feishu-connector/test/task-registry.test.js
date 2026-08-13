import assert from "node:assert/strict";
import test from "node:test";
import { TaskRegistry } from "../src/task-registry.js";

function task(overrides = {}) {
  return {
    messageId: overrides.messageId || "example-message-first",
    chatId: overrides.chatId || "example-group-chat",
    project: overrides.project || "example-project",
    sessionKey: overrides.sessionKey || "feishu:example-group-chat:example-sender-a",
    startedAt: overrides.startedAt || 1_000,
    phase: overrides.phase || "accepted",
    ...overrides
  };
}

test("tracks every task in a chat and queues tasks sharing one session", () => {
  const registry = new TaskRegistry({ now: () => 5_000 });
  const first = registry.add(task());
  const second = registry.add(task({ messageId: "example-message-second", startedAt: 2_000 }));
  const parallel = registry.add(task({
    messageId: "example-message-parallel",
    sessionKey: "feishu:example-group-chat:example-sender-b",
    startedAt: 3_000
  }));

  assert.equal(first.phase, "accepted");
  assert.equal(second.phase, "queued");
  assert.equal(parallel.phase, "accepted");
  assert.equal(registry.list("example-group-chat").length, 3);
  assert.match(registry.format("example-group-chat"), /当前共有 3 个活动任务/);
  assert.match(registry.format("example-group-chat"), /排队中/);
});

test("resolves an explicit short task id and refuses an ambiguous implicit target", () => {
  const registry = new TaskRegistry();
  const first = registry.add(task());
  registry.add(task({ messageId: "example-message-second", sessionKey: "feishu:example-group-chat:example-sender-b" }));

  assert.equal(registry.resolve("example-group-chat"), null);
  assert.equal(registry.resolve("example-group-chat", first.taskId)?.messageId, "example-message-first");
  assert.equal(registry.resolve("example-group-chat", "example-message-first")?.taskId, first.taskId);
});

test("finishing one task preserves the other tasks in the chat", () => {
  const registry = new TaskRegistry();
  const first = registry.add(task());
  const second = registry.add(task({ messageId: "example-message-second", sessionKey: "feishu:example-group-chat:example-sender-b" }));

  registry.finish(first.messageId);

  assert.equal(registry.list("example-group-chat").length, 1);
  assert.equal(registry.resolve("example-group-chat")?.messageId, second.messageId);
});
