#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  unlink
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createPairingToken,
  registerNativeFeishuApp,
  waitForPairing
} from "../feishu-connector/src/native-onboarding.js";
import { renderNativeConfig } from "../native/config-template.mjs";
import {
  atomicPrivateWrite,
  nativeConfigMatchesPending,
  sanitizeDiagnostic
} from "./onboard-native-utils.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const RUNTIME_ROOT = path.join(ROOT_DIR, "runtime");
const RUNTIME_DIR = path.join(RUNTIME_ROOT, "native-cc-connect");
const DATA_DIR = path.join(RUNTIME_DIR, "data");
const CONFIG_PATH = path.join(RUNTIME_DIR, "config.toml");
const PENDING_PATH = path.join(RUNTIME_DIR, ".onboarding.json");
const LOCK_PATH = path.join(RUNTIME_DIR, ".onboarding.lock");
const GUIDE_PATH = path.join(RUNTIME_DIR, ".pairing-guide.html");
const sensitiveValues = new Set();
let lockAcquired = false;
let displayedPairingStage = "";

async function cleanupEphemeralFiles() {
  if (!lockAcquired) return;
  await unlink(GUIDE_PATH).catch(() => {});
  await unlink(LOCK_PATH).catch(() => {});
  lockAcquired = false;
}

for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(signal, () => {
    cleanupEphemeralFiles().finally(() => process.exit(exitCode));
  });
}

function usage() {
  console.log(`用法：
  ./scripts/onboard-native.sh --workspace /绝对路径/到/工作区

选项：
  --without-dispatcher     不配对 Aily，只允许主人直接使用
  --app-name <名称>        设置创建的飞书应用名称
  --timeout-minutes <分钟> 本次等待配对的时间，默认 20
  --no-open                不自动打开浏览器；必须同时使用 --show-pairing-codes
  --show-pairing-codes     在终端显示配对码；只限本人独立终端
  --recover-lock           仅在确认没有安装器运行时恢复意外中断留下的锁
  --help                   显示帮助

App ID、App Secret、主人 ID、群 ID 和 Aily 机器人 ID 都会自动取得，
不会打印到终端。应用凭据保存后，中断再运行同一命令可继续配对。`);
}

function parseArgs(argv) {
  const result = {
    workspace: process.env.WORKSPACE_PATH || "",
    requireDispatcher: true,
    appName: "本地个人 Agent",
    timeoutMs: 20 * 60_000,
    openBrowser: true,
    showPairingCodes: false,
    recoverLock: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help") return { help: true };
    if (arg === "--without-dispatcher") result.requireDispatcher = false;
    else if (arg === "--no-open") result.openBrowser = false;
    else if (arg === "--show-pairing-codes") result.showPairingCodes = true;
    else if (arg === "--recover-lock") result.recoverLock = true;
    else if (["--workspace", "--app-name", "--timeout-minutes"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === "--workspace") result.workspace = value;
      if (arg === "--app-name") result.appName = value;
      if (arg === "--timeout-minutes") {
        const minutes = Number(value);
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
          throw new Error("--timeout-minutes must be an integer from 1 to 120");
        }
        result.timeoutMs = minutes * 60_000;
      }
    } else if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    } else if (!["--without-dispatcher", "--no-open", "--show-pairing-codes", "--recover-lock"].includes(arg)) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (!result.openBrowser && !result.showPairingCodes) {
    throw new Error("--no-open 必须与 --show-pairing-codes 一起使用，并且只限本人独立终端");
  }
  return result;
}

function isInside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function validateWorkspace(value) {
  if (!value || !path.isAbsolute(value)) {
    throw new Error("--workspace must be an absolute path");
  }
  const metadata = await lstat(value);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("--workspace must be a real directory");
  }
  const workspace = await realpath(value);
  const home = path.resolve(os.homedir());
  if (workspace === path.parse(workspace).root || workspace === home) {
    throw new Error("--workspace must not be a filesystem or home root");
  }
  if (isInside(workspace, ROOT_DIR) || isInside(ROOT_DIR, workspace)) {
    throw new Error("--workspace must not expose the installation or private runtime tree");
  }
  return workspace;
}

