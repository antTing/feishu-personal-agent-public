import assert from "node:assert/strict";
import test from "node:test";

import { ReplyContextStore } from "../src/reply-context.js";

const VALID_OPEN_ID = ["ou", "exampleuser"].join("_");

test("group replies mention the original sender with Feishu native syntax", () => {
  const contexts = new ReplyContextStore();
  contexts.remember("message-task", { chatType: "group", senderId: VALID_OPEN_ID });

  assert.equal(
    contexts.format("message-task", "已收到任务。"),
    `<at user_id="${VALID_OPEN_ID}"></at> 已收到任务。`
  );
});

test("p2p replies do not add a mention", () => {
  const contexts = new ReplyContextStore();
  contexts.remember("message-task", { chatType: "p2p", senderId: VALID_OPEN_ID });

  assert.equal(contexts.format("message-task", "已收到任务。"), "已收到任务。");
});

test("forgotten or invalid contexts do not add a mention", () => {
  const contexts = new ReplyContextStore();
  contexts.remember("message-task", { chatType: "group", senderId: "invalid" });
  assert.equal(contexts.format("message-task", "完成。"), "完成。");

  contexts.remember("message-task", { chatType: "group", senderId: VALID_OPEN_ID });
  contexts.forget("message-task");
  assert.equal(contexts.format("message-task", "完成。"), "完成。");
});
