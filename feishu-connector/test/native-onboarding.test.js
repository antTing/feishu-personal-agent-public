import assert from "node:assert/strict";
import test from "node:test";

import {
  PairingCollector,
  buildRegistrationOptions,
  createPairingToken,
  registerNativeFeishuApp,
  verifyNativeAppScopes,
  waitForPairing
} from "../src/native-onboarding.js";

const id = (prefix, suffix) => `${prefix}_${suffix}`;
const BOT_ID = id("ou", "examplelocalbot");
const OWNER_ID = id("ou", "exampleowner");
const OTHER_USER_ID = id("ou", "exampleotheruser");
const DISPATCHER_ID = id("ou", "exampledispatcher");
const CHAT_ID = id("oc", "exampleexecutionchat");
const OTHER_CHAT_ID = id("oc", "exampleotherchat");

function messageEvent({
  messageId,
  senderId,
  senderType,
  chatId = CHAT_ID,
  token,
  mentionBot = true,
  replyTo = ""
}) {
  return {
    sender: {
      sender_type: senderType,
      sender_id: { open_id: senderId }
    },
    message: {
      message_id: messageId,
      chat_id: chatId,
      chat_type: "group",
      message_type: "text",
      content: JSON.stringify({ text: `@_user_1 配对 ${token}` }),
      ...(replyTo ? { parent_id: replyTo, root_id: replyTo } : {}),
      mentions: mentionBot
        ? [{ key: "@_user_1", id: { open_id: BOT_ID }, name: "示例机器人" }]
        : []
    }
  };
}

test("one-click registration requests the native message permissions and callbacks", () => {
  const options = buildRegistrationOptions({
    requireDispatcher: true,
    onQRCodeReady() {}
  });

  assert.equal(options.createOnly, true);
  assert.equal(options.addons.preset, true);
  assert.ok(options.addons.scopes.tenant.includes("im:message.group_at_msg:readonly"));
  assert.ok(options.addons.scopes.tenant.includes("im:message:send_as_bot"));
  assert.ok(options.addons.scopes.tenant.includes("im:message:readonly"));
  assert.ok(options.addons.scopes.tenant.includes("im:resource"));
  assert.ok(options.addons.scopes.tenant.includes("im:message.group_at_msg.include_bot:readonly"));
  assert.deepEqual(options.addons.events.items.tenant, ["im.message.receive_v1"]);
  assert.deepEqual(options.addons.callbacks.items, ["card.action.trigger"]);
});

test("registration description follows the selected native agent", () => {
  const options = buildRegistrationOptions({
    requireDispatcher: false,
    agentLabel: "Claude Code",
    onQRCodeReady() {}
  });
  assert.match(options.appPreset.desc, /Claude Code/);
});

test("direct mode does not request bot-to-bot message access", () => {
  const options = buildRegistrationOptions({
    requireDispatcher: false,
    onQRCodeReady() {}
  });
  assert.equal(
    options.addons.scopes.tenant.includes("im:message.group_at_msg.include_bot:readonly"),
    false
  );
});

test("registration returns credentials without requiring callers to supply IDs", async () => {
  let receivedOptions;
  const result = await registerNativeFeishuApp({
    onQRCodeReady() {},
    registerApp: async (options) => {
      receivedOptions = options;
      return {
        client_id: id("cli", "exampleapplication"),
        client_secret: "example-secret-value",
        user_info: { open_id: OWNER_ID }
      };
    }
  });

  assert.equal(receivedOptions.createOnly, true);
  assert.equal(result.appId, id("cli", "exampleapplication"));
  assert.equal(result.appSecret, "example-secret-value");
  assert.equal(result.registrationOwnerId, OWNER_ID);
});

test("registration fails closed when Feishu omits the scanning user identity", async () => {
  await assert.rejects(
    registerNativeFeishuApp({
      onQRCodeReady() {},
      registerApp: async () => ({
        client_id: id("cli", "exampleapplication"),
        client_secret: "example-secret-value",
        user_info: {}
      })
    }),
    /未返回扫码用户身份/
  );
});

test("pairing tokens contain 128 bits of randomness", () => {
  assert.match(createPairingToken(), /^PAIR-[A-F0-9]{32}$/);
});

