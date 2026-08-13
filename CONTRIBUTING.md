# 贡献指南

## 开发原则

- 保持 Connector 小而明确，不在其中增加隐藏的本地模型路由。
- 新能力默认最小权限，并为拒绝、超时、重复投递和重启场景添加测试。
- 不把提示词当作唯一安全控制；高风险操作必须有确定性策略或运行时审批。
- 普通目录和 Git 工作区都必须保持可用。

## 个人数据规则

贡献中不得包含真实飞书 App ID/Secret、用户/机器人/群 ID、消息链接、昵称、姓名、内部项目名、绝对个人路径、会话、日志、截图或二维码。测试使用 `example-owner-user`、`example-source-bot`、`example-group-chat`、`example-message`、`example-workspace` 等明显虚构值。

只提交 `config/` 中的脱敏模板。`runtime/` 永远是本机私有目录。

## 验证

```bash
npm ci --prefix feishu-connector
npm test --prefix feishu-connector
./scripts/release-check.sh
```

改动构建补丁时还需运行 `./scripts/build-cc-connect-local.sh`。补丁必须锁定上游版本、校验下载哈希，并在目标文本不精确匹配时失败。

新增或修改脚本时，应验证全新目录安装、重复运行、已有配置拒绝覆盖、文件权限以及 macOS/Linux 行为。

## 文档

面向使用者的方案、审计和说明统一使用 Markdown。示例不得依赖维护者本机路径、账号状态或私有工作区。
