#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const LOG_FILE = path.join(ROOT_DIR, "runtime", "personal-agent.log");

const categories = [
  ["本地服务控制通道启动失败", /service control channel (?:failed to start|did not become ready)/i],
  ["本地服务控制通道运行中断", /service control channel stopped unexpectedly/i],
  ["服务运行环境缺少 Node、pgrep 或 nc", /service runtime is missing a required command|command not found/i],
  ["本机 cc-connect 二进制类型或权限不安全", /cc-connect binary has an unsafe type or permission mode/i],
  ["运行终端向服务进程组发送了终止信号", /service wrapper received a termination signal/i],
  ["服务包装器进入退出清理", /service wrapper entered exit cleanup/i],
  ["cc-connect 在本机端点就绪前退出", /cc-connect exited before local endpoints became ready/i],
  ["cc-connect 重试后仍未能启动本机端点", /cc-connect exited before local endpoints became ready after retry/i],
  ["cc-connect 本机端点启动超时", /cc-connect local endpoints did not become ready/i],
  ["飞书身份或白名单初始化失败", /startup=failed code=FEISHU_IDENTITY_OR_ALLOWLIST/i],
  ["工作区或状态初始化失败", /startup=failed code=WORKSPACE_OR_STATE/i],
  ["Bridge 初始化失败", /startup=failed code=BRIDGE/i],
  ["配置或私有文件权限初始化失败", /startup=failed code=CONFIG_OR_PERMISSIONS/i],
  ["Connector 网络初始化失败", /startup=failed code=NETWORK/i],
  ["Connector 未分类启动失败", /startup=failed code=UNKNOWN/i],
  ["Connector 进程已退出", /connector process exited with status/i],
  ["Bridge 或飞书长连接未在限定时间内就绪", /startup=failed code=(?:BRIDGE|NETWORK)/i],
  ["飞书长连接运行中断", /runtime=failed code=FEISHU_LONG_CONNECTION/i],
  ["旧版 Connector 私有路径布局不兼容", /private runtime layout/i],
  ["私有文件类型或权限不安全", /must be a regular file|symbolic link|must not be accessible|expected mode 600/i],
  ["缺少必要配置项", /missing configuration value/i],
  ["工作区状态权限错误", /workspace state must use mode 600|permission state must use mode 600/i],
  ["工作区路径或安全根错误", /managed root|search root|workspace path|outside allowed roots|too broad/i],
  ["机器人来源白名单配置不成对", /allowedbotids is required|allowedbotchatids is required/i],
  ["主人白名单为空", /at least one feishu allowed user|alloweduserids is empty/i],
  ["无法解析飞书机器人身份", /unable to resolve feishu bot identity/i],
  ["cc-connect Bridge 尚未就绪", /cc-connect bridge is not ready/i],
  ["本机端点配置不是 loopback", /must use a loopback host|must not contain url credentials|must not contain query parameters/i],
  ["端口已被占用", /address already in use|eaddrinuse/i],
  ["飞书认证或权限失败", /unauthorized|forbidden|invalid.*(?:app|secret|token)|app.*(?:not found|disabled)|permission denied/i],
  ["Bridge 连接失败", /bridge.*(?:disconnected|closed|failed|error)|websocket.*(?:closed|failed|error)/i],
  ["Codex 启动或登录失败", /codex.*(?:not found|login|auth|failed|error|exited)/i],
  ["配置格式错误", /config.*(?:invalid|parse|error)|toml.*(?:parse|invalid)|json.*(?:parse|invalid)/i],
  ["文件权限错误", /operation not permitted|permission denied|eacces/i],
  ["磁盘空间不足", /no space left on device|enospc/i],
  ["网络连接失败", /network|timeout|timed out|connection refused|dns|proxyconnect/i]
];

async function main() {
  const metadata = await lstat(LOG_FILE);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error("private startup log has an unsafe type or permission mode");
  }
  const content = await readFile(LOG_FILE, "utf8");
  const tail = content.slice(-64 * 1024);
  const stages = [...tail.matchAll(/startup-stage=([a-z-]+)/g)].map((match) => match[1]);
  const found = categories.filter(([, pattern]) => pattern.test(tail)).map(([label]) => label);
  console.log(`启动日志状态：${content.trim() ? "有内容" : "空"}`);
  if (stages.length > 0) console.log(`最后安全阶段：${stages.at(-1)}`);
  if (found.length === 0) {
    console.log("诊断分类：未命中已知类别；需由主人在本机私下检查日志原文。");
  } else {
    for (const label of found) console.log(`诊断分类：${label}`);
  }
  console.log("未输出日志原文、飞书 ID、Token 或完整路径。");
}

main().catch((error) => {
  const category = error?.code === "ENOENT" ? "没有可用的私有启动日志" : "私有日志不可安全读取";
  console.error(`启动诊断失败：${category}。`);
  process.exitCode = 1;
});
