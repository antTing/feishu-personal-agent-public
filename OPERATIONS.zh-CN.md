# 本地运行与维护

本文只说明安装完成后的本地运行、状态检查、停止和凭据轮换。首次安装请先阅读 [INSTALL.md](INSTALL.md)，权限边界见 [SECURITY.md](SECURITY.md)。

## 服务命令

前台启动，适合首次验收和查看即时错误：

```bash
./scripts/start.sh
```

后台启动：

```bash
./scripts/start-background.sh
```

后台脚本会把服务放入独立进程会话，不依赖当前终端持续打开。它不是开机自启动服务，重启电脑后仍需重新运行。Codex、CI 或其他受管执行环境仍可能主动清理其全部子进程，因此正式运行请由本人普通终端启动。本文不自动安装 `launchd` 或 `systemd`。

查看状态：

```bash
./scripts/status.sh
```

停止服务：

```bash
./scripts/stop.sh
```

状态命令只显示进程及本机 Bridge、Management 端点是否就绪，不打印 Token、飞书 ID 或完整配置。只有飞书长连接和 Bridge 都健康时才显示就绪；任一通道断开会立即降级，自动重连成功后恢复。后台日志属于私有运行数据，位于 `runtime/`；不要上传、粘贴到聊天或加入发行包。

后台模式不记录 cc-connect 原始输出；Connector 启动失败只写固定错误码，避免会话键、身份值或路径进入日志。需要查看 cc-connect 细节时，应由主人在本机前台临时运行并自行脱敏，不能把原文交给 Agent。

后台日志每次启动前都会截断，只保留本次启动的诊断信息，不作为长期审计日志。

这些命令不会安装 launchd、systemd 或其他开机自启动服务。要启用开机自启动，必须由机器所有者另行评估并明确批准。

## 安全重启

配置或本地二进制更新后，按以下顺序重启：

```bash
./scripts/stop.sh
./scripts/preflight.sh
./scripts/start-background.sh
./scripts/status.sh
```

停止会中断正在执行和排队的任务。先在飞书发送 `任务状态`，确认没有需要保留的任务。

## 轮换本地 Token

Bridge Token 和 Management Token 只用于本机组件之间通信。轮换前必须停止服务：

```bash
./scripts/stop.sh
./scripts/rotate-secrets.sh
./scripts/preflight.sh
./scripts/start-background.sh
```

轮换脚本会同时更新 Connector 与 cc-connect 的对应值，并保留飞书 App ID、App Secret、白名单、工作区和状态文件。它不会在终端打印新 Token；服务运行中会拒绝执行。

轮换使用私有事务日志。若进程被强制终止或机器断电，下次运行轮换命令会先把两份配置整组恢复到轮换前版本，再开始新的轮换，避免本机 Token 新旧混配。恢复失败时脚本保持停止并拒绝继续，交给主人在本机处理。

不要用 `init-config.sh --force` 轮换本地 Token。该命令是完整重建配置，可能覆盖白名单或工作区设置。

## 轮换飞书 App Secret

App Secret 必须先由主人在飞书开发者后台重置。不要把新 Secret 发到聊天、交给 Agent 或写入 shell 历史。随后在一个不被 Agent 记录的独立终端中执行：

```bash
./scripts/stop.sh
read -s FEISHU_APP_SECRET
export FEISHU_APP_SECRET
./scripts/rotate-secrets.sh
unset FEISHU_APP_SECRET
./scripts/preflight.sh
./scripts/start-background.sh
```

若同时更换 App ID，可在同一独立终端设置 `FEISHU_APP_ID`；更换 App ID 时必须同时提供对应的 App Secret。轮换脚本不会修改主人、来源机器人或群白名单。

App Secret 在该终端环境中短暂存在，执行完立即 `unset`。若怀疑终端录屏、调试日志或进程环境被其他用户读取，应改用系统钥匙串或受控 Secret Manager，并再次轮换。

## 会话空闲提示

公开默认配置中 `reset_on_idle_mins = 0`，不会仅因空闲自动切换会话。若飞书仍提示“因空闲超过 30 分钟，已自动切换到新会话”，通常是旧进程还没重启，或实际运行的项目配置仍为非零值。

完成安全重启后再验证。不要通过读取或粘贴完整私有配置排查；只在本机确认对应项目的该字段和进程启动时间。

## 任务进度与停止

飞书内发送：

```text
任务状态
停止任务 T-XXXXXXXX
```

同一发送者、同一工作区的任务顺序执行；不同会话可以并行。多个活动任务必须按任务编号停止，详见 [USAGE.md](USAGE.md)。

## 故障恢复

- `status.sh` 显示没有服务状态：服务未运行，可在 preflight 通过后启动。
- 显示服务状态已过期：先执行 `stop.sh`。若记录的进程仍存在，脚本会拒绝自动接管或清理，必须由主人在本机确认；这可以避免电脑休眠、进程暂停或 PID 复用时误停其他进程。停止脚本通过私有心跳和一次性控制请求工作，不会直接按状态文件中的 PID 向进程发信号。
- 进程运行但 Bridge 或 Management 未就绪：执行 `stop.sh`，在本机私下检查 `runtime/` 日志，不要把日志原文发给 Agent。
- 后台启动后很快退出：可运行 `./scripts/diagnose-startup.mjs`。它只输出固定错误类别，不输出日志原文、ID、Token 或完整路径；未命中类别时由主人在本机私下查看原文。
- 在 Codex 或 CI 里显示“已启动”后立即消失：改由本人普通终端执行 `./scripts/start-background.sh`；不要让 Agent 私自创建开机启动项。
- `rotate-secrets.sh` 拒绝执行：先停止服务；若服务状态异常，由主人在本机检查对应进程后处理，不要强制覆盖。
- 提示控制锁残留：这表示另一个启动、停止或轮换操作正在进行，或上次操作异常退出。不要直接删除；先在本机确认没有相关进程，再由主人处理 `runtime/` 中的私有锁。
- 飞书收不到消息：核对企业自建应用版本、事件订阅、权限、可用范围和白名单，参见 [feishu-enterprise-app-setup.md](feishu-enterprise-app-setup.md)。

脚本不会自动强制终止未退出的进程，也不会删除会话、工作区或任务状态。需要强制终止或清理数据时必须由主人确认具体目标。

## 重建空间要求

`build-cc-connect-local.sh` 会在隔离临时目录中下载并编译 Go 依赖，成功后才原子替换本机二进制；失败不会覆盖已有可用版本。首次干净构建可能需要数 GiB 可用磁盘空间。空间不足时脚本会失败并清理本次临时构建目录，不会替用户删除缓存、日志或其他文件。
