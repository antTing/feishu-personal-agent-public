import * as Lark from "@larksuiteoapi/node-sdk";
import { randomBytes } from "node:crypto";
import {
  extractMessageText,
  hasSelfMention,
  normalizeSenderType
} from "./message-policy.js";

const FEISHU_ID = /^ou_[A-Za-z0-9]+$/;
const FEISHU_CHAT_ID = /^oc_[A-Za-z0-9]+$/;

export const NATIVE_APP_SCOPES = Object.freeze([
  "im:message.group_at_msg:readonly",
  "im:message:send_as_bot",
  "im:message:readonly",
  "im:resource"
]);

export function requiredNativeScopes(requireDispatcher = true) {
  return requireDispatcher
    ? [...NATIVE_APP_SCOPES, "im:message.group_at_msg.include_bot:readonly"]
    : [...NATIVE_APP_SCOPES];
}

export function createPairingToken() {
  return `PAIR-${randomBytes(16).toString("hex").toUpperCase()}`;
}

export function buildRegistrationOptions({
  requireDispatcher = true,
  appName = "本地个人 Agent",
  agentLabel = "本地 Agent",
  onQRCodeReady,
  onStatusChange
} = {}) {
  if (typeof onQRCodeReady !== "function") {
    throw new Error("onQRCodeReady is required");
  }
  const tenantScopes = requiredNativeScopes(requireDispatcher);
  return {
    source: "feishu-personal-agent",
    createOnly: true,
    appPreset: {
      name: appName,
      desc: `通过飞书安全调用本机 cc-connect 和${agentLabel}`
    },
    addons: {
      // Keep Feishu's PersonalAgent base so WebSocket event and card callback
      // transport are provisioned by the same official flow used by cc-connect.
      preset: true,
      scopes: { tenant: tenantScopes },
      events: { items: { tenant: ["im.message.receive_v1"] } },
      callbacks: { items: ["card.action.trigger"] }
    },
    onQRCodeReady,
    ...(typeof onStatusChange === "function" ? { onStatusChange } : {})
  };
}

export async function registerNativeFeishuApp({
  requireDispatcher = true,
  appName,
  agentLabel,
  onQRCodeReady,
  onStatusChange,
  registerApp = Lark.registerApp
} = {}) {
  const result = await registerApp(buildRegistrationOptions({
    requireDispatcher,
    appName,
    agentLabel,
    onQRCodeReady,
    onStatusChange
  }));
  if (!/^cli_[A-Za-z0-9]+$/.test(String(result?.client_id || ""))) {
    throw new Error("Feishu app registration did not return a valid App ID");
  }
  if (!String(result?.client_secret || "")) {
    throw new Error("Feishu app registration did not return an App Secret");
  }
  const registrationOwnerId = String(result.user_info?.open_id || "");
  if (!FEISHU_ID.test(registrationOwnerId)) {
    throw new Error("飞书注册结果未返回扫码用户身份，已停止安装以避免绑定错误主人");
  }
  return {
    appId: result.client_id,
    appSecret: result.client_secret,
    registrationOwnerId
  };
}

function containsExactToken(content, token) {
  if (!token) return false;
  return String(content)
    .toUpperCase()
    .split(/\s+/u)
    .filter(Boolean)
    .includes(String(token).toUpperCase());
}

export class PairingCollector {
  constructor({
    botOpenId,
    registrationOwnerId = "",
    requireDispatcher = true,
    ownerToken,
    dispatcherToken,
    confirmationToken,
    rejectionToken = createPairingToken(),
    createToken = createPairingToken,
    state = {}
  }) {
    if (!FEISHU_ID.test(String(botOpenId || ""))) {
      throw new Error("A valid bot open_id is required for pairing");
    }
    this.botOpenId = botOpenId;
    if (!FEISHU_ID.test(String(registrationOwnerId || "")) || registrationOwnerId === botOpenId) {
      throw new Error("扫码用户身份无效或与机器人身份冲突，已停止配对");
    }
    this.registrationOwnerId = String(registrationOwnerId);
    this.requireDispatcher = requireDispatcher;
    this.ownerToken = String(ownerToken || "").toUpperCase();
    this.dispatcherToken = String(dispatcherToken || "").toUpperCase();
    this.confirmationToken = String(confirmationToken || "").toUpperCase();
    this.rejectionToken = String(rejectionToken || "").toUpperCase();
    this.createToken = createToken;
    if (this.requireDispatcher) {
      const dispatcherTokens = new Set([
        this.dispatcherToken,
        this.confirmationToken,
        this.rejectionToken
      ]);
      if (
        typeof this.createToken !== "function" ||
        dispatcherTokens.size !== 3 ||
        [...dispatcherTokens].some((token) => !token)
      ) {
        throw new Error("Dispatcher pairing requires three independent tokens");
      }
    }
    this.ownerId = String(state.ownerId || this.registrationOwnerId);
    this.executionChatId = String(state.executionChatId || "");
    this.dispatcherId = String(state.dispatcherId || "");
    this.dispatcherCandidateId = String(state.dispatcherCandidateId || "");
    this.dispatcherCandidateMessageId = String(state.dispatcherCandidateMessageId || "");
    this.seen = new Set();
  }

