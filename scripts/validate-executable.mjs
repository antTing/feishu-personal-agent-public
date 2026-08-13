#!/usr/bin/env node

import { lstat } from "node:fs/promises";

const filePath = process.argv[2];
if (!filePath) process.exit(1);

try {
  const metadata = await lstat(filePath);
  const ownerExecutable = (metadata.mode & 0o100) !== 0;
  const unsafePermissions = (metadata.mode & 0o077) !== 0;
  if (!metadata.isFile() || metadata.isSymbolicLink() || !ownerExecutable || unsafePermissions) {
    process.exitCode = 1;
  }
} catch {
  process.exitCode = 1;
}
