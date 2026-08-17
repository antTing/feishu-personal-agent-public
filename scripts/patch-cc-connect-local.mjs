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

async function writeNew(relativePath, content) {
  const filePath = path.join(sourceDir, relativePath);
  await writeFile(filePath, content, { flag: "wx" });
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
  "core/message.go",
  `import (
\t"fmt"
\t"log/slog"`,
  `import (
\t"log/slog"`
);

await replaceExact(
  "core/message.go",
  `\t"log/slog"
\t"os"
\t"path/filepath"`,
  `\t"log/slog"
\t"path/filepath"`
);

await replaceExact(
  "core/message.go",
  `func SaveFilesToDisk(workDir string, files []FileAttachment) []string {
\tif len(files) == 0 {
\t\treturn nil
\t}
\tattachDir := filepath.Join(workDir, ".cc-connect", "attachments")
\tif err := os.MkdirAll(attachDir, 0o755); err != nil {
\t\tslog.Warn("SaveFilesToDisk: mkdir failed", "dir", attachDir, "error", err)
\t}

\tvar paths []string
\tfor i, f := range files {
\t\tfname := sanitizeAttachmentFileName(f.FileName)
\t\tif fname == "" {
\t\t\tfname = fmt.Sprintf("file_%d_%d", time.Now().UnixMilli(), i)
\t\t}
\t\tfpath := filepath.Join(attachDir, fname)
\t\tif err := os.WriteFile(fpath, f.Data, 0o644); err != nil {
\t\t\tslog.Error("SaveFilesToDisk: write failed", "error", err)
\t\t\tcontinue
\t\t}
\t\tpaths = append(paths, fpath)
\t\tslog.Debug("SaveFilesToDisk: file saved", "path", fpath, "name", f.FileName, "mime", f.MimeType, "size", len(f.Data))
\t}
\treturn paths
}`,
  `func SaveFilesToDisk(workDir string, files []FileAttachment) []string {
\tif len(files) == 0 {
\t\treturn nil
\t}
\tattachDir, err := PreparePrivateDataDir(workDir, "attachments")
\tif err != nil {
\t\tslog.Warn("SaveFilesToDisk: private attachment directory rejected", "error", err)
\t\treturn nil
\t}

\tpaths := make([]string, 0, len(files))
\tfor _, f := range files {
\t\tfname := sanitizeAttachmentFileName(f.FileName)
\t\tif fname == "" {
\t\t\tfname = "file"
\t\t}
\t\tfname = strings.ReplaceAll(fname, "*", "_")
\t\tfpath, err := WritePrivateTempFile(attachDir, "attachment-*-"+fname, f.Data)
\t\tif err != nil {
\t\t\tslog.Error("SaveFilesToDisk: private file write failed", "error", err)
\t\t\tcontinue
\t\t}
\t\tpaths = append(paths, fpath)
\t\tslog.Debug("SaveFilesToDisk: file saved", "mime", f.MimeType, "size", len(f.Data))
\t}
\treturn paths
}`
);

await replaceExact(
  "agent/codex/appserver_session.go",
  `\t"os/exec"
\t"path/filepath"
\t"sort"`,
  `\t"os/exec"
\t"sort"`
);

await replaceExact(
  "agent/codex/appserver_session.go",
  `func (s *appServerSession) stageImages(prompt string, images []core.ImageAttachment) (string, []string, error) {
\tif len(images) == 0 {
\t\treturn prompt, nil, nil
\t}

\timgDir := filepath.Join(s.workDir, ".cc-connect", "images")
\tif err := os.MkdirAll(imgDir, 0o755); err != nil {
\t\treturn "", nil, fmt.Errorf("codex app-server: create image dir: %w", err)
\t}

\timagePaths := make([]string, 0, len(images))
\tfor i, img := range images {
\t\text := codexImageExt(img.MimeType)
\t\tfname := fmt.Sprintf("img_%d_%d%s", time.Now().UnixMilli(), i, ext)
\t\tfpath := filepath.Join(imgDir, fname)
\t\tif err := os.WriteFile(fpath, img.Data, 0o644); err != nil {
\t\t\treturn "", nil, fmt.Errorf("codex app-server: save image: %w", err)
\t\t}
\t\timagePaths = append(imagePaths, fpath)
\t}

\tif strings.TrimSpace(prompt) == "" {
\t\tprompt = "Please analyze the attached image(s)."
\t}

\treturn prompt, imagePaths, nil
}`,
  `func (s *appServerSession) stageImages(prompt string, images []core.ImageAttachment) (string, []string, error) {
\tif len(images) == 0 {
\t\treturn prompt, nil, nil
\t}

\timgDir, err := core.PreparePrivateDataDir(s.workDir, "images")
\tif err != nil {
\t\treturn "", nil, fmt.Errorf("codex app-server: private image directory rejected: %w", err)
\t}

\timagePaths := make([]string, 0, len(images))
\tfor _, img := range images {
\t\text := codexImageExt(img.MimeType)
\t\tfpath, err := core.WritePrivateTempFile(imgDir, "img_*"+ext, img.Data)
\t\tif err != nil {
\t\t\treturn "", nil, fmt.Errorf("codex app-server: private image write failed: %w", err)
\t\t}
\t\timagePaths = append(imagePaths, fpath)
\t}

\tif strings.TrimSpace(prompt) == "" {
\t\tprompt = "Please analyze the attached image(s)."
\t}

\treturn prompt, imagePaths, nil
}`
);

await replaceExact(
  "config/config.go",
  `\tAdminFrom        string       \`toml:"admin_from,omitempty"\`        // comma-separated user IDs allowed to run privileged commands; "*" = all allowed users
\tUsers            *UsersConfig \`toml:"users,omitempty"\`             // per-user role config; nil = legacy behavior`,
  `\tAdminFrom        string       \`toml:"admin_from,omitempty"\`        // comma-separated user IDs allowed to run privileged commands; "*" = all allowed users
\tApprovalFrom     string       \`toml:"approval_from,omitempty"\`     // comma-separated user IDs allowed to approve or deny tool use; empty = legacy allow-from behavior
\tUsers            *UsersConfig \`toml:"users,omitempty"\`             // per-user role config; nil = legacy behavior`
);

await replaceExact(
  "core/engine.go",
  `\tdisabledCmds map[string]bool
\tadminFrom    string           // comma-separated user IDs for privileged commands; "*" = all allowed users; "" = deny
\tuserRoles    *UserRoleManager // nil = legacy mode (no per-user policies)
\tuserRolesMu  sync.RWMutex     // protects userRoles, disabledCmds, and adminFrom`,
  `\tdisabledCmds  map[string]bool
\tadminFrom     string           // comma-separated user IDs for privileged commands; "*" = all allowed users; "" = deny
\tapprovalFrom  string           // comma-separated tool approvers; empty preserves upstream behavior
\tuserRoles     *UserRoleManager // nil = legacy mode (no per-user policies)
\tuserRolesMu   sync.RWMutex     // protects userRoles, disabledCmds, adminFrom, and approvalFrom`
);

await replaceExact(
  "core/engine.go",
  `}

// privilegedCommands are commands that require admin_from authorization.`,
  `}

// SetApprovalFrom restricts tool allow/deny decisions to explicit user IDs.
// An empty value preserves the upstream behavior for existing installations.
func (e *Engine) SetApprovalFrom(approvalFrom string) {
\te.userRolesMu.Lock()
\te.approvalFrom = strings.TrimSpace(approvalFrom)
\te.userRolesMu.Unlock()
}

func (e *Engine) isPermissionApprover(userID string) bool {
\te.userRolesMu.RLock()
\taf := e.approvalFrom
\te.userRolesMu.RUnlock()
\tif af == "" {
\t\treturn true
\t}
\treturn AllowList(af, userID)
}

func (e *Engine) hasPermissionApprovalPolicy() bool {
\te.userRolesMu.RLock()
\tconfigured := e.approvalFrom != ""
\te.userRolesMu.RUnlock()
\treturn configured
}

// privilegedCommands are commands that require admin_from authorization.`
);

await replaceExact(
  "cmd/cc-connect/main.go",
  `\t\t// Wire admin allowlist for privileged commands
\t\tengine.SetAdminFrom(proj.AdminFrom)

\t\t// Wire per-user role-based policies`,
  `\t\t// Wire admin allowlist for privileged commands
\t\tengine.SetAdminFrom(proj.AdminFrom)
\t\tengine.SetApprovalFrom(proj.ApprovalFrom)

\t\t// Wire per-user role-based policies`
);

await replaceExact(
  "cmd/cc-connect/main.go",
  `\t// Reload admin allowlist
\tengine.SetAdminFrom(proj.AdminFrom)

\t// Reload per-user role-based policies`,
  `\t// Reload admin and tool-approval allowlists
\tengine.SetAdminFrom(proj.AdminFrom)
\tengine.SetApprovalFrom(proj.ApprovalFrom)

\t// Reload per-user role-based policies`
);

