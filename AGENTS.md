# 仓库 Agent 指令

- 安装或配置前，完整阅读 `INSTALL.md` 和 `SECURITY.md`。
- 将 `runtime/`、`managed-workspaces/`、环境文件、日志、会话、图片和本地缓存视为私密数据。除非主人明确要求某项诊断，否则不得检查或输出这些内容。
- 不得输出、复制到聊天、提交或上传 App Secret、Token、API Key、Cookie、飞书 ID、私密消息链接或完整个人路径。
- 新安装应使用 `./scripts/onboard-native.sh` 自动创建飞书应用并通过用户批准和一次性群消息配对取得身份值。Agent 可以按默认参数启动该脚本，但不得添加 `--no-open`、`--show-pairing-codes` 或 `--recover-lock`，不得在聊天中索取 App Secret 或飞书 ID，不得读取 `.onboarding.json`、生成后的配置正文、私有锁或旧日志；浏览器授权、企业审批和飞书内配对由主人确认。手工 `init-config.sh`/`init-native-config.sh` 只作恢复入口，包含秘密时仍须由主人在独立终端执行。
- 每条 Git 命令执行前都必须获得人类对完整命令的明确批准；确认分支不等于批准 Git 命令。
- 安装系统软件包、覆盖已有配置、删除数据、启用开机自启动或开放网络端口前必须询问。
- Bridge 和 Management 端点必须保持在 loopback；不得为了让测试通过而放宽白名单或审批门禁。
- 方案、审查和用户文档使用 Markdown，并优先使用中文。
- 修改后运行 `npm test --prefix feishu-connector`、`./scripts/release-check.sh` 以及相关预检或烟测。
