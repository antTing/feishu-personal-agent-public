import { WebSocket as NodeWebSocket } from "ws";

const OPEN_STATE = 1;

export function buildBridgeMessage({
  platform,
  project,
  messageId,
  chatId,
  chatType,
  userId,
  content
}) {
  const scope = chatType === "p2p" ? userId : chatId;

  return {
    type: "message",
    project,
    msg_id: messageId,
    session_key: `${platform}:${scope}:${userId}`,
    user_id: userId,
    user_name: "",
    content,
    reply_ctx: messageId,
    images: [],
    files: []
  };
}

export class BridgeClient {
  constructor({ url, token, platform, project, WebSocketImpl = NodeWebSocket, logger = console }) {
    if (!WebSocketImpl) {
      throw new Error("This Node.js runtime does not provide WebSocket support");
    }

    this.url = url;
    this.token = token;
    this.platform = platform;
    this.project = project;
    this.WebSocketImpl = WebSocketImpl;
    this.logger = logger;
    this.socket = null;
    this.registered = false;
    this.stopped = true;
    this.retryMs = 1_000;
    this.retryTimer = null;
    this.pingTimer = null;
    this.replyHandler = null;
    this.readyHandler = null;
    this.errorHandler = null;
    this.disconnectHandler = null;
    this.permissionHandler = null;
    this.typingStartHandler = null;
    this.typingStopHandler = null;
  }

  get isReady() {
    return this.registered && this.socket?.readyState === OPEN_STATE;
  }

  onReply(handler) {
    this.replyHandler = handler;
  }

  onReady(handler) {
    this.readyHandler = handler;
  }

  onBridgeError(handler) {
    this.errorHandler = handler;
  }

  onDisconnect(handler) {
    this.disconnectHandler = handler;
  }

  onPermissionRequest(handler) {
    this.permissionHandler = handler;
  }

  onTypingStart(handler) {
    this.typingStartHandler = handler;
  }

  onTypingStop(handler) {
    this.typingStopHandler = handler;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.socket?.close();
    this.socket = null;
    this.registered = false;
  }

  sendMessage(message) {
    if (!this.isReady) {
      throw new Error("cc-connect Bridge is not ready");
    }
    this.send(message);
  }

  connect() {
    if (this.stopped) return;

    const endpoint = new URL(this.url);
    const socket = new this.WebSocketImpl(endpoint, {
      headers: { Authorization: `Bearer ${this.token}` }
    });
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.send({
        type: "register",
        platform: this.platform,
        project: this.project,
        capabilities: ["text", "typing"],
        metadata: {
          version: "0.2.0",
          protocol_version: 1,
          description: "Feishu self-built app connector"
        }
      });
    });

    socket.addEventListener("message", (event) => this.handleIncoming(event.data));
    socket.addEventListener("error", () => {
      this.logger.error("[bridge] websocket error");
    });
    socket.addEventListener("close", () => {
      this.registered = false;
      clearInterval(this.pingTimer);
      this.disconnectHandler?.();
      this.scheduleReconnect();
    });
  }

  handleIncoming(raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      this.logger.error("[bridge] ignored invalid JSON frame");
      return;
    }

    switch (message.type) {
      case "register_ack":
        if (!message.ok) {
          this.logger.error(`[bridge] registration rejected: ${message.error || "unknown error"}`);
          this.socket?.close();
          return;
        }
        this.registered = true;
        this.retryMs = 1_000;
        this.startHeartbeat();
        this.logger.info("[bridge] connected to cc-connect");
        this.readyHandler?.();
        break;

      case "reply":
        Promise.resolve(this.replyHandler?.(message)).catch(() => {
          this.logger.error("[bridge] failed to deliver agent reply");
        });
        break;

      case "error":
        this.logger.error(`[bridge] cc-connect error: ${message.code || "unknown"}`);
        this.errorHandler?.(message);
        break;

      case "permission_request":
        Promise.resolve(this.permissionHandler?.(message)).catch(() => {
          this.logger.error("[bridge] failed to deliver permission request");
        });
        break;

      case "typing_start":
        this.typingStartHandler?.(message);
        break;

      case "typing_stop":
        this.typingStopHandler?.(message);
        break;

      case "pong":
        break;

      default:
        this.logger.warn(`[bridge] ignored unsupported frame type: ${message.type || "unknown"}`);
    }
  }

  startHeartbeat() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.isReady) {
        this.send({ type: "ping", ts: Date.now() });
      }
    }, 30_000);
    this.pingTimer.unref?.();
  }

  scheduleReconnect() {
    if (this.stopped || this.retryTimer) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 60_000);
    this.logger.warn(`[bridge] disconnected; retrying in ${delay / 1_000}s`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
    this.retryTimer.unref?.();
  }

  send(payload) {
    if (this.socket?.readyState !== OPEN_STATE) {
      throw new Error("Bridge WebSocket is not open");
    }
    this.socket.send(JSON.stringify(payload));
  }

  sendPermissionDecision({ project, sessionKey, replyCtx, allowed }) {
    if (!this.isReady) throw new Error("cc-connect Bridge is not ready");
    this.send({
      type: "card_action",
      project,
      session_key: sessionKey,
      reply_ctx: replyCtx,
      action: allowed ? "perm:allow" : "perm:deny"
    });
  }
}
