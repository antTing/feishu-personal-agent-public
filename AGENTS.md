# 仓库 Agent 指令

- 安装或配置前，完整阅读 `INSTALL.md` 和 `SECURITY.md`。
- 将 `runtime/`、`managed-workspaces/`、环境文件、日志、会话、图片和本地缓存视为私密数据。除非主人明确要求某项诊断，否则不得检查或输出这些内容。
- 不得输出、复制到聊天、提交或上传 App Secret、Token、API Key、Cookie、飞书 ID、私密消息链接或完整个人路径。
- 配置初始化前必须暂停，请主人在独立终端或系统密钥环会话中设置秘密并运行 `./scripts/init-config.sh`。Agent 不得代为执行包含秘密的命令、在聊天中索取秘密或读取生成后的配置正文。非秘密的飞书身份值和工作区路径也要逐项确认，不得猜测、越过安全根目录搜索或从旧日志推断。
- 每条 Git 命令执行前都必须获得人类对完整命令的明确批准；确认分支不等于批准 Git 命令。
- 安装系统软件包、覆盖已有配置、删除数据、启用开机自启动或开放网络端口前必须询问。
- Bridge 和 Management 端点必须保持在 loopback；不得为了让测试通过而放宽白名单或审批门禁。
- 方案、审查和用户文档使用 Markdown，并优先使用中文。
- 修改后运行 `npm test --prefix feishu-connector`、`./scripts/release-check.sh` 以及相关预检或烟测。
