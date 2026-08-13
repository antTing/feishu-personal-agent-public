import * as Lark from "@larksuiteoapi/node-sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BridgeClient, buildBridgeMessage } from "./bridge-client.js";
import { classifyBridgeReply } from "./bridge-reply-policy.js";
import { loadConfig } from "./config.js";
import { authorizeMessage, extractMessageText } from "./message-policy.js";
import { PermissionCoordinator } from "./permission-coordinator.js";
import { ReplyContextStore } from "./reply-context.js";
import { TaskRegistry } from "./task-registry.js";
import { TaskStatusTracker } from "./task-status.js";
import { WorkspaceCoordinator } from "./workspace-coordinator.js";
import { WorkspaceProvisioner } from "./workspace-provisioner.js";

const processedMessages = new Map();
const outboundMessages = new Map();
const activeTasks = new TaskRegistry();
const pendingStops = new Map();
const DEDUPE_TTL_MS = 10 * 60_000;
const LOCAL_STATUS = /^(?:\/status|\/task\s+status|任务状态|任务列表|查看任务状态|当前任务状态)$/i;
const LOCAL_STOP = /^(?:\/stop|\/cancel|停止任务|停止当前任务|取消任务|终止任务)(?:\s+(T-[A-F0-9]{8}|om_[A-Za-z0-9_-]+))?$/i;
const execFileAsync = promisify(execFile);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function log(level, message) {
  const output = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  output(`[feishu-connector] ${message}`);
}

function startupErrorCode(error) {
  const message = String(error?.message || error || "");
  if (/bot identity|allowed user|allowedBot/i.test(message)) return "FEISHU_IDENTITY_OR_ALLOWLIST";
  if (/workspace|managed root|search root|permission state/i.test(message)) return "WORKSPACE_OR_STATE";
  if (/Bridge|WebSocket/i.test(message)) return "BRIDGE";
  if (/config|loopback|regular file|symbolic link|mode 600|accessible by group/i.test(message)) return "CONFIG_OR_PERMISSIONS";
  if (/network|timeout|connection|ENET|ECONN/i.test(message)) return "NETWORK";
  return "UNKNOWN";
}

function pruneMessageCache(cache, now = Date.now()) {
  for (const [messageId, expiresAt] of cache) {
    if (expiresAt <= now) cache.delete(messageId);
  }
}

function isDuplicate(messageId) {
  pruneMessageCache(processedMessages);
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, Date.now() + DEDUPE_TTL_MS);
  return false;
}

function rememberOutbound(messageId) {
  if (!messageId) return;
  pruneMessageCache(outboundMessages);
  outboundMessages.set(messageId, Date.now() + DEDUPE_TTL_MS);
}

function repliesToOutbound(message) {
  pruneMessageCache(outboundMessages);
  return [message.parent_id, message.root_id].some((messageId) =>
    messageId && outboundMessages.has(messageId)
  );
}

function clearActiveTask(messageId) {
  activeTasks.finish(messageId);
}

async function fetchBotIdentity(client) {
  const result = await client.request({
    url: "/open-apis/bot/v3/info",
    method: "GET"
  });
  if (result.code !== 0 || !result.bot?.open_id) {
    throw new Error(`Unable to resolve Feishu bot identity (code ${result.code ?? "unknown"})`);
  }
  return result.bot;
}

