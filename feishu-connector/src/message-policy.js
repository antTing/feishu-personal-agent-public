const BOT_SENDER_TYPES = new Set(["bot", "app", "assistant"]);
const SUPPORTED_MESSAGE_TYPES = new Set(["text", "post", "interactive", "card"]);
const MAX_MESSAGE_LENGTH = 20_000;

function parseContent(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeText(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

function stripSelfMention(text, message, selfBotOpenId) {
  let result = text;
  for (const mention of message.mentions ?? []) {
    if (mention.id?.open_id === selfBotOpenId && mention.key) {
      result = result.replaceAll(mention.key, "");
      if (mention.name) result = result.replaceAll(`@${mention.name}`, "");
    }
  }
  if (selfBotOpenId) result = result.replaceAll(selfBotOpenId, "");
  return result;
}

function unwrapPostLocale(parsed) {
  if (Array.isArray(parsed?.content) || typeof parsed?.title === "string") {
    return parsed;
  }

  for (const locale of ["zh_cn", "en_us", "zh_hk", "zh_tw", "ja_jp"]) {
    if (parsed?.[locale]) return parsed[locale];
  }

  return Object.values(parsed ?? {}).find((value) =>
    value && typeof value === "object" && (Array.isArray(value.content) || typeof value.title === "string")
  );
}

function renderPostElement(element) {
  if (!element || typeof element !== "object") return "";

  switch (element.tag) {
    case "text":
      return element.text ?? "";
    case "a": {
      const label = element.text || element.href || "";
      return element.href && element.href !== label ? `${label} (${element.href})` : label;
    }
    case "at":
      return element.user_id || (element.user_name ? `@${element.user_name}` : "");
    case "img":
      return "[图片]";
    case "media":
      return "[附件]";
    case "code_block":
      return `\n\`\`\`${element.language ?? ""}\n${element.text ?? ""}\n\`\`\`\n`;
    case "hr":
      return "\n---\n";
    default:
      return typeof element.text === "string" ? element.text : "";
  }
}

function extractPost(parsed) {
  const body = unwrapPostLocale(parsed);
  if (!body) return "";

  const lines = [];
  if (body.title) lines.push(body.title);

  for (const paragraph of body.content ?? []) {
    if (!Array.isArray(paragraph)) continue;
    lines.push(paragraph.map(renderPostElement).join(""));
  }

  return lines.join("\n");
}

function addCardText(value, output) {
  if (typeof value === "string" && value.trim()) output.push(value);
}

function walkCard(node, output) {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const child of node) walkCard(child, output);
    return;
  }
  if (typeof node !== "object") return;

  const tag = typeof node.tag === "string" ? node.tag : "";
  if (["plain_text", "lark_md", "markdown"].includes(tag)) {
    addCardText(node.content, output);
    addCardText(node.text, output);
    return;
  }
  if (tag === "text") {
    addCardText(node.text, output);
    addCardText(node.content, output);
    return;
  }
  if (tag === "a") {
    const label = node.text || node.href || node.url;
    const href = node.href || node.url;
    addCardText(href && href !== label ? `${label} (${href})` : label, output);
    return;
  }
  if (tag === "at") {
    addCardText(node.user_id || (node.user_name ? `@${node.user_name}` : ""), output);
    return;
  }

  if (typeof node.content === "string") addCardText(node.content, output);

  if (typeof node.title === "string") addCardText(node.title, output);
  else walkCard(node.title, output);

  if (typeof node.text === "string" && ["div", "button", "note"].includes(tag)) {
    addCardText(node.text, output);
  } else {
    walkCard(node.text, output);
  }

  for (const key of ["header", "body", "elements", "fields", "actions", "columns", "options"]) {
    walkCard(node[key], output);
  }
}

function extractCard(parsed) {
  const pieces = [];
  walkCard(parsed, pieces);

  const unique = [];
  for (const piece of pieces) {
    const normalized = normalizeText(piece);
    if (normalized && unique.at(-1) !== normalized) unique.push(normalized);
  }
  return unique.join("\n");
}

export function normalizeSenderType(senderType) {
  const normalized = String(senderType ?? "").toLowerCase();
  if (normalized === "user") return "user";
  if (BOT_SENDER_TYPES.has(normalized)) return "bot";
  return null;
}

export function hasSelfMention(message, selfBotOpenId) {
  return Boolean(selfBotOpenId) && (message.mentions ?? []).some(
    (mention) => mention.id?.open_id === selfBotOpenId
  );
}

export function authorizeMessage({
  event,
  selfBotOpenId,
  allowedUserIds,
  allowedBotIds,
  allowedBotChatIds,
  allowGroupMessages
}) {
  const message = event?.message;
  const senderId = event?.sender?.sender_id?.open_id;
  const senderType = normalizeSenderType(event?.sender?.sender_type);

  if (!message?.message_id || !message.chat_id || !senderId || !senderType) {
    return { allowed: false, reason: "invalid-event" };
  }
  if (senderId === selfBotOpenId) {
    return { allowed: false, reason: "self-message" };
  }

  if (senderType === "user") {
    if (!allowedUserIds.has(senderId)) {
      return { allowed: false, reason: "user-not-allowed" };
    }
  } else {
    if (message.chat_type === "p2p") {
      return { allowed: false, reason: "bot-p2p-disabled" };
    }
    if (!allowedBotChatIds.has(message.chat_id)) {
      return { allowed: false, reason: "bot-chat-not-allowed" };
    }
    if (allowedBotIds.size === 0 || !allowedBotIds.has(senderId)) {
      return { allowed: false, reason: "bot-not-allowed" };
    }
  }

  if (message.chat_type !== "p2p") {
    if (!allowGroupMessages) {
      return { allowed: false, reason: "group-messages-disabled" };
    }
    if (!hasSelfMention(message, selfBotOpenId)) {
      return { allowed: false, reason: "self-mention-required" };
    }
  }

  return { allowed: true, senderId, senderType };
}

export function extractMessageText(message, selfBotOpenId) {
  if (!SUPPORTED_MESSAGE_TYPES.has(message?.message_type)) return null;
  const parsed = parseContent(message.content);
  if (!parsed) return null;

  let text = "";
  if (message.message_type === "text") text = parsed.text ?? "";
  else if (message.message_type === "post") text = extractPost(parsed);
  else text = extractCard(parsed);

  return normalizeText(stripSelfMention(text, message, selfBotOpenId));
}