test("permission verification submits an administrator request when a scope is missing", async () => {
  let applyCalls = 0;
  await assert.rejects(
    verifyNativeAppScopes({
      appId: id("cli", "exampleapplication"),
      appSecret: "example-secret-value",
      requireDispatcher: true,
      createClient: () => ({
        application: {
          scope: {
            list: async () => ({
              code: 0,
              data: {
                scopes: [
                  { scope_name: "im:message.group_at_msg:readonly", grant_status: 1, scope_type: "tenant" },
                  { scope_name: "im:message:send_as_bot", grant_status: 1, scope_type: "tenant" },
                  { scope_name: "im:message:readonly", grant_status: 1, scope_type: "tenant" },
                  { scope_name: "im:resource", grant_status: 1, scope_type: "tenant" }
                ]
              }
            }),
            apply: async () => {
              applyCalls += 1;
              return { code: 0 };
            }
          }
        }
      })
    }),
    /已自动向企业管理员提交权限审批/
  );
  assert.equal(applyCalls, 1);
});

test("permission verification accepts only granted scopes", async () => {
  let applyCalls = 0;
  const scopes = [
    "im:message.group_at_msg:readonly",
    "im:message:send_as_bot",
    "im:message:readonly",
    "im:resource",
    "im:message.group_at_msg.include_bot:readonly"
  ];
  await verifyNativeAppScopes({
    appId: id("cli", "exampleapplication"),
    appSecret: "example-secret-value",
    requireDispatcher: true,
    createClient: () => ({
      application: {
        scope: {
          list: async () => ({
            code: 0,
            data: {
              scopes: scopes.map((scope_name) => ({
                scope_name,
                grant_status: 1,
                scope_type: "tenant"
              }))
            }
          }),
          apply: async () => {
            applyCalls += 1;
            return { code: 0 };
          }
        }
      }
    })
  });
  assert.equal(applyCalls, 0);
});

test("pairing binds the QR owner and requires owner confirmation for the dispatcher", () => {
  const collector = new PairingCollector({
    botOpenId: BOT_ID,
    registrationOwnerId: OWNER_ID,
    requireDispatcher: true,
    ownerToken: "PAIR-OWNER",
    dispatcherToken: "example-pair-dispatcher",
    confirmationToken: "example-pair-confirm",
    rejectionToken: "example-pair-reject"
  });

  const wrongOwner = collector.consume(messageEvent({
    messageId: "message-wrong-owner",
    senderId: OTHER_USER_ID,
    senderType: "user",
    token: "PAIR-OWNER"
  }));
  assert.equal(wrongOwner.ownerMismatch, true);
  assert.equal(collector.stage, "owner");

  const owner = collector.consume(messageEvent({
    messageId: "message-owner",
    senderId: OWNER_ID,
    senderType: "user",
    token: "PAIR-OWNER"
  }));
  assert.equal(owner.changed, true);
  assert.equal(owner.stage, "dispatcher");

  const wrongChat = collector.consume(messageEvent({
    messageId: "message-dispatcher-wrong-chat",
    senderId: DISPATCHER_ID,
    senderType: "bot",
    chatId: OTHER_CHAT_ID,
    token: "example-pair-dispatcher"
  }));
  assert.equal(wrongChat.changed, false);

  const dispatcher = collector.consume(messageEvent({
    messageId: "message-dispatcher",
    senderId: DISPATCHER_ID,
    senderType: "bot",
    token: "example-pair-dispatcher"
  }));
  assert.equal(dispatcher.changed, true);
  assert.equal(dispatcher.stage, "dispatcher-confirmation");

  const nonOwnerConfirmation = collector.consume(messageEvent({
    messageId: "message-confirmation-other-user",
    senderId: OTHER_USER_ID,
    senderType: "user",
    token: "example-pair-confirm",
    replyTo: "message-dispatcher"
  }));
  assert.equal(nonOwnerConfirmation.changed, false);

  const unthreadedConfirmation = collector.consume(messageEvent({
    messageId: "message-confirmation-unthreaded",
    senderId: OWNER_ID,
    senderType: "user",
    token: "example-pair-confirm"
  }));
  assert.equal(unthreadedConfirmation.changed, false);

  const confirmation = collector.consume(messageEvent({
    messageId: "message-confirmation-owner",
    senderId: OWNER_ID,
    senderType: "user",
    token: "example-pair-confirm",
    replyTo: "message-dispatcher"
  }));
  assert.equal(confirmation.changed, true);
  assert.equal(confirmation.stage, "complete");
  assert.deepEqual(collector.snapshot(), {
    ownerId: OWNER_ID,
    executionChatId: CHAT_ID,
    dispatcherId: DISPATCHER_ID,
    dispatcherCandidateId: DISPATCHER_ID,
    dispatcherCandidateMessageId: "message-dispatcher"
  });
});

