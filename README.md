# 飞书个人 AI Agent

通过飞书安全调用你自己电脑上的 Codex。它适合把 Aily 智能体当作日常入口，把真正需要读取本地文件、开发项目或控制电脑的任务转交给本地 Agent。

```text
你
├─ 问候、测试、飞书文档/日历/任务等
│  └─ Aily 智能体处理，不调用本地 Codex
│
└─ 本地代码、文件、构建、终端或电脑操作
   └─ Aily 在白名单群中 @ 企业自建应用机器人
      └─ Feishu Connector -> cc-connect -> Codex
```

也可以不使用 Aily，直接私聊或在群中 `@` 企业自建应用机器人。

## 解决什么问题

### 1. 避免所有对话都消耗本地 Agent Token

问候、连通性测试、查飞书文档、创建日程或处理飞书任务，通常不需要读取本机代码和文件。如果这些消息全部进入 Codex，会产生不必要的模型调用和上下文消耗。

推荐让已配置相应能力和权限的 Aily 智能体处理这类云端轻任务；只有下列任务才转交本项目：

- 阅读或修改本机项目；
- 运行构建、测试、脚本或终端命令；
- 分析本地文件、日志或开发环境；
- 需要操作个人电脑的开发、运维任务。

这种方式减少的是**不必要的 Codex 调用次数**，不会降低真实开发任务本身所需的 Token。Aily 也可能消耗自己的套餐或模型额度。

### 2. 让飞书中的任务安全进入本机

Aily 等云端智能体不能天然访问你的电脑。本项目提供一条受控链路：

```text
飞书企业自建应用
  -> 官方 WebSocket 长连接
  -> Feishu Connector
  -> cc-connect Bridge（仅 localhost）
  -> cc-connect
  -> Codex
```

链路包含用户、来源机器人和群白名单，并提供任务队列、停止、工作区授权、Git 分支确认和一次性操作审批。

## 重要边界

- **Aily 是可选的前台入口，不包含在本仓库中。** Aily 的知识、技能、提示词和飞书操作权限需要单独配置。
- **本项目不会自动判断一条普通消息是否值得调用 Codex。** 只有从 Aily 侧不转交轻任务，才能避免这些 Codex 调用。
- 直接发送给企业自建应用机器人的普通消息会进入 Codex；`任务状态`、停止、审批、工作区和分支确认等控制指令由 Connector 本地处理。
- 仅保持飞书长连接、Bridge 连接或查询本地任务状态，不会消耗 Codex Token。

## 能做什么

- 私聊或在群中 `@` 企业自建应用机器人发起本地任务。
- 接收白名单内 Aily 或其他机器人转交的文本、富文本、卡片文字和链接。
- 引用原消息回复，并在群内 `@` 原发送者。
- 显示任务编号、执行/排队状态和耗时，支持按编号停止任务。
- 把不同工作区映射到独立的只读和开发会话。
- Git 仓库在开发前确认目标分支；普通目录不强制要求 Git。
- 写文件、执行命令和其他有副作用的操作通过一次性审批继续。

## 安装前准备

| 准备项 | 说明 |
|---|---|
| 一台持续在线的电脑或服务器 | 支持 macOS、Linux；Windows 建议使用 WSL。电脑关机或休眠时无法执行本地任务 |
| Node.js 22+ 和 npm | 运行 Feishu Connector |
| Go 1.25+ | 在本机编译固定版本的 cc-connect |
| Codex CLI | 使用安装者自己的账号完成登录，费用归该账号 |
| 飞书企业自建应用 | 需要创建、启用机器人能力、配置长连接、申请权限并发布版本 |
| 私有身份值 | App ID、App Secret、主人用户 `open_id` |
| 可选的机器人转交值 | Aily/来源机器人 `open_id`、执行群 `chat_id` |
| 可选的本地工作区 | 工作区名称、绝对路径以及最小安全搜索根目录 |

飞书配置详见 [feishu-enterprise-app-setup.md](feishu-enterprise-app-setup.md)。不要把 App Secret、Token 或真实身份 ID 发进聊天、Issue 或提交记录。

## 快速开始：让 Agent 帮你安装

把下面整段交给 Codex、Claude Code 或其他具有本机终端权限的 Agent：

```text
请参考 https://raw.githubusercontent.com/antTing/feishu-personal-agent-public/main/INSTALL.md 帮我安装和配置。先完整阅读文档，列出缺失依赖和拟修改文件；不要读取、打印或提交密钥。到配置飞书 App Secret 和本地 Token 的步骤时必须暂停，由我在另一个终端亲自执行初始化；你不能代我执行带秘密环境变量的命令，只能在初始化完成后检查配置文件是否存在及权限是否正确。对非秘密身份 ID、Codex 登录和工作区路径逐项确认，也不要未经我明确批准执行任何 Git 操作。完成后运行测试、release-check 和 preflight。最后不要在 Agent 受管终端里后台启动，请提示我在本人普通终端执行 ./scripts/start-background.sh。
```

### 安装过程中你需要做什么

Agent 会负责依赖检查、下载源码、构建、测试和预检，但下面几步必须由你参与：

1. **确认安装位置和命令。** Git、系统软件安装、覆盖配置等动作需要你明确批准。
2. **完成 Codex 登录。** 使用你自己的 Codex 账号在交互终端登录。
3. **创建并发布飞书企业自建应用。** Agent 可以指导，但不能替你决定租户权限和可用范围。
4. **在独立终端输入私密配置。** 提供 App ID、App Secret、主人 `open_id`；如需 Aily 转交，再提供来源机器人 `open_id` 和群 `chat_id`。不要把这些值粘贴给 Agent。
5. **确认本地工作区。** 告诉 Agent 允许访问的工作区名称、路径和最小安全搜索根目录。
6. **在本人普通终端启动后台服务。** Agent 受管终端退出后可能回收后台进程，因此最后一步由你执行。

