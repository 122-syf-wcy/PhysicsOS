# PhysicsOS 发布手册

发布只从已通过 CI 的 commit 或 tag 开始。生产部署、备份和恢复的完整操作以 [`13-DEPLOYMENT-OPERATIONS.md`](./13-DEPLOYMENT-OPERATIONS.md) 为准，本页只描述发布入口、签名材料和检查清单。

## 服务端镜像发布

1. 确认候选 commit 的 CI、`docker compose config --quiet` 和部署改动验证全部通过。
2. 创建不可变的语义化 tag，例如 `v0.2.0`，再推送 tag。
3. tag 会触发 [`.github/workflows/release.yml`](../.github/workflows/release.yml)，构建并推送 `linux/amd64` 镜像到 GHCR，然后创建 GitHub Release。
4. 也可以手动触发该 workflow，填写已有 tag，并选择草稿发布。
5. 记录 commit SHA、镜像 digest、Compose 修订、迁移版本（如有）和发布人；部署时使用 digest，不要只依赖可移动 tag。

镜像名称由仓库路径决定，Tag 由语义化版本派生；预发布版本不会自动更新 `latest`。

## 桌面端发布

[`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml) 在 `v*` tag 或手动触发时构建：

- macOS arm64：`.app` 与 `.dmg`
- macOS x86_64：`.app` 与 `.dmg`
- Windows x86_64：NSIS `.exe` 与 MSI `.msi`

缺少签名材料时 workflow 会生成未签名构建，只适合内部验证，不应作为公测安装包。

### 签名与更新材料

macOS 代码签名需要 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD` 和
`APPLE_SIGNING_IDENTITY`。公证需要 `APPLE_ID`、`APPLE_PASSWORD`、`APPLE_TEAM_ID`，并与当前
workflow 注入的 secrets 保持一致。Windows 需要 `WINDOWS_CERTIFICATE`、
`WINDOWS_CERTIFICATE_PASSWORD`，或已安装证书的 `WINDOWS_CERTIFICATE_THUMBPRINT`。证书、密码和
API private key 只能来自受保护的 release environment，不能写入仓库、release config、命令行参数或日志。

Tauri 更新包同时需要：

- `PHYSICSOS_DESKTOP_UPDATE_PUBKEY`
- `PHYSICSOS_DESKTOP_UPDATE_ENDPOINT`
- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（私钥有密码时）

发布前运行 `pnpm run desktop:release-config`；它会拒绝开发 key、占位域名、非 HTTPS endpoint 和仍指向开发页的构建。`update-host` 只托管 `latest.json` 清单，不托管安装包；安装包和对应 `.sig` 需要先上传到稳定 HTTPS 地址，再通过 `update-host` 的管理接口登记版本、发布或回滚。接口和通道规则见 [`overlays/harness/files/packages/physicsos/update-host/README.md`](../overlays/harness/files/packages/physicsos/update-host/README.md)。

`update-host` 对服务端收到的签名只做形状检查，不能替代密码学验签。发布前必须让客户端或 Tauri
CLI 用嵌入的公钥验证安装包与 `.sig`；校验失败时不得登记新版本。

## 数据库备份与恢复

发布前按 [`13-DEPLOYMENT-OPERATIONS.md`](./13-DEPLOYMENT-OPERATIONS.md) 完成 PostgreSQL、Redis 和 `app_data` 的协调备份，并验证备份 manifest。恢复属于破坏性操作，必须安排维护窗口、明确恢复点并完成恢复演练；不要在本页复制或改写恢复命令。

## 发布前检查清单

- [ ] 候选 commit 的 CI、lint、测试和构建全部通过。
- [ ] `.env` 与七类生产 secret 文件未被提交，权限和轮换状态已确认。
- [ ] PostgreSQL、Redis 和 `app_data` 已有可验证备份，恢复演练结果已记录。
- [ ] `docker compose config --quiet`、`/healthz` 和 `/readyz` 通过，反代与 `PHYSICOS_TRUSTED_PROXIES` 已核对。
- [ ] 镜像 digest、桌面安装包 checksum 和签名材料已记录。
- [ ] `latest.json` 的版本、平台、URL 和签名与实际上传产物一致。
- [ ] 发布说明写明已知限制、回滚方式、数据迁移影响和操作人。
