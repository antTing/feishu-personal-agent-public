# 飞书企业自建应用配置

## 目标链路

```text
Aily（可选） -> 执行群 -> 飞书企业自建应用机器人
                            -> cc-connect 原生 Feishu WebSocket
                            -> Codex
```

使用企业自建应用，不使用群自定义 Webhook 机器人。长连接只需要出站网络，不需要公网 IP、域名或回调服务器。

## 自动创建和批准

新安装运行：

```bash
./scripts/onboard-native.sh --workspace '/绝对路径/到/工作区'
```

脚本调用[飞书官方一键建应用能力](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/scan-to-create-an-app-in-one-click-nodejs)，保留官方 `PersonalAgent` 基座，并在确认页增量声明本项目需要的权限、`im.message.receive_v1` 和 `card.action.trigger`。用户只需在浏览器确认；App ID、App Secret 和扫码用户 `open_id` 由官方注册结果直接返回，不需要复制。

企业策略可能要求管理员审批应用或新增权限。安装器不能也不会绕过该审批；它会调用官方授权状态接口核对所有必需权限，缺权限时自动调用官方接口发起管理员审批，再通过 Bot Info 检查机器人是否启用。批准并让应用生效后，临时长连接才继续身份配对。应用凭据已经保存后，连接等待超时可重新运行同一命令继续。

## 权限与官方基座

官方 `PersonalAgent` 基座负责机器人和长连接相关默认配置；它的基础项由飞书控制，不能由安装器删除。本项目在此基础上只增量声明下列业务权限，并在安装后核对实际授权状态。

官方一键注册的 `addons` 只能增量声明权限、事件和回调名称，不能自行设置敏感的订阅方式。本项目因此保留 `PersonalAgent` 默认基座，而不是使用空白最小基座；临时 WebSocket 配对能收到主人消息，才视为消息长连接实际可用。卡片回调在首次工具审批烟测中继续验证，失败时保持纯文本审批，不放宽审批人白名单。

基础群聊执行需要：

```text
im:message.group_at_msg:readonly
im:message:send_as_bot
im:message:readonly
im:resource
```

后两项用于读取消息中的图片/附件资源以及回传图片/文件。它们不会订阅群内全部消息；安装器仍然只订阅机器人被明确 `@` 的消息事件。

接收其他机器人（例如 Aily）在群中 `@` 当前机器人，还需要：

```text
im:message.group_at_msg.include_bot:readonly
```

自动安装默认只使用专用执行群。`--without-dispatcher` 不申请机器人消息权限，只允许主人直接使用。若将来要启用主人私聊，再增加 `im:message.p2p_msg:readonly` 并把原生配置的 `group_only` 改为 `false`。

不要仅为定位 ID 申请 `im:message.group_msg`，它会读取群内全部消息，权限明显更宽。生成的配置使用 `resolve_mentions = false`，发送者 `@` 直接采用消息事件中的 `open_id`，因此不额外读取群成员目录。

## 自动取得身份值

- App ID / App Secret：官方一键注册成功后直接写入本机私有状态；
- 主人 `open_id`：扫码注册结果直接确定，不再要求第二次绑定主人；
- 执行群 `chat_id`：主人在目标群发送带一次性随机码的 `@` 消息后取得，并与扫码身份交叉校验；
- Aily 机器人 `open_id`：Aily 在同一群发送另一枚一次性随机码后成为候选；主人核对发送者，并回复该条消息使用确认码后才写入。若候选不正确，主人可在同一回复中使用拒绝码，安装器会清除候选并轮换调度配对码。

配对监听器不连接 Codex，不处理普通任务，也不保存消息正文。中间状态和最终配置只在被忽略的 `runtime/` 中以 `700/600` 权限保存；授权链接和随机码默认只显示在自动打开的本机浏览器中，不进入 Agent 输出，凭据和身份 ID 始终不显示。

## 验收

| 测试 | 预期 |
|---|---|
| 主人在执行群未 `@` | 忽略 |
| 主人在执行群明确 `@` | 接收并回复 |
| 白名单 Aily 明确 `@` | 接收并处理 |
| 非白名单机器人或群 | 忽略 |
| 同一任务线程追问 | 复用同一会话并排队 |
| 新根消息任务 | 新会话，可与其他线程并行 |
| 图片/文件 | 交给原生 cc-connect 媒体管线 |
| `/stop` | 停止当前任务线程 |

不要让旧 Connector 和原生 cc-connect 同时连接同一个应用，否则事件可能被不同连接随机消费。
