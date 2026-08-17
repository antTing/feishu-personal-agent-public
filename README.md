# 飞书个人 AI Agent

把飞书企业自建应用机器人接到自己电脑上的 Codex。推荐把 Aily（或其他云端智能体）作为轻量前台，只把确实需要本机文件、代码、构建或终端的任务转给本地 cc-connect。

> 当前 `v0.2` 提供可运行的原生本机执行端，以及一份上游调度协议参考。仓库不包含可独立部署的 Aily 调度服务；只粘贴提示词不能自动获得持久队列、重启恢复、幂等去重或跨会话任务状态。

```text
日常问候、测试、飞书文档/日历/任务
        -> Aily 直接处理，不调用本地 Codex

本地代码、文件、构建、终端、电脑操作
        -> Aily 在执行群中 @ 本地机器人
        -> cc-connect 原生 Feishu -> Codex
```

## 解决什么问题

如果所有对话都直接进入本地 Agent，简单问候、连通性测试和飞书云端操作也会占用 Codex 的上下文和模型用量。把这类消息留在 Aily，可以减少不必要的 Codex 调用；它不会让真正的开发任务变成零 Token，也不保证总费用一定下降，因为 Aily 也可能消耗自己的额度。

本项目不内置 Aily，也不替 Aily 做语义路由。Aily 是否能处理日历、文档、任务等飞书操作，取决于你给它配置的能力。项目提供的是本机执行端和一套通用的任务/会话约定。要实现文档描述的多任务串行、跨会话并行和准确停止，上游还必须具有持久存储或工作流能力；没有这些能力时，建议先用主人直连模式，或一次只派发一个任务。

## 推荐架构

新部署使用原生模式：

```text
Aily（可选）
  -> 执行群中的 @ 本地机器人
  -> cc-connect 官方 Feishu WebSocket
  -> Codex CLI / App Server
  -> 已授权工作区
```

原生模式直接使用 cc-connect 已有的飞书消息、引用回复、思考/工具进度、图片/普通文件、线程会话和停止能力，不再重复实现一套飞书 Connector。旧版 `Feishu Connector -> Bridge` 仍保留在仓库中，用于兼容现有部署和迁移过渡，不建议新安装继续采用它。

## 任务和会话边界

Aily 应为每条独立任务链生成 `DS-XXXXXXXX`，为链中的每个具体任务生成 `T-XXXXXXXX`，并在执行群里创建一个新的飞书根消息/回复线程。原生配置启用 `thread_isolation = true` 后：

- 同一 `DS` 由 Aily 维护持久 FIFO，同时只派发队首一个 `T`；后续 `T` 在 Aily 侧排队，不提前进入 cc-connect；
- 当前运行 `T` 的补充信息可以留在同一线程，但不能把另一个独立 `T` 当作补充消息塞入本地队列；
- 不同 `DS` 使用不同线程，可以并行；
- 同一个群里两个人先后提出的两件事，不能因为群相同就合并；
- 两个群即使使用同一个 Aily，也默认是两条不同任务链；
- Aily 无法判断是续问还是新任务时，应先询问，不要猜测。

任务封装格式见 [任务分发协议](docs/aily-dispatch-protocol.zh-CN.md)。

## 快速开始

### 1. 准备

- macOS、Linux 或 WSL；
- Node.js 22+、npm、Go 1.25+、`curl`、`tar`、哈希校验工具；
- 已登录的 Codex CLI；
- 一个可以创建企业自建应用的飞书账号；
- 一个准备作为执行群的飞书群；
- 一个明确的本地工作区路径。
- 若要使用 Aily 多任务调度：还需要 Aily 侧可持久化 `DS/T` 映射、FIFO 和任务状态；本仓库只提供协议与提示词模板。

App、机器人、权限、App Secret 及用户/机器人/群 ID 均由安装器自动创建、申请或从一次性配对事件取得，不需要手工查找和复制。用户只处理飞书官方授权、企业管理员审批、加群和配对确认。

### 2. 让 Agent 安装

把下面一句话交给 Codex、Claude Code 或其他有本机终端权限的 Agent：

```text
请阅读 https://raw.githubusercontent.com/antTing/feishu-personal-agent-public/main/INSTALL.md，按原生 cc-connect 模式帮我安装；先列出依赖和拟执行命令，询问我工作区路径以及是否使用 Aily，然后按默认参数运行自动建应用和配对流程，不要使用显示一次性链接、配对码或恢复私有锁的选项。浏览器授权、企业审批、执行群/Aily 配对和主人最终确认由我处理；不要读取或回显私有配置、ID、Secret、一次性授权链接和配对码，完成后运行测试和 release-check。
```

