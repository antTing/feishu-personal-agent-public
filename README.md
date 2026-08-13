# 飞书个人 AI Agent

一个尽量简单的本地个人 Agent：使用飞书企业自建应用接收消息，通过 cc-connect Bridge 管理会话，最终交给 Codex 分析或执行。

```text
飞书企业自建应用
  -> 官方 WebSocket 长连接
  -> Feishu Connector
  -> cc-connect Bridge（仅 localhost）
  -> cc-connect
  -> Codex
```

这个项目不包含多模型 Router、Dify、n8n 或复杂工作流引擎。入口、权限和任务状态放在 Connector，模型会话与生命周期交给 cc-connect，实际推理和开发任务由 Codex 完成。

## 能做什么

- 私聊或在群中 `@` 企业自建应用机器人发起任务。
- 接收白名单内其他机器人转交的文本、富文本、卡片文字和链接。
- 引用原消息回复，并在群内 `@` 原发送者。
- 显示任务编号、执行/排队状态和耗时，支持按编号停止任务。
- 默认不因会话空闲自动切换；安装者可按需配置会话轮换。
- 把不同工作区映射到独立的只读和开发会话。
- Git 仓库在开发前确认目标分支；普通目录不强制要求 Git。
- 写文件、命令、Git 和其他有副作用的操作通过一次性审批继续。

## 安全默认值

- 飞书用户、来源机器人和群都使用显式白名单。
- Bridge 与 Management API 仅监听 `127.0.0.1`，并使用独立随机 Token。
- 真实配置、会话、日志和构建产物都在被忽略的 `runtime/` 中。
- 配置文件权限为 `600`，运行目录权限为 `700`。
- 不启用 cc-connect Web UI、`yolo` 或宿主机高权限入口。
- 不发布本机二进制；安装时固定版本、校验源码包哈希并在目标机器构建。

MCP、提示词和白名单都不是操作系统沙箱。不要把生产数据库写账号、Docker Socket、SSH 私钥或云平台管理员凭据放入 Agent 可读目录。

## 快速开始

完整步骤见 [INSTALL.md](INSTALL.md)。配置好依赖和飞书应用后，核心命令是：

```bash
npm ci --prefix feishu-connector
./scripts/init-config.sh
./scripts/build-cc-connect-local.sh
./scripts/preflight.sh
./scripts/start-background.sh
./scripts/status.sh
```

`init-config.sh` 从环境变量读取飞书凭据和白名单，不打印密钥，并生成两个本地随机 Token。已有配置默认不会被覆盖。

也可以直接把下面这句话交给 Codex、Claude Code 或其他本地 Agent：

```text
请参考 https://raw.githubusercontent.com/antTing/feishu-personal-agent-public/main/INSTALL.md 帮我安装和配置。先完整阅读文档，列出缺失依赖和拟修改文件；不要读取、打印或提交密钥。到配置飞书 App Secret 和本地 Token 的步骤时必须暂停，由我在另一个终端亲自执行初始化；你不能代我执行带秘密环境变量的命令，只能在初始化完成后检查配置文件是否存在及权限是否正确。对非秘密身份 ID、Codex 登录和工作区路径逐项确认，也不要未经我明确批准执行任何 Git 操作。完成后运行测试、release-check 和 preflight。最后不要在 Agent 受管终端里后台启动，请提示我在本人普通终端执行 ./scripts/start-background.sh。
```

## 文档

- [INSTALL.md](INSTALL.md)：人工安装、Agent 代装、升级和故障排查。
- [USAGE.md](USAGE.md)：飞书命令、任务队列、停止、审批和工作区。
- [OPERATIONS.zh-CN.md](OPERATIONS.zh-CN.md)：后台运行、状态、停止、安全重启和凭据轮换。
- [feishu-enterprise-app-setup.md](feishu-enterprise-app-setup.md)：企业自建应用权限与事件配置。
- [permissions-and-capabilities.md](permissions-and-capabilities.md)：权限边界与扩展顺序。
- [cost-and-workspace-access.md](cost-and-workspace-access.md)：各环节费用与工作区说明。
- [SECURITY.md](SECURITY.md)：密钥、发布和漏洞报告要求。
- [THIRD_PARTY_NOTICES.zh-CN.md](THIRD_PARTY_NOTICES.zh-CN.md)：第三方软件中文说明；许可法律正文仍以英文原件为准。

## 发布前检查

```bash
npm test --prefix feishu-connector
./scripts/release-check.sh
./scripts/preflight.sh
```

`release-check` 是本项目的启发式脱敏检查，扫描公开文件和导出树，拒绝飞书具体 ID、个人绝对路径、真实密钥、私人链接、环境文件、会话、二进制和其他私密运行时数据。它不能替代托管平台的 Secret Scanner 和人工审查。它故意不读取本机 `runtime/`；打包和发布时必须继续排除整个目录。

需要生成不含本机运行数据的发布目录时，使用一个不存在的目标路径：

```bash
./scripts/export-public.sh /tmp/feishu-personal-agent-public
```

脚本只复制公开清单，并跳过 `runtime/`、依赖、缓存、日志、图片和密钥文件；完成前还会扫描整棵导出树。

## 费用

Connector 和 cc-connect 本身没有按消息软件费。本机计算、网络和电力由运行者承担。飞书企业自建应用使用租户的消息/OpenAPI 配额；若上游智能体先生成转交消息，该智能体可能另行计费。Codex 模型消费取决于安装者选择的登录方式、账户和当时的产品条款，项目不会根据本机状态作固定承诺。

## 许可

本项目使用 MIT License。patched cc-connect 仍遵循其上游许可和归属要求，见[第三方软件中文说明](THIRD_PARTY_NOTICES.zh-CN.md)和[英文许可原件](THIRD_PARTY_NOTICES.md)。