  tokens() {
    return {
      ownerToken: this.ownerToken,
      dispatcherToken: this.dispatcherToken,
      confirmationToken: this.confirmationToken,
      rejectionToken: this.rejectionToken
    };
  }

  rotateDispatcherTokens() {
    const previous = new Set([
      this.dispatcherToken,
      this.confirmationToken,
      this.rejectionToken
    ]);
    const next = [];
    for (let index = 0; index < 3; index += 1) {
      let token = "";
      for (let attempt = 0; attempt < 32; attempt += 1) {
        token = String(this.createToken() || "").toUpperCase();
        if (token && !previous.has(token) && !next.includes(token)) break;
        token = "";
      }
      if (!token) throw new Error("Unable to rotate dispatcher pairing tokens");
      next.push(token);
    }
    [this.dispatcherToken, this.confirmationToken, this.rejectionToken] = next;
  }

  get stage() {
    if (!this.ownerId || !this.executionChatId) return "owner";
    if (this.requireDispatcher && (!this.dispatcherCandidateId || !this.dispatcherCandidateMessageId)) {
      return "dispatcher";
    }
    if (this.requireDispatcher && !this.dispatcherId) return "dispatcher-confirmation";
    return "complete";
  }

  snapshot() {
    return {
      ownerId: this.ownerId,
      executionChatId: this.executionChatId,
      dispatcherId: this.dispatcherId,
      dispatcherCandidateId: this.dispatcherCandidateId,
      dispatcherCandidateMessageId: this.dispatcherCandidateMessageId
    };
  }

  consume(event) {
    const message = event?.message;
    const messageId = String(message?.message_id || "");
    if (!messageId || this.seen.has(messageId)) return { changed: false, stage: this.stage };
    this.seen.add(messageId);
    if (message?.chat_type !== "group" || !FEISHU_CHAT_ID.test(String(message.chat_id || ""))) {
      return { changed: false, stage: this.stage };
    }
    if (!hasSelfMention(message, this.botOpenId)) return { changed: false, stage: this.stage };

    const senderId = String(event?.sender?.sender_id?.open_id || "");
    if (!FEISHU_ID.test(senderId) || senderId === this.botOpenId) {
      return { changed: false, stage: this.stage };
    }
    const senderType = normalizeSenderType(event?.sender?.sender_type);
    const content = extractMessageText(message, this.botOpenId) || "";

    if (this.stage === "owner") {
      if (senderType !== "user" || !containsExactToken(content, this.ownerToken)) {
        return { changed: false, stage: this.stage };
      }
      if (senderId !== this.registrationOwnerId) {
        return { changed: false, stage: this.stage, ownerMismatch: true };
      }
      this.ownerId = senderId;
      this.executionChatId = message.chat_id;
      return { changed: true, stage: this.stage, snapshot: this.snapshot() };
    }

    if (this.stage === "dispatcher") {
      if (senderType !== "bot" || !containsExactToken(content, this.dispatcherToken)) {
        return { changed: false, stage: this.stage };
      }
      if (message.chat_id !== this.executionChatId) {
        return { changed: false, stage: this.stage };
      }
      this.dispatcherCandidateId = senderId;
      this.dispatcherCandidateMessageId = messageId;
      return { changed: true, stage: this.stage, snapshot: this.snapshot() };
    }

    if (this.stage === "dispatcher-confirmation") {
      if (senderType !== "user" || senderId !== this.ownerId) {
        return { changed: false, stage: this.stage };
      }
      const repliesToCandidate = [message.parent_id, message.root_id]
        .filter(Boolean)
        .includes(this.dispatcherCandidateMessageId);
      if (message.chat_id !== this.executionChatId || !repliesToCandidate) {
        return { changed: false, stage: this.stage };
      }
      if (containsExactToken(content, this.rejectionToken)) {
        this.dispatcherId = "";
        this.dispatcherCandidateId = "";
        this.dispatcherCandidateMessageId = "";
        this.rotateDispatcherTokens();
        return {
          changed: true,
          rejected: true,
          stage: this.stage,
          snapshot: this.snapshot()
        };
      }
      if (!containsExactToken(content, this.confirmationToken)) {
        return { changed: false, stage: this.stage };
      }
      this.dispatcherId = this.dispatcherCandidateId;
      return { changed: true, stage: this.stage, snapshot: this.snapshot() };
    }

    return { changed: false, stage: this.stage };
  }
}

export async function fetchBotOpenId({ appId, appSecret }) {
  const client = new Lark.Client({
    appId,
    appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: Lark.Domain.Feishu,
    loggerLevel: Lark.LoggerLevel.fatal
  });
  const result = await client.request({
    url: "/open-apis/bot/v3/info",
    method: "GET"
  });
  if (result?.bot?.activate_status !== undefined && Number(result.bot.activate_status) !== 2) {
    throw new Error("新机器人尚未启用；请先完成飞书中的应用发布或管理员审批，再运行同一命令继续");
  }
  const botOpenId = String(result?.bot?.open_id || "");
  if (!FEISHU_ID.test(botOpenId)) {
    throw new Error("新机器人尚不可用；请先完成飞书中的应用发布或管理员审批，再运行同一命令继续");
  }
  return botOpenId;
}

