const DEFAULT_TTL_MS = 24 * 60 * 60_000;
const FEISHU_OPEN_ID = /^ou_[A-Za-z0-9]+$/;

export class ReplyContextStore {
  constructor({ ttlMs = DEFAULT_TTL_MS } = {}) {
    this.ttlMs = ttlMs;
    this.contexts = new Map();
  }

  remember(messageId, { chatType, senderId }) {
    if (!messageId) return;
    this.prune();
    this.contexts.set(messageId, {
      chatType,
      senderId,
      expiresAt: Date.now() + this.ttlMs
    });
  }

  format(messageId, text) {
    this.prune();
    const context = this.contexts.get(messageId);
    if (context?.chatType !== "group" || !FEISHU_OPEN_ID.test(context.senderId || "")) {
      return text;
    }
    return `<at user_id="${context.senderId}"></at> ${text}`;
  }

  forget(messageId) {
    this.contexts.delete(messageId);
  }

  prune(now = Date.now()) {
    for (const [messageId, context] of this.contexts) {
      if (context.expiresAt <= now) this.contexts.delete(messageId);
    }
  }
}
