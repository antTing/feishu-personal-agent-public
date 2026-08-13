#!/usr/bin/env node

import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const LOG_FILE = path.join(ROOT_DIR, "runtime", "personal-agent.log");
const START_SCRIPT = path.join(SCRIPT_DIR, "start.sh");

const flags = constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW || 0);
const log = await open(LOG_FILE, flags);
try {
  const child = spawn(START_SCRIPT, [], {
    cwd: ROOT_DIR,
    detached: true,
    env: process.env,
    stdio: ["ignore", log.fd, log.fd]
  });
  child.once("error", () => process.exit(1));
  child.unref();
} finally {
  await log.close();
}