Agent 可以检查依赖、构建、启动自动安装器和运行测试。你只需确认浏览器授权、必要的企业审批、把机器人加入执行群，并按本机浏览器配对页完成执行群选择、Aily 报到和主人最终确认；不需要向 Agent 提供任何飞书 ID、Secret 或配对码。

### 3. 核心安装命令

```bash
./scripts/build-cc-connect-local.sh
./scripts/onboard-native.sh --workspace '/绝对路径/到/工作区'
./scripts/start-native.sh
```

`start-native.sh` 会优先复用当前终端中的 Codex CLI；macOS 上找不到时，会自动发现 ChatGPT/Codex 桌面应用内置的 Codex 执行器，不需要重复安装。

`start-native.sh` 是当前经过验证的启动入口。`v0.2` 暂未提供经过验证的一键 launchd/systemd 安装器；不要直接绕过该脚本启动 cc-connect，因为它还负责发现 Codex 执行器。不要把原生模式和旧模式同时连接到同一个飞书应用。

## 飞书权限

安装器复用飞书官方 `PersonalAgent` 基座，并在确认页增量声明 `im.message.receive_v1`、发送/接收消息、图片/附件资源权限和卡片回调。使用 Aily 时还会声明 `im:message.group_at_msg.include_bot:readonly`。安装器会回读实际授权结果；缺权限时自动发起管理员审批，批准后按同一命令继续。本项目增量权限不包含读取群全部消息的敏感权限；官方基座最终包含的权限以飞书确认页为准。配对完成后自动生成严格的 `allow_from`、`allow_chat` 和 `approval_from`。完整说明见 [飞书企业自建应用配置](feishu-enterprise-app-setup.md)。

## 能力边界

原生模式已经覆盖：

- 文本、富文本、图片和普通文件消息；
- 链接按文本交给 Agent，能否打开仍取决于网络与权限；
- 语音需要额外配置语音转写，当前模板未启用；视频当前只传递元数据和可能的缩略图，不读取视频正文；
- 飞书引用回复；群内处理中提示、工具进度和完成反馈会同时 `@` 原任务发送者，使 Aily 或主人能收到对应事件；
- 按回复线程隔离会话；
- 同一 `DS` 由 Aily 串行派发、不同 `DS` 线程并行；
- `/stop`、`/help`、`/version` 和工具权限确认；任务状态由线程内进度和 Aily 的 `DS/T` 状态映射提供；
- 工具审批卡片和文字审批只允许 `approval_from` 中的主人操作，并禁用跨任务延续的“允许全部”；
- 固定工作区中的 Codex CLI/App Server 执行。

仍由 Aily 或后续策略补丁负责：

- `DS/T` 编号到原始用户会话的映射；
- 未知工作区的申请、查找和批准；
- 只读/开发工作区的登记及 Git 分支门禁；
- 从任意线程按 `T-...` 精确停止；
- 自动根据任务封装切换 cc-connect project、工作目录或权限模式。

这些边界会在原生模式验收通过后逐项补齐；当前不要把旧 Connector 文档里的能力误认为原生模式已经全部具备。

## 费用

飞书消息和本地 cc-connect 本身没有按消息的软件费。Aily 处理轻任务可能消耗 Aily 额度；Aily 转交本地任务时，Aily 和 Codex 都可能产生用量；直接发给本地机器人则会使用 Codex。实际账单以各平台账号和当时的产品条款为准。

## 文档

- [INSTALL.md](INSTALL.md)：安装、配置、Agent 代装和迁移。
- [USAGE.md](USAGE.md)：消息、线程、队列、停止、媒体和费用。
- [docs/aily-dispatch-protocol.zh-CN.md](docs/aily-dispatch-protocol.zh-CN.md)：Aily/其他调度器的任务封装协议。
- [config/aily-router.example.md](config/aily-router.example.md)：可直接配置给 Aily 的路由规则模板。
- [docs/native-migration.zh-CN.md](docs/native-migration.zh-CN.md)：从旧 Connector 切换到原生模式的 PoC 与回滚清单。
- [native/README.md](native/README.md)：原生模式现状和迁移边界。
- [SECURITY.md](SECURITY.md)：安全边界和发布要求。