test("only the owner can reject a replied dispatcher candidate and old tokens cannot reclaim it", () => {
  const rotatedTokens = [
    "example-pair-new-dispatcher",
    "example-pair-new-confirmation",
    "example-pair-new-rejection"
  ];
  const collector = new PairingCollector({
    botOpenId: BOT_ID,
    registrationOwnerId: OWNER_ID,
    requireDispatcher: true,
    ownerToken: "example-pair-owner",
    dispatcherToken: "example-pair-old-dispatcher",
    confirmationToken: "example-pair-old-confirmation",
    rejectionToken: "example-pair-old-rejection",
    createToken: () => rotatedTokens.shift()
  });

  collector.consume(messageEvent({
    messageId: "message-owner-for-rejection",
    senderId: OWNER_ID,
    senderType: "user",
    token: "example-pair-owner"
  }));
  collector.consume(messageEvent({
    messageId: "message-first-candidate",
    senderId: DISPATCHER_ID,
    senderType: "bot",
    token: "example-pair-old-dispatcher"
  }));

  const nonOwner = collector.consume(messageEvent({
    messageId: "message-reject-non-owner",
    senderId: OTHER_USER_ID,
    senderType: "user",
    token: "example-pair-old-rejection",
    replyTo: "message-first-candidate"
  }));
  assert.equal(nonOwner.changed, false);
  assert.equal(collector.stage, "dispatcher-confirmation");

  const unthreaded = collector.consume(messageEvent({
    messageId: "message-reject-unthreaded",
    senderId: OWNER_ID,
    senderType: "user",
    token: "example-pair-old-rejection"
  }));
  assert.equal(unthreaded.changed, false);
  assert.equal(collector.stage, "dispatcher-confirmation");

  const rejection = collector.consume(messageEvent({
    messageId: "message-reject-owner",
    senderId: OWNER_ID,
    senderType: "user",
    token: "example-pair-old-rejection",
    replyTo: "message-first-candidate"
  }));
  assert.equal(rejection.changed, true);
  assert.equal(rejection.rejected, true);
  assert.equal(rejection.stage, "dispatcher");
  assert.deepEqual(rejection.snapshot, {
    ownerId: OWNER_ID,
    executionChatId: CHAT_ID,
    dispatcherId: "",
    dispatcherCandidateId: "",
    dispatcherCandidateMessageId: ""
  });
  assert.deepEqual(collector.tokens(), {
    ownerToken: "EXAMPLE-PAIR-OWNER",
    dispatcherToken: "EXAMPLE-PAIR-NEW-DISPATCHER",
    confirmationToken: "EXAMPLE-PAIR-NEW-CONFIRMATION",
    rejectionToken: "EXAMPLE-PAIR-NEW-REJECTION"
  });

  const oldTokenReuse = collector.consume(messageEvent({
    messageId: "message-old-token-reuse",
    senderId: DISPATCHER_ID,
    senderType: "bot",
    token: "example-pair-old-dispatcher"
  }));
  assert.equal(oldTokenReuse.changed, false);
  assert.equal(collector.stage, "dispatcher");

  const newCandidate = collector.consume(messageEvent({
    messageId: "message-new-candidate",
    senderId: DISPATCHER_ID,
    senderType: "bot",
    token: "example-pair-new-dispatcher"
  }));
  assert.equal(newCandidate.changed, true);
  assert.equal(newCandidate.stage, "dispatcher-confirmation");

  const oldRejection = collector.consume(messageEvent({
    messageId: "message-old-rejection-reuse",
    senderId: OWNER_ID,
    senderType: "user",
    token: "example-pair-old-rejection",
    replyTo: "message-new-candidate"
  }));
  assert.equal(oldRejection.changed, false);

  const confirmation = collector.consume(messageEvent({
    messageId: "message-new-confirmation",
    senderId: OWNER_ID,
    senderType: "user",
    token: "example-pair-new-confirmation",
    replyTo: "message-new-candidate"
  }));
  assert.equal(confirmation.changed, true);
  assert.equal(confirmation.stage, "complete");
  assert.equal(collector.snapshot().dispatcherId, DISPATCHER_ID);
});

