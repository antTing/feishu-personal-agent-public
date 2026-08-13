# 第三方软件声明

英文原始说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本文件仅方便中文阅读，不替代第三方许可原文；如有差异，以英文原件及第三方随附许可为准。

## cc-connect

- 项目：[chenhg5/cc-connect](https://github.com/chenhg5/cc-connect)
- 固定源码版本：`v1.4.1`
- 许可：MIT。上游 v1.4.1 README 声明使用 MIT，但该版本源码压缩包没有单独的 `LICENSE` 文件。

`scripts/build-cc-connect-local.sh` 会下载固定源码、校验压缩包哈希，并应用 `scripts/patch-cc-connect-local.mjs` 中的窄范围补丁。生成的本机二进制不包含在公开源码包中。

若分发 patched cc-connect 二进制，必须同时保留上游源码或 README 归属信息、本项目第三方声明以及 MIT 许可文本。随本项目保存的文本见 [`third-party/cc-connect-MIT.txt`](third-party/cc-connect-MIT.txt)，上游源码与归属信息仍为权威来源。

## 飞书/Lark OpenAPI Node SDK

- 包：[`@larksuiteoapi/node-sdk`](https://www.npmjs.com/package/@larksuiteoapi/node-sdk)
- 许可：MIT
- Copyright: Copyright (c) 2022 Lark Technologies Pte. Ltd.

固定包随附的许可声明保存在 [`third-party/lark-node-sdk-MIT.txt`](third-party/lark-node-sdk-MIT.txt)。间接依赖的名称、版本、完整性哈希和声明许可记录在 `feishu-connector/package-lock.json` 中；再分发者仍需自行核对并履行所有间接依赖义务。

## OpenAI Codex 命令行工具（CLI）

Codex CLI 是外部运行依赖，本项目不再分发它。安装、账户访问、用量与费用遵循 OpenAI 当前条款和官方文档。
