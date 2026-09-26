# ADR-0001：账户分层会话存储

- 状态：已接受
- 日期：2026-09-26
- 决策人：PhysicsOS maintainers
- 相关文档 / PR：`packages/session/session-persistence-jsonl`、`scripts/migrate/sessions-to-account-layout.mjs`

## 背景

PhysicsOS 的 Web 与桌面端都需要让同一账号在不同设备上恢复同一批会话，同时不能让同一服务器上的其他账号通过目录扫描、误配置或运维脚本读到他人的 transcript。原 JSONL 布局按 `cwd` 和 session id 分目录，适合单用户 Harness，但没有账号维度。

`SessionHeader` 是上游稳定的会话格式，当前只包含 `id`、`cwd`、lineage 和 `agentPreset`，不包含账号。PhysicsOS 的真正归属账本是 `physicsos_auth` 存储域中的 `api_resources` 行：`session -> ownerKey(schoolId:username)`。工作区路径是 userKey 的 SHA-256 摘要，不能反向恢复账号；session id 本身也不携带账号。

因此需要把“谁能读写”和“文件放在哪里”分开：前者仍由 `/api` 的归属校验负责，后者为备份、配额、审计和跨端恢复提供稳定的账号目录边界。

## 决定

- 新的物化布局为 `<root>/<schoolId>/<encoded-userKey>/<encoded-sessionId>/session.jsonl*`。
- `schoolId`、`userKey` 和 session id 在进入文件系统前必须通过白名单校验或注入式编码；拒绝 `..`、路径分隔符、NUL、空段和非法账号字母表。
- JSONL backend 通过可选 Cordis 服务 `physicsosSessionOwnership` 同步解析 `SessionHeader -> owner`。服务缺失时保留旧布局写入；解析失败或返回非法 owner 时 fail loud。
- 读取时先识别账户布局，再回退旧 `<root>/<project>/<sessionId>/` 布局。同一 session id 在两处或两个 owner 下同时存在时返回明确的 layout conflict，不静默选择。
- 迁移由离线脚本完成：默认 dry-run，`--apply` 才 rename；归属只从显式的 `api_resources` 或 ownership manifest 读取，未知、冲突和非法头都跳过并报告。
- 授权边界不依赖目录名或文件路径。`api_resources` 归属校验仍是唯一准入决定；目录分层用于运维隔离、备份范围和合规检查。

## 后果

- 正面：账号数据在共享服务器上有稳定边界；旧日志可分批迁移；桌面端和 Web 端可以从同一账号目录恢复会话；冲突不会被误读成任一账号的数据。
- 负面：发现会话时要同时扫描新旧布局，账号目录的启动枚举成本高于单一旧根；迁移期间必须维护双侧冲突检查。
- 需要跟进：生产 composition 必须发布 `physicsosSessionOwnership` provider，将 `api_resources` 的内存索引或等价查询接入 backend；当前 JSON 存储部署可由迁移脚本读取 `physicsos_auth.json`，PostgreSQL 部署应改为数据库查询。
- 多副本部署必须把 sessions root 放在共享文件系统，或把会话索引/内容迁入 PostgreSQL。仅做本地目录分层不能满足跨副本一致性，也不能提供跨进程写入互斥。

## 替代方案

- 从 `cwd` 反推 owner：已放弃。工作区路径是哈希摘要，不可逆；按路径前缀猜测会在改名、共享目录或迁移后把数据放错账号。
- 把 `owner/schoolId` 加入 `SessionHeader`：暂不采用。它会改变上游会话格式并迫使 session persistence 依赖认证域；在格式升级前，显式 resolver 能保持后端与认证的边界。
- 为每个账号挂 symlink 到旧目录：已放弃。它保留旧路径作为权威身份，容易产生双写和权限绕过，且备份工具无法可靠区分真实边界。
