import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { WorkspaceCoordinator } from "../src/workspace-coordinator.js";

test("an explicit workspace name never falls through to a substring alias", async () => {
  const root = path.join(tmpdir(), `workspace-boundary-${process.pid}-${Math.random()}`);
  const repo = path.join(root, "foo");
  await mkdir(path.join(repo, ".git"), { recursive: true });
  await writeFile(path.join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  const coordinator = new WorkspaceCoordinator({
    statePath: path.join(root, "state.json"),
    defaultProject: "personal-agent",
    ownerUserIds: ["example-owner-user"],
    workspaces: [{
      name: "foo",
      aliases: ["foo"],
      path: repo,
      readProject: "foo-read",
      devProject: "foo-dev"
    }],
    provisioner: {
      validateWorkspacePath: async (workspacePath) => workspacePath
    }
  });
  await coordinator.initialize();

  const result = await coordinator.handle({
    text: "项目：foobar，检查代码",
    senderId: "example-source-bot",
    senderType: "bot",
    source: {
      messageId: "example-message-001",
      chatId: "example-group-chat",
      chatType: "group",
      userId: "example-source-bot",
      senderType: "bot",
      text: "项目：foobar，检查代码"
    }
  });
  assert.equal(result.type, "reply");
  assert.match(result.text, /尚未授权/);
});