async function ensurePrivateDirectory(directory) {
  try {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Private runtime path must be a real directory");
    }
    if ((metadata.mode & 0o077) !== 0) {
      throw new Error("Private runtime directory must use mode 700");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(directory, { mode: 0o700 });
  }
  await chmod(directory, 0o700);
}

async function assertPrivateFile(filePath) {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o600) {
    throw new Error("Private onboarding state is not a regular mode-600 file");
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return true;
  }
}

async function recoverStaleLock() {
  if (!(await pathExists(LOCK_PATH))) return;
  await assertPrivateFile(LOCK_PATH);
  let lockState;
  try {
    lockState = JSON.parse(await readFile(LOCK_PATH, "utf8"));
  } catch {
    throw new Error("安装锁格式无效；为避免影响仍在运行的安装器，未自动删除");
  }
  const pid = Number(lockState?.pid);
  if (!Number.isSafeInteger(pid) || pid < 2) {
    throw new Error("安装锁缺少有效进程标识；为避免误删，未自动恢复");
  }
  if (processIsAlive(pid)) {
    throw new Error("检测到安装器仍在运行，拒绝恢复安装锁");
  }
  const stalePath = `${LOCK_PATH}.stale.${randomBytes(8).toString("hex")}`;
  try {
    await rename(LOCK_PATH, stalePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await unlink(stalePath);
}

async function acquireLock({ recover = false } = {}) {
  if (recover) await recoverStaleLock();
  try {
    await atomicPrivateWrite(LOCK_PATH, `${JSON.stringify({
      schemaVersion: 1,
      pid: process.pid,
      startedAt: new Date().toISOString()
    })}\n`, { exclusive: true });
    lockAcquired = true;
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error("已有自动安装进程或遗留锁；确认没有安装器运行后加 --recover-lock 重试");
    }
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function loadPending() {
  if (!(await pathExists(PENDING_PATH))) return null;
  await assertPrivateFile(PENDING_PATH);
  const state = JSON.parse(await readFile(PENDING_PATH, "utf8"));
  if (
    state?.schemaVersion !== 1 ||
    !state.appId ||
    !state.appSecret ||
    !/^ou_[A-Za-z0-9]+$/.test(String(state.registrationOwnerId || "")) ||
    !state.workspace
  ) {
    throw new Error("Private onboarding state is invalid");
  }
  sensitiveValues.add(String(state.appId));
  sensitiveValues.add(String(state.appSecret));
  sensitiveValues.add(String(state.workspace));
  for (const value of [
    state.registrationOwnerId,
    state.ownerId,
    state.executionChatId,
    state.dispatcherId,
    state.dispatcherCandidateId,
    state.dispatcherCandidateMessageId
  ]) {
    if (value) sensitiveValues.add(String(value));
  }
  return state;
}

async function savePending(state) {
  await atomicPrivateWrite(PENDING_PATH, `${JSON.stringify(state)}\n`);
}

function rememberPairingTokens(tokens) {
  for (const value of Object.values(tokens || {})) {
    if (value) sensitiveValues.add(String(value));
  }
  return tokens;
}

function openAuthorizationUrl(url, enabled) {
  if (!enabled) return false;
  const command = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  const child = spawnSync(command[0], command[1], {
    stdio: "ignore",
    windowsHide: true,
    timeout: 10_000
  });
  return child.status === 0;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function showPairingStage(stage, tokens, showCodes) {
  let title;
  let instruction;
  let commands = [];
  if (stage === "owner") {
    title = "选择执行群";
    instruction = "扫码账号已经绑定为主人。把新机器人加入目标执行群，然后由主人本人在该群发送：";
    commands = [{ label: "绑定执行群", value: `@新机器人 绑定执行群 ${tokens.ownerToken}` }];
  }
  if (stage === "owner-mismatch") {
    console.log("收到的用户不是刚才扫码授权的账号，请由同一账号在目标群完成执行群绑定。");
    return;
  }
  if (displayedPairingStage === stage) return;
  if (stage === "dispatcher") {
    title = "绑定 Aily 调度机器人";
    instruction = "主人和执行群已识别。现在让 Aily 在同一个群中发送：";
    commands = [{ label: "Aily 报到", value: `@新机器人 配对调度 ${tokens.dispatcherToken}` }];
  }
  if (stage === "dispatcher-confirmation") {
    title = "主人确认 Aily";
    instruction = "请先核对群里刚发送配对消息的机器人。由主人本人回复 Aily 的那条消息并 @ 新机器人，二选一发送：";
    commands = [
      { label: "确认候选", value: `@新机器人 确认调度 ${tokens.confirmationToken}` },
      { label: "拒绝并重新配对", value: `@新机器人 拒绝调度 ${tokens.rejectionToken}` }
    ];
  }
  if (commands.length === 0) return;
  if (showCodes) {
    console.log(`\n${instruction}`);
    for (const item of commands) console.log(`  ${item.label}：${item.value}`);
    displayedPairingStage = stage;
    return;
  }
  const commandHtml = commands
    .map((item) => `<p><strong>${escapeHtml(item.label)}</strong></p><code>${escapeHtml(item.value)}</code>`)
    .join("");
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:64px auto;padding:0 24px;color:#1f2328}code{display:block;margin-top:20px;padding:18px;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;font-size:18px;overflow-wrap:anywhere}p{line-height:1.7}</style></head>
<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(instruction)}</p>${commandHtml}<p>此页面只存在于本机私有运行目录，完成或退出安装后会删除。只按本页要求发送到本次执行群并 @ 新机器人；不要转发到其他会话、日志或 Issue。</p></body></html>\n`;
  await atomicPrivateWrite(GUIDE_PATH, html);
  const guideUrl = pathToFileURL(GUIDE_PATH);
  guideUrl.searchParams.set("stage", stage);
  const opened = openAuthorizationUrl(guideUrl.toString(), true);
  if (!opened) {
    throw new Error("无法打开本机配对页；请在本人独立终端加 --show-pairing-codes 重新运行");
  }
  displayedPairingStage = stage;
  console.log(`已在本机浏览器显示“${title}”步骤，终端未输出配对码。`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  await ensurePrivateDirectory(RUNTIME_ROOT);
  await ensurePrivateDirectory(RUNTIME_DIR);
  await ensurePrivateDirectory(DATA_DIR);
  await acquireLock({ recover: options.recoverLock });
  if (await pathExists(CONFIG_PATH)) {
    await assertPrivateFile(CONFIG_PATH);
    const existingPending = await loadPending();
    if (existingPending) {
      if (options.workspace) {
        const requestedWorkspace = await validateWorkspace(options.workspace);
        if (requestedWorkspace !== existingPending.workspace) {
          throw new Error("The requested workspace does not match the pending onboarding session");
        }
      }
      const existingConfig = await readFile(CONFIG_PATH, "utf8");
      if (nativeConfigMatchesPending(existingConfig, existingPending)) {
        await unlink(PENDING_PATH);
        console.log("检测到最终配置已写入，已清理中断状态；不会重复创建应用。");
        return;
      }
    }
    throw new Error("Native configuration already exists; onboarding will not overwrite it");
  }

  let pending = await loadPending();
  if (pending) {
    if (options.workspace) {
      const requestedWorkspace = await validateWorkspace(options.workspace);
      if (requestedWorkspace !== pending.workspace) {
        throw new Error("The requested workspace does not match the pending onboarding session");
      }
    }
    console.log("检测到未完成的私有配对状态，将继续上次安装。未读取或显示任何身份值。");
  } else {
    const workspace = await validateWorkspace(options.workspace);
    console.log("即将打开飞书官方授权页。请确认应用名称、机器人能力、权限、事件和卡片回调。");
    const registration = await registerNativeFeishuApp({
      requireDispatcher: options.requireDispatcher,
      appName: options.appName,
      onQRCodeReady: ({ url, expireIn }) => {
        const opened = openAuthorizationUrl(url, options.openBrowser);
        if (opened) {
          console.log(`已打开飞书官方授权页，链接有效期约 ${Math.ceil(expireIn / 60)} 分钟。`);
        } else {
          if (options.openBrowser) {
            throw new Error("无法自动打开飞书授权页；请由本人在独立终端加 --no-open 重新运行");
          }
          console.log(`请在约 ${Math.ceil(expireIn / 60)} 分钟内使用下面的一次性授权链接：`);
          console.log(url);
        }
      },
      onStatusChange: ({ status }) => {
        if (status === "domain_switched") console.log("已切换到当前账号对应的飞书域名。");
      }
    });
    pending = {
      schemaVersion: 1,
      appId: registration.appId,
      appSecret: registration.appSecret,
      registrationOwnerId: registration.registrationOwnerId,
      workspace,
      requireDispatcher: options.requireDispatcher,
      ownerId: registration.registrationOwnerId,
      executionChatId: "",
      dispatcherId: "",
      dispatcherCandidateId: "",
      dispatcherCandidateMessageId: ""
    };
    sensitiveValues.add(String(pending.appId));
    sensitiveValues.add(String(pending.appSecret));
    sensitiveValues.add(String(pending.workspace));
    if (pending.registrationOwnerId) sensitiveValues.add(String(pending.registrationOwnerId));
    await atomicPrivateWrite(PENDING_PATH, `${JSON.stringify(pending)}\n`, { exclusive: true });
    console.log("应用已创建，凭据已写入本机私有状态，终端不会显示凭据或身份 ID。");
  }

  const ownerToken = createPairingToken();
  const dispatcherToken = createPairingToken();
  const confirmationToken = createPairingToken();
  rememberPairingTokens({ ownerToken, dispatcherToken, confirmationToken });
  const identities = await waitForPairing({
    appId: pending.appId,
    appSecret: pending.appSecret,
    registrationOwnerId: pending.registrationOwnerId,
    requireDispatcher: pending.requireDispatcher,
    ownerToken,
    dispatcherToken,
    confirmationToken,
    state: pending,
    timeoutMs: options.timeoutMs,
    onReady: (stage, tokens) => showPairingStage(
      stage,
      rememberPairingTokens(tokens),
      options.showPairingCodes
    ),
    onStage: (stage, tokens) => showPairingStage(
      stage,
      rememberPairingTokens(tokens),
      options.showPairingCodes
    ),
    onPersist: async (snapshot) => {
      pending = { ...pending, ...snapshot };
      await savePending(pending);
    }
  });

  const config = renderNativeConfig({
    appId: pending.appId,
    appSecret: pending.appSecret,
    ownerId: identities.ownerId,
    dispatcherId: identities.dispatcherId,
    executionChatId: identities.executionChatId,
    workspace: pending.workspace,
    dataDir: DATA_DIR
  });
  await atomicPrivateWrite(CONFIG_PATH, config, { exclusive: true });
  await unlink(PENDING_PATH);
  console.log(pending.requireDispatcher
    ? "\n自动安装与配对完成：应用凭据、主人、执行群和调度机器人均已写入严格白名单。"
    : "\n自动安装与配对完成：应用凭据、主人和执行群均已写入严格白名单。");
  console.log("媒体会暂存在目标工作区的 .cc-connect/；若工作区受版本控制，请由主人将它加入该项目自己的忽略规则。");
  console.log("下一步运行 ./scripts/start-native.sh 做前台验证。");
}

main().catch((error) => {
  console.error(`自动安装未完成：${sanitizeDiagnostic(error, sensitiveValues)}`);
  process.exitCode = 1;
}).finally(async () => {
  await cleanupEphemeralFiles();
});