test("pairing ignores messages that do not explicitly mention the new bot", () => {
  const collector = new PairingCollector({
    botOpenId: BOT_ID,
    registrationOwnerId: OWNER_ID,
    requireDispatcher: false,
    ownerToken: "PAIR-OWNER",
    dispatcherToken: "PAIR-UNUSED"
  });
  const update = collector.consume(messageEvent({
    messageId: "message-no-mention",
    senderId: OWNER_ID,
    senderType: "user",
    token: "PAIR-OWNER",
    mentionBot: false
  }));
  assert.equal(update.changed, false);
  assert.equal(collector.stage, "owner");
});

test("pairing accepts an Aily interactive-card message as a dispatcher candidate", () => {
  const collector = new PairingCollector({
    botOpenId: BOT_ID,
    registrationOwnerId: OWNER_ID,
    requireDispatcher: true,
    ownerToken: "example-pair-owner",
    dispatcherToken: "example-pair-card-dispatcher",
    confirmationToken: "example-pair-card-confirmation",
    rejectionToken: "example-pair-card-rejection",
    state: {
      ownerId: OWNER_ID,
      executionChatId: CHAT_ID
    }
  });
  const event = messageEvent({
    messageId: "message-dispatcher-card",
    senderId: DISPATCHER_ID,
    senderType: "assistant",
    token: "example-unused-text-token"
  });
  event.message.message_type = "interactive";
  event.message.content = JSON.stringify({
    title: "示例调度消息",
    elements: [[{ tag: "text", text: "配对调度 example-pair-card-dispatcher" }]]
  });

  const update = collector.consume(event);
  assert.equal(update.changed, true);
  assert.equal(update.stage, "dispatcher-confirmation");
  assert.equal(collector.snapshot().dispatcherCandidateId, DISPATCHER_ID);
});

test("pairing requires a complete token in supported message content", () => {
  const collector = new PairingCollector({
    botOpenId: BOT_ID,
    registrationOwnerId: OWNER_ID,
    requireDispatcher: false,
    ownerToken: "PAIR-EXACT",
    dispatcherToken: "PAIR-UNUSED"
  });
  const substring = messageEvent({
    messageId: "message-token-substring",
    senderId: OWNER_ID,
    senderType: "user",
    token: "PAIR-EXACTX"
  });
  assert.equal(collector.consume(substring).changed, false);

  const post = messageEvent({
    messageId: "message-post-token",
    senderId: OWNER_ID,
    senderType: "user",
    token: "PAIR-EXACT"
  });
  post.message.message_type = "post";
  assert.equal(collector.consume(post).changed, false);
  assert.equal(collector.stage, "owner");
});

