#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceDir = process.env.CC_SOURCE_DIR;
if (!sourceDir) {
  throw new Error("CC_SOURCE_DIR is required");
}

async function replaceExact(relativePath, before, after) {
  const filePath = path.join(sourceDir, relativePath);
  const source = await readFile(filePath, "utf8");
  const occurrences = source.split(before).length - 1;

  if (occurrences !== 1) {
    throw new Error(`${relativePath}: expected one patch target, found ${occurrences}`);
  }

  await writeFile(filePath, source.replace(before, after));
}

await replaceExact(
  "config/config.go",
  "\t\tif len(proj.Platforms) == 0 && !permissive {",
  "\t\tbridgeEnabled := c.Bridge.Enabled != nil && *c.Bridge.Enabled\n\t\tif len(proj.Platforms) == 0 && !permissive && !bridgeEnabled {"
);

await replaceExact(
  "core/bridge.go",
  '\taddr := fmt.Sprintf(\":%d\", bs.port)',
  '\taddr := fmt.Sprintf(\"127.0.0.1:%d\", bs.port)'
);

await replaceExact(
  "core/bridge.go",
  `\tref := a.server.resolveEngine(m.SessionKey, m.Project)
\tif ref == nil {
\t\tslog.Warn("bridge: no engine for session", "platform", a.platform, "session_key", m.SessionKey, "project", m.Project)
\t\treturn
\t}`,
  `\tref := a.server.resolveEngine(m.SessionKey, m.Project)
\tif ref == nil {
\t\tslog.Warn("bridge: no engine for requested project", "platform", a.platform, "project", m.Project)
\t\t_ = a.server.sendToAdapter(a.platform, map[string]any{
\t\t\t"type": "error", "code": "unknown_project", "msg_id": m.MsgID,
\t\t\t"project": m.Project, "reply_ctx": m.ReplyCtx,
\t\t})
\t\treturn
\t}`
);

await replaceExact(
  "core/management.go",
  '\t\tAddr:    fmt.Sprintf(\":%d\", m.port),',
  '\t\tAddr:    fmt.Sprintf(\"127.0.0.1:%d\", m.port),'
);

await replaceExact(
  "core/bridge.go",
  `func bridgeTransportChatID(sessionKey string) (string, error) {`,
  `func bridgeChatID(sessionKey string) string {
\tparts := strings.SplitN(sessionKey, ":", 3)
\tif len(parts) < 2 {
\t\treturn ""
\t}
\treturn parts[1]
}

func bridgeTransportChatID(sessionKey string) (string, error) {`
);

await replaceExact(
  "core/engine.go",
  `func (e *Engine) sendPermissionPrompt(p Platform, replyCtx any, prompt, toolName, toolInput string) {
\te.hooks.Emit(HookEvent{`,
  `func (e *Engine) sendPermissionPrompt(p Platform, replyCtx any, prompt, toolName, toolInput string) {
\tif bp, ok := p.(*BridgePlatform); ok {
\t\tif rc, ok := replyCtx.(*bridgeReplyCtx); ok {
\t\t\t_ = bp.server.sendToAdapter(rc.Platform, map[string]any{
\t\t\t\t"type": "permission_request", "project": bp.project,
\t\t\t\t"session_key": rc.SessionKey, "reply_ctx": rc.ReplyCtx,
\t\t\t\t"chat_id": bridgeChatID(rc.SessionKey),
\t\t\t\t"tool_name": toolName, "tool_input": toolInput,
\t\t\t})
\t\t\treturn
\t\t}
\t}
\te.hooks.Emit(HookEvent{`
);
