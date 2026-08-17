# 本地运行与维护

## 原生模式

首次验收在本人普通终端前台运行：

```bash
./scripts/start-native.sh
```

使用 `Ctrl-C` 停止。原生模式不启用 Bridge 或 Management，也不启动旧 Feishu Connector。

当前 `v0.2` 只验证了 `start-native.sh` 前台入口，尚未提供适配本项目 Codex PATH 发现逻辑的一键 launchd/systemd 安装器。不要直接绕过该脚本安装 cc-connect daemon；否则系统没有全局 Codex CLI 时，前台可用而后台可能启动失败。安装开机启动会改变系统状态，后续即使提供脚本也必须由主人明确确认。不要把 Codex/CI 受管终端中的 `nohup` 当作可靠服务托管。

原生模式当前通过飞书验证健康状态：

- 机器人能在执行群响应 `/help` 或 `/version`；
- 新任务显示处理中/工具进度；
- 图片或文件能进入任务；
- 当前任务的补充消息留在同一线程，不同根线程可并行；独立新 `T` 由 Aily 侧排队；
- 对应线程中的 `/stop` 能停止当前会话。

## 旧 Connector 兼容模式

以下命令只用于现有旧部署：

```bash
./scripts/start-background.sh
./scripts/status.sh
./scripts/stop.sh
```

它们会启动 Feishu Connector、Bridge 和 Management，不是原生模式的控制命令。迁移完成前保留；新安装不要使用。

旧版的 App Secret 和本地 Token 轮换仍使用：

```bash
./scripts/stop.sh
./scripts/rotate-secrets.sh
```

原生模式只有一份 cc-connect 配置，不使用 Bridge/Management Token。新安装通过 `onboard-native.sh` 自动取得凭据和身份。App Secret 轮换或改绑既有应用属于恢复操作：先停止原生进程，由主人在飞书开放平台或独立终端完成，Agent 不得读取、代填或回显 Secret；不要为了轮换直接重跑自动建应用流程，否则会创建新的应用。

若安装器因断电或 `SIGKILL` 留下私有锁，主人先确认没有其他安装器进程，再在本人独立终端对原命令追加 `--recover-lock`。该选项只回收已确认死亡进程的锁，不读取或显示 App 凭据；PID 仍存活或锁格式异常时会拒绝操作。代装 Agent 不得自行执行恢复。

## 切换模式

1. 确认没有执行中或排队任务；
2. 停止当前模式；
3. 等待飞书长连接释放；
4. 启动另一个模式；
5. 做一次只读、媒体、线程和停止验收。

同一个飞书应用不能同时由两种模式消费事件。

## 私有日志

日志、会话、附件和配置都在 `runtime/`，不得上传或粘贴给 Agent。排障时只报告稳定错误类别；如果需要查看原文，由主人在本机完成并先脱敏。服务脚本不会自动删除私有数据或强制终止无法确认身份的进程。
