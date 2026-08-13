import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceCoordinator, extractWorkspaceName, isDevelopmentTask } from "../src/workspace-coordinator.js";

const OWNER = "example-owner-user";

async function fixture() {
  const root = path.join(tmpdir(), `workspace-coordinator-${process.pid}-${Math.random()}`);
  const repo = path.join(root, "approved-workspace");
  await mkdir(path.join(repo, ".git"), { recursive: true });
  await writeFile(path.join(repo, ".git", "HEAD"), "ref: refs/heads/feat/test\n");
  const statePath = path.join(root, "state.json");
  const provisioned = [];
  const coordinator = new WorkspaceCoordinator({
    statePath,
    defaultProject: "personal-agent",
    ownerUserIds: [OWNER],
    workspaces: [{
      name: "approved-workspace",
      aliases: ["approved-workspace"],
      path: repo,
      readProject: "approved-workspace-read",
      devProject: "approved-workspace-dev"
    }],
    provisioner: {
      findOrCreate: async (name) => ({ path: path.join(root, name), created: false, alternatives: [] }),
      register: async (workspace) => {
        provisioned.push(workspace.name);
        return { ...workspace, readProject: `${workspace.name}-read`, devProject: `${workspace.name}-dev` };
      },
      restartCcConnect: async () => {},
      validateWorkspacePath: async (workspacePath) => workspacePath
    }
  });
  await coordinator.initialize();
  return { coordinator, provisioned, repo, statePath };
}

function source(text, senderType = "bot") {
  return {
    messageId: "message-original",
    chatId: "example-group-chat",
    chatType: "group",
    userId: senderType === "bot" ? "example-source-bot" : OWNER,
    senderType,
    text
  };
}

test("extracts explicit project labels and detects development work", () => {
  assert.equal(extractWorkspaceName("项目： approved-workspace"), "approved-workspace");
  assert.equal(isDevelopmentTask("阅读代码并输出报告"), false);
  assert.equal(isDevelopmentTask("运行 build 并输出数据"), true);
  assert.equal(isDevelopmentTask("运行 build 并修改配置"), true);
});

test("routes an authorized read-only task directly", async () => {
  const { coordinator } = await fixture();
  const result = await coordinator.handle({
    text: "项目：approved-workspace，只读分析代码",
    senderId: "example-source-bot",
    senderType: "bot",
    source: source("项目：approved-workspace，只读分析代码")
  });

  assert.equal(result.type, "dispatch");
  assert.equal(result.project, "approved-workspace-read");
});

test("routes development work in a non-git workspace without a branch gate", async () => {
  const { coordinator, repo } = await fixture();
  await rm(path.join(repo, ".git"), { recursive: true, force: true });
  const original = source("项目：approved-workspace，写入一个本地报告文件");

  const result = await coordinator.handle({
    text: original.text,
    senderId: original.userId,
    senderType: "bot",
    source: original
  });

  assert.equal(result.type, "dispatch");
  assert.equal(result.project, "approved-workspace-dev");
  assert.match(result.notice, /普通目录/);
  assert.match(result.source.text, /不要求根目录分支确认/);
  assert.match(result.source.text, /不得搜索工作区之外/);
});

test("gates development work until the owner confirms the current branch", async () => {
  const { coordinator } = await fixture();
  const original = source("项目：approved-workspace，运行 build 并修改配置");
  const gated = await coordinator.handle({
    text: original.text,
    senderId: original.userId,
    senderType: "bot",
    source: original
  });

  assert.equal(gated.type, "reply");
  const request = gated.text.match(/BR-[A-F0-9]{8}/)[0];

  const blocked = await coordinator.handle({
    text: `确认分支 ${request} feat/other`,
    senderId: OWNER,
    senderType: "user",
    source: source(`确认分支 ${request} feat/other`, "user")
  });
  assert.match(blocked.text, /不一致/);

  const approved = await coordinator.handle({
    text: `确认分支 ${request} feat/test`,
    senderId: OWNER,
    senderType: "user",
    source: source(`确认分支 ${request} feat/test`, "user")
  });
  assert.equal(approved.type, "dispatch");
  assert.equal(approved.project, "approved-workspace-dev");
  assert.equal(approved.source.messageId, "message-original");
  assert.match(approved.source.text, /该确认不授权任何 Git 命令/);
});

test("accepts bracketed and id-free branch confirmations without routing them to the default agent", async () => {
  const { coordinator } = await fixture();
  const original = source("项目：approved-workspace，运行 build");
  const gated = await coordinator.handle({
    text: original.text,
    senderId: original.userId,
    senderType: "bot",
    source: original
  });
  const request = gated.text.match(/BR-[A-F0-9]{8}/)[0];

  const bracketed = await coordinator.handle({
    text: `确认分支 ${request} <feat/test>`,
    senderId: OWNER,
    senderType: "user",
    source: source(`确认分支 ${request} <feat/test>`, "user")
  });
  assert.equal(bracketed.type, "dispatch");
  assert.equal(bracketed.project, "approved-workspace-dev");

  const secondOriginal = { ...original, messageId: "message-second" };
  await coordinator.handle({
    text: secondOriginal.text,
    senderId: secondOriginal.userId,
    senderType: "bot",
    source: secondOriginal
  });
  const shorthand = await coordinator.handle({
    text: "确认分支feat/test",
    senderId: OWNER,
    senderType: "user",
    source: source("确认分支feat/test", "user")
  });
  assert.equal(shorthand.type, "dispatch");
  assert.equal(shorthand.project, "approved-workspace-dev");
  assert.equal(shorthand.source.messageId, "message-second");
});

test("unknown workspaces require an owner-bound approval ID", async () => {
  const { coordinator, provisioned, statePath } = await fixture();
  const original = source("项目：new-service，检查代码");
  const request = await coordinator.handle({
    text: original.text,
    senderId: original.userId,
    senderType: "bot",
    source: original
  });
  const id = request.text.match(/WR-[A-F0-9]{8}/)[0];

  const botAttempt = await coordinator.handle({
    text: `同意工作区 ${id}`,
    senderId: "example-source-bot",
    senderType: "bot",
    source: source(`同意工作区 ${id}`)
  });
  assert.match(botAttempt.text, /主人本人/);

  const approved = await coordinator.handle({
    text: `同意工作区 ${id}`,
    senderId: OWNER,
    senderType: "user",
    source: source(`同意工作区 ${id}`, "user")
  });
  assert.equal(approved.type, "dispatch");
  assert.equal(approved.project, "new-service-read");
  assert.equal(approved.source.messageId, "message-original");
  assert.deepEqual(provisioned, ["new-service"]);

  const persisted = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(persisted.workspaces.some((workspace) => workspace.name === "new-service"), true);
  assert.equal(persisted.pending.some((entry) => entry.id === id), false);
});
