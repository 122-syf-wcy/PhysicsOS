# 安全策略

## 支持的版本

| 版本                     | 支持状态                   |
| ------------------------ | -------------------------- |
| `main` 分支 / 最新 0.1.x | 接受安全漏洞报告与修复     |
| 更早的历史提交与旧构建   | 不支持，请先升级到最新版本 |

PhysicsOS 目前处于公测（public beta）阶段，接口与部署方式仍可能调整；安全修复会优先合入 `main` 分支。

## 上报漏洞

- **请通过 GitHub Security Advisory 私密上报**：仓库 `Security` → `Report a vulnerability`。不要开公开 issue、不要在讨论区贴利用细节。
- 报告请尽量包含：受影响版本或提交、复现步骤、影响面、是否为部署配置问题、你已尝试的缓解方式。
- 如果你希望匿名或署名致谢，请在报告中说明。

## 响应时限承诺

| 阶段                   | 承诺时限                                 |
| ---------------------- | ---------------------------------------- |
| 确认收到报告           | 3 个工作日内                             |
| 初步评估与影响范围判断 | 10 个工作日内                            |
| 修复或缓解方案         | 视严重程度尽快给出时间表，并同步进展     |
| 公开披露               | 修复发布后与报告者协商，默认先修复后披露 |

这是尽力而为（best effort）的公益项目承诺，不构成商业 SLA。

## 本项目特有的安全边界

部署安全基线详见 [`docs/12-SECURITY-PERMISSION.md`](./docs/12-SECURITY-PERMISSION.md) 与 [`docs/13-DEPLOYMENT-OPERATIONS.md`](./docs/13-DEPLOYMENT-OPERATIONS.md)，报告漏洞前请先对照以下边界：

1. **7 个 secret 文件**：`postgres_password`、`redis_password`、`database_url`、`redis_url`、`deepseek_api_key`、`admin_password`、`image_api_key`。它们通过 Compose secrets 挂载到 `/run/secrets/*`，由 `scripts/docker-entrypoint.mjs` 展开为环境变量。secret 缺失或为空时进程会直接启动失败，这是预期行为。
2. **`PHYSICOS_TRUSTED_PROXIES` 必须是反向代理的精确 IP 字面量**（IPv4 或 IPv6）。CIDR 与主机名会在启动时被拒绝；留空表示不信任任何转发头，会导致 Cookie 不设 `Secure`、CSRF 源校验可能拒绝 HTTPS 请求、所有访客共用同一个限流桶。反向代理必须覆盖而不是追加客户端传入的 `X-Forwarded-For`。
3. **生产环境必须使用 HTTPS**。明文 HTTP 只允许用于本地开发或隔离网络中的验收。
4. **不要提交 `.env*`、密钥、证书或私钥**。仓库根及子模块的 `.gitignore` 已忽略本地 secret 文件；如果你在 issue、PR、日志或截图中发现真实密钥，请按上面的私密渠道报告。
5. **多副本部署必须共享状态**：限流与一次性响应账本依赖 Redis 后端；未配置共享后端时会回退到单进程内存实现，多副本下不提供跨副本保证。

## 范围说明

以下通常不算本仓库的安全漏洞，但仍欢迎报告可疑行为：

- 仅影响本地开发环境、且需要攻击者已经具备本机文件读写能力的问题；
- 依赖项上游已公开且尚未发布修复的漏洞（我们会跟踪并在可用后升级）；
- 需要生产部署者主动关闭安全配置（例如把 `PHYSICOS_TRUSTED_PROXIES` 配置成任意来源）才能触发的行为。