export async function verifyNativeAppScopes({
  appId,
  appSecret,
  requireDispatcher = true,
  createClient = (options) => new Lark.Client(options)
}) {
  const client = createClient({
    appId,
    appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: Lark.Domain.Feishu,
    loggerLevel: Lark.LoggerLevel.fatal
  });
  const result = await client.application.scope.list({});
  if (result?.code && result.code !== 0) {
    throw new Error("无法核对飞书应用权限；完成应用发布或管理员审批后可重新运行");
  }
  const available = new Set((result?.data?.scopes || [])
    .filter((scope) => (
      Number(scope?.grant_status) === 1 &&
      (!scope?.scope_type || scope.scope_type === "tenant")
    ))
    .map((scope) => String(scope?.scope_name || "")));
  const missing = requiredNativeScopes(requireDispatcher).filter((scope) => !available.has(scope));
  if (missing.length > 0) {
    try {
      const applyResult = await client.application.scope.apply({});
      if (applyResult?.code && applyResult.code !== 0) {
        throw Object.assign(new Error("scope approval request failed"), {
          code: applyResult.code
        });
      }
      throw new Error("已自动向企业管理员提交权限审批；批准后重新运行同一安装命令继续");
    } catch (error) {
      if (String(error?.message || "").startsWith("已自动向企业管理员提交")) throw error;
      const code = Number(error?.code || error?.response?.data?.code || 0);
      if (code === 212004) {
        throw new Error("权限审批已在处理中；管理员批准后重新运行同一安装命令继续");
      }
      if (code === 212001) {
        throw new Error("仍有高敏权限需要企业管理员在飞书中审批；批准后重新运行同一安装命令继续");
      }
      throw new Error("缺少必需权限且自动提交审批失败；请由企业管理员检查应用审批后重试");
    }
  }
}

export async function waitForPairing({
  appId,
  appSecret,
  registrationOwnerId = "",
  requireDispatcher = true,
  ownerToken = createPairingToken(),
  dispatcherToken = createPairingToken(),
  confirmationToken = createPairingToken(),
  rejectionToken = createPairingToken(),
  createToken = createPairingToken,
  state = {},
  timeoutMs = 20 * 60_000,
  onReady = () => {},
  onStage = () => {},
  onPersist = async () => {},
  verifyPermissions = verifyNativeAppScopes,
  fetchBotIdentity = fetchBotOpenId,
  createDispatcher = (handler) => new Lark.EventDispatcher({
    loggerLevel: Lark.LoggerLevel.fatal
  }).register({ "im.message.receive_v1": handler }),
  createWsClient = (options) => new Lark.WSClient(options)
} = {}) {
  await verifyPermissions({ appId, appSecret, requireDispatcher });
  const botOpenId = await fetchBotIdentity({ appId, appSecret });
  const collector = new PairingCollector({
    botOpenId,
    registrationOwnerId,
    requireDispatcher,
    ownerToken,
    dispatcherToken,
    confirmationToken,
    rejectionToken,
    createToken,
    state
  });
  if (collector.stage === "complete") return collector.snapshot();

  let wsClient;
  let timer;
  let settled = false;
  let processing = Promise.resolve();
  const result = new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const dispatcher = createDispatcher((event) => {
      processing = processing.then(async () => {
        const update = collector.consume(event);
        if (update.ownerMismatch) {
          await onStage("owner-mismatch", collector.tokens());
          return;
        }
        if (!update.changed) return;
        await onPersist(update.snapshot);
        await onStage(update.stage, collector.tokens());
        if (update.stage === "complete") finish(resolve, update.snapshot);
      }).catch((error) => {
        finish(reject, error);
      });
      return processing;
    });
    wsClient = createWsClient({
      appId,
      appSecret,
      domain: Lark.Domain.Feishu,
      loggerLevel: Lark.LoggerLevel.fatal,
      autoReconnect: true,
      source: "feishu-personal-agent-onboarding",
      onReady: () => {
        Promise.resolve(onReady(collector.stage, collector.tokens()))
          .catch((error) => finish(reject, error));
      },
      onError: () => finish(reject, new Error("飞书配对连接失败；完成应用发布或管理员审批后可运行同一命令继续"))
    });
    timer = setTimeout(
      () => finish(reject, new Error("Feishu pairing timed out; rerun the onboarding command to resume")),
      timeoutMs
    );
    Promise.resolve(wsClient.start({ eventDispatcher: dispatcher })).catch((error) => {
      finish(reject, error);
    });
  });

  try {
    return await result;
  } finally {
    clearTimeout(timer);
    wsClient?.close?.({ force: true });
  }
}
