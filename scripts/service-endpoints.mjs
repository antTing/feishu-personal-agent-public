#!/usr/bin/env node

import { loadConfig } from "../feishu-connector/src/config.js";

const config = await loadConfig();
const bridge = new URL(config.bridge.url);
const management = new URL(config.workspaces.managementUrl);
const values = {
  "bridge-host": bridge.hostname.replace(/^\[|\]$/g, ""),
  "bridge-port": bridge.port || (bridge.protocol === "wss:" ? "443" : "80"),
  "management-host": management.hostname.replace(/^\[|\]$/g, ""),
  "management-port": management.port || (management.protocol === "https:" ? "443" : "80")
};

const key = process.argv[2];
if (!Object.hasOwn(values, key)) {
  console.error("端点读取失败：未知字段。");
  process.exitCode = 1;
} else {
  console.log(values[key]);
}