test("waitForPairing persists each accepted identity and closes the temporary connection", async () => {
  let eventHandler;
  let closed = false;
  const snapshots = [];
  const promise = waitForPairing({
    appId: id("cli", "exampleapplication"),
    appSecret: "example-secret-value",
    registrationOwnerId: OWNER_ID,
    requireDispatcher: true,
    ownerToken: "PAIR-OWNER",
    dispatcherToken: "example-pair-dispatcher",
    confirmationToken: "example-pair-confirm",
    rejectionToken: "example-pair-reject",
    timeoutMs: 2_000,
    verifyPermissions: async () => {},
    fetchBotIdentity: async () => BOT_ID,
    createDispatcher(handler) {
      eventHandler = handler;
      return { example: "dispatcher" };
    },
    createWsClient(options) {
      return {
        start() {
          options.onReady();
        },
        close() {
          closed = true;
        }
      };
    },
    async onPersist(snapshot) {
      snapshots.push({ ...snapshot });
    }
  });

  await new Promise((resolve) => setImmediate(resolve));

  await eventHandler(messageEvent({
    messageId: "message-owner",
    senderId: OWNER_ID,
    senderType: "user",
    token: "PAIR-OWNER"
  }));
  await eventHandler(messageEvent({
    messageId: "message-dispatcher",
    senderId: DISPATCHER_ID,
    senderType: "bot",
    token: "example-pair-dispatcher"
  }));
  await eventHandler(messageEvent({
    messageId: "message-confirmation-owner",
    senderId: OWNER_ID,
    senderType: "user",
    token: "example-pair-confirm",
    replyTo: "message-dispatcher"
  }));

  const result = await promise;
  assert.equal(snapshots.length, 3);
  assert.equal(result.dispatcherId, DISPATCHER_ID);
  assert.equal(closed, true);
});

test("waitForPairing persists a cleared candidate and reports rotated rejection tokens", async () => {
  let eventHandler;
  const snapshots = [];
  const stages = [];
  const tokenQueue = [
    "example-pair-rotated-dispatcher",
    "example-pair-rotated-confirmation",
    "example-pair-rotated-rejection"
  ];
  const promise = waitForPairing({
    appId: id("cli", "exampleapplication"),
    appSecret: "example-secret-value",
    registrationOwnerId: OWNER_ID,
    requireDispatcher: true,
    ownerToken: "example-pair-owner",
    dispatcherToken: "example-pair-old-dispatcher",
    confirmationToken: "example-pair-old-confirmation",
    rejectionToken: "example-pair-old-rejection",
    createToken: () => tokenQueue.shift(),
    timeoutMs: 2_000,
    verifyPermissions: async () => {},
    fetchBotIdentity: async () => BOT_ID,
    createDispatcher(handler) {
      eventHandler = handler;
      return { example: "dispatcher" };
    },
    createWsClient(options) {
      return {
        start() {
          options.onReady();
        },
        close() {}
      };
    },
    async onPersist(snapshot) {
      snapshots.push({ ...snapshot });
    },
    async onStage(stage, tokens) {
      stages.push({ stage, tokens: { ...tokens } });
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  await eventHandler(messageEvent({
    messageId: "message-owner-before-rejection",
    senderId: OWNER_ID,
    senderType: "user",
    token: "example-pair-owner"
  }));
  await eventHandler(messageEvent({
    messageId: "message-candidate-before-rejection",
    senderId: DISPATCHER_ID,
    senderType: "bot",
    token: "example-pair-old-dispatcher"
  }));
  await eventHandler(messageEvent({
    messageId: "message-owner-rejects-candidate",
    senderId: OWNER_ID,
    senderType: "user",
    token: "example-pair-old-rejection",
    replyTo: "message-candidate-before-rejection"
  }));

  assert.deepEqual(snapshots.at(-1), {
    ownerId: OWNER_ID,
    executionChatId: CHAT_ID,
    dispatcherId: "",
    dispatcherCandidateId: "",
    dispatcherCandidateMessageId: ""
  });
  assert.deepEqual(stages.at(-1), {
    stage: "dispatcher",
    tokens: {
      ownerToken: "EXAMPLE-PAIR-OWNER",
      dispatcherToken: "EXAMPLE-PAIR-ROTATED-DISPATCHER",
      confirmationToken: "EXAMPLE-PAIR-ROTATED-CONFIRMATION",
      rejectionToken: "EXAMPLE-PAIR-ROTATED-REJECTION"
    }
  });

  await eventHandler(messageEvent({
    messageId: "message-candidate-after-rejection",
    senderId: DISPATCHER_ID,
    senderType: "bot",
    token: "example-pair-rotated-dispatcher"
  }));
  await eventHandler(messageEvent({
    messageId: "message-confirm-after-rejection",
    senderId: OWNER_ID,
    senderType: "user",
    token: "example-pair-rotated-confirmation",
    replyTo: "message-candidate-after-rejection"
  }));

  const result = await promise;
  assert.equal(result.dispatcherId, DISPATCHER_ID);
});
