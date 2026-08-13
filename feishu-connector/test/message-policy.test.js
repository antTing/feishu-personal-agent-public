import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeMessage,
  extractMessageText,
  hasSelfMention,
  normalizeSenderType
} from "../src/message-policy.js";

const SELF = "example-self-bot";
const BOT = "example-source-bot";
const USER = "example-owner-user";
const CHAT = "example-group-chat";

function event({
  senderId = USER,
  senderType = "user",
  chatId = CHAT,
  chatType = "group",
  mentions = [{ key: "@_user_1", id: { open_id: SELF }, name: "示例机器人" }]
} = {}) {
  return {
    sender: { sender_type: senderType, sender_id: { open_id: senderId } },
    message: {
      message_id: "example-message-001",
      chat_id: chatId,
      chat_type: chatType,
      message_type: "text",
      content: JSON.stringify({ text: "@_user_1 示例文本" }),
      mentions
    }
  };
}

function authorize(input, overrides = {}) {
  return authorizeMessage({
    event: input,
    selfBotOpenId: SELF,
    allowedUserIds: new Set([USER]),
    allowedBotIds: new Set([BOT]),
    allowedBotChatIds: new Set([CHAT]),
    allowGroupMessages: true,
    ...overrides
  });
}

test("normalizes user and bot sender types", () => {
  assert.equal(normalizeSenderType("USER"), "user");
  assert.equal(normalizeSenderType("bot"), "bot");
  assert.equal(normalizeSenderType("app"), "bot");
  assert.equal(normalizeSenderType("unknown"), null);
});

test("allows an owner direct message without an @ mention", () => {
  const result = authorize(event({ chatType: "p2p", chatId: "example-direct-chat", mentions: [] }));
  assert.deepEqual(result, { allowed: true, senderId: USER, senderType: "user" });
});

test("requires a precise self mention in a group", () => {
  const incoming = event({
    mentions: [{ key: "@_user_2", id: { open_id: "example-unrelated-user" }, name: "示例用户" }]
  });
  assert.equal(hasSelfMention(incoming.message, SELF), false);
  assert.equal(authorize(incoming).reason, "self-mention-required");
});

test("allows bots only when both source bot and chat are configured", () => {
  const allowed = authorize(event({ senderId: BOT, senderType: "bot" }));
  const blocked = authorize(event({ senderId: BOT, senderType: "bot", chatId: "example-other-chat" }));

  assert.deepEqual(allowed, { allowed: true, senderId: BOT, senderType: "bot" });
  assert.equal(blocked.reason, "bot-chat-not-allowed");
  assert.equal(authorize(event({ senderId: BOT, senderType: "bot" }), { allowedBotIds: new Set() }).reason, "bot-not-allowed");
});

test("optionally narrows bot access to configured bot IDs", () => {
  const incoming = event({ senderId: BOT, senderType: "bot" });
  assert.equal(authorize(incoming, { allowedBotIds: new Set([BOT]) }).allowed, true);
  assert.equal(authorize(incoming, { allowedBotIds: new Set(["example-other-bot"]) }).reason, "bot-not-allowed");
});

test("rejects bot direct messages and messages from self", () => {
  assert.equal(authorize(event({ senderId: BOT, senderType: "bot", chatType: "p2p" })).reason, "bot-p2p-disabled");
  assert.equal(authorize(event({ senderId: SELF, senderType: "bot" })).reason, "self-message");
});

test("extracts text and removes only the self mention", () => {
  const message = event({
    mentions: [
      { key: "@_user_1", id: { open_id: SELF }, name: "示例机器人" },
      { key: "@_user_2", id: { open_id: "example-other-user" }, name: "示例用户" }
    ]
  }).message;
  message.content = JSON.stringify({ text: "@_user_1 请和 @_user_2 一起处理" });

  assert.equal(extractMessageText(message, SELF), "请和 @_user_2 一起处理");
});

test("extracts rich post text and links", () => {
  const message = event().message;
  message.message_type = "post";
  message.content = JSON.stringify({
    zh_cn: {
      title: "示例标题",
      content: [
        [{ tag: "at", user_id: SELF }, { tag: "text", text: "示例正文 A" }],
        [{ tag: "a", text: "示例链接", href: "https://example.invalid/resource" }]
      ]
    }
  });

  assert.equal(
    extractMessageText(message, SELF),
    "示例标题\n示例正文 A\n示例链接 (https://example.invalid/resource)"
  );
});

test("extracts flattened interactive card content", () => {
  const message = event().message;
  message.message_type = "interactive";
  message.content = JSON.stringify({
    title: "示例卡片",
    elements: [
      [{ tag: "text", text: "示例字段" }],
      [{ tag: "text", text: "示例正文 B" }],
      [{ tag: "text", text: "@_user_1" }]
    ]
  });

  assert.equal(
    extractMessageText(message, SELF),
    "示例卡片\n示例字段\n示例正文 B"
  );
});

test("extracts raw v2 card markdown content", () => {
  const message = event().message;
  message.message_type = "interactive";
  message.content = JSON.stringify({
    header: { title: { tag: "plain_text", content: "示例卡片" } },
    body: {
      elements: [{ tag: "markdown", content: "示例正文 C\n@_user_1" }]
    }
  });

  assert.equal(extractMessageText(message, SELF), "示例卡片\n示例正文 C");
});

test("returns null for unsupported message types", () => {
  const message = event().message;
  message.message_type = "image";
  assert.equal(extractMessageText(message, SELF), null);
});
