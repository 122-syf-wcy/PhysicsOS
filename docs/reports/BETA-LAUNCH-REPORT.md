# PhysicsOS 公测上线报告

- 报告日期：2026-09-27
- 应用运行时基线：`63c20e6e701b1dc1e4188e66903a82a18306f2cc`
- 品牌与去班级化提交：`3d7e398a77c82209452224ee9770a46bbc8b4213`
- 最新证据与截图提交：`543d7a57`
- 正式地址：<https://physics.dongsiwei.com>
- 部署目录：`/opt/physicsos`
- 发布结论：**可以进入单副本、开放注册公测**。核心可用性、账号隔离、密钥权限、浏览器安全头和运维观测已经过实际生产复验；下文登记的项目仍不满足无限规模或长期无人值守生产的要求。

> 本报告不记录任何明文密码、API key、Cookie、模型上游 key 或 secret 内容。管理员密码由 `/opt/physicsos/.env.admin_password` 经 Compose secret 注入应用。

## 1. 交付范围

本次应用交付提交 `63c20e6` 共改动 `114` 个文件，新增 `13,528` 行、删除 `297` 行，交付范围覆盖：

- 账户、租户、角色、会话、设备注销、密码重置、TOTP 与管理员审计面。
- 个人学习作答和保存场景的服务端同步、幂等写、分页与跨设备读取。
- 力学、光学、热学、流体、电路、电磁、复合场、机械波和近代物理等实验与题库能力。
- `physics-student` Agent 预设和七个 PhysicsOS 物理工具，模型数值来自物理引擎而非自由生成。
- 账号私有工作区、按账号分层的会话存储、普通角色宿主机文件系统访问拒绝。
- 管理员运维控制面板、磁盘/会话/工作区/PostgreSQL/Redis 指标、15 秒缓存和告警阈值。
- 平台模型号池、AES-GCM key 加密、加权轮询、故障转移、冷却恢复和本机 OpenAI 兼容代理。
- PostgreSQL、Redis、Compose、健康检查、CI、备份/恢复/回滚文档、开源协作与安全文档。
- PhysicsOS 轨道透镜品牌标志、浏览器 favicon 与 PWA 安装图标；产品定位为个人物理实验与学习平台，不包含班级或作业管理。
- Web 为公测主入口；Tauri 桌面壳保留为可选形态，本轮不做签名、公证和商店发布。

## 2. 部署拓扑与地址

```text
Internet
  |
  | HTTPS / TLS
  v
nginx (38.76.190.3, Let's Encrypt)
  |
  | 127.0.0.1:3080
  v
PhysicsOS app container
  |-- PostgreSQL container (Docker 内网，未公网发布)
  |-- Redis container (Docker 内网，未公网发布)
  `-- model-pool proxy 127.0.0.1:38972 (仅 app 容器内)
          |
          v
      upstream OpenAI-compatible gateway
```

| 项目 | 当前实态 |
| --- | --- |
| 公网入口 | `https://physics.dongsiwei.com` |
| HTTP 行为 | `http://physics.dongsiwei.com/` 返回 `301` 到 HTTPS |
| 应用监听 | 主机回环 `127.0.0.1:3080`，未裸露容器端口 |
| Compose 服务 | `app`、`postgres`、`redis` 三容器均为 `healthy` |
| 持久数据 | `app_data`、`postgres_data`、`redis_data` 命名卷 |
| 应用运行时基线 | `63c20e6e701b1dc1e4188e66903a82a18306f2cc` |
| 品牌与产品边界 | `3d7e398a77c82209452224ee9770a46bbc8b4213`（生产增量镜像 `physicsos-app:brand-title-fix`） |
| 最新证据与截图 | `543d7a57` |
| 运维与文档 | 跟随 `origin/main`；后续文档、nginx 加固脚本更新不要求重建应用镜像 |
| 管理员租户 | `PHYSICSOS-OPEN` |
| 管理员账号 | `admin` |
| 管理员密码来源 | `/opt/physicsos/.env.admin_password`，经 secret 注入，不在报告中记录明文 |
| 模型代理 | `127.0.0.1:38972/v1`，实测 `/v1/models` 返回 `200` |
| 号池后台状态 | 1 条启用通道、1 个 active key、`encryptionReady=true` |
| 当前副本数 | 单 `app` 副本；扩容前必须共享 `PHYSICSOS_SESSIONS_ROOT` |