async function main() {
  const config = await loadConfig();
  const allowedUsers = new Set(config.feishu.allowedUserIds);
  const allowedBots = new Set(config.feishu.allowedBotIds);
  const allowedBotChats = new Set(config.feishu.allowedBotChatIds);

  if (allowedUsers.size === 0) {
    throw new Error("At least one Feishu allowed user is required");
  }
  if (allowedBotChats.size > 0 && allowedBots.size === 0) {
    throw new Error("allowedBotIds is required when allowedBotChatIds is configured");
  }
  if (allowedBots.size > 0 && allowedBotChats.size === 0) {
    throw new Error("allowedBotChatIds is required when allowedBotIds is configured");
  }

  const client = new Lark.Client({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: Lark.Domain.Feishu,
    loggerLevel: Lark.LoggerLevel.warn
  });
  const botIdentity = await fetchBotIdentity(client);
  log("info", "bot-identity=resolved");
  const replyContexts = new ReplyContextStore();

  const provisioner = new WorkspaceProvisioner({
    ccConfigPath: config.workspaces.ccConfigPath,
    managedRoot: config.workspaces.managedRoot,
    searchRoots: config.workspaces.searchRoots,
    managementUrl: config.workspaces.managementUrl,
    managementToken: config.workspaces.managementToken,
    logger: {
      info: (message) => log("info", message),
      warn: (message) => log("warn", message)
    }
  });
  await provisioner.initialize();
  const workspaces = new WorkspaceCoordinator({
    statePath: config.workspaces.statePath,
    defaultProject: config.bridge.project,
    workspaces: config.workspaces.approved,
    ownerUserIds: config.feishu.allowedUserIds,
    provisioner,
    logger: {
      info: (message) => log("info", message),
      warn: (message) => log("warn", message)
    }
  });
  await workspaces.initialize();
  const permissions = new PermissionCoordinator({
    statePath: config.permissions.statePath,
    ownerUserIds: config.feishu.allowedUserIds
  });
  await permissions.initialize();

  const bridge = new BridgeClient({
    ...config.bridge,
    logger: {
      info: (message) => log("info", message),
      warn: (message) => log("warn", message),
      error: (message) => log("error", message)
    }
  });

  const replyText = async (messageId, text) => {
    const content = replyContexts.format(messageId, text);
    const result = await client.im.v1.message.reply({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify({ text: content }),
        msg_type: "text"
      }
    });

    if (result.code && result.code !== 0) {
      throw new Error(`Feishu reply failed with code ${result.code}`);
    }
    rememberOutbound(result.data?.message_id);
  };

  const taskStatus = new TaskStatusTracker({
    reply: replyText,
    onState: (messageId, state) => {
      const task = activeTasks.get(messageId);
      if (!task) return;
      if (state === "finished") {
        activeTasks.finish(messageId);
        return;
      }
      activeTasks.update(messageId, state);
    },
    logger: {
      warn: (message) => log("warn", message)
    }
  });

  bridge.onReply(async (message) => {
    const reply = classifyBridgeReply(message.content);
    if (!reply.final) {
      await replyText(message.reply_ctx, reply.content);
      log("info", "reply=intermediate-session-reset");
      return;
    }
    taskStatus.finish(message.reply_ctx);
    const stoppedTaskIds = pendingStops.get(message.reply_ctx);
    if (stoppedTaskIds) {
      pendingStops.delete(message.reply_ctx);
      for (const stoppedTaskId of stoppedTaskIds) {
        taskStatus.finish(stoppedTaskId);
        clearActiveTask(stoppedTaskId);
      }
    } else {
      clearActiveTask(message.reply_ctx);
    }
    try {
      await replyText(message.reply_ctx, reply.content);
      log("info", "reply=delivered");
    } finally {
      replyContexts.forget(message.reply_ctx);
    }
  });
  bridge.onBridgeError(async (message) => {
    if (!message.msg_id) return;
    taskStatus.finish(message.msg_id);
    const stoppedTaskIds = pendingStops.get(message.msg_id);
    if (stoppedTaskIds) {
      pendingStops.delete(message.msg_id);
      for (const stoppedTaskId of stoppedTaskIds) {
        taskStatus.finish(stoppedTaskId);
        clearActiveTask(stoppedTaskId);
      }
    } else {
      clearActiveTask(message.msg_id);
    }
    try {
      await replyText(message.msg_id, "任务执行失败，请稍后重试。");
      log("warn", "reply=execution-failed");
    } finally {
      replyContexts.forget(message.msg_id);
    }
  });
  const handlePermissionRequest = async (message) => {
    const sessionParts = String(message.session_key || "").split(":");
    const sourceChatId = message.chat_id || sessionParts[1];
    const sourceSenderId = sessionParts[2];
    if (message.reply_ctx && sourceSenderId) {
      replyContexts.remember(message.reply_ctx, {
        chatType: String(sourceChatId || "").startsWith("oc_") ? "group" : "p2p",
        senderId: sourceSenderId
      });
    }
    const id = await permissions.remember({
      project: message.project,
      sessionKey: message.session_key,
      replyCtx: message.reply_ctx,
      sourceMessageId: message.reply_ctx,
      sourceChatId,
      toolName: message.tool_name,
      toolInput: message.tool_input
    });
    activeTasks.update(message.reply_ctx, "waiting_approval");
    taskStatus.pause(message.reply_ctx);
    const detail = message.tool_input
      ? "检测到工具参数；为避免泄露路径或密钥，不在飞书中回显。"
      : "该工具未提供可显示的参数。";
    await replyText(
      message.reply_ctx,
      `<at user_id="${config.feishu.allowedUserIds[0]}"></at> Codex 请求执行以下操作：\n${message.tool_name || "工具调用"}\n${detail}\n\n请回复：允许操作 ${id} 或 拒绝操作 ${id}\n仅本次有效。`
    );
    log("info", "permission=requested");
  };
  bridge.onPermissionRequest(handlePermissionRequest);
  bridge.onTypingStart((message) => {
    const task = activeTasks.update(message.reply_ctx, "running");
    if (task) void taskStatus.markRunning(message.reply_ctx);
  });
  bridge.onTypingStop((message) => {
    const task = activeTasks.get(message.reply_ctx);
    if (task && task.phase !== "stopping") activeTasks.update(message.reply_ctx, "running");
  });
  const serviceStateCommand = process.env.SERVICE_STATE_COMMAND;
  const serviceWrapperPid = Number(process.env.SERVICE_WRAPPER_PID);
  let startupComplete = false;
  let bridgeHealthy = false;
  let feishuHealthy = false;
  let readinessUpdate = Promise.resolve();
  const updateServiceReadiness = (ready) => {
    if (!serviceStateCommand) return Promise.resolve();
    readinessUpdate = readinessUpdate.then(() => execFileAsync(process.execPath, [
      serviceStateCommand,
      ready ? "mark-ready" : "mark-not-ready",
      String(serviceWrapperPid)
    ], {
      timeout: 5_000,
      windowsHide: true
    })).catch(() => {
      log("warn", `service-state=${ready ? "ready" : "not-ready"}-update-failed`);
    });
    return readinessUpdate;
  };
  const syncServiceReadiness = () => updateServiceReadiness(
    startupComplete && bridgeHealthy && feishuHealthy
  );
  let bridgeEpoch = 0;
  const bridgeStartup = deferred();
  bridge.onReady(() => {
    bridgeHealthy = true;
    bridgeStartup.resolve();
    if (startupComplete) void syncServiceReadiness();
  });
  bridge.onDisconnect(() => {
    bridgeEpoch += 1;
    bridgeHealthy = false;
    void syncServiceReadiness();
  });
  bridge.start();

  const dispatcher = new Lark.EventDispatcher({
    loggerLevel: Lark.LoggerLevel.warn
  }).register({
    "im.message.receive_v1": async (event) => {
      const message = event.message;
      const messageId = message?.message_id;
      const authorization = authorizeMessage({
        event,
        selfBotOpenId: botIdentity.open_id,
        allowedUserIds: allowedUsers,
        allowedBotIds: allowedBots,
        allowedBotChatIds: allowedBotChats,
        allowGroupMessages: config.feishu.allowGroupMessages
      });

      if (!authorization.allowed || !messageId || isDuplicate(messageId)) {
        return;
      }

      if (authorization.senderType === "bot" && repliesToOutbound(message)) {
        log("warn", "bot-message=loop-prevented");
        return;
      }

      replyContexts.remember(messageId, {
        chatType: message.chat_type,
        senderId: authorization.senderId
      });

      const text = extractMessageText(message, botIdentity.open_id);
      if (!text) {
        if (authorization.senderType === "user") {
          await replyText(messageId, "当前支持文本、富文本和消息卡片中的文字内容。");
        }
        replyContexts.forget(messageId);
        log("info", "message=unsupported-type");
        return;
      }

      const source = {
        messageId,
        chatId: message.chat_id,
        chatType: message.chat_type,
        userId: authorization.senderId,
        senderType: authorization.senderType,
        text
      };

      if (LOCAL_STATUS.test(text)) {
        await replyText(messageId, activeTasks.format(message.chat_id));
        replyContexts.forget(messageId);
        log("info", "message=local-task-status");
        return;
      }

      const stopMatch = text.match(LOCAL_STOP);
      if (stopMatch) {
        if (authorization.senderType !== "user") {
          await replyText(messageId, "停止任务只能由主人本人发起。");
          replyContexts.forget(messageId);
          return;
        }
        const chatTasks = activeTasks.list(message.chat_id);
        const requestedTaskId = stopMatch[1];
        const task = activeTasks.resolve(message.chat_id, requestedTaskId);
        if (!task) {
          const response = chatTasks.length === 0
            ? "当前没有正在执行或排队的任务。"
            : `${requestedTaskId ? `没有找到任务 ${requestedTaskId}。` : "当前有多个活动任务，请指定要停止的任务编号。"}\n\n${activeTasks.format(message.chat_id)}`;
          await replyText(messageId, response);
          replyContexts.forget(messageId);
          return;
        }
        const sessionTasks = activeTasks.sameSession(task);
        if (task.phase === "queued") {
          const current = sessionTasks.find((candidate) => candidate.phase !== "queued");
          const currentHint = current ? `请停止正在占用该会话的 ${current.taskId}` : "请稍后再试";
          await replyText(
            messageId,
            `${task.taskId} 正在同一 Codex 会话中排队。cc-connect 目前不能只移除单条排队消息；${currentHint}，届时该会话的后续排队任务也会一并取消。`
          );
          replyContexts.forget(messageId);
          return;
        }
        if (!bridge.isReady) {
          await replyText(messageId, "cc-connect 通道暂未就绪，停止请求未送达。");
          replyContexts.forget(messageId);
          return;
        }
        try {
          bridge.sendMessage(buildBridgeMessage({
            platform: config.bridge.platform,
            project: task.project,
            messageId,
            chatId: task.chatId,
            chatType: task.chatType,
            userId: task.userId,
            content: "/stop"
          }));
          const queuedCount = sessionTasks.filter((candidate) => candidate.phase === "queued").length;
          pendingStops.set(messageId, sessionTasks.map((candidate) => candidate.messageId));
          for (const sessionTask of sessionTasks) {
            activeTasks.update(sessionTask.messageId, "stopping");
            taskStatus.pause(sessionTask.messageId);
          }
          const queueNotice = queuedCount > 0 ? ` 同一会话中另有 ${queuedCount} 个排队任务，也会一并取消。` : "";
          await replyText(messageId, `已向 ${task.taskId}（${task.project}）发送停止请求。${queueNotice}`);
        } catch {
          await replyText(messageId, "停止请求未能送达 cc-connect，请稍后重试。");
        }
        replyContexts.forget(messageId);
        log("info", `message=local-task-stop project=${task.project}`);
        return;
      }

      const permissionDecision = await permissions.decide({
        text,
        senderId: authorization.senderId,
        senderType: authorization.senderType,
        chatId: message.chat_id
      });
      if (permissionDecision) {
        if (permissionDecision.type === "reply") {
          await replyText(messageId, permissionDecision.text);
        } else if (!bridge.isReady) {
          await replyText(messageId, "cc-connect Agent 通道暂未就绪，操作审批未送达，请稍后重试。");
        } else {
          const pending = permissionDecision.pending;
          try {
            bridge.sendPermissionDecision({
              project: pending.project,
              sessionKey: pending.sessionKey,
              replyCtx: pending.replyCtx,
              allowed: permissionDecision.allowed
            });
            await permissions.complete(pending.id);
            activeTasks.update(pending.replyCtx, "running");
            void taskStatus.markRunning(pending.replyCtx);
            await replyText(
              pending.sourceMessageId,
              permissionDecision.allowed ? "主人已允许本次操作，任务继续执行。" : "主人已拒绝本次操作，任务将据此继续或结束。"
            );
          } catch {
            await replyText(messageId, `操作审批 ${pending.id} 未送达，请稍后用同一编号重试。`);
          }
        }
        replyContexts.forget(messageId);
        log("info", "permission=decision-forwarded");
        return;
      }

      const bridgeEpochBeforeDecision = bridgeEpoch;
      let decision;
      try {
        decision = await workspaces.handle({
          text,
          senderId: authorization.senderId,
          senderType: authorization.senderType,
          source
        });
      } catch (error) {
        await replyText(messageId, "工作区审批或路由暂时失败，原任务没有进入 Codex。请稍后重试。");
        replyContexts.forget(messageId);
        log("error", "workspace=route-failed");
        return;
      }

      if (decision.type === "reply") {
        const replySource = decision.source || source;
        if (replySource.messageId !== messageId) {
          replyContexts.remember(replySource.messageId, {
            chatType: replySource.chatType,
            senderId: replySource.userId
          });
        }
        await replyText(replySource.messageId, decision.text);
        replyContexts.forget(replySource.messageId);
        replyContexts.forget(messageId);
        log("info", "message=local-approval-gate");
        return;
      }

      const dispatchSource = decision.source;
      if (dispatchSource.messageId !== messageId) {
        replyContexts.remember(dispatchSource.messageId, {
          chatType: dispatchSource.chatType,
          senderId: dispatchSource.userId
        });
      }
      if (decision.notice) {
        await replyText(dispatchSource.messageId, decision.notice);
      }

      if (decision.deferUntilProjectReady) {
        const deadline = Date.now() + 20_000;
        try {
          while (Date.now() < deadline && (bridgeEpoch <= bridgeEpochBeforeDecision || !bridge.isReady)) {
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          if (bridgeEpoch <= bridgeEpochBeforeDecision || !bridge.isReady) throw new Error("reload timeout");
        } catch {
          await replyText(dispatchSource.messageId, "工作区已批准，但 cc-connect 重载尚未完成。请稍后回复原任务继续。");
          replyContexts.forget(dispatchSource.messageId);
          replyContexts.forget(messageId);
          log("warn", "workspace=bridge-reload-timeout");
          return;
        }
      }

      if (!bridge.isReady) {
        await replyText(dispatchSource.messageId, "cc-connect Agent 通道暂未就绪，请稍后重试。");
        replyContexts.forget(dispatchSource.messageId);
        replyContexts.forget(messageId);
        log("warn", "message=bridge-unavailable");
        return;
      }

      let statusStarted = false;
      const dispatchMessage = buildBridgeMessage({
        platform: config.bridge.platform,
        project: decision.project,
        messageId: dispatchSource.messageId,
        chatId: dispatchSource.chatId,
        chatType: dispatchSource.chatType,
        userId: dispatchSource.userId,
        content: dispatchSource.text
      });
      const activeTask = {
        messageId: dispatchSource.messageId,
        chatId: dispatchSource.chatId,
        chatType: dispatchSource.chatType,
        userId: dispatchSource.userId,
        project: decision.project,
        sessionKey: dispatchMessage.session_key,
        startedAt: Date.now(),
        phase: "accepted"
      };
      const trackedTask = activeTasks.add(activeTask);
      if (dispatchSource.senderType === "bot") {
        await taskStatus.start(dispatchSource.messageId, { queued: trackedTask.phase === "queued" });
        statusStarted = true;
      }
      try {
        bridge.sendMessage(dispatchMessage);
      } catch {
        if (statusStarted) taskStatus.finish(dispatchSource.messageId);
        clearActiveTask(trackedTask.messageId);
        await replyText(dispatchSource.messageId, "任务未能送达 cc-connect，请稍后重试。原任务没有执行。");
        replyContexts.forget(dispatchSource.messageId);
        log("warn", "message=bridge-send-failed");
        return;
      }
      log("info", `message=forwarded source=${dispatchSource.senderType} project=${decision.project}`);
    }
  });

  const feishuStartup = deferred();
  let runtimeGuard;
  let shuttingDown = false;
  let wsClient;
  const shutdownRuntime = (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (runtimeGuard) clearInterval(runtimeGuard);
    taskStatus.stop();
    bridge.stop();
    wsClient?.close?.({ force: true });
    process.exit(code);
  };
  const failRuntime = () => {
    log("error", "runtime=failed code=FEISHU_LONG_CONNECTION");
    shutdownRuntime(1);
  };
  wsClient = new Lark.WSClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: Lark.Domain.Feishu,
    loggerLevel: Lark.LoggerLevel.warn,
    onReady: () => {
      feishuHealthy = true;
      feishuStartup.resolve();
      if (startupComplete) void syncServiceReadiness();
    },
    onReconnecting: () => {
      feishuHealthy = false;
      void syncServiceReadiness();
    },
    onReconnected: () => {
      feishuHealthy = true;
      if (startupComplete) void syncServiceReadiness();
    },
    onError: () => {
      feishuHealthy = false;
      void syncServiceReadiness();
      if (!startupComplete) feishuStartup.reject(new Error("Feishu long connection failed"));
      else failRuntime();
    }
  });

  process.once("SIGINT", () => {
    shutdownRuntime(0);
  });
  process.once("SIGTERM", () => {
    shutdownRuntime(0);
  });

  log("info", "starting Feishu long connection");
  wsClient.start({ eventDispatcher: dispatcher });
  let readinessTimer;
  const readinessTimeout = new Promise((_, reject) => {
    readinessTimer = setTimeout(() => reject(new Error("Bridge or Feishu readiness timeout")), 15_000);
  });
  try {
    await Promise.race([
      Promise.all([bridgeStartup.promise, feishuStartup.promise]),
      readinessTimeout
    ]);
  } finally {
    clearTimeout(readinessTimer);
  }
  startupComplete = true;
  runtimeGuard = setInterval(() => {
    if (wsClient.getConnectionStatus?.().state === "failed") failRuntime();
  }, 2_000);
  if (serviceStateCommand) {
    if (!Number.isSafeInteger(serviceWrapperPid) || serviceWrapperPid <= 1) {
      throw new Error("Invalid service wrapper identity");
    }
    await execFileAsync(process.execPath, [serviceStateCommand, "owned-by", String(serviceWrapperPid)], {
      timeout: 5_000,
      windowsHide: true
    });
    await syncServiceReadiness();
  }
  log("info", "service=ready");
}

main().catch((error) => {
  log("error", `startup=failed code=${startupErrorCode(error)}`);
  process.exitCode = 1;
});
