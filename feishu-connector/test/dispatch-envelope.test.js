import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDispatchEnvelope,
  deriveChainId,
  deriveTaskId,
  parseDispatchEnvelope,
  sessionBoundary,
  sameTaskChain,
  stripDispatchEnvelope
} from "../../native/dispatch-envelope.mjs";

test("builds and parses a bounded Aily task envelope", () => {
  const chainId = deriveChainId({
    dispatcher: "example-dispatcher",
    sourceChat: "example-source-chat",
    sourceRoot: "example-source-root"
  });
  const taskId = deriveTaskId({ chainId, sourceMessage: "example-source-message" });
  const text = buildDispatchEnvelope({
    chain_id: chainId,
    task_id: taskId,
    workspace: "approved-workspace",
    permission: "read",
    request: "检查示例项目的构建配置",
    context: "只提供与本任务直接相关的背景"
  });

  const parsed = parseDispatchEnvelope(text);
  assert.equal(parsed.chain_id, chainId);
  assert.equal(parsed.task_id, taskId);
  assert.equal(parsed.permission, "read");
  assert.equal(stripDispatchEnvelope(text), "检查示例项目的构建配置");
});

test("derives separate chains for different source roots", () => {
  const common = { dispatcher: "example-dispatcher", sourceChat: "example-chat" };
  const first = deriveChainId({ ...common, sourceRoot: "root-a" });
  const second = deriveChainId({ ...common, sourceRoot: "root-b" });
  assert.notEqual(first, second);
  assert.equal(sameTaskChain({ chain_id: first }, { chain_id: first }), true);
  assert.equal(sameTaskChain({ chain_id: first }, { chain_id: second }), false);
});

test("uses the Feishu root message as the native session boundary", () => {
  assert.equal(sessionBoundary({ sourceChat: "chat-a", sourceRoot: "root-a" }), "chat-a:root-a");
  assert.equal(sessionBoundary({ sourceChat: "chat-a" }), "chat-a:chat-a");
});

test("rejects malformed envelopes before they reach an agent", () => {
  assert.throws(
    () => parseDispatchEnvelope("[LOCAL_TASK]\n{\"version\":1,\"chain_id\":\"bad\"}\n[/LOCAL_TASK]"),
    /invalid format/
  );
  assert.throws(
    () => buildDispatchEnvelope({
      chain_id: "DS-12345678",
      task_id: "T-12345678",
      workspace: "bad/path",
      permission: "read",
      request: "示例"
    }),
    /workspace has an invalid format/
  );
});