await replaceExact(
  "core/engine.go",
  `\tlower := strings.ToLower(strings.TrimSpace(content))

\tif isApproveAllResponse(lower) {`,
  `\tlower := strings.ToLower(strings.TrimSpace(content))

\t// Tool permission decisions are administrative actions. A source bot may
\t// submit and stop work, but it must never approve or deny tools on the
\t// owner's behalf. AskUserQuestion answers are handled above and remain
\t// available to every otherwise-authorized participant in the thread.
\tisPermissionDecision := isApproveAllResponse(lower) || isAllowResponse(lower) || isDenyResponse(lower)
\tif isPermissionDecision && !e.isPermissionApprover(msg.UserID) {
\t\tslog.Warn("permission decision rejected for non-admin user",
\t\t\t"user_id", msg.UserID, "platform", msg.Platform, "project", e.name)
\t\te.reply(p, msg.ReplyCtx, fmt.Sprintf(e.i18n.T(MsgAdminRequired), "tool approval"))
\t\treturn true
\t}
\tif isApproveAllResponse(lower) && e.hasPermissionApprovalPolicy() {
\t\te.reply(p, msg.ReplyCtx, "🔒 当前部署只允许单次工具审批；请使用 allow 或 deny。")
\t\treturn true
\t}

\tif isApproveAllResponse(lower) {`
);

await replaceExact(
  "core/i18n.go",
  `\tMsgPermissionDenied          MsgKey = "permission_denied_msg"
\tMsgPermissionHint            MsgKey = "permission_hint"`,
  `\tMsgPermissionDenied          MsgKey = "permission_denied_msg"
\tMsgPermissionHint            MsgKey = "permission_hint"
\tMsgPermissionHintOneTime     MsgKey = "permission_hint_one_time"`
);

await replaceExact(
  "core/i18n.go",
  `\tMsgPermCardBody    MsgKey = "perm_card_body"
\tMsgPermCardNote    MsgKey = "perm_card_note"`,
  `\tMsgPermCardBody        MsgKey = "perm_card_body"
\tMsgPermCardNote        MsgKey = "perm_card_note"
\tMsgPermCardNoteOneTime MsgKey = "perm_card_note_one_time"`
);

await replaceExact(
  "core/i18n.go",
  `\tMsgPermissionHint: {
\t\tLangEnglish:            "⚠️ Waiting for permission response. Reply **allow** / **deny** / **allow all**.",
\t\tLangChinese:            "⚠️ 等待权限响应。请回复 **允许** / **拒绝** / **允许所有**。",
\t\tLangTraditionalChinese: "⚠️ 等待權限回應。請回覆 **允許** / **拒絕** / **允許所有**。",
\t\tLangJapanese:           "⚠️ 権限の応答を待っています。**allow** / **deny** / **allow all** で返信してください。",
\t\tLangSpanish:            "⚠️ Esperando respuesta de permiso. Responda **allow** / **deny** / **allow all**.",
\t},`,
  `\tMsgPermissionHint: {
\t\tLangEnglish:            "⚠️ Waiting for permission response. Reply **allow** / **deny** / **allow all**.",
\t\tLangChinese:            "⚠️ 等待权限响应。请回复 **允许** / **拒绝** / **允许所有**。",
\t\tLangTraditionalChinese: "⚠️ 等待權限回應。請回覆 **允許** / **拒絕** / **允許所有**。",
\t\tLangJapanese:           "⚠️ 権限の応答を待っています。**allow** / **deny** / **allow all** で返信してください。",
\t\tLangSpanish:            "⚠️ Esperando respuesta de permiso. Responda **allow** / **deny** / **allow all**.",
\t},
\tMsgPermissionHintOneTime: {
\t\tLangEnglish:            "⚠️ Waiting for a one-time permission response. Reply **allow** / **deny**.",
\t\tLangChinese:            "⚠️ 等待本次权限响应。请回复 **允许** / **拒绝**。",
\t\tLangTraditionalChinese: "⚠️ 等待本次權限回應。請回覆 **允許** / **拒絕**。",
\t\tLangJapanese:           "⚠️ 今回の権限応答を待っています。**allow** / **deny** で返信してください。",
\t\tLangSpanish:            "⚠️ Esperando una respuesta de permiso única. Responda **allow** / **deny**.",
\t},`
);

await replaceExact(
  "core/i18n.go",
  `\tMsgPermCardNote: {
\t\tLangEnglish:            "If buttons are unresponsive, reply: allow / deny / allow all",
\t\tLangChinese:            "如果按钮无响应，请直接回复：允许 / 拒绝 / 允许所有",
\t\tLangTraditionalChinese: "若按鈕無回應，請直接回覆：允許 / 拒絕 / 允許所有",
\t\tLangJapanese:           "ボタンが反応しない場合は直接返信: allow / deny / allow all",
\t\tLangSpanish:            "Si los botones no responden, responda: allow / deny / allow all",
\t},`,
  `\tMsgPermCardNote: {
\t\tLangEnglish:            "If buttons are unresponsive, reply: allow / deny / allow all",
\t\tLangChinese:            "如果按钮无响应，请直接回复：允许 / 拒绝 / 允许所有",
\t\tLangTraditionalChinese: "若按鈕無回應，請直接回覆：允許 / 拒絕 / 允許所有",
\t\tLangJapanese:           "ボタンが反応しない場合は直接返信: allow / deny / allow all",
\t\tLangSpanish:            "Si los botones no responden, responda: allow / deny / allow all",
\t},
\tMsgPermCardNoteOneTime: {
\t\tLangEnglish:            "If buttons are unresponsive, reply: allow / deny",
\t\tLangChinese:            "如果按钮无响应，请直接回复：允许 / 拒绝",
\t\tLangTraditionalChinese: "若按鈕無回應，請直接回覆：允許 / 拒絕",
\t\tLangJapanese:           "ボタンが反応しない場合は直接返信: allow / deny",
\t\tLangSpanish:            "Si los botones no responden, responda: allow / deny",
\t},`
);

await replaceExact(
  "core/engine.go",
  `\t} else {
\t\te.reply(p, msg.ReplyCtx, e.i18n.T(MsgPermissionHint))
\t\treturn true
\t}`,
  `\t} else {
\t\thintKey := MsgPermissionHint
\t\tif e.hasPermissionApprovalPolicy() {
\t\t\thintKey = MsgPermissionHintOneTime
\t\t}
\t\te.reply(p, msg.ReplyCtx, e.i18n.T(hintKey))
\t\treturn true
\t}`
);

await replaceExact(
  "core/engine.go",
  `\t\t\t\ttoolInput := truncateIf(event.ToolInput, permLimit)
\t\t\t\tprompt := fmt.Sprintf(e.i18n.T(MsgPermissionPrompt), event.ToolName, toolInput)
\t\t\t\te.sendPermissionPrompt(p, replyCtx, prompt, event.ToolName, toolInput)`,
  `\t\t\t\ttoolInput := truncateIf(event.ToolInput, permLimit)
\t\t\t\tprompt := fmt.Sprintf(e.i18n.T(MsgPermissionPrompt), event.ToolName, toolInput)
\t\t\t\tif e.hasPermissionApprovalPolicy() {
\t\t\t\t\tprompt = fmt.Sprintf(e.i18n.T(MsgPermCardBody), event.ToolName, toolInput) +
\t\t\t\t\t\t"\\n\\n" + e.i18n.T(MsgPermissionHintOneTime)
\t\t\t\t}
\t\t\t\te.sendPermissionPrompt(p, replyCtx, prompt, event.ToolName, toolInput)`
);

await replaceExact(
  "core/engine.go",
  `\t\tbuttons := [][]ButtonOption{
\t\t\t{
\t\t\t\t{Text: e.i18n.T(MsgPermBtnAllow), Data: "perm:allow"},
\t\t\t\t{Text: e.i18n.T(MsgPermBtnDeny), Data: "perm:deny"},
\t\t\t},
\t\t\t{
\t\t\t\t{Text: e.i18n.T(MsgPermBtnAllowAll), Data: "perm:allow_all"},
\t\t\t},
\t\t}`,
  `\t\tbuttons := [][]ButtonOption{
\t\t\t{
\t\t\t\t{Text: e.i18n.T(MsgPermBtnAllow), Data: "perm:allow"},
\t\t\t\t{Text: e.i18n.T(MsgPermBtnDeny), Data: "perm:deny"},
\t\t\t},
\t\t}
\t\tif !e.hasPermissionApprovalPolicy() {
\t\t\tbuttons = append(buttons, []ButtonOption{{
\t\t\t\tText: e.i18n.T(MsgPermBtnAllowAll), Data: "perm:allow_all",
\t\t\t}})
\t\t}`
);

