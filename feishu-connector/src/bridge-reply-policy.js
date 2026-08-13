const IDLE_SESSION_RESET = /因空闲超过\s*(\d+)\s*分钟，已自动切换到新会话[。.]?/;

export function classifyBridgeReply(content) {
  const text = String(content || "");
  const idleReset = text.match(IDLE_SESSION_RESET);
  if (idleReset) {
    return {
      final: false,
      content: `已为本次任务启用新 Agent 会话。此前的对话超过 ${idleReset[1]} 分钟未使用；这不是说当前任务已经运行了 ${idleReset[1]} 分钟。`
    };
  }
  return { final: true, content: text };
}
