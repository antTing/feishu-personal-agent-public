#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isServiceReady, isServiceRecordActive, readServiceRecord } from "./service-state.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const CONFIG_FILE = path.join(ROOT_DIR, "runtime", "feishu-connector", "config.json");

function probe(rawUrl) {
  const target = new URL(rawUrl);
  const host = target.hostname.replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("configured service endpoint is not loopback");
  }
  const port = Number(target.port || (target.protocol === "https:" || target.protocol === "wss:" ? 443 : 80));
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(1_000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function main() {
  const record = await readServiceRecord();
  if (!record) {
    console.log("服务状态：未运行（没有 PID 文件）。");
    process.exitCode = 1;
    return;
  }
  if (!await isServiceRecordActive(record)) {
    console.log("服务状态：未运行（PID 文件已过期）。");
    process.exitCode = 1;
    return;
  }
  if (!await isServiceReady(record)) {
    console.log("服务状态：启动中（Connector 尚未完成端到端就绪握手）。");
    process.exitCode = 1;
    return;
  }

  const config = JSON.parse(await readFile(CONFIG_FILE, "utf8"));
  const [bridgeReady, managementReady] = await Promise.all([
    probe(config.bridge?.url),
    probe(config.workspaces?.managementUrl)
  ]);

  console.log("服务进程：运行中");
  console.log(`Bridge：${bridgeReady ? "已监听" : "未就绪"}`);
  console.log(`Management：${managementReady ? "已监听" : "未就绪"}`);
  if (!bridgeReady || !managementReady) process.exitCode = 1;
}

main().catch((error) => {
  const category = error?.code === "EACCES" || error?.code === "EPERM"
    ? "私有文件权限不足"
    : error?.code === "ENOENT"
      ? "缺少必要的私有运行文件"
      : "本地状态不可用";
  console.error(`状态检查失败：${category}。`);
  process.exitCode = 1;
});