await replaceExact(
  "core/engine.go",
  `\t\tcard := NewCard().
\t\t\tTitle(e.i18n.T(MsgPermCardTitle), "orange").
\t\t\tMarkdown(body).
\t\t\tButtonsEqual(allowBtn, denyBtn).
\t\t\tButtons(allowAllBtn).
\t\t\tNote(e.i18n.T(MsgPermCardNote)).
\t\t\tBuild()
\t\te.sendWithCard(p, replyCtx, card)`,
  `\t\tcardBuilder := NewCard().
\t\t\tTitle(e.i18n.T(MsgPermCardTitle), "orange").
\t\t\tMarkdown(body).
\t\t\tButtonsEqual(allowBtn, denyBtn)
\t\tnoteKey := MsgPermCardNote
\t\tif e.hasPermissionApprovalPolicy() {
\t\t\tnoteKey = MsgPermCardNoteOneTime
\t\t} else {
\t\t\tcardBuilder.Buttons(allowAllBtn)
\t\t}
\t\tcard := cardBuilder.Note(e.i18n.T(noteKey)).Build()
\t\te.sendWithCard(p, replyCtx, card)`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `type replyContext struct {
\tmessageID  string
\tchatID     string
\tsessionKey string
}`,
  `type replyContext struct {
\tmessageID  string
\tchatID     string
\tsessionKey string
\tsenderID   string
\tsenderName string
\tisGroup    bool
}`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\tallowFrom                  string
\tallowChat                  string`,
  `\tallowFrom                  string
\tapprovalFrom               string
\tallowChat                  string`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\t// noReplyToTrigger: when true, send via Create instead of Im.Message.Reply (no quote to the user's message).
\tnoReplyToTrigger bool
\tresolveMentions  bool`,
  `\t// noReplyToTrigger: when true, send via Create instead of Im.Message.Reply (no quote to the user's message).
\tnoReplyToTrigger      bool
\tmentionTriggerSender bool
\tresolveMentions       bool`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `func (p *Platform) getBotOpenID() string {
\tp.mu.RLock()
\tdefer p.mu.RUnlock()
\treturn p.botOpenID
}`,
  `func (p *Platform) getBotOpenID() string {
\tp.mu.RLock()
\tdefer p.mu.RUnlock()
\treturn p.botOpenID
}

func (p *Platform) isCardActorAllowed(userID string) bool {
\treturn core.AllowList(p.allowFrom, userID)
}

func (p *Platform) isPermissionActorAllowed(userID string) bool {
\treturn p.isCardActorAllowed(userID) && core.AllowList(p.approvalFrom, userID)
}

func (p *Platform) allowsPersistentToolApproval() bool {
\treturn strings.TrimSpace(p.approvalFrom) == ""
}

func (p *Platform) replySenderMention(rc replyContext) string {
\tif !p.mentionTriggerSender || !rc.isGroup || strings.TrimSpace(rc.senderID) == "" {
\t\treturn ""
\t}
\tif botID := p.getBotOpenID(); botID != "" && rc.senderID == botID {
\t\treturn ""
\t}
\tname := strings.TrimSpace(rc.senderName)
\tif name == "" {
\t\tname = "任务发起者"
\t}
\treturn fmt.Sprintf("<at user_id=\\\"%s\\\">%s</at>", html.EscapeString(rc.senderID), html.EscapeString(name))
}

func (p *Platform) replySenderCardMention(rc replyContext) string {
\tif p.replySenderMention(rc) == "" {
\t\treturn ""
\t}
\treturn fmt.Sprintf("<at id=%s></at>", html.EscapeString(rc.senderID))
}

func (p *Platform) prefixReplySender(rc replyContext, content string) string {
\tmention := p.replySenderMention(rc)
\tif mention == "" || strings.Contains(content, mention) {
\t\treturn content
\t}
\tif strings.TrimSpace(content) == "" {
\t\treturn mention
\t}
\treturn mention + "\\n" + content
}

func (p *Platform) buildReplyContentWithSender(ctx context.Context, rc replyContext, content string) (string, string) {
\tcontent = p.resolveMentionsInContent(ctx, rc.chatID, content)
\tmsgType, msgBody := buildReplyContent(content)
\tif msgType == larkim.MsgTypeInteractive {
\t\treturn msgType, prependMentionToCardJSON(msgBody, p.replySenderCardMention(rc))
\t}
\tcontent = p.prefixReplySender(rc, content)
\treturn buildReplyContent(content)
}

func (p *Platform) buildStatusFooterCardWithSender(ctx context.Context, rc replyContext, content, footer string) string {
\tcontent = p.resolveMentionsInContent(ctx, rc.chatID, content)
\tprocessedBody := sanitizeMarkdownURLs(preprocessFeishuMarkdown(content))
\tprocessedFooter := sanitizeMarkdownURLs(preprocessFeishuMarkdown(footer))
\tcardJSON := buildCardJSONWithStatusFooter(processedBody, processedFooter)
\treturn prependMentionToCardJSON(cardJSON, p.replySenderCardMention(rc))
}

func prependMentionToCardJSON(cardJSON, mention string) string {
\tif mention == "" {
\t\treturn cardJSON
\t}
\tvar card map[string]any
\tif err := json.Unmarshal([]byte(cardJSON), &card); err != nil {
\t\treturn cardJSON
\t}
\ttarget := card
\tif body, ok := card["body"].(map[string]any); ok {
\t\ttarget = body
\t}
\telements, _ := target["elements"].([]any)
\tfor _, raw := range elements {
\t\tif element, ok := raw.(map[string]any); ok {
\t\t\tif content, _ := element["content"].(string); content == mention {
\t\t\t\treturn cardJSON
\t\t\t}
\t\t}
\t}
\tmentionElement := map[string]any{"tag": "markdown", "content": mention}
\ttarget["elements"] = append([]any{mentionElement}, elements...)
\tencoded, err := json.Marshal(card)
\tif err != nil {
\t\treturn cardJSON
\t}
\treturn string(encoded)
}`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\tallowFrom, _ := opts["allow_from"].(string)
\tcore.CheckAllowFrom(name, allowFrom)
\tallowChat, _ := opts["allow_chat"].(string)`,
  `\tallowFrom, _ := opts["allow_from"].(string)
\tcore.CheckAllowFrom(name, allowFrom)
\tapprovalFrom, _ := opts["approval_from"].(string)
\tallowChat, _ := opts["allow_chat"].(string)`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\tthreadIsolation, _ := opts["thread_isolation"].(bool)
\tresolveMentionsOpt, _ := opts["resolve_mentions"].(bool)`,
  `\tthreadIsolation, _ := opts["thread_isolation"].(bool)
\tmentionTriggerSender, _ := opts["mention_trigger_sender"].(bool)
\tresolveMentionsOpt, _ := opts["resolve_mentions"].(bool)`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\t\tallowFrom:                  allowFrom,
\t\tallowChat:                  allowChat,`,
  `\t\tallowFrom:                  allowFrom,
\t\tapprovalFrom:               approvalFrom,
\t\tallowChat:                  allowChat,`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\t\tthreadIsolation:            threadIsolation,
\t\tresolveMentions:            resolveMentionsOpt,`,
  `\t\tthreadIsolation:            threadIsolation,
\t\tmentionTriggerSender:       mentionTriggerSender,
\t\tresolveMentions:            resolveMentionsOpt,`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\tuserID := ""
\tif event.Event.Operator != nil {
\t\tuserID = event.Event.Operator.OpenID
\t}
\tchatID := ""`,
  `\tuserID := ""
\tif event.Event.Operator != nil {
\t\tuserID = event.Event.Operator.OpenID
\t}
\tif !p.isCardActorAllowed(userID) {
\t\treturn &callback.CardActionTriggerResponse{Toast: &callback.Toast{
\t\t\tType: "error", Content: "当前身份无权操作此卡片 / Unauthorized card action",
\t\t}}, nil
\t}
\tchatID := ""`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\tsessionKey := p.sessionKeyFromCardAction(chatID, userID, event.Event.Action.Value)

\t// nav: / act: — synchronous card update`,
  `\tsessionKey := p.sessionKeyFromCardAction(chatID, userID, event.Event.Action.Value)
\tactorName := p.resolveUserName(userID)
\tactorIsGroup := strings.HasPrefix(chatID, "oc_")

\t// nav: / act: — synchronous card update`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\t\trctx := replyContext{messageID: messageID, chatID: chatID, sessionKey: sessionKey}
\t\th := p.getHandler()
\t\tgo h(p.dispatchPlatform(), &core.Message{
\t\t\tSessionKey:           sessionKey,`,
  `\t\trctx := replyContext{messageID: messageID, chatID: chatID, sessionKey: sessionKey,
\t\t\tsenderID: userID, senderName: actorName, isGroup: actorIsGroup}
\t\th := p.getHandler()
\t\tgo h(p.dispatchPlatform(), &core.Message{
\t\t\tSessionKey:           sessionKey,`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\t// askq: — AskUserQuestion option selected, forward as user message
\tif strings.HasPrefix(actionVal, "askq:") {
\t\trctx := replyContext{messageID: messageID, chatID: chatID, sessionKey: sessionKey}
\t\th := p.getHandler()
\t\tgo h(p.dispatchPlatform(), &core.Message{
\t\t\tSessionKey: sessionKey,`,
  `\t// askq: — AskUserQuestion option selected, forward as user message
\tif strings.HasPrefix(actionVal, "askq:") {
\t\trctx := replyContext{messageID: messageID, chatID: chatID, sessionKey: sessionKey,
\t\t\tsenderID: userID, senderName: actorName, isGroup: actorIsGroup}
\t\th := p.getHandler()
\t\tgo h(p.dispatchPlatform(), &core.Message{
\t\t\tSessionKey: sessionKey,`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\t\tcmdText := strings.TrimPrefix(actionVal, "cmd:")
\t\trctx := replyContext{messageID: messageID, chatID: chatID, sessionKey: sessionKey}`, 
  `\t\tcmdText := strings.TrimPrefix(actionVal, "cmd:")
\t\trctx := replyContext{messageID: messageID, chatID: chatID, sessionKey: sessionKey,
\t\t\tsenderID: userID, senderName: actorName, isGroup: actorIsGroup}`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\tparentID := stringValue(msg.ParentId)

\trctx := replyContext{messageID: messageID, chatID: chatID, sessionKey: sessionKey}`,
  `\tparentID := stringValue(msg.ParentId)

\trctx := replyContext{messageID: messageID, chatID: chatID, sessionKey: sessionKey,
\t\tsenderID: userID, isGroup: chatType == "group"}`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\tif userID != "" {
\t\tuserName = p.resolveUserName(userID)
\t}
\tchatName := p.resolveChatName(chatID)`,
  `\tif userID != "" {
\t\tuserName = p.resolveUserName(userID)
\t}
\trctx.senderName = userName
\tchatName := p.resolveChatName(chatID)`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\t// perm: — permission response with in-place card update
\tif strings.HasPrefix(actionVal, "perm:") {
\t\tvar responseText string`,
  `\t// perm: — permission response with in-place card update
\tif strings.HasPrefix(actionVal, "perm:") {
\t\tif !p.isPermissionActorAllowed(userID) {
\t\t\treturn &callback.CardActionTriggerResponse{Toast: &callback.Toast{
\t\t\t\tType: "error", Content: "只有主人可以处理工具审批 / Owner approval required",
\t\t\t}}, nil
\t\t}
\t\tif actionVal == "perm:allow_all" && !p.allowsPersistentToolApproval() {
\t\t\treturn &callback.CardActionTriggerResponse{Toast: &callback.Toast{
\t\t\t\tType: "error", Content: "当前部署只允许单次工具审批 / One-time approval only",
\t\t\t}}, nil
\t\t}
\t\tvar responseText string`
);

await replaceExact(
  "core/engine.go",
  `// handleCardNav is called by platforms that support in-place card updates.
// It routes nav: and act: prefixed actions to the appropriate render function.
func (e *Engine) handleCardNav(action string, sessionKey string) *Card {`,
  `func canonicalCardCommandID(cmd string) string {
\tnormalized := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(cmd)), "/")
\tif i := strings.IndexByte(normalized, '/'); i >= 0 {
\t\tnormalized = normalized[:i]
\t}
\tif normalized == "delete-mode" {
\t\tnormalized = "delete"
\t}
\treturn matchPrefix(normalized, builtinCommands)
}

func (e *Engine) isCardCommandDisabled(cmd string) bool {
\tcmdID := canonicalCardCommandID(cmd)
\tif cmdID == "" {
\t\treturn false
\t}
\te.userRolesMu.RLock()
\tdisabled := e.disabledCmds[cmdID]
\te.userRolesMu.RUnlock()
\treturn disabled
}

// handleCardNav is called by platforms that support in-place card updates.
// It routes nav: and act: prefixed actions to the appropriate render function.
func (e *Engine) handleCardNav(action string, sessionKey string) *Card {`
);

await replaceExact(
  "core/engine.go",
  `\tif i := strings.IndexByte(body, ' '); i >= 0 {
\t\tcmd = body[:i]
\t\targs = strings.TrimSpace(body[i+1:])
\t}

\tif prefix == "act" && cmd == "/model" {`,
  `\tif i := strings.IndexByte(body, ' '); i >= 0 {
\t\tcmd = body[:i]
\t\targs = strings.TrimSpace(body[i+1:])
\t}

\tif e.isCardCommandDisabled(cmd) {
\t\tcmdID := canonicalCardCommandID(cmd)
\t\treturn e.simpleCard(e.i18n.T(MsgHelpTitle), "red",
\t\t\tfmt.Sprintf(e.i18n.T(MsgCommandDisabled), "/"+cmdID))
\t}

\tif prefix == "act" && cmd == "/model" {`
);

await replaceExact(
  "core/engine.go",
  `\tfor _, item := range current.items {
\t\tcb.ListItem(commandText(item.command), "▶", item.action)
\t}`,
  `\tfor _, item := range current.items {
\t\tif e.isCardCommandDisabled(item.command) {
\t\t\tcontinue
\t\t}
\t\tcb.ListItem(commandText(item.command), "▶", item.action)
\t}`
);

await replaceExact(
  "core/engine.go",
  `\tcase "/stop":
\t\treturn e.renderStatusCard(sessionKey, extractUserID(sessionKey))`,
  `\tcase "/stop":
\t\treturn e.simpleCard(e.i18n.T(MsgExecutionStopped), "green", e.i18n.T(MsgExecutionStopped))`
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

await replaceExact(
  "platform/feishu/feishu.go",
  `\tcontent = p.resolveMentionsInContent(ctx, rc.chatID, content)
\tmsgType, msgBody := buildReplyContent(content)

\tif !p.shouldUseThreadOrReplyAPI(rc) {`,
  `\tmsgType, msgBody := p.buildReplyContentWithSender(ctx, rc, content)

\tif !p.shouldUseThreadOrReplyAPI(rc) {`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\tif p.shouldUseThreadOrReplyAPI(rc) {
\t\treturn p.Reply(ctx, rctx, content)
\t}

\tcontent = p.resolveMentionsInContent(ctx, rc.chatID, content)
\tmsgType, msgBody := buildReplyContent(content)
\treturn p.sendNewMessageToChat(ctx, rc, msgType, msgBody)`,
  `\tif p.shouldUseThreadOrReplyAPI(rc) {
\t\treturn p.Reply(ctx, rctx, content)
\t}

\tmsgType, msgBody := p.buildReplyContentWithSender(ctx, rc, content)
\treturn p.sendNewMessageToChat(ctx, rc, msgType, msgBody)`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `func (p *Platform) SendWithStatusFooter(ctx context.Context, rctx any, content, footer string) error {
\tif strings.TrimSpace(footer) == "" {
\t\treturn p.Send(ctx, rctx, content)
\t}
\trc, ok := rctx.(replyContext)
\tif !ok {
\t\treturn fmt.Errorf("%s: invalid reply context type %T", p.tag(), rctx)
\t}
\tcontent = p.resolveMentionsInContent(ctx, rc.chatID, content)
\tprocessedBody := sanitizeMarkdownURLs(preprocessFeishuMarkdown(content))
\tprocessedFooter := sanitizeMarkdownURLs(preprocessFeishuMarkdown(footer))
\tcardJSON := buildCardJSONWithStatusFooter(processedBody, processedFooter)`,
  `func (p *Platform) SendWithStatusFooter(ctx context.Context, rctx any, content, footer string) error {
\tif strings.TrimSpace(footer) == "" {
\t\treturn p.Send(ctx, rctx, content)
\t}
\trc, ok := rctx.(replyContext)
\tif !ok {
\t\treturn fmt.Errorf("%s: invalid reply context type %T", p.tag(), rctx)
\t}
\tcardJSON := p.buildStatusFooterCardWithSender(ctx, rc, content, footer)`
);

await replaceExact(
  "platform/feishu/card.go",
  `func plainText(content string) map[string]any {
\treturn map[string]any{"tag": "plain_text", "content": content}
}`,
  `func plainText(content string) map[string]any {
\treturn map[string]any{"tag": "plain_text", "content": content}
}

func cardWithReplySenderMention(card *core.Card, mention string) *core.Card {
\tif card == nil || mention == "" {
\t\treturn card
\t}
\tcopyCard := *card
\tcopyCard.Elements = append([]core.CardElement{core.CardMarkdown{Content: mention}}, card.Elements...)
\treturn &copyCard
}`
);

await replaceExact(
  "platform/feishu/card.go",
  `\tcardJSON := renderCard(card, rc.sessionKey)
\tif !p.shouldUseThreadOrReplyAPI(rc) {`,
  `\tcard = cardWithReplySenderMention(card, p.replySenderCardMention(rc))
\tcardJSON := renderCard(card, rc.sessionKey)
\tif !p.shouldUseThreadOrReplyAPI(rc) {`
);

await replaceExact(
  "platform/feishu/card.go",
  `\tcardJSON := renderCard(card, rc.sessionKey)
\treturn p.createMessage(ctx, rc.chatID, larkim.MsgTypeInteractive, cardJSON, "send card")`,
  `\tcard = cardWithReplySenderMention(card, p.replySenderCardMention(rc))
\tcardJSON := renderCard(card, rc.sessionKey)
\treturn p.createMessage(ctx, rc.chatID, larkim.MsgTypeInteractive, cardJSON, "send card")`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\tstatus      core.CardStatus
\tlastContent string
}`,
  `\tstatus      core.CardStatus
\tlastContent string
\tmention     string
}`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\tvar cardJSON string
\tvar sendContent string // what goes into the Im.Message.Create / Reply content field
\tvar cardID string      // cardkit-v1 entity id (empty = no streaming text path)
\tif isCardJSON(content) {
\t\tcardJSON = content`,
  `\tvar cardJSON string
\tvar sendContent string // what goes into the Im.Message.Create / Reply content field
\tvar cardID string      // cardkit-v1 entity id (empty = no streaming text path)
\tmention := p.replySenderCardMention(rc)
\tif isCardJSON(content) {
\t\tcardJSON = prependMentionToCardJSON(content, mention)`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\t} else {
\t\tcardJSON = buildPreviewCardJSON(content)
\t\tsendContent = cardJSON
\t}

\tvar msgID string`,
  `\t} else {
\t\tcardJSON = prependMentionToCardJSON(buildPreviewCardJSON(content), mention)
\t\tsendContent = cardJSON
\t}

\tvar msgID string`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\treturn &feishuPreviewHandle{messageID: msgID, chatID: chatID, cardID: cardID}, nil`,
  `\treturn &feishuPreviewHandle{messageID: msgID, chatID: chatID, cardID: cardID, mention: mention}, nil`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\t}
\t// Route card-entity-bound messages to cardkit-v1 full-card update API.`,
  `\t}
\tcardJSON = prependMentionToCardJSON(cardJSON, h.mention)
\t// Route card-entity-bound messages to cardkit-v1 full-card update API.`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\tcardJSON := buildCardJSONWithStatusFooter(processedBody, processedFooter)
\t// Same card-entity routing as UpdateMessage above.`,
  `\tcardJSON := buildCardJSONWithStatusFooter(processedBody, processedFooter)
\tcardJSON = prependMentionToCardJSON(cardJSON, h.mention)
\t// Same card-entity routing as UpdateMessage above.`
);

await replaceExact(
  "platform/feishu/feishu.go",
  `\tcardJSON := buildCardJSONWithStatus(lastContent, status)

\tctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)`,
  `\tcardJSON := buildCardJSONWithStatus(lastContent, status)
\tcardJSON = prependMentionToCardJSON(cardJSON, h.mention)

\tctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)`
);

await writeNew(
  "core/local_approval_patch_test.go",
  `package core

import (
\t"strings"
\t"testing"
)

func localApprovalState(session AgentSession) (*interactiveState, *pendingPermission) {
\tpending := &pendingPermission{
\t\tRequestID: "local-approval-request",
\t\tToolInput: map[string]any{"path": "example.txt"},
\t\tResolved:  make(chan struct{}),
\t}
\treturn &interactiveState{agentSession: session, pending: pending}, pending
}

func TestLocalPatchPermissionDecisionsRequireConfiguredApprover(t *testing.T) {
\tfor _, decision := range []string{"allow", "deny", "allow all"} {
\t\tt.Run(decision, func(t *testing.T) {
\t\t\te := newTestEngine()
\t\t\te.SetApprovalFrom("owner-user")
\t\t\trec := &recordingAgentSession{}
\t\t\tstate, pending := localApprovalState(rec)
\t\t\te.interactiveStates["test:chat:root"] = state
\t\t\tmsg := &Message{SessionKey: "test:chat:root", UserID: "source-bot", ReplyCtx: "ctx"}

\t\t\tif !e.handlePendingPermission(&stubPlatformEngine{n: "test"}, msg, decision, "") {
\t\t\t\tt.Fatal("permission decision was not handled")
\t\t\t}
\t\t\tif rec.calls != 0 {
\t\t\t\tt.Fatalf("non-approver reached RespondPermission: %d calls", rec.calls)
\t\t\t}
\t\t\tstate.mu.Lock()
\t\t\tstillPending := state.pending == pending
\t\t\tapproveAll := state.approveAll
\t\t\tstate.mu.Unlock()
\t\t\tif !stillPending || approveAll {
\t\t\t\tt.Fatal("rejected decision changed pending approval state")
\t\t\t}
\t\t\tselect {
\t\t\tcase <-pending.Resolved:
\t\t\t\tt.Fatal("rejected decision resolved the pending request")
\t\t\tdefault:
\t\t\t}
\t\t})
\t}
}

func TestLocalPatchConfiguredApproverCanResolve(t *testing.T) {
\te := newTestEngine()
\te.SetApprovalFrom("owner-user")
\trec := &recordingAgentSession{}
\tstate, pending := localApprovalState(rec)
\te.interactiveStates["test:chat:root"] = state
\tmsg := &Message{SessionKey: "test:chat:root", UserID: "owner-user", ReplyCtx: "ctx"}

\tif !e.handlePendingPermission(&stubPlatformEngine{n: "test"}, msg, "allow", "") {
\t\tt.Fatal("owner decision was not handled")
\t}
\tif rec.calls != 1 || rec.lastResult.Behavior != "allow" {
\t\tt.Fatalf("owner decision was not forwarded: calls=%d behavior=%q", rec.calls, rec.lastResult.Behavior)
\t}
\tselect {
\tcase <-pending.Resolved:
\tdefault:
\t\tt.Fatal("owner decision did not resolve the pending request")
\t}
}

func TestLocalPatchPersistentApprovalIsDisabledWhenPolicyConfigured(t *testing.T) {
\te := newTestEngine()
\te.SetApprovalFrom("owner-user")
\trec := &recordingAgentSession{}
\tstate, pending := localApprovalState(rec)
\te.interactiveStates["test:chat:root"] = state
\tmsg := &Message{SessionKey: "test:chat:root", UserID: "owner-user", ReplyCtx: "ctx"}

\tif !e.handlePendingPermission(&stubPlatformEngine{n: "test"}, msg, "allow all", "") {
\t\tt.Fatal("persistent approval decision was not handled")
\t}
\tif rec.calls != 0 {
\t\tt.Fatal("persistent approval reached RespondPermission")
\t}
\tstate.mu.Lock()
\tstillPending := state.pending == pending
\tapproveAll := state.approveAll
\tstate.mu.Unlock()
\tif !stillPending || approveAll {
\t\tt.Fatal("persistent approval changed pending state")
\t}
}

func TestLocalPatchOneTimePermissionPromptHidesPersistentApproval(t *testing.T) {
\te := newTestEngine()
\te.SetApprovalFrom("owner-user")
\tp := &stubCardPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}}
\te.sendPermissionPrompt(p, "ctx", "legacy prompt", "Bash", "example command")
\tif len(p.sentCards) != 1 {
\t\tt.Fatalf("sent cards = %d, want 1", len(p.sentCards))
\t}
\tcard := p.sentCards[0]
\tfor _, row := range card.CollectButtons() {
\t\tfor _, button := range row {
\t\t\tif button.Data == "perm:allow_all" {
\t\t\t\tt.Fatal("one-time permission policy exposed allow-all button")
\t\t\t}
\t\t}
\t}
\trendered := strings.ToLower(card.RenderText())
\tif strings.Contains(rendered, "allow all") || strings.Contains(rendered, "允许所有") {
\t\tt.Fatalf("one-time permission card advertised persistent approval: %q", rendered)
\t}
}

func TestLocalPatchLegacyPermissionPromptKeepsUpstreamBehavior(t *testing.T) {
\te := newTestEngine()
\tp := &stubCardPlatform{stubPlatformEngine: stubPlatformEngine{n: "feishu"}}
\te.sendPermissionPrompt(p, "ctx", "legacy prompt", "Bash", "example command")
\tif len(p.sentCards) != 1 {
\t\tt.Fatalf("sent cards = %d, want 1", len(p.sentCards))
\t}
\tfor _, row := range p.sentCards[0].CollectButtons() {
\t\tfor _, button := range row {
\t\t\tif button.Data == "perm:allow_all" {
\t\t\t\treturn
\t\t\t}
\t\t}
\t}
\tt.Fatal("empty approval_from should preserve the upstream allow-all button")
}

func TestLocalPatchInvalidPermissionReplyUsesOneTimeHint(t *testing.T) {
\te := newTestEngine()
\te.SetApprovalFrom("owner-user")
\trec := &recordingAgentSession{}
\tstate, pending := localApprovalState(rec)
\te.interactiveStates["test:chat:root"] = state
\tp := &stubPlatformEngine{n: "test"}
\tmsg := &Message{SessionKey: "test:chat:root", UserID: "owner-user", ReplyCtx: "ctx"}

\tif !e.handlePendingPermission(p, msg, "please stop this task", "") {
\t\tt.Fatal("invalid permission reply was not handled")
\t}
\tif got := p.getSent(); len(got) != 1 || got[0] != e.i18n.T(MsgPermissionHintOneTime) {
\t\tt.Fatalf("permission hint = %#v, want one-time hint", got)
\t}
\tstate.mu.Lock()
\tstillPending := state.pending == pending
\tstate.mu.Unlock()
\tif !stillPending || rec.calls != 0 {
\t\tt.Fatal("invalid permission reply changed the pending request")
\t}
}

func TestLocalPatchSlashStopResolvesPendingPermission(t *testing.T) {
\te := newTestEngine()
\te.SetApprovalFrom("owner-user")
\tsessionKey := "test:chat:root"
\trec := &recordingAgentSession{}
\tstate, pending := localApprovalState(rec)
\te.interactiveStates[sessionKey] = state
\tp := &stubPlatformEngine{n: "test"}
\tmsg := &Message{
\t\tSessionKey: sessionKey,
\t\tUserID:     "source-bot",
\t\tReplyCtx:   "ctx",
\t\tContent:    "/stop",
\t}

\te.handleMessage(p, msg)
\tselect {
\tcase <-pending.Resolved:
\tdefault:
\t\tt.Fatal("slash stop did not resolve the pending permission")
\t}
\te.interactiveMu.Lock()
\t_, stillRunning := e.interactiveStates[sessionKey]
\te.interactiveMu.Unlock()
\tif stillRunning {
\t\tt.Fatal("slash stop left the interactive session running")
\t}
\twant := e.i18n.T(MsgExecutionStopped)
\tif got := p.getSent(); len(got) == 0 || got[len(got)-1] != want {
\t\tt.Fatalf("stop reply = %#v, want %q", got, want)
\t}
}

func TestLocalPatchEmptyApprovalFromPreservesLegacyBehavior(t *testing.T) {
\te := newTestEngine()
\trec := &recordingAgentSession{}
\tstate, _ := localApprovalState(rec)
\te.interactiveStates["test:chat:root"] = state
\tmsg := &Message{SessionKey: "test:chat:root", UserID: "any-allowed-user", ReplyCtx: "ctx"}
\te.handlePendingPermission(&stubPlatformEngine{n: "test"}, msg, "allow", "")
\tif rec.calls != 1 {
\t\tt.Fatalf("empty approval_from should preserve legacy behavior, got %d calls", rec.calls)
\t}
}
`
);

// cc-connect v1.4.1 defaults the App Server URL to WebSocket while its
// session implementation still exchanges JSON-RPC over stdio. Keep the
// default transport aligned with the implementation so a config containing
// only backend="app_server" can actually initialize a session.
await replaceExact(
  "agent/codex/codex.go",
  `func normalizeAppServerURL(raw string) string {
	url := strings.TrimSpace(raw)
	if url == "" {
		return "ws://127.0.0.1:3845"
	}
	if strings.EqualFold(url, "stdio") {
		return "stdio://"
	}
	return url
}`,
  `func normalizeAppServerURL(raw string) string {
	url := strings.TrimSpace(raw)
	if url == "" {
		return "stdio://"
	}
	if strings.EqualFold(url, "stdio") {
		return "stdio://"
	}
	return url
}`
);

await replaceExact(
  "agent/codex/codex_model_test.go",
  `func TestNormalizeAppServerURL_EmptyKeepsWebSocketDefault(t *testing.T) {
	if got := normalizeAppServerURL(""); got != "ws://127.0.0.1:3845" {
		t.Fatalf("normalizeAppServerURL(empty) = %q, want ws://127.0.0.1:3845", got)
	}
}`,
  `func TestNormalizeAppServerURL_EmptyDefaultsToStdIO(t *testing.T) {
	if got := normalizeAppServerURL(""); got != "stdio://" {
		t.Fatalf("normalizeAppServerURL(empty) = %q, want stdio://", got)
	}
}`
);

await writeNew(
  "platform/feishu/local_approval_patch_test.go",
  `package feishu

import "testing"

func TestLocalPatchCardAndPermissionActors(t *testing.T) {
\tp := &Platform{allowFrom: "owner-user,source-bot", approvalFrom: "owner-user"}
\tif !p.isCardActorAllowed("source-bot") {
\t\tt.Fatal("configured source bot should be able to use ordinary card controls")
\t}
\tif p.isCardActorAllowed("other-user") {
\t\tt.Fatal("user outside allow_from must not operate cards")
\t}
\tif p.isPermissionActorAllowed("source-bot") {
\t\tt.Fatal("source bot must not handle tool approval")
\t}
\tif !p.isPermissionActorAllowed("owner-user") {
\t\tt.Fatal("configured owner should be able to handle tool approval")
\t}
\tif p.allowsPersistentToolApproval() {
\t\tt.Fatal("configured approval policy must disable persistent approval")
\t}
}

func TestLocalPatchEmptyApprovalFromPreservesPlatformCompatibility(t *testing.T) {
\tp := &Platform{allowFrom: "source-bot"}
\tif !p.isPermissionActorAllowed("source-bot") {
\t\tt.Fatal("empty approval_from should preserve upstream behavior")
\t}
\tif !p.allowsPersistentToolApproval() {
\t\tt.Fatal("empty approval_from should preserve allow-all compatibility")
\t}
}
`
);

await writeNew(
  "platform/feishu/local_reply_mention_patch_test.go",
  `package feishu

import (
\t"context"
\t"encoding/json"
\t"strings"
\t"testing"

\t"github.com/chenhg5/cc-connect/core"
\tlarkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

func localMentionElementCount(t *testing.T, cardJSON string) (int, string) {
\tt.Helper()
\tvar card map[string]any
\tif err := json.Unmarshal([]byte(cardJSON), &card); err != nil {
\t\tt.Fatalf("parse card JSON: %v", err)
\t}
\ttarget := card
\tif body, ok := card["body"].(map[string]any); ok {
\t\ttarget = body
\t}
\telements, _ := target["elements"].([]any)
\tif len(elements) == 0 {
\t\treturn 0, ""
\t}
\tfirst, _ := elements[0].(map[string]any)
\tcontent, _ := first["content"].(string)
\treturn len(elements), content
}

func TestLocalPatchReplyMentionIsScopedToTriggeringGroupSender(t *testing.T) {
\tp := &Platform{mentionTriggerSender: true, botOpenID: "local-bot"}
\trc := replyContext{senderID: "source-bot", senderName: "示例调度器", isGroup: true}
\tmention := p.replySenderMention(rc)
\tif !strings.Contains(mention, ` + "`" + `<at user_id="source-bot">` + "`" + `) || !strings.Contains(mention, "示例调度器") {
\t\tt.Fatalf("unexpected sender mention: %q", mention)
\t}
\tif cardMention := p.replySenderCardMention(rc); cardMention != "<at id=source-bot></at>" {
\t\tt.Fatalf("unexpected card sender mention: %q", cardMention)
\t}
\tif got := p.prefixReplySender(rc, "任务完成"); got != mention+"\\n任务完成" {
\t\tt.Fatalf("unexpected prefixed reply: %q", got)
\t}
\tif got := p.prefixReplySender(rc, mention+"\\n任务完成"); got != mention+"\\n任务完成" {
\t\tt.Fatalf("mention was duplicated: %q", got)
\t}

\tfor _, disabled := range []replyContext{
\t\t{senderID: "source-bot", senderName: "示例调度器", isGroup: false},
\t\t{senderID: "local-bot", senderName: "本地机器人", isGroup: true},
\t} {
\t\tif got := p.replySenderMention(disabled); got != "" {
\t\t\tt.Fatalf("unexpected mention for disabled context: %q", got)
\t\t}
\t}
}

func TestLocalPatchReplyMentionIsAddedToCardJSONOnce(t *testing.T) {
\tmention := "<at id=source-bot></at>"
\tfor name, input := range map[string]string{
\t\t"v2": ` + "`" + `{"schema":"2.0","body":{"elements":[{"tag":"markdown","content":"结果"}]}}` + "`" + `,
\t\t"v1": ` + "`" + `{"elements":[{"tag":"markdown","content":"结果"}]}` + "`" + `,
\t} {
\t\tt.Run(name, func(t *testing.T) {
\t\t\tonce := prependMentionToCardJSON(input, mention)
\t\t\tcount, first := localMentionElementCount(t, once)
\t\t\tif count != 2 || first != mention {
\t\t\t\tt.Fatalf("mention not prepended: count=%d first=%q", count, first)
\t\t\t}
\t\t\ttwice := prependMentionToCardJSON(once, mention)
\t\t\tcount, first = localMentionElementCount(t, twice)
\t\t\tif count != 2 || first != mention {
\t\t\t\tt.Fatalf("mention was duplicated: count=%d first=%q", count, first)
\t\t\t}
\t\t})
\t}
}

func TestLocalPatchReplyBuilderUsesMessageTypeSpecificMention(t *testing.T) {
\tp := &Platform{mentionTriggerSender: true, botOpenID: "local-bot"}
\trc := replyContext{senderID: "source-bot", senderName: "示例调度器", isGroup: true}

\tmsgType, body := p.buildReplyContentWithSender(context.Background(), rc, "任务完成")
\tvar textBody struct {
\t\tText string ` + "`" + `json:"text"` + "`" + `
\t}
\tif err := json.Unmarshal([]byte(body), &textBody); err != nil {
\t\tt.Fatalf("parse plain reply JSON: %v", err)
\t}
\tif msgType != larkim.MsgTypeText || !strings.Contains(textBody.Text, ` + "`" + `<at user_id="source-bot">` + "`" + `) {
\t\tt.Fatalf("plain reply did not use text mention: type=%q text=%q", msgType, textBody.Text)
\t}
\tif strings.Contains(textBody.Text, "<at id=source-bot></at>") {
\t\tt.Fatalf("plain reply unexpectedly used card mention: %q", textBody.Text)
\t}

\tmsgType, body = p.buildReplyContentWithSender(context.Background(), rc, "**任务完成**")
\tif msgType != larkim.MsgTypeInteractive {
\t\tt.Fatalf("markdown reply type=%q, want interactive", msgType)
\t}
\tcount, first := localMentionElementCount(t, body)
\tif count < 2 || first != "<at id=source-bot></at>" {
\t\tt.Fatalf("markdown card did not use card mention: count=%d first=%q", count, first)
\t}
\tif strings.Contains(body, "<at user_id=") {
\t\tt.Fatalf("markdown card contains text mention syntax: %q", body)
\t}
}

func TestLocalPatchStatusFooterUsesCardMention(t *testing.T) {
\tp := &Platform{mentionTriggerSender: true, botOpenID: "local-bot"}
\trc := replyContext{senderID: "source-bot", senderName: "示例调度器", isGroup: true}
\tbody := p.buildStatusFooterCardWithSender(context.Background(), rc, "任务完成", "耗时 1 秒")
\tcount, first := localMentionElementCount(t, body)
\tif count < 4 || first != "<at id=source-bot></at>" {
\t\tt.Fatalf("status card did not use card mention: count=%d first=%q", count, first)
\t}
\tif strings.Contains(body, "<at user_id=") {
\t\tt.Fatalf("status card contains text mention syntax: %q", body)
\t}
}

func TestLocalPatchReplyMentionDoesNotMutateSourceCard(t *testing.T) {
\toriginal := &core.Card{Elements: []core.CardElement{core.CardMarkdown{Content: "结果"}}}
\tcopyCard := cardWithReplySenderMention(original, "<at id=source-bot></at>")
\tif len(original.Elements) != 1 {
\t\tt.Fatal("source card was mutated")
\t}
\tif len(copyCard.Elements) != 2 {
\t\tt.Fatalf("copied card has %d elements, want 2", len(copyCard.Elements))
\t}
\tfirst, ok := copyCard.Elements[0].(core.CardMarkdown)
\tif !ok || first.Content != "<at id=source-bot></at>" {
\t\tt.Fatalf("unexpected first copied element: %#v", copyCard.Elements[0])
\t}
}
`
);

await writeNew(
  "core/private_files.go",
  `package core

import (
\t"errors"
\t"os"
\t"path/filepath"
\t"strings"
)

func ensurePrivateDirectory(dir string) error {
\tif err := os.Mkdir(dir, 0o700); err != nil && !os.IsExist(err) {
\t\treturn errors.New("create private directory failed")
\t}
\tinfo, err := os.Lstat(dir)
\tif err != nil {
\t\treturn errors.New("inspect private directory failed")
\t}
\tif info.Mode()&os.ModeSymlink != 0 {
\t\treturn errors.New("private directory is a symbolic link")
\t}
\tif !info.IsDir() {
\t\treturn errors.New("private path is not a directory")
\t}
\tif err := os.Chmod(dir, 0o700); err != nil {
\t\treturn errors.New("secure private directory failed")
\t}
\treturn nil
}

// PreparePrivateDataDir returns a canonical .cc-connect child directory.
// The work directory itself may be a symlink, but private child directories
// must be real directories and are always tightened to owner-only access.
func PreparePrivateDataDir(workDir, leaf string) (string, error) {
\tif leaf == "" || leaf == "." || leaf == ".." || strings.ContainsAny(leaf, "/\\\\") {
\t\treturn "", errors.New("invalid private directory name")
\t}
\tabsWorkDir, err := filepath.Abs(workDir)
\tif err != nil {
\t\treturn "", errors.New("resolve work directory failed")
\t}
\trealWorkDir, err := filepath.EvalSymlinks(absWorkDir)
\tif err != nil {
\t\treturn "", errors.New("resolve work directory links failed")
\t}
\tinfo, err := os.Stat(realWorkDir)
\tif err != nil || !info.IsDir() {
\t\treturn "", errors.New("work directory is unavailable")
\t}

\tprivateRoot := filepath.Join(realWorkDir, ".cc-connect")
\tif err := ensurePrivateDirectory(privateRoot); err != nil {
\t\treturn "", err
\t}
\tprivateLeaf := filepath.Join(privateRoot, leaf)
\tif err := ensurePrivateDirectory(privateLeaf); err != nil {
\t\treturn "", err
\t}
\treturn privateLeaf, nil
}

// WritePrivateTempFile writes a new owner-only file without following or
// replacing a pre-existing leaf path. The caller controls only the pattern,
// while CreateTemp supplies an unpredictable O_EXCL filename.
func WritePrivateTempFile(dir, pattern string, data []byte) (path string, err error) {
\tif pattern == "" {
\t\tpattern = "private-*"
\t}
\tif strings.ContainsAny(pattern, "/\\\\") {
\t\treturn "", errors.New("invalid private filename pattern")
\t}
\tinfo, err := os.Lstat(dir)
\tif err != nil {
\t\treturn "", errors.New("inspect private output directory failed")
\t}
\tif info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
\t\treturn "", errors.New("private output directory is unsafe")
\t}

\tf, err := os.CreateTemp(dir, pattern)
\tif err != nil {
\t\treturn "", errors.New("create private file failed")
\t}
\tpath = f.Name()
\tcleanup := true
\tdefer func() {
\t\tif cleanup {
\t\t\t_ = f.Close()
\t\t\t_ = os.Remove(path)
\t\t}
\t}()
\tif err = f.Chmod(0o600); err != nil {
\t\treturn "", errors.New("secure private file failed")
\t}
\tif _, err = f.Write(data); err != nil {
\t\treturn "", errors.New("write private file failed")
\t}
\tif err = f.Close(); err != nil {
\t\treturn "", errors.New("close private file failed")
\t}
\tcleanup = false
\treturn path, nil
}
`
);

await writeNew(
  "core/local_attachment_patch_test.go",
  `package core

import (
\t"os"
\t"path/filepath"
\t"testing"
)

func TestLocalPatchAttachmentPermissions(t *testing.T) {
\tworkDir := t.TempDir()
\tpaths := SaveFilesToDisk(workDir, []FileAttachment{{
\t\tFileName: "example.txt",
\t\tData:     []byte("example"),
\t}})
\tif len(paths) != 1 {
\t\tt.Fatalf("expected one attachment path, got %d", len(paths))
\t}

\tdirInfo, err := os.Stat(filepath.Join(workDir, ".cc-connect", "attachments"))
\tif err != nil {
\t\tt.Fatalf("stat attachment directory: %v", err)
\t}
\tif got := dirInfo.Mode().Perm(); got != 0o700 {
\t\tt.Fatalf("attachment directory mode = %o, want 700", got)
\t}

\tfileInfo, err := os.Stat(paths[0])
\tif err != nil {
\t\tt.Fatalf("stat attachment file: %v", err)
\t}
\tif got := fileInfo.Mode().Perm(); got != 0o600 {
\t\tt.Fatalf("attachment file mode = %o, want 600", got)
\t}
}
`
);

await writeNew(
  "core/local_private_files_patch_test.go",
  `package core

import (
\t"bytes"
\t"os"
\t"path/filepath"
\t"runtime"
\t"strings"
\t"testing"
)

func TestLocalPatchPrivateAttachmentsAreUniqueAndTightenDirectories(t *testing.T) {
\tworkDir := t.TempDir()
\tprivateRoot := filepath.Join(workDir, ".cc-connect")
\tattachDir := filepath.Join(privateRoot, "attachments")
\tif err := os.MkdirAll(attachDir, 0o755); err != nil {
\t\tt.Fatal(err)
\t}
\t_ = os.Chmod(privateRoot, 0o755)
\t_ = os.Chmod(attachDir, 0o755)

\tpaths := SaveFilesToDisk(workDir, []FileAttachment{
\t\t{FileName: "example.txt", Data: []byte("first")},
\t\t{FileName: "example.txt", Data: []byte("second")},
\t})
\tif len(paths) != 2 || paths[0] == paths[1] {
\t\tt.Fatalf("expected two unique attachment paths, got %#v", paths)
\t}

\tif runtime.GOOS != "windows" {
\t\tfor _, dir := range []string{privateRoot, attachDir} {
\t\t\tinfo, err := os.Stat(dir)
\t\t\tif err != nil {
\t\t\t\tt.Fatal(err)
\t\t\t}
\t\t\tif got := info.Mode().Perm(); got != 0o700 {
\t\t\t\tt.Fatalf("private directory mode = %o, want 700", got)
\t\t\t}
\t\t}
\t}

\tfor i, want := range [][]byte{[]byte("first"), []byte("second")} {
\t\tgot, err := os.ReadFile(paths[i])
\t\tif err != nil {
\t\t\tt.Fatal(err)
\t\t}
\t\tif !bytes.Equal(got, want) {
\t\t\tt.Fatalf("attachment %d content = %q, want %q", i, got, want)
\t\t}
\t}
}

func TestLocalPatchPrivateAttachmentDirectoriesRejectSymlinks(t *testing.T) {
\tif runtime.GOOS == "windows" {
\t\tt.Skip("symlink permissions vary on Windows")
\t}
\tfor _, leafLink := range []bool{false, true} {
\t\tname := "private-root"
\t\tif leafLink {
\t\t\tname = "attachments"
\t\t}
\t\tt.Run(name, func(t *testing.T) {
\t\t\tworkDir := t.TempDir()
\t\t\toutside := t.TempDir()
\t\t\tprivateRoot := filepath.Join(workDir, ".cc-connect")
\t\t\tlinkPath := privateRoot
\t\t\tif leafLink {
\t\t\t\tif err := os.Mkdir(privateRoot, 0o700); err != nil {
\t\t\t\t\tt.Fatal(err)
\t\t\t\t}
\t\t\t\tlinkPath = filepath.Join(privateRoot, "attachments")
\t\t\t}
\t\t\tif err := os.Symlink(outside, linkPath); err != nil {
\t\t\t\tt.Fatal(err)
\t\t\t}
\t\t\tif paths := SaveFilesToDisk(workDir, []FileAttachment{{FileName: "blocked.txt", Data: []byte("blocked")}}); len(paths) != 0 {
\t\t\t\tt.Fatalf("unsafe directory accepted: %#v", paths)
\t\t\t}
\t\t\tentries, err := os.ReadDir(outside)
\t\t\tif err != nil {
\t\t\t\tt.Fatal(err)
\t\t\t}
\t\t\tif len(entries) != 0 {
\t\t\t\tt.Fatal("attachment escaped through symbolic link")
\t\t\t}
\t\t})
\t}
}

func TestLocalPatchWorkDirectorySymlinkResolvesInsideTarget(t *testing.T) {
\tif runtime.GOOS == "windows" {
\t\tt.Skip("symlink permissions vary on Windows")
\t}
\trealWorkDir := t.TempDir()
\tlinkParent := t.TempDir()
\tworkDirLink := filepath.Join(linkParent, "workspace-link")
\tif err := os.Symlink(realWorkDir, workDirLink); err != nil {
\t\tt.Fatal(err)
\t}
\tpaths := SaveFilesToDisk(workDirLink, []FileAttachment{{FileName: "example.txt", Data: []byte("example")}})
\tif len(paths) != 1 {
\t\tt.Fatalf("attachment path was not canonicalized into the real work directory: %#v", paths)
\t}
\tcanonicalWorkDir, err := filepath.EvalSymlinks(realWorkDir)
\tif err != nil {
\t\tt.Fatal(err)
\t}
\tcanonicalAttachment, err := filepath.EvalSymlinks(paths[0])
\tif err != nil {
\t\tt.Fatal(err)
\t}
\tif !strings.HasPrefix(canonicalAttachment, canonicalWorkDir+string(os.PathSeparator)) {
\t\tt.Fatalf("attachment path was not canonicalized into the real work directory")
\t}
}
`
);

await writeNew(
  "agent/codex/local_attachment_patch_test.go",
  `package codex

import (
\t"os"
\t"path/filepath"
\t"testing"

\t"github.com/chenhg5/cc-connect/core"
)

func TestLocalPatchImagePermissions(t *testing.T) {
\tworkDir := t.TempDir()
\ts := &appServerSession{workDir: workDir}
\t_, paths, err := s.stageImages("test-run", []core.ImageAttachment{{
\t\tMimeType: "image/png",
\t\tData:     []byte("example"),
\t}})
\tif err != nil {
\t\tt.Fatalf("stageImages: %v", err)
\t}
\tif len(paths) != 1 {
\t\tt.Fatalf("expected one image path, got %d", len(paths))
\t}

\tdirInfo, err := os.Stat(filepath.Join(workDir, ".cc-connect", "images"))
\tif err != nil {
\t\tt.Fatalf("stat image directory: %v", err)
\t}
\tif got := dirInfo.Mode().Perm(); got != 0o700 {
\t\tt.Fatalf("image directory mode = %o, want 700", got)
\t}

\tfileInfo, err := os.Stat(paths[0])
\tif err != nil {
\t\tt.Fatalf("stat image file: %v", err)
\t}
\tif got := fileInfo.Mode().Perm(); got != 0o600 {
\t\tt.Fatalf("image file mode = %o, want 600", got)
\t}
}
`
);

await writeNew(
  "agent/codex/local_private_images_patch_test.go",
  `package codex

import (
\t"os"
\t"path/filepath"
\t"runtime"
\t"sync"
\t"testing"

\t"github.com/chenhg5/cc-connect/core"
)

func TestLocalPatchPrivateImageDirectoryRejectsSymlink(t *testing.T) {
\tif runtime.GOOS == "windows" {
\t\tt.Skip("symlink permissions vary on Windows")
\t}
\tworkDir := t.TempDir()
\toutside := t.TempDir()
\tprivateRoot := filepath.Join(workDir, ".cc-connect")
\tif err := os.Mkdir(privateRoot, 0o700); err != nil {
\t\tt.Fatal(err)
\t}
\tif err := os.Symlink(outside, filepath.Join(privateRoot, "images")); err != nil {
\t\tt.Fatal(err)
\t}
\ts := &appServerSession{workDir: workDir}
\tif _, _, err := s.stageImages("test", []core.ImageAttachment{{MimeType: "image/png", Data: []byte("blocked")}}); err == nil {
\t\tt.Fatal("symbolic-link image directory was accepted")
\t}
\tentries, err := os.ReadDir(outside)
\tif err != nil {
\t\tt.Fatal(err)
\t}
\tif len(entries) != 0 {
\t\tt.Fatal("image escaped through symbolic link")
\t}
}

func TestLocalPatchConcurrentImageStagingUsesUniqueFiles(t *testing.T) {
\tworkDir := t.TempDir()
\ts := &appServerSession{workDir: workDir}
\tconst workers = 24
\tpaths := make(chan string, workers)
\terrs := make(chan error, workers)
\tvar wg sync.WaitGroup
\tfor i := 0; i < workers; i++ {
\t\twg.Add(1)
\t\tgo func() {
\t\t\tdefer wg.Done()
\t\t\t_, staged, err := s.stageImages("test", []core.ImageAttachment{{MimeType: "image/png", Data: []byte("image")}})
\t\t\tif err != nil {
\t\t\t\terrs <- err
\t\t\t\treturn
\t\t\t}
\t\t\tif len(staged) != 1 {
\t\t\t\terrs <- os.ErrInvalid
\t\t\t\treturn
\t\t\t}
\t\t\tpaths <- staged[0]
\t\t}()
\t}
\twg.Wait()
\tclose(paths)
\tclose(errs)
\tfor err := range errs {
\t\tt.Fatalf("stageImages failed: %v", err)
\t}
\tseen := make(map[string]bool, workers)
\tfor path := range paths {
\t\tif seen[path] {
\t\t\tt.Fatalf("duplicate staged image path: %s", filepath.Base(path))
\t\t}
\t\tseen[path] = true
\t}
\tif len(seen) != workers {
\t\tt.Fatalf("staged %d unique images, want %d", len(seen), workers)
\t}
}
`
);

await writeNew(
  "core/local_command_patch_test.go",
  `package core

import (
\t"fmt"
\t"strings"
\t"testing"
)

func TestLocalPatchCardNavigationRespectsDisabledCommands(t *testing.T) {
\te := newTestEngine()
\te.SetDisabledCommands([]string{"mode", "model", "dir", "provider"})

\tblocked := map[string]string{
\t\t"act:/mode yolo":      "mode",
\t\t"act:/model switch 1": "model",
\t\t"nav:/dir":            "dir",
\t\t"nav:/provider/add":   "provider",
\t}
\tfor action, cmdID := range blocked {
\t\tcard := e.handleCardNav(action, "test:chat:user")
\t\tif card == nil {
\t\t\tt.Fatalf("blocked action %q returned no refusal card", action)
\t\t}
\t\twant := fmt.Sprintf(e.i18n.T(MsgCommandDisabled), "/"+cmdID)
\t\tif rendered := card.RenderText(); !strings.Contains(rendered, want) {
\t\t\tt.Fatalf("blocked action %q rendered %q, want %q", action, rendered, want)
\t\t}
\t}

\tfor _, action := range []string{"nav:/help", "nav:/version"} {
\t\tif card := e.handleCardNav(action, "test:chat:user"); card == nil {
\t\t\tt.Fatalf("allowed action %q returned no card", action)
\t\t}
\t}

\tsessionKey := "test:chat:sensitive-user"
\tstopCard := e.handleCardNav("act:/stop", sessionKey)
\tif stopCard == nil {
\t\tt.Fatal("stop action returned no confirmation card")
\t}
\tstopText := stopCard.RenderText()
\tif !strings.Contains(stopText, e.i18n.T(MsgExecutionStopped)) {
\t\tt.Fatalf("stop confirmation missing expected text: %q", stopText)
\t}
\tif strings.Contains(stopText, sessionKey) {
\t\tt.Fatalf("stop confirmation leaked the session key: %q", stopText)
\t}
}

func TestLocalPatchHelpCardHidesDisabledCommands(t *testing.T) {
\te := newTestEngine()
\te.SetDisabledCommands([]string{"mode", "model", "provider"})
\trendered := e.renderHelpGroupCard("agent").RenderText()
\tfor _, command := range []string{"/mode", "/model", "/provider"} {
\t\tif strings.Contains(rendered, "**"+command+"**") {
\t\t\tt.Fatalf("help card exposed disabled command %s", command)
\t\t}
\t}
}
`
);
