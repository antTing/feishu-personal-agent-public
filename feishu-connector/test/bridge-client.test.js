import test from "node:test";
import assert from "node:assert/strict";
import { BridgeClient, buildBridgeMessage } from "../src/bridge-client.js";

test("builds stable direct-message session keys", () => {
  const message = buildBridgeMessage({
    platform: "feishu-self-built-app",
    project: "example-default-project",
    messageId: "example-message-direct",
    chatId: "example-direct-chat",
    chatType: "p2p",
    userId: "example-owner-user",
    content: "示例请求"
  });

  assert.equal(message.project, "example-default-project");
  assert.equal(message.session_key, "feishu-self-built-app:example-owner-user:example-owner-user");
  assert.equal(message.reply_ctx, "example-message-direct");
  assert.deepEqual(message.images, []);
  assert.deepEqual(message.files, []);
});

test("isolates group sessions by chat and user", () => {
  const message = buildBridgeMessage({
    platform: "feishu-self-built-app",
    project: "example-workspace-read",
    messageId: "example-message-group",
    chatId: "example-group-chat",
    chatType: "group",
    userId: "example-owner-user",
    content: "示例状态请求"
  });

  assert.equal(message.session_key, "feishu-self-built-app:example-group-chat:example-owner-user");
});

test("authenticates Bridge with a request header instead of a URL token", () => {
  let observedUrl;
  let observedOptions;
  class FakeWebSocket {
    constructor(url, options) {
      observedUrl = String(url);
      observedOptions = options;
      this.readyState = 0;
    }

    addEventListener() {}

    close() {}
  }

  const client = new BridgeClient({
    url: "ws://127.0.0.1:9810/bridge/ws",
    token: "placeholder-bridge-token",
    platform: "feishu-self-built-app",
    project: "example-default-project",
    WebSocketImpl: FakeWebSocket
  });
  client.start();

  assert.equal(new URL(observedUrl).search, "");
  assert.deepEqual(observedOptions, {
    headers: { Authorization: "Bearer placeholder-bridge-token" }
  });
  client.stop();
});

test("reports readiness only after Bridge registration succeeds", () => {
  let socket;
  class FakeWebSocket {
    constructor() {
      this.readyState = 1;
      this.listeners = new Map();
      socket = this;
    }

    addEventListener(name, handler) {
      this.listeners.set(name, handler);
    }

    send() {}

    close() {}
  }

  const client = new BridgeClient({
    url: "ws://127.0.0.1:9810/bridge/ws",
    token: "placeholder-bridge-token",
    platform: "feishu-self-built-app",
    project: "example-default-project",
    WebSocketImpl: FakeWebSocket
  });
  let ready = 0;
  client.onReady(() => { ready += 1; });
  client.start();

  socket.listeners.get("open")();
  assert.equal(ready, 0);
  socket.listeners.get("message")({ data: JSON.stringify({ type: "register_ack", ok: true }) });
  assert.equal(ready, 1);
  assert.equal(client.isReady, true);
  client.stop();
});
