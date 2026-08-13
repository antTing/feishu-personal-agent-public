import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { PermissionCoordinator } from "../src/permission-coordinator.js";

const OWNER = "example-owner-user";

test("keeps an approval pending until Bridge delivery is committed", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "permission-coordinator-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  const statePath = path.join(root, "permissions.json");
  const coordinator = new PermissionCoordinator({ statePath, ownerUserIds: [OWNER] });
  await coordinator.initialize();
  const id = await coordinator.remember({
    project: "workspace-example-dev",
    sessionKey: "feishu:example-group-chat:example-source-bot",
    replyCtx: "example-message-original",
    sourceMessageId: "example-message-original",
    sourceChatId: "example-group-chat",
    toolName: "shell",
    toolInput: "run command"
  });

  const decision = await coordinator.decide({
    text: `允许操作 ${id}`,
    senderId: OWNER,
    senderType: "user",
    chatId: "example-group-chat"
  });
  assert.equal(decision.type, "decision");
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).pending.length, 1);

  await coordinator.complete(id);
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).pending.length, 0);
});

test("does not persist raw tool input", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "permission-coordinator-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const statePath = path.join(root, "permissions.json");
  const coordinator = new PermissionCoordinator({ statePath, ownerUserIds: [OWNER] });
  await coordinator.initialize();
  await coordinator.remember({
    project: "workspace-example-dev",
    sessionKey: "feishu:example-group-chat:example-source-bot",
    sourceChatId: "example-group-chat",
    toolName: "shell",
    toolInput: "sensitive command argument"
  });

  const state = await readFile(statePath, "utf8");
  assert.doesNotMatch(state, /sensitive command argument/);
  assert.equal(JSON.parse(state).pending[0].toolInputPresent, true);
});

test("rejects operation approval from a bot or another chat", async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), "permission-coordinator-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const coordinator = new PermissionCoordinator({
    statePath: path.join(root, "permissions.json"),
    ownerUserIds: [OWNER]
  });
  await coordinator.initialize();
  const id = await coordinator.remember({
    project: "workspace-example-dev",
    sessionKey: "feishu:example-group-chat:example-source-bot",
    sourceChatId: "example-group-chat"
  });

  const result = await coordinator.decide({
    text: `允许操作 ${id}`,
    senderId: "example-source-bot",
    senderType: "bot",
    chatId: "example-group-chat"
  });
  assert.match(result.text, /主人本人/);
});
