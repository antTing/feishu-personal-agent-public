# 飞书连接器

> 兼容模式：新安装请使用仓库根目录 README 中的“cc-connect 原生 Feishu”方案。本目录只为现有 Bridge 部署迁移期间保留，原生 PoC 通过后会移除。

飞书企业自建应用与 cc-connect Bridge 之间的轻量连接器：

```text
企业自建应用长连接 -> Feishu Connector -> localhost Bridge -> cc-connect -> Codex
```

它负责：

- 使用 App ID / App Secret 建立官方 WebSocket 长连接。
- 校验用户、来源机器人和群白名单，以及群聊精确 `@` 规则。
- 解析文本、富文本、卡片文字和链接，并做短期消息去重。
- 把消息路由到获准的 cc-connect project。
- 引用原飞书消息回复，在群内 `@` 原发送者。
- 管理任务编号、执行状态、排队和停止请求。
- 处理工作区、分支和一次性工具审批。

它不在本地回答问题、分类意图或提供模型能力，因此获准消息都会进入 cc-connect/Codex。

## 配置与运行

默认配置为 `runtime/feishu-connector/config.json`，也可通过 `FEISHU_CONNECTOR_CONFIG` 指定一个同样的私有运行布局：Connector 配置所在目录放 `workspaces.json` 和 `permissions.json`，其相邻的 `../cc-connect/` 目录放 `config.toml`。这些文件必须是普通文件并使用 `600` 权限；目录使用 `700`。

```bash
npm ci --prefix feishu-connector
npm test --prefix feishu-connector
./scripts/start-feishu-connector.sh
```

不要提交 `runtime/`、日志、会话、截图、二维码或本机二进制。Connector 日志只应记录连接和状态，不记录消息正文、用户 ID 或 Token。

## 机器人转交

白名单内其他机器人可在获准群中明确 `@` 当前企业应用机器人转交任务。应用需要 `im:message.group_at_msg.include_bot:readonly` 权限；不需要也不建议为了这个功能申请读取群全部消息。

机器人私聊、未 `@`、非白名单群、自身消息和回复回环都会被忽略。旧 Connector 不下载图片、附件和语音；这是改用原生 cc-connect 的主要原因之一。

## 工作区

- 已登记工作区分别映射 read/dev project。
- 只读任务进入 `suggest`；开发任务进入 `app_server + suggest`，由飞书承接工具审批。
- 根目录是 Git 仓库时，开发前确认目标分支；根目录是普通目录时不设置分支门禁。
- 未登记项目先返回工作区审批，不会直接启动 Codex。
- 查找结果不唯一或找不到项目来源时暂停，禁止猜路径或自动克隆。

## cc-connect 本机补丁

构建脚本固定 cc-connect v1.4.1 并校验源码包哈希，然后应用小范围补丁：允许全局 Bridge 下的 Bridge-only project；Bridge/Management 固定监听 loopback；未知 project 返回错误；Bridge 支持转发 App Server 权限请求。补丁目标不精确匹配时安装立即失败。

详细安装和操作见仓库根目录 [INSTALL.md](../INSTALL.md) 与 [USAGE.md](../USAGE.md)。
