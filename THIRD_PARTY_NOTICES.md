# Third-Party Notices

中文说明见 [THIRD_PARTY_NOTICES.zh-CN.md](THIRD_PARTY_NOTICES.zh-CN.md)。本文件保留英文归属信息，若翻译与原文存在差异，以本文件及第三方随附许可为准。

This project integrates with or builds the following third-party software. Their licenses remain their own.

## cc-connect

- Project: [chenhg5/cc-connect](https://github.com/chenhg5/cc-connect)
- Pinned source version: `v1.4.1`
- License: MIT, as declared in the upstream v1.4.1 README. The v1.4.1 source archive does not include a separate `LICENSE` file; anyone redistributing the patched binary must retain the upstream source archive or README attribution and this notice.

`scripts/build-cc-connect-local.sh` downloads the pinned source, verifies its archive hash and applies the narrow patches in `scripts/patch-cc-connect-local.mjs`. The resulting binary is built locally and is not included in this repository. Distributors of that binary must ship the corresponding upstream source archive/README or equivalent MIT notice with the binary.

The license text recorded for this release is in [`third-party/cc-connect-MIT.txt`](third-party/cc-connect-MIT.txt). The upstream source and attribution remain authoritative.

## Lark OpenAPI Node SDK

- Package: [`@larksuiteoapi/node-sdk`](https://www.npmjs.com/package/@larksuiteoapi/node-sdk)
- License: MIT
- Copyright: Copyright (c) 2022 Lark Technologies Pte. Ltd.

The license notice distributed with the pinned package is preserved in [`third-party/lark-node-sdk-MIT.txt`](third-party/lark-node-sdk-MIT.txt). Transitive dependency names, versions, integrity hashes and declared licenses are recorded in `feishu-connector/package-lock.json`. Redistributors remain responsible for reviewing and satisfying all transitive license obligations.

## OpenAI Codex CLI

Codex CLI is an external runtime dependency and is not redistributed by this project. Installation, account access, usage and billing are governed by OpenAI's current terms and documentation.