完整人工安装步骤见 [INSTALL.md](INSTALL.md)。

## 安装完成后

### 1. 启动并检查

在安装目录的普通终端中运行：

```bash
./scripts/start-background.sh
./scripts/status.sh
```

正常结果应显示服务进程正在运行，Bridge 和 Management 已就绪。当前版本不会自动安装开机启动；电脑重启后需要再次运行 `start-background.sh`。

停止服务：

```bash
./scripts/stop.sh
```

### 2. 直接使用企业自建应用机器人

- 私聊：白名单主人可以直接发送消息。
- 群聊：必须明确 `@` 企业自建应用机器人。

```text
@本地机器人 分析 example-project 的构建速度，先只读检查
@本地机器人 修改登录页，项目 example-project
```

直接发送的普通消息会进入 Codex 并产生相应模型用量。

### 3. 推荐：让 Aily 只转交本地任务

给 Aily 配置类似下面的路由原则：

```text
问候、测试以及你有权限完成的飞书文档、日历、任务等操作由你直接处理。
只有任务必须访问本机代码、文件、终端、构建环境或电脑软件时，才在指定执行群中 @ 本地执行机器人并发送完整任务。
不转发密钥、Cookie、Token 或与任务无关的聊天历史；无法判断时先询问用户。
```

要接收机器人转交，飞书应用还需要：

- 权限 `im:message.group_at_msg.include_bot:readonly`，并发布包含该权限的新应用版本；
- 将来源机器人 `open_id` 加入 `allowedBotIds`；
- 将执行群 `chat_id` 加入 `allowedBotChatIds`；
- Aily 在该群中明确 `@` 企业自建应用机器人。

这样，Aily 可以留在前台处理轻任务，本地 Codex 只处理真正需要电脑权限的任务。

Connector 会把 Aily 视为这条转交消息的发送者，因此状态和最终答复会引用原消息并 `@` Aily，而不会自动恢复最初提问者的身份。Aily 不能代替主人停止任务、批准工作区、确认分支或批准工具操作，这些动作仍由配置中的主人用户完成。

## 常用指令

查看当前任务：

```text
任务状态
任务列表
/status
```

停止任务：

```text
停止任务
停止任务 T-XXXXXXXX
```

授权新工作区：

```text
同意工作区 WR-XXXXXXXX
```

确认开发分支：

```text
确认分支 BR-XXXXXXXX feature/example
```

批准或拒绝一次工具操作：

```text
允许操作 PA-XXXXXXXX
拒绝操作 PA-XXXXXXXX
```

同一发送者、同一工作区的任务顺序执行；不同发送者或不同工作区会话可以并行。需要停止任务时，先发送 `任务状态` 查看准确编号。

更多说明见 [USAGE.md](USAGE.md)。

## 安全默认值

- 飞书用户、来源机器人和群都使用显式白名单。
- Bridge 与 Management API 仅监听 `127.0.0.1`，并使用独立随机 Token。
- 真实配置、会话、日志和构建产物都在被忽略的 `runtime/` 中。
- 配置文件权限为 `600`，运行目录权限为 `700`。
- 不启用 cc-connect Web UI、`yolo` 或宿主机高权限入口。
- 不发布本机二进制；安装时固定版本、校验源码包哈希并在目标机器构建。

MCP、提示词和白名单都不是操作系统沙箱。不要把生产数据库写账号、Docker Socket、SSH 私钥或云平台管理员凭据放入 Agent 可读目录。

## 费用说明

| 环节 | 是否可能产生模型费用 |
|---|---|
| Aily 处理问候、测试或飞书操作 | 不消耗 Codex Token；可能消耗 Aily 自身额度 |
| Aily 将本地任务转交给本机器人 | Aily 和 Codex 可能分别产生用量 |
| 直接向本机器人发送普通消息 | 会进入 Codex |
| 查询任务状态、停止、审批等本地控制 | 通常不发起新的模型调用 |
| Feishu Connector 与 cc-connect | 本地开源组件，无按消息软件费 |

实际费用取决于各平台账号、登录方式和当时的产品条款，详见 [cost-and-workspace-access.md](cost-and-workspace-access.md)。

## 文档

- [INSTALL.md](INSTALL.md)：人工安装、Agent 代装、升级和故障排查。
- [USAGE.md](USAGE.md)：消息入口、任务队列、停止、审批和工作区。
- [OPERATIONS.zh-CN.md](OPERATIONS.zh-CN.md)：后台运行、状态、停止、安全重启和凭据轮换。
- [feishu-enterprise-app-setup.md](feishu-enterprise-app-setup.md)：企业自建应用权限与事件配置。
- [permissions-and-capabilities.md](permissions-and-capabilities.md)：权限边界与扩展顺序。
- [SECURITY.md](SECURITY.md)：密钥、发布和漏洞报告要求。

## 开发与发布检查

```bash
npm test --prefix feishu-connector
./scripts/release-check.sh
./scripts/preflight.sh
```

生成不含本机运行数据的发布目录：

```bash
./scripts/export-public.sh /tmp/feishu-personal-agent-public
```

`release-check` 是启发式脱敏检查，不能替代托管平台的 Secret Scanner 和人工审查。始终排除整个 `runtime/` 目录。

## 许可

本项目使用 MIT License。patched cc-connect 仍遵循其上游许可和归属要求，见[第三方软件中文说明](THIRD_PARTY_NOTICES.zh-CN.md)和[英文许可原件](THIRD_PARTY_NOTICES.md)。