## 3. 五项复验证据

### 3.1 部署、健康检查与版本一致性

实测命令：

```sh
ssh -i ~/.ssh/id_ed25519 root@38.76.190.3 \
  'cd /opt/physicsos && docker compose ps && docker compose images'

curl -sS https://physics.dongsiwei.com/healthz
curl -sS https://physics.dongsiwei.com/readyz
curl -sS -D - -o /dev/null https://physics.dongsiwei.com/readyz
```

实测结果：

```text
应用运行时提交：63c20e6e701b1dc1e4188e66903a82a18306f2cc
app/postgres/redis：healthy
GET /healthz：200 {"status":"ok"}
GET /readyz：200 {"status":"ready","checks":{"postgres":{"status":"ok"},"redis":{"status":"ok"}}}
HTTPS：有效，HTTP 入口 301 跳转到 HTTPS
```

### 3.2 主机、secret 与浏览器安全边界

SSH 实测结果：

```text
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin without-password
```

secret 实测结果：

```text
app 身份：uid=999(physicsos) gid=999(physicsos)
admin_password/database_url/deepseek_api_key/image_api_key/model_pool_secret/redis_url：
  999:999，mode 0400，app 可读
uid 1000 读取 model_pool_secret：DENIED
```

`scripts/deploy/install-nginx-security-headers.sh` 已在生产 nginx 应用并实测返回：

```text
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

脚本重复执行后仍保持 `2` 个 server block；HTTP 入口继续 `301` 到 HTTPS。

### 3.3 多用户、Agent 与工作区隔离

2026-09-27 在生产环境复跑：

```sh
PHYSICSOS_AUDIT_ADMIN_PASSWORD='<secret-injected>' \
  node tests/acceptance/isolation.mjs
```

结果为：

```text
SUMMARY pass=12 fail=0 blocked=0
```

关键原始语义：

- 学生 B 创建的 session 返回 `agentPreset=physics-student`，`cwd` 被服务端绑定到
  `/var/lib/physicsos/physicsos-users/794ffc...`，调用方传入的 `/etc` 等路径不会保留。
- 学生 A 的 `session.list` 为空，不能读到学生 B 的 session。
- 学习作答、场景和会话导出均按账号所有权拒绝跨账号读取；班级作业 API 已从生产 composition 移除。
- 普通角色的 `host.listDirectory` / `host.pickDirectory` / `host.createDirectory`
  返回 `403 HOST_FILESYSTEM_DENIED`。

`preset-composition.spec.ts` 补充证据为 `3/3` 通过：`physics-student` 只挂载
`persona`、`tool-physicsos`、`tool-ask-user`，不包含 fs、shell、web 或 subagent；
七个物理工具只进入学生 Agent 自己的 scope。

同一 UID 的 fs 读取边界仍是上游 Agent 安全模型的理论残余：
当前生产预设没有 fs/shell 工具，bash runner 又因 `SANDBOX_UNAVAILABLE` fail-closed，
因此学生没有读到 `/run/secrets` 或他人会话的入口。后续若新增 fs/shell 预设，必须重新做
per-session READ fence 和越权验收，不能把当前结论外推到所有预设。

### 3.4 模型号池与运维控制面板

号池实测：

```sh
docker compose exec -T app node -e \
  "fetch('http://127.0.0.1:38972/v1/models').then(async r => console.log(r.status, await r.text()))"
