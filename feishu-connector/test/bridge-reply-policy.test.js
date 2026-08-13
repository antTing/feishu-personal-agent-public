import assert from "node:assert/strict";
import test from "node:test";

import { classifyBridgeReply } from "../src/bridge-reply-policy.js";

test("rewrites idle-session notices as non-final task progress", () => {
  assert.deepEqual(
    classifyBridgeReply("⏰ 因空闲超过 30 分钟，已自动切换到新会话。"),
    {
      final: false,
      content: "已为本次任务启用新 Agent 会话。此前的对话超过 30 分钟未使用；这不是说当前任务已经运行了 30 分钟。"
    }
  );
});

test("keeps normal agent replies final", () => {
  assert.deepEqual(classifyBridgeReply("分析完成。"), {
    final: true,
    content: "分析完成。"
  });
});
