# 安装指南

本文面向 macOS 和 Linux。Windows 建议在 WSL 中运行。服务默认以前台进程启动，适合个人电脑或单机 VM；它不是多租户 SaaS。

## 1. 前置条件

- Node.js 22 或更高版本，以及 npm。
- Go 1.25 或更高版本，用于在本机编译固定版本的 cc-connect。
- `curl`、`tar`、`shasum` 或 `sha256sum`、`pgrep`。
- Codex CLI，并完成一种可用的登录方式。
- 一个飞书企业自建应用，而不是群自定义 Webhook 机器人。

Codex CLI 的安装和登录方式可能变化，请以 [Codex CLI 官方文档](https://developers.openai.com/codex/cli) 为准。当前官方安装器示例为：

```bash
curl -fsSL https://chatgpt.com/codex/install.sh | sh
codex
```

首次运行 `codex` 时选择可用的登录方式。不要把 API Key 写入本仓库、安装提示词或飞书消息。Codex 会在会话启动时读取 `AGENTS.md`；发现规则见 [AGENTS.md 官方说明](https://developers.openai.com/codex/guides/agents-md)。

## 2. 获取源码与依赖

```bash
git clone https://github.com/antTing/feishu-personal-agent-public.git
cd feishu-personal-agent-public
npm ci --prefix feishu-connector
```

若让 Agent 执行安装，任何 `git clone`、`git pull` 或其他 Git 命令仍应先由人明确批准。也可以下载发行包并解压，从而不使用 Git。

## 3. 创建飞书企业自建应用

按 [feishu-enterprise-app-setup.md](feishu-enterprise-app-setup.md) 完成：

1. 创建企业自建应用并启用机器人能力。
2. 选择“使用长连接接收事件”。
3. 订阅 `im.message.receive_v1`。
4. 申请最小消息权限并发布应用版本。
5. 在本机私密记录 App ID、App Secret 和主人用户的 `open_id`。
6. 如需其他机器人转交，再在本机私密记录允许的机器人 `open_id` 和群 `chat_id`。

这些值是私有配置，不得放入 Issue、README、截图或提交记录。应用自身机器人 ID 由 Connector 启动时自动查询，不需要写入公开模板。

## 4. 生成私有配置

配置生成器只把真实值写入被忽略的 `runtime/`，文件权限为 `600`。它还会生成相互独立的 Bridge Token 和 Management Token，且不会打印 Token。

在当前 shell 中设置必要值：

```bash
export FEISHU_APP_ID='填写应用 App ID'
read -r -s FEISHU_APP_SECRET
export FEISHU_APP_SECRET
export FEISHU_OWNER_OPEN_ID='填写主人用户 open_id'
```

如需接收其他机器人转交，再设置逗号分隔的白名单：

```bash
export FEISHU_ALLOWED_BOT_IDS='填写允许的机器人 open_id'
export FEISHU_ALLOWED_BOT_CHAT_IDS='填写允许的群 chat_id'
```

可选：首次就登记一个获准工作区。它既可以是 Git 仓库，也可以是普通目录。

```bash
export WORKSPACE_NAME='approved-workspace'
export WORKSPACE_PATH='/absolute/path/to/approved-workspace'
export WORKSPACE_SEARCH_ROOTS='/absolute/path/to/safe-parent'
```

生成配置：

```bash
./scripts/init-config.sh
unset FEISHU_APP_SECRET
```

如果已有配置，脚本会拒绝覆盖。只有在停止服务并明确轮换配置时才使用：

```bash
./scripts/init-config.sh --force
```

`--force` 会完整重建配置，不应用于日常 Token 轮换。已经安装后的轮换流程见 [OPERATIONS.zh-CN.md](OPERATIONS.zh-CN.md)。

`--force` 会生成新的本地 Token，因此旧进程必须重启。它不会删除已有会话或工作区状态。

可用环境变量：

| 变量 | 必填 | 说明 |
|---|---:|---|
| `FEISHU_APP_ID` | 是 | 企业自建应用 App ID |
| `FEISHU_APP_SECRET` | 是 | 企业自建应用 App Secret |
| `FEISHU_OWNER_OPEN_ID` | 是 | 可审批和停止任务的主人用户 |
| `FEISHU_ALLOWED_BOT_IDS` | 否 | 允许转交任务的机器人 ID，逗号分隔 |
| `FEISHU_ALLOWED_BOT_CHAT_IDS` | 否 | 允许机器人转交的群 ID，逗号分隔 |
| `WORKSPACE_NAME` | 否 | 初始工作区的公开别名 |
| `WORKSPACE_PATH` | 否 | 初始工作区绝对路径；必须与名称同时设置 |
| `WORKSPACE_SEARCH_ROOTS` | 登记初始工作区时是 | 未登记工作区只允许在这些明确安全根目录查找 |
| `WORKSPACE_MANAGED_ROOT` | 否 | 新空工作区的专用根目录 |
| `CC_BRIDGE_PORT` | 否 | 默认 `9810`，仅监听 loopback |
| `CC_MANAGEMENT_PORT` | 否 | 默认 `9820`，仅监听 loopback |

## 5. 构建 cc-connect

项目不发布作者机器上的二进制。构建脚本下载固定的 cc-connect v1.4.1 源码包、校验 SHA-256、精确应用本地安全补丁，然后在目标机器生成 `runtime/bin/cc-connect-local`：

```bash
./scripts/build-cc-connect-local.sh
```

若下载哈希或补丁目标不匹配，脚本会停止。不要跳过校验，也不要用来源不明的预编译二进制替换。

## 6. 检查与启动

```bash
npm test --prefix feishu-connector
./scripts/release-check.sh
./scripts/preflight.sh
./scripts/start-background.sh
./scripts/status.sh
```

`start-background.sh` 在后台启动 cc-connect、Connector 和需要的 Codex 子进程。`status.sh` 查看状态，`stop.sh` 停止。首次排障也可使用 `start.sh` 前台启动，按 `Ctrl-C` 停止。当前版本不自动安装 launchd 或 systemd 服务。完整运维流程见 [OPERATIONS.zh-CN.md](OPERATIONS.zh-CN.md)。

后台命令应由本人在普通终端执行。Codex、CI 或其他受管终端可能在命令返回后回收后台进程组，即使使用 `nohup` 也不能视为可靠托管。

若要生成可以上传到代码托管平台的干净目录，而不是直接压缩当前工作目录：

```bash
./scripts/export-public.sh /tmp/feishu-personal-agent-public
```

导出器会在返回成功前自动扫描完整导出树；目标目录必须不存在且位于源码树之外。

不要把 `runtime/` 复制到发布目录。

## 7. 飞书验收

直连模式可以先私聊企业应用机器人完成端到端验证：

```text
你好
你能做什么？
任务状态
```

其中“你好”和“你能做什么？”会进入 Codex，用于验证完整模型链路并产生相应模型用量；`任务状态` 由 Connector 本地处理。

如果采用 Aily 前台分流模式，问候和测试应留在 Aily，不要转交。先由主人向本地机器人发送 `任务状态` 验证 Connector，再让 Aily 在白名单群中明确 `@` 本地机器人，转交一个确实需要访问本机的只读任务。

再在白名单群中明确 `@` 机器人发送一个只读任务。若配置了来源机器人，让该机器人在同一白名单群中明确 `@` 当前机器人转交一条任务。

验收结果应满足：

- 非白名单用户、未 `@` 群消息和非白名单机器人不触发任务。
- 回复引用原消息；群回复同时 `@` 原发送者。
- `任务状态` 能显示任务编号；`停止任务 T-XXXXXXXX` 能停止指定任务。
- Git 工作区的开发任务先询问分支；普通目录不要求分支。
- 写文件或执行命令时返回一次性操作审批。

## 8. 让 Agent 代装

把下面提示词交给 Codex、Claude Code 或其他有本机终端权限的 Agent：

```text
请参考 https://raw.githubusercontent.com/antTing/feishu-personal-agent-public/main/INSTALL.md 帮我安装和配置。

要求：
1. 先完整阅读 INSTALL.md、SECURITY.md 和当前目录的 AGENTS.md，只读检查环境并列出缺失依赖、拟执行命令和拟修改文件。
2. 不要读取、打印、记录或提交已有密钥。执行到第 4 节配置 App Secret 和本地 Token 前必须暂停，由我在另一个终端亲自运行环境变量设置和 `./scripts/init-config.sh`；不要代我执行带秘密环境变量的命令。初始化完成后，你只能检查配置文件是否存在、权限是否为 600/700，不能读取或回显内容。非秘密身份 ID、Codex 登录和工作区路径逐项确认。
3. 任何 Git 命令、系统软件安装、权限扩大、删除、覆盖已有配置或开机自启动都必须先获得我的明确批准。
4. 只使用 runtime/ 保存真实配置，权限设为 600/700；随机生成 Bridge 和 Management Token，不向公网或局域网开放端口。
5. 不要替我创建或发布飞书应用，也不要猜测 ID、工作区路径或登录方式。
6. 完成后运行 npm test、scripts/release-check.sh 和 scripts/preflight.sh，汇报结果但不回显密钥或完整本地路径。
7. 不要在 Agent 受管终端中把服务当作后台常驻；验证完成后停止前台进程，并提示我在本人普通终端执行 `./scripts/start-background.sh`。
```

Agent 可以完成依赖检查、目录准备、构建、测试和前台验证；包含秘密的配置生成命令、飞书后台操作、身份值提供、Codex 登录、高风险动作和最终后台启动仍由人负责。

## 9. 故障排查

`preflight` 提示 Codex 未登录：若使用交互式登录，在终端运行 `codex` 并完成登录后重试；若使用其他受支持的认证方式，请单独验证一次 Codex 调用。需要把未登录视为预检失败时，运行 `PREFLIGHT_REQUIRE_CODEX_AUTH=1 ./scripts/preflight.sh`。

Connector 无法收到消息：确认使用企业自建应用、长连接事件已启用、`im.message.receive_v1` 已订阅、权限对应的应用版本已经发布，且当前用户在可用范围内。

群消息无响应：必须明确 `@` 当前机器人；用户需在 `allowedUserIds`，机器人转交还要求群和来源机器人都在白名单。

Bridge 未连接：检查两个私有配置中的端口和 Token 是否由同一次 `init-config` 生成，且端口没有被其他进程占用。

工作区未找到：只会在 `searchRoots` 下精确查找。提供准确路径或扩大一个最小安全搜索根；不要把个人主目录或文件系统根目录作为搜索根。

## 10. 更新、轮换和卸载

更新源码前先停止服务。重新安装 Node 依赖、运行构建脚本和全部检查，再启动。任何 Git 更新命令必须遵循使用者自己的审批规则。

若凭据出现在日志、截图、聊天、提交或发行包中，立即在飞书后台轮换 App Secret，并按 [OPERATIONS.zh-CN.md](OPERATIONS.zh-CN.md) 使用 `rotate-secrets.sh` 同步更新 App Secret 和两个本地 Token。删除文件不能撤销已经泄露的凭据。

卸载时先停止服务，再由人确认是否删除 `runtime/` 和 `managed-workspaces/`。它们可能包含会话、审批状态、日志和用户工作成果，安装脚本不会自动删除。