```

结果：HTTP `200`，模型列表通过本机代理返回；管理员
`/physicsos/model-pool/state` 返回 `200`，当前 `1` 条启用通道、`1` 个 active key，
`encryptionReady=true`。上游 key 只以 tail 和脱敏状态展示。

管理员 `/physicsos/ops/metrics` 实测：

```text
cache.ttlMs = 15000
第一次 force=1：cache.hit=false
第二次普通请求：cache.hit=true
health.status = ok
PostgreSQL = ok
Redis = ok
alerts = 0
根盘 usedPercent = 55.29092308187761（2026-09-27T02:41:52Z 快照）
```

本次未重新消耗模型额度做 chat completion；真实回合 `pong` / `ok` 的原始证据见
[`ISOLATION-AUDIT.md`](./ISOLATION-AUDIT.md) 的模型链路修复记录。

### 3.5 公测界面与教师演示截图

宣传截图脚本已以真实浏览器、真实生产站点端到端执行并 `exit 0`：

```sh
PHYSICSOS_SHOT_BASE='https://physics.dongsiwei.com' \
PHYSICSOS_SHOT_USER='admin' \
PHYSICSOS_SHOT_PASSWORD='<secret-injected>' \
node tests/acceptance/promo-shots.mjs
```

保留的八张 `1600x1000` 截图：

| 文件 | 用途 |
| --- | --- |
| [`01-home.png`](./screenshots/promo/01-home.png) | 平台首页与整体视觉 |
| [`02-experiment-center.png`](./screenshots/promo/02-experiment-center.png) | 初中实验中心与领域选择 |
| [`03-lab-series-circuit.png`](./screenshots/promo/03-lab-series-circuit.png) | 串联电路实验 |
| [`04-lab-convex-lens.png`](./screenshots/promo/04-lab-convex-lens.png) | 凸透镜成像规律 |
| [`05-lab-liquid-pressure.png`](./screenshots/promo/05-lab-liquid-pressure.png) | 探究液体内部压强 |
| [`06-lab-melting.png`](./screenshots/promo/06-lab-melting.png) | 探究晶体熔化过程 |
| [`07-library.png`](./screenshots/promo/07-library.png) | 资源库 |
| [`08-learning-record.png`](./screenshots/promo/08-learning-record.png) | 学习记录与活动热力图 |

## 4. 本地门禁与测试数

当前提交的最近一次全量收口记录：

| 门禁 | 结果 |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm test` | exit 0 |
| `pnpm build` | exit 0 |

本次上线收口时重新执行的全部门禁：

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

结果：

```text
typecheck: exit 0
lint:      exit 0
Test Files  67 passed (67)
Tests       865 passed (865)

Test Files  53 passed (53)
Tests       418 passed (418)

deploy: 3 passed / 3
desktop: 26 passed / 26
build: exit 0
```

其中 `preset-composition.spec.ts` 为 `3/3` 通过。全量门禁均在本轮最终提交前重新执行，
完成后再冻结发布 SHA。

## 5. Overlay 幂等

当前 overlay 验收记录：

```sh
node scripts/overlay/harness-overlay.mjs apply
git -C vendor/deepseek-harness apply --reverse --check \
  ../../overlays/harness/upstream-changes.patch
```

已记录结果：

```text
upstream-changes.patch already applied
git apply --reverse --check：通过
无 .rej / .orig 残留
17 个 OVERLAY_PATHS 的 overlay 与 vendor 对应文件逐字节一致
```

为避免修改 `vendor/deepseek-harness`，本报告编制轮没有再次执行 `apply` 或 `capture`。

## 6. 上线残余风险与明确不做项

