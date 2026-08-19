import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAgentType,
  renderNativeConfig,
  validateFeishuIdentityValues
} from "../../native/config-template.mjs";

const exampleId = (prefix, suffix) => `${prefix}_${suffix}`;
const APP_ID = exampleId("cli", "exampleapp");
const OWNER_ID = exampleId("ou", "exampleowner");
const DISPATCHER_ID = exampleId("ou", "exampledispatcher");
const CHAT_ID = exampleId("oc", "exampleexecution");

test("renders a direct native Feishu configuration without Bridge or Management", () => {
  const config = renderNativeConfig({
    appId: APP_ID,
    appSecret: "example-app-secret",
    ownerId: OWNER_ID,
    dispatcherId: DISPATCHER_ID,
    executionChatId: CHAT_ID,
    workspace: "/absolute/example/workspace",
    dataDir: "/absolute/example/private-data"
  });

  assert.match(config, /type = "feishu"/);
  assert.match(config, /thread_isolation = true/);
  assert.match(config, /share_session_in_channel = false/);
  assert.match(config, /group_reply_all = false/);
  assert.match(config, /attachment_send = "on"/);
  assert.match(config, /backend = "app_server"/);
  assert.match(config, /app_server_url = "stdio"/);
  assert.ok(config.includes(`admin_from = ${JSON.stringify(OWNER_ID)}`));
  assert.ok(config.includes(`approval_from = ${JSON.stringify(OWNER_ID)}`));
  assert.ok(config.includes("mention_trigger_sender = true"));
  assert.ok(config.includes("resolve_mentions = false"));
  assert.ok(config.includes(`allow_from = ${JSON.stringify(`${OWNER_ID},${DISPATCHER_ID}`)}`));
  const disabledLine = config.split("\n").find((line) => line.startsWith("disabled_commands = "));
  assert.match(disabledLine, /"mode"/);
  assert.match(disabledLine, /"provider"/);
  assert.match(disabledLine, /"history"/);
  assert.doesNotMatch(disabledLine, /"dir"|"workspace"/);
  assert.match(disabledLine, /"status"/);
  assert.match(disabledLine, /"usage"/);
  assert.match(disabledLine, /"cancel"/);
  assert.doesNotMatch(disabledLine, /"stop"|"help"|"version"/);
  assert.equal(
    config.split("\n").filter((line) => line === `admin_from = ${JSON.stringify(OWNER_ID)}`).length,
    2
  );
  assert.doesNotMatch(config, /\[bridge\]|\[management\]/i);
});

test("escapes values as TOML strings instead of interpolating configuration", () => {
  const config = renderNativeConfig({
    appId: APP_ID,
    appSecret: "example-secret\nunsafe = true",
    ownerId: OWNER_ID,
    dispatcherId: DISPATCHER_ID,
    executionChatId: CHAT_ID,
    workspace: "/absolute/example/workspace",
    dataDir: "/absolute/example/private-data"
  });

  assert.match(config, /app_secret = "example-secret\\nunsafe = true"/);
  assert.equal(config.includes("\nunsafe = true\n"), false);
});

test("supports direct owner-only mode when no Aily dispatcher is configured", () => {
  const config = renderNativeConfig({
    appId: APP_ID,
    appSecret: "example-app-secret",
    ownerId: OWNER_ID,
    dispatcherId: "",
    executionChatId: CHAT_ID,
    workspace: "/absolute/example/workspace",
    dataDir: "/absolute/example/private-data"
  });

  assert.ok(config.includes(`allow_from = ${JSON.stringify(OWNER_ID)}`));
  assert.equal(config.includes(`allow_from = ${JSON.stringify(`${OWNER_ID},`)}`), false);
});

test("renders Claude Code with cc-connect's native claudecode agent", () => {
  const config = renderNativeConfig({
    appId: APP_ID,
    appSecret: "example-app-secret",
    ownerId: OWNER_ID,
    dispatcherId: "",
    executionChatId: CHAT_ID,
    workspace: "/absolute/example/workspace",
    dataDir: "/absolute/example/private-data",
    agentType: "claude"
  });

  assert.match(config, /type = "claudecode"/);
  assert.match(config, /mode = "default"/);
  assert.doesNotMatch(config, /app_server_url|backend = "app_server"/);
});

test("renders Cursor through cc-connect's native ACP adapter", () => {
  const config = renderNativeConfig({
    appId: APP_ID,
    appSecret: "example-app-secret",
    ownerId: OWNER_ID,
    dispatcherId: "",
    executionChatId: CHAT_ID,
    workspace: "/absolute/example/workspace",
    dataDir: "/absolute/example-private-data",
    agentType: "cursor"
  });

  assert.match(config, /type = "acp"/);
  assert.match(config, /cmd = "agent"/);
  assert.match(config, /args = \["acp"\]/);
  assert.match(config, /auth_method = "cursor_login"/);
});

test("normalizes supported agent aliases and rejects unknown types", () => {
  assert.equal(normalizeAgentType("codex").type, "codex");
  assert.equal(normalizeAgentType("claude-code").type, "claudecode");
  assert.equal(normalizeAgentType("cursor-agent").type, "acp");
  assert.throws(() => normalizeAgentType("unknown-agent"), /agent type/);
});

test("rejects wildcard, list and malformed Feishu identity values", () => {
  const valid = {
    appId: APP_ID,
    ownerId: OWNER_ID,
    dispatcherId: DISPATCHER_ID,
    executionChatId: CHAT_ID
  };

  for (const [field, value] of [
    ["ownerId", "*"],
    ["ownerId", `${exampleId("ou", "first")},${exampleId("ou", "second")}`],
    ["ownerId", `${exampleId("ou", "owner")} user`],
    ["dispatcherId", "*"],
    ["dispatcherId", `${exampleId("ou", "bot")}\n${exampleId("ou", "other")}`],
    ["executionChatId", `${exampleId("oc", "first")},${exampleId("oc", "second")}`],
    ["executionChatId", "*"],
    ["appId", "example-app"]
  ]) {
    assert.throws(
      () => validateFeishuIdentityValues({ ...valid, [field]: value }),
      /must be one/
    );
  }
});
