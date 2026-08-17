# 安装指南

本文安装的是推荐的“原生 cc-connect + 飞书企业自建应用”模式。旧版 `Feishu Connector -> Bridge` 只用于兼容已有部署；不要把两个模式同时接到同一个飞书应用。

## 1. 前置条件

- macOS、Linux 或 WSL；
- Node.js 22+、npm；
- Go 1.25+（用于构建固定版本 cc-connect）；
- `curl`、`tar`、`shasum` 或 `sha256sum`；
- Codex CLI，或带有可复用内置执行器的 ChatGPT/Codex 桌面应用，并完成登录；
- 一个可以创建企业自建应用的飞书账号。应用、机器人、权限、事件和身份值由安装器自动处理。

启动脚本会优先使用当前 `PATH` 中的 `codex`；macOS 找不到时，会自动尝试复用 ChatGPT/Codex 桌面应用内置的执行器，不要求重复安装。仍找不到或版本不支持 `app-server` 时，再按[官方文档](https://developers.openai.com/codex/cli)安装或更新 Codex CLI。不要把 API Key 写入仓库、Agent 提示词或飞书消息。

## 2. 获取源码和构建本机 cc-connect

可以由本人手动下载发行包，也可以让 Agent 先提出命令并在你批准后执行。任何 Git 命令都必须由你针对完整命令明确批准。

仓库地址为 [antTing/feishu-personal-agent-public](https://github.com/antTing/feishu-personal-agent-public)。可以在 GitHub 下载并解压源码包；使用 Git 时，在明确批准完整命令后执行：

```bash
git clone https://github.com/antTing/feishu-personal-agent-public.git
cd feishu-personal-agent-public
```

进入源码目录后安装依赖并构建：

```bash
npm ci --prefix feishu-connector
./scripts/build-cc-connect-local.sh
```

构建脚本固定 cc-connect v1.4.1，校验源码包 SHA-256，并应用本地安全补丁。项目不发布作者机器上的二进制。

## 3. 一键创建应用并自动配对

默认安装不要求你去开放平台查找或复制 App ID、App Secret、主人 `open_id`、群 `chat_id` 或 Aily 机器人 `open_id`。运行：

```bash
./scripts/onboard-native.sh --workspace '/绝对路径/到/工作区'
```

运行前会先验证本机存在支持 `app-server` 的 Codex 执行器，避免创建完飞书应用后才发现执行端不可用。安装器随后会按顺序完成：

1. 打开飞书官方的一键建应用授权页；
2. 复用飞书官方 `PersonalAgent` 基座，并增量声明消息权限、`im.message.receive_v1` 事件和 `card.action.trigger` 回调；
3. 你在浏览器确认应用名称和权限；安装器随后逐项核对实际授权结果，缺权限时自动向企业管理员发起审批。管理员批准后重新运行同一命令继续；
4. App ID 和 App Secret 直接写入本机 `600` 私有状态，不在终端显示；
5. 扫码账号已经确定为主人。安装器在本机浏览器显示执行群配对码；把新机器人加入目标执行群，由主人按页面提示在该群 `@` 一次，安装器只用这条消息取得并确认执行群 `chat_id`；
6. 浏览器显示 Aily 配对码；让 Aily 在同一群按页面提示 `@` 一次，识别候选调度机器人；
7. 浏览器显示确认和拒绝两条命令；主人先核对群里报到的机器人。正确时回复 Aily 的那条配对消息并 `@` 新机器人确认；不正确时回复同一条消息并发送拒绝命令，安装器会清除候选并生成新的调度配对码；
8. 只有主人确认后，安装器才写入严格的 `allow_from`、`allow_chat` 和 `approval_from`；
9. 完成后删除临时配对状态和本机配对页面。

配对阶段只监听明确 `@` 新机器人且包含完整一次性随机码的文本、富文本或卡片消息，不启动 Codex，也不会执行任何任务。只要最终配置尚未安装，中断或等待超时都可以重新运行同一命令继续配对；应用凭据已经写入本机私有状态后不会再次创建应用。若机器在飞书已创建应用、但本机尚未来得及保存凭据的极短窗口断电，可能留下一个未绑定应用；安装器不会擅自删除它，应由主人在飞书中确认后处理。若最终配置已经写入而清理状态时中断，下一次运行会校验并清理匹配的临时状态，不会覆盖配置或重复创建应用。

不使用 Aily、只让主人直接使用时运行：

```bash
./scripts/onboard-native.sh --without-dispatcher --workspace '/绝对路径/到/工作区'
```

浏览器无法自动打开时，安装器会停止，避免把一次性值暴露给代装 Agent。本人可以在独立终端加 `--no-open --show-pairing-codes` 继续；这时终端会显示短时授权链接和配对码。它们只能按页面指引用于本次官方授权和指定执行群的配对消息，不得转发到其他会话、Issue 或日志中。

如果异常断电留下安装锁，先确认没有其他安装器运行，再由本人显式追加 `--recover-lock` 重试。代装 Agent 不得自行使用该选项，也不得检查私有锁正文。

详细权限和人工审批边界见 [feishu-enterprise-app-setup.md](feishu-enterprise-app-setup.md)。`init-native-config.sh` 仅保留为已有应用的高级恢复入口，新安装不需要手工填写任何飞书 ID 或密钥。

工作区可以是 Git 仓库，也可以是没有 Git 的普通目录。原生第一阶段使用一个固定工作区；未知工作区、只读/开发拆分和分支门禁先由 Aily/主人确认，不能让消息直接传入任意路径。

自动安装不会覆盖已有配置，也不会自动删除未完成的应用或私有状态。

## 4. 前台验证

```bash
./scripts/start-native.sh
```

看到 cc-connect 成功建立 Feishu WebSocket 后，在执行群中发送一个明确 `@` 本地机器人的只读任务。原生模式应能显示思考/工具进度，并能接收图片或文件。先不要让任务修改文件或运行生产命令。

停止前台进程使用 `Ctrl-C`。当前 `v0.2` 只验证了这个前台入口，尚未提供适配本项目 Codex PATH 发现逻辑的一键 launchd/systemd 安装器。不要直接安装 cc-connect daemon，也不要把受管 Agent 会话中的 `nohup` 当作可靠服务托管。

图片和文件会暂存在目标工作区的 `.cc-connect/`。如果目标工作区由版本控制管理，请由主人把 `.cc-connect/` 加入该项目自己的忽略规则；本项目的 `.gitignore` 不会影响外部工作区，安装器也不会擅自修改它。

## 5. 检查

```bash
npm test --prefix feishu-connector
./scripts/release-check.sh
```

这些检查不需要读取私有运行数据。配置问题只在本机终端排查，不要把配置内容、日志、会话或截图发给 Agent。

## 6. Aily 分流配置

Aily 只在任务确实需要本机能力时，在执行群中明确 `@` 本地机器人，并发送 [任务分发协议](docs/aily-dispatch-protocol.zh-CN.md)规定的 `DS/T` 封装。可直接以 [Aily 路由规则模板](config/aily-router.example.md)为起点配置系统提示词。问候、测试和已经由 Aily 能完成的飞书操作不要转交。

这份模板是协议参考，不是可运行的持久调度器。要实现同一 `DS` 排队、不同 `DS` 并行、重启恢复、去重和按 `T` 停止，必须在 Aily 平台的工作流/数据存储中实现相应状态机，或自行部署上游调度服务。仅有系统提示词时不要承诺这些语义；可先使用 `--without-dispatcher` 的主人直连模式。

## 7. 给 Agent 的安装提示词

```text
请阅读 https://raw.githubusercontent.com/antTing/feishu-personal-agent-public/main/INSTALL.md，按原生 cc-connect 模式帮我安装。

先完整阅读 INSTALL.md、SECURITY.md 和当前目录的 AGENTS.md，列出依赖、拟执行命令和拟修改文件。不要读取、打印、记录或提交任何密钥、Token、Cookie、飞书消息链接、一次性授权链接、配对码或完整个人路径。询问我工作区路径以及是否使用 Aily，然后可以按默认参数启动 onboard-native.sh；不要添加 --no-open、--show-pairing-codes 或 --recover-lock。浏览器授权、企业管理员审批、执行群配对、Aily 配对和主人最终确认由我在飞书界面完成。脚本生成私有状态和配置后，你只能检查文件存在和权限，不能读取正文。

任何 Git 命令、系统软件安装、删除、覆盖配置、开机自启动或网络端口变更都先向我询问。完成后运行测试和 release-check；不要在受管终端中后台启动服务，最后提示我在本人普通终端运行 ./scripts/start-native.sh。
```

## 8. 从旧 Connector 迁移

1. 记录旧服务当前状态，确认没有任务正在执行；
2. 停止旧服务；
3. 旧应用继续使用时可走高级恢复入口；更简单的做法是运行自动安装创建一个新的原生应用；
4. 启动原生 cc-connect 并完成只读、媒体、线程和停止验收；
5. 验收通过后再删除旧 Connector 的运行配置和会话（由主人确认，安装脚本不会自动删除）。

旧模式和原生模式不能并行消费同一应用的长连接事件，否则飞书可能把事件随机分给其中一个连接。