| 项目 | 当前状态 | 公测处理 | 明确不做 |
| --- | --- | --- | --- |
| 桌面端签名、公证、商店发布 | 未执行 | Web 为唯一主推入口；桌面壳作为可选开发/自托管形态 | 本轮不做 |
| Content-Security-Policy | 未启用 | 已启用 HSTS、nosniff、X-Frame-Options、Referrer-Policy、Permissions-Policy | CSP 暂缓，待 inline style、Worker、WebSocket 和生成资产 allowlist 有端到端测试后再启用 |
| 多副本扩容 | 未做 | 单 `app` 副本运行 | 扩容前必须让 `PHYSICSOS_SESSIONS_ROOT` 指向共享文件系统，并验证跨副本会话可见与一次回执账本 |
| `web_search` | 仍指向 DeepSeek 官方端点 | 不作为学生 `physics-student` 预设能力；管理员/标准 Agent 使用时需人工确认 | 本轮不迁移到第三方网关，也不承诺搜索可用性 |
| 第三方网关敏感词过滤 | 命中时可能返回 `500 / new_api_error` | 已保留号池故障转移和管理员状态页 | 本轮不实现敏感词绕过或自动改写；上线后需用真实题库采样 |
| 管理员 TOTP | 当前管理员登录直接签发会话，未启用 TOTP | 建议公测扩容前开启并保存恢复码 | 不把“支持 TOTP 代码”写成“管理员已启用 2FA” |
| 完整灾难恢复演练 | PostgreSQL 定时备份已有记录 | 公测继续每日备份 | Redis + `app_data` 的异地加密备份、完整恢复、RPO/RTO 演练仍标为“待验证” |
| 同 UID fs 读取模型 | 上游读模型仍允许同 UID 可读文件 | 当前生产学生预设无 fs/shell，bash runner fail-closed | 不在未增加 per-session READ fence 前重新装回 bwrap/landlock runner |

## 7. 运维手册索引

主手册：[`docs/13-DEPLOYMENT-OPERATIONS.md`](../13-DEPLOYMENT-OPERATIONS.md)

| 手册章节 | 内容 |
| --- | --- |
| §1 | 生产拓扑、单副本边界和持久卷 |
| §2 | Docker、Compose、反向代理和 TLS 前置条件 |
| §3 | secret 文件、受信代理、运行时环境契约 |
| §3.3 | 模型 base URL、模型名和输出上限 |
| §3.4 | 模型通道池、轮询、冷却、手工恢复、加密与备份 |
| §4 | CI 门禁 |
| §5 | 构建、镜像和发布记录 |
| §6 | 部署、健康检查和认证写入冒烟 |
| §7 | PostgreSQL 定时备份与 PostgreSQL + Redis + app_data 完整备份 |
| §8 | 恢复步骤 |
| §9 | 回滚原则 |
| §10 | SSH、容器日志轮转、nginx 安全头和公网自检 |
| §11 | 日常/每周运维检查和事故响应 |
| §12 | 公测前检查清单 |

隔离与安全复核：[`docs/reports/ISOLATION-AUDIT.md`](./ISOLATION-AUDIT.md)

## 8. 给初中物理老师的演示配图清单

建议演示顺序：

1. 用 `01-home.png` 介绍平台入口和“物理引擎给事实、AI 负责讲解”的定位。
2. 用 `02-experiment-center.png` 展示初中分类、实验选择和课堂主题覆盖。
3. 用 `03-lab-series-circuit.png` 演示电路参数变化与读数联动。
4. 用 `04-lab-convex-lens.png` 演示物距、像距、成像规律和主光路。
5. 用 `05-lab-liquid-pressure.png` 演示液体深度与压强的关系。
6. 用 `06-lab-melting.png` 演示晶体熔化过程中的温度平台与状态变化。
7. 用 `07-library.png` 展示题库和实验资源。
8. 用 `08-learning-record.png` 展示学习记录、活动热力图和薄弱点回顾。

所有图片均取自真实生产站点，不包含管理员密码或后台 secret。

## 9. 上线结论与待验证

**Go**：当前提交可以开始单副本、开放注册公测；生产 `PHYSICSOS_REGISTRATION_MODE`
实测为 `open`。如出现滥用或模型成本异常，可无损切换为 `invite` / `closed` 并重启
`app`。

**待验证**：

- 本报告编制轮未重新消耗模型额度做真实 chat completion。
- `web_search` 未做端到端验收，仍指向 DeepSeek 官方端点。
- 第三方网关敏感词过滤未做完整题库采样。
- 多副本扩容、共享 sessions root、Redis + app_data 异地恢复和完整灾备切换未演练。
- 桌面端签名、公证、自动更新和安装包发布未执行。
- CSP 未启用；仅在当前五类基础安全头基础上运行。
