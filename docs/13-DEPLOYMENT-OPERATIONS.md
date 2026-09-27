# PhysicsOS Deployment and Operations

This runbook covers the production container foundation: CI gates, immutable
image builds, Compose startup, health verification, backups, restore drills,
and rollback. It does not authorize a push or deployment by itself.

## 1. Production topology

The Compose stack runs three stateful roles:

| Service    | Responsibility                                           | Persistent data         |
| ---------- | -------------------------------------------------------- | ----------------------- |
| `app`      | Harness Web/API host plus PhysicsOS host plugins         | `app_data` (`DSH_HOME`) |
| `postgres` | Relational account, learning, class, and event storage   | `postgres_data`         |
| `redis`    | Shared rate limits, queues, and short-lived coordination | `redis_data`            |

The app publishes only to host loopback by default:

```text
127.0.0.1:${PHYSICSOS_HTTP_PORT:-3080} -> app:3080
```

Put an authenticated TLS reverse proxy on the host for remote access. Do not
bind the raw Harness Web port to a public interface.

Every service has a Docker healthcheck. The app's `/healthz` route is process
liveness; `/readyz` is fail-closed readiness for PostgreSQL and Redis. Docker
starts the app only after both dependencies are healthy.

The supported public-beta topology is a **single `app` replica**. Session logs
live under `DSH_HOME` (`PHYSICSOS_SESSIONS_ROOT`, default
`dshHomePath('sessions')` inside the `app_data` volume). A second replica sees
only the sessions it wrote itself unless that root points at a shared
filesystem, so scale the app out only after that change has been tested.

## 2. Prerequisites

- Docker Engine with Compose v2
- An initialized repository, including `vendor/deepseek-harness`
- A deployment host with enough disk for three named volumes and local backups
- A reverse proxy, TLS certificate, DNS name, and network allowlist for the
  deployment environment

The local `.env.*` secret paths are ignored by Git. Never place secrets in the
image, Compose environment values, source files, or frontend bundles.

## 3. Configure secrets

Compose wires seven secret files. `scripts/docker-entrypoint.mjs` materializes
each `<NAME>_FILE` into the plain `<NAME>` variable the Harness reads; a
missing or empty file aborts startup instead of silently degrading.

Create them once per environment:

```sh
umask 077
openssl rand -hex 32 > .env.postgres_password
openssl rand -hex 32 > .env.redis_password
# Bootstrap SUPER_ADMIN. There is no self-service path to an admin account:
# registration only ever creates STUDENT. No default password is invented here.
openssl rand -base64 24 > .env.admin_password

postgres_password="$(cat .env.postgres_password)"
redis_password="$(cat .env.redis_password)"

printf 'postgresql://physicsos:%s@postgres:5432/physicsos\n' "$postgres_password" \
  > .env.database_url
printf 'redis://:%s@redis:6379/0\n' "$redis_password" \
  > .env.redis_url
printf '%s\n' 'replace-with-the-model-provider-key' > .env.deepseek_api_key
printf '%s\n' 'replace-with-the-question-image-api-key' > .env.image_api_key
```

Percent-encode characters before inserting credentials into URLs. Production
secret managers may provide the same files at another path with
`PHYSICSOS_POSTGRES_PASSWORD_FILE`, `PHYSICSOS_REDIS_PASSWORD_FILE`,
`PHYSICSOS_DATABASE_URL_FILE`, `PHYSICSOS_REDIS_URL_FILE`,
`PHYSICSOS_DEEPSEEK_API_KEY_FILE`, `PHYSICSOS_ADMIN_PASSWORD_FILE`, and
`PHYSICOS_IMAGE_API_KEY_FILE`.

The seven names by role:

| File                     | Secret                           | Missing/empty behavior                   |
| ------------------------ | -------------------------------- | ---------------------------------------- |
| `.env.postgres_password` | PostgreSQL superuser password    | `postgres` container refuses to start    |
| `.env.redis_password`    | Redis `requirepass`              | `redis` container exits                  |
| `.env.database_url`      | App → PostgreSQL DSN             | `docker compose config` fails            |
| `.env.redis_url`         | App → Redis DSN                  | `docker compose config` fails            |
| `.env.deepseek_api_key`  | Model provider key               | app refuses to start                     |
| `.env.admin_password`    | Bootstrap `SUPER_ADMIN` password | app refuses to start; no admin is seeded |
| `.env.image_api_key`     | Paper question-image generation  | app refuses to start                     |

`.env.admin_password` is consumed once, at first boot, to seed
`PHYSICSOS-OPEN:admin`. Keep the file afterwards so later restarts stay
consistent, and rotate the account password through the normal flow rather
than editing the file. If question images are intentionally disabled for the
beta, remove the `image_api_key` secret from `compose.yml` instead of leaving
an empty file, and record that decision in the release notes.

### 3.1 Reverse proxy and forwarded headers

Set `PHYSICOS_TRUSTED_PROXIES` to the **exact IP literals** of the proxy peers
that connect to the app, comma-separated. CIDR ranges and hostnames are
rejected at startup:

```sh
# TLS terminator on the same Docker host (published via the loopback port)
PHYSICOS_TRUSTED_PROXIES=127.0.0.1,::1

# Proxy in another container: use the bridge gateway address the app sees
PHYSICOS_TRUSTED_PROXIES=172.18.0.1
```

Only a TCP peer in this list may supply `X-Forwarded-Proto` and
`X-Forwarded-For`. Leaving it empty behind a TLS proxy means the session
cookie is issued without `Secure`, CSRF origin checks may reject `https`
requests, and every visitor shares the proxy's rate-limit bucket. Setting it
too broadly (or listing an address an untrusted client can reach from) lets
clients spoof their IP and protocol, defeating per-IP limits and audit
attribution.

Optional knobs, all plain environment variables:

| Variable                   | Default                       | Purpose                                                       |
| -------------------------- | ----------------------------- | ------------------------------------------------------------- |
| `PHYSICOS_TRUSTED_PROXIES` | empty (trust nothing)         | Exact proxy IP literals for forwarded headers                 |
| `PHYSICSOS_SESSIONS_ROOT`  | `/var/lib/physicsos/sessions` | Shared session root; required before scaling past one replica |
| `PHYSICSOS_PANDOC`         | `/usr/bin/pandoc`             | Pandoc binary used for A4 export                              |
| `PHYSICSOS_SOFFICE`        | `/usr/bin/soffice`            | LibreOffice binary; macOS dev can point at the app bundle     |
| `PHYSICSOS_DATABASE_SSL`   | `false`                       | Enable TLS for the PostgreSQL connection                      |

### 3.2 Runtime environment contract

`Dockerfile` declares the image defaults, `compose.yml` provides the same
defaults while mapping the host-side overrides, and `.env.example` lists every
override an operator may need. The production storage and shared-state
backends are intentionally fixed in both the image and Compose to
`postgres`/`redis`; they are not optional `.env` switches.

| Runtime variable                 | Source in Compose                 | Purpose                                    |
| -------------------------------- | --------------------------------- | ------------------------------------------ |
| `PHYSICSOS_STORAGE_BACKEND`      | fixed `postgres`                  | Prevents JSON storage fallback             |
| `PHYSICSOS_STORAGE_SCHEMA`       | `PHYSICSOS_STORAGE_SCHEMA`        | PostgreSQL schema, default `physicsos`     |
| `PHYSICSOS_SHARED_STATE_BACKEND` | fixed `redis`                     | Prevents in-memory rate-limit fallback     |
| `DATABASE_URL_FILE`              | `PHYSICSOS_DATABASE_URL_FILE`     | Materialized to `DATABASE_URL`             |
| `REDIS_URL_FILE`                 | `PHYSICSOS_REDIS_URL_FILE`        | Materialized to `REDIS_URL`                |
| `DEEPSEEK_API_KEY_FILE`          | `PHYSICSOS_DEEPSEEK_API_KEY_FILE` | Materialized to `DEEPSEEK_API_KEY`         |
| `PHYSICSOS_ADMIN_PASSWORD_FILE`  | `PHYSICSOS_ADMIN_PASSWORD_FILE`   | Materialized to `PHYSICSOS_ADMIN_PASSWORD` |
| `PHYSICOS_IMAGE_API_KEY_FILE`    | `PHYSICOS_IMAGE_API_KEY_FILE`     | Materialized to `PHYSICOS_IMAGE_API_KEY`   |
| `PHYSICOS_TRUSTED_PROXIES`       | `PHYSICOS_TRUSTED_PROXIES`        | Forwarded-header trust list                |

Validate the composed configuration without starting containers:

```sh
docker compose config --quiet
```

### 3.3 模型链路（provider / base URL / key）

生产组合的默认模型走 `llm-deepseek` 的 `deepseek-official` 路由，但
`DEEPSEEK_BASE_URL` 不再直接指向第三方网关，而是指向容器内的
`model-pool-host` 回环代理。代理再按通道优先级与 key 权重选择上游，因此单个
key 失效时不需要重启 Harness。

| 项               | 生产取值                                                                    | 说明                                                                             |
| ---------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Harness base URL | `http://127.0.0.1:${PHYSICSOS_MODEL_POOL_PORT:-38972}/v1`                   | 只在 app 容器内监听；公网端口不会暴露代理                                        |
| 兜底上游         | `PHYSICSOS_MODEL_FALLBACK_BASE_URL`，默认 `https://api.fengshao1227.com/v1` | 只用于空池播种；后台新增任意通道后不再自动重加                                   |
| key              | `.env.deepseek_api_key`（OpenAI 兼容 key）                                  | 仅作为空池兜底种子，由 `model-pool-host` 加密存入 `physicsos_model_pool`         |
| 加密主密钥       | `.env.model_pool_secret`                                                    | 派生 AES-256-GCM 密钥；必须长期稳定，换掉后旧 key 会 `KEY_DECRYPT_FAILED`        |
| 模型名           | `deepseek-v4.1-flash`                                                       | base 组合默认 `deepseek-v4-flash`，多数中转网关没有，会回 `model_not_found`      |
| 输出上限         | `maxTokens: 32768`                                                          | 推理模型先花 reasoning token；上限太小会 `content:null` + `finish_reason:length` |

模型名与输出上限写在 `$DSH_HOME/settings.yaml`（容器内
`/var/lib/physicsos/settings.yaml`，缺失时回落到 base 组合默认值）：

```yaml
llm-deepseek:
  maxTokens: 32768
  models:
    - id: deepseek-v4.1-flash
      name: DeepSeek V4.1 Flash
      contextWindow: 1000000
      maxTokens: 32768

agent-default-model:
  provider: deepseek-official
  model: deepseek-v4.1-flash
  reasoningEffort: high
```

三个容易踩的坑：

1. **secret 文件权限**：compose secret 以宿主机文件权限挂进容器，而 app 以非 root
   用户运行。`0600 root:root` 会让容器起不来并打印
   `secret file for DEEPSEEK_API_KEY_FILE is unreadable (EACCES)`；保持 `0644`
   （与本目录其他 `.env.*` 一致）。
2. **`/api` 的域名信任栅栏只认 CLI 参数**：`PHYSICOS_TRUSTED_HOSTS` 本身不会被
   harness 读取，它必须同时出现在 compose 的
   `--trusted-host ${PHYSICOS_TRUSTED_HOSTS}` 里。漏传时公网的
   `/api/host.describe` 返回 `403 forbidden`，浏览器客户端卡在“正在加载工作区 /
   Loading plugins”，而 loopback 仍然正常。
3. **辅助请求也走模型**：会话标题、出卷专区的解题调用共用同一端点与 key，
   `session-title-first-prompt-llm` 也会消耗额度，因此一次真实回合的按账号计数
   通常 +2。

最小验收（服务器上执行；key 只从 secret 读，不回显）：

```sh
cd /opt/physicsos && K=$(cat .env.deepseek_api_key)
curl -sS -o /dev/null -w '%{http_code}\n' https://api.fengshao1227.com/v1/models \
  -H "Authorization: Bearer $K"
docker compose exec -T app node -e "fetch('http://127.0.0.1:38972/v1/models').then(async r => { console.log(r.status, await r.text()) })"
docker compose exec -T app cat /var/lib/physicsos/settings.yaml
```

### 3.4 平台模型号池（model-pool）

管理员在「管理后台 → 模型通道」维护通道和 key；页签只显示 key 尾 4 位。
`model-pool-host` 同时暴露：

- app 容器内的 OpenAI 兼容代理：`http://127.0.0.1:38972/v1`
- 同源管理接口：`/physicsos/model-pool/*`，只接受 `SUPER_ADMIN`

#### 策略语义

| 行为     | 生产语义                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 轮询     | 先按 `priority` 从小到大的通道分档，档内按 key 权重轮询；单次请求仍返回完整候选链用于故障转移                                               |
| 重试     | `retryCount` 默认 2，最多尝试候选 key 数量个；400/404/422 等客户端错误不换 key                                                              |
| 冷却     | 401/403 认证失败立即冷却；429/5xx/传输失败达到 `failureThreshold` 后冷却                                                                    |
| 退避     | `cooldownBaseMs` 起指数增长，受 `cooldownMaxMs` 限制；`autoRecover=true` 时到期自动恢复                                                     |
| 流式     | 只会在上游响应头返回前重试；流已经开始后不重放，避免重复内容                                                                                |
| 全不可用 | 明确返回 HTTP 503 与 `MODEL_POOL_EXHAUSTED`、`MODEL_POOL_EMPTY`、`MODEL_POOL_MODEL_UNAVAILABLE` 或 `MODEL_POOL_ALL_COOLING`，不伪造模型回复 |

#### 日常操作

1. **换 key**：在「模型通道」找到 key，点「编辑」后粘贴新 key；请求成功后旧的
   密文会被覆盖，失败计数清零。只在创建/替换的请求体内出现明文 key，列表和审计
   永远只记尾号。
2. **临时停用 key**：把 key 的「启用」取消后保存；代理下一请求立即跳过它。
3. **停用整条通道**：编辑通道并把「通道启用」取消；该通道下所有 key 一起退出候选。
4. **全部停用**：模型请求会返回上述 503；这是可恢复的配置状态，不会退回到未加密的
   单 key 直连。
5. **手动恢复**：对冷却中的 key 点「重置失败」，或按策略等待自动恢复。
6. **单 key 探测**：点「测试此 key」，页面显示上游状态、延迟和脱敏错误。

#### 加密与备份

`model_pool_secret` 必须与 `postgres_data` 一起备份；只有数据库而没有主密钥时，
通道记录仍可读，但 key 无法解密，模型请求会 fail-closed。不要把 secret 写进
`docs/`、issue、日志或 shell 历史。

```sh
openssl rand -hex 32 > .env.model_pool_secret
chmod 0400 .env.model_pool_secret
docker compose config --quiet
docker compose up -d app
```

## 4. Continuous integration

`.github/workflows/ci.yml` runs on `main` pushes, pull requests, and manual
dispatch. The job initializes the pinned Harness submodule, applies the overlay,
installs both lockfiles, and runs:

```sh
docker compose config --quiet
pnpm -C vendor/deepseek-harness exec vitest run \
  --config ../../overlays/harness/files/packages/physicsos/health-host/vitest.config.ts
pnpm -C vendor/deepseek-harness run build:lib
pnpm exec prettier --check <deployment-owned paths>
pnpm exec tsc -p overlays/harness/files/packages/physicsos/health-host/tsconfig.json
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

A release is eligible only when every gate is green on the exact commit being
deployed. Preserve the image digest and commit SHA together in the release
record. The format gate is intentionally scoped to the deployment-owned paths
until the repository-wide Prettier baseline is reconciled.

## 5. Build and release

Build locally:

```sh
export PHYSICSOS_APP_IMAGE="registry.example/physicsos-app:$(git rev-parse --short=12 HEAD)"
docker compose build --pull app
docker image inspect "$PHYSICSOS_APP_IMAGE" \
  --format '{{index .RepoDigests 0}}'
```

For a registry release, tag with the full commit SHA and, after push, deploy the
resulting digest rather than a movable tag:

```sh
docker push "$PHYSICSOS_APP_IMAGE"
docker image inspect "$PHYSICSOS_APP_IMAGE" \
  --format '{{index .RepoDigests 0}}'
```

Record:

- commit SHA
- image digest
- Compose revision
- database migration revision, when the release has one
- operator and UTC start/end time

## 6. Deploy

1. Verify the candidate digest and CI result for the same commit.
2. Verify a successful backup before any schema migration.
3. Start the dependencies and wait for healthy state:

```sh
docker compose up -d postgres redis
docker compose ps
```

4. Run the release migration step before starting the new app. Migrations must
   be backward-compatible with the currently running app. If the migration
   fails, stop the release, keep the old app running, and do not retry blindly.

5. Start the app:

```sh
docker compose up -d --no-build app
docker compose ps app
```

6. Smoke test readiness and the Web entry point:

```sh
curl --fail --show-error http://127.0.0.1:3080/healthz
curl --fail --show-error http://127.0.0.1:3080/readyz
curl --fail --show-error --head http://127.0.0.1:3080/
docker compose logs --since=10m app
```

7. Verify one authenticated read and one bounded write through the external
   reverse proxy. Confirm the resulting account/tenant scope and audit event.

## 7. Backup

Back up PostgreSQL, Redis, and the `app_data` volume together. A database dump
without the session/replay volume is not a complete PhysicsOS backup.

### 7.1 Scheduled PostgreSQL backup

On a hardened host, install the maintenance jobs with:

```sh
sudo PHYSICSOS_DIR=/opt/physicsos \
  /opt/physicsos/scripts/deploy/install-operations.sh
```

This installs `/etc/cron.d/physicsos-postgres-backup`; it runs daily at
`02:15` host time (the current production host uses UTC):

```text
15 2 * * * root PHYSICSOS_DIR=/opt/physicsos \
  /opt/physicsos/scripts/deploy/backup-postgres.sh \
  >>/var/log/physicsos-postgres-backup.log 2>&1
```

Run one backup immediately and print its verified artifact path:

```sh
sudo PHYSICSOS_DIR=/opt/physicsos \
  /opt/physicsos/scripts/deploy/backup-postgres.sh
```

The default output root is `/opt/physicsos/backups/postgres`, with one private
timestamp directory per run:

```text
/opt/physicsos/backups/postgres/YYYYMMDDTHHMMSSZ/
├── manifest.txt
├── postgres.dump
├── postgres.dump.sha256
└── postgres.list
```

`postgres.list` is the successful `pg_restore --list` output. Re-verify a
specific archive without touching the database, then check its checksum:

```sh
backup=/opt/physicsos/backups/postgres/RECOVERY_POINT
docker run --rm --network none \
  -v "$backup:/backup:ro" \
  --entrypoint pg_restore postgres:17-bookworm \
  --list /backup/postgres.dump >/dev/null
(cd "$backup" && sha256sum -c postgres.dump.sha256)
```

The production verification on 2026-09-26 created
`/opt/physicsos/backups/postgres/20260926T112730Z`: the 161,176-byte archive
contained 119 `pg_restore --list` entries and passed its SHA-256 check.

Retention defaults to 14 days and can be changed with
`PHYSICSOS_BACKUP_RETENTION_DAYS`. Scheduled dumps cover PostgreSQL only;
Redis and `app_data` still require the coordinated full backup below and must
be copied to encrypted off-host storage.

### 7.2 Coordinated full backup

Set a UTC timestamp and create a private backup directory:

```sh
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="backups/$stamp"
install -d -m 0700 "$backup_dir"
```

PostgreSQL custom-format dump:

```sh
docker compose exec -T postgres sh -c \
  'PGPASSWORD="$(cat /run/secrets/postgres_password)" pg_dump \
    --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --format=custom' \
  > "$backup_dir/postgres.dump"
```

Redis append-only snapshot:

```sh
docker compose exec -T redis sh -c \
  'REDISCLI_AUTH="$(cat /run/secrets/redis_password)" \
    redis-cli --no-auth-warning BGSAVE'

docker compose stop redis
docker run --rm \
  -v physicsos_redis_data:/source:ro \
  -v "$PWD/$backup_dir:/backup" \
  alpine:3.21 tar -C /source -czf /backup/redis.tgz .
docker compose start redis
```

Application/session volume:

```sh
docker compose stop app
docker run --rm \
  -v physicsos_app_data:/source:ro \
  -v "$PWD/$backup_dir:/backup" \
  alpine:3.21 tar -C /source -czf /backup/app-data.tgz .
docker compose start app
```

Write a manifest with the release identity and checksums:

```sh
{
  printf 'commit=%s\n' "$(git rev-parse HEAD)"
  docker compose images
  sha256sum "$backup_dir"/*
} > "$backup_dir/manifest.txt"
```

Copy the directory to encrypted off-host storage. Test restoration monthly and
before every risky migration. Define and record RPO/RTO per environment; do not
claim a recovery target that has not been measured in a restore drill.

## 8. Restore

Restore is destructive. Announce a maintenance window, stop writes, and
explicitly approve the recovery point before proceeding.

1. Preserve the failed volumes for investigation:

```sh
docker compose stop app redis postgres
```

2. Restore the application volume:

```sh
docker run --rm \
  -v physicsos_app_data:/target \
  -v "$PWD/backups/RECOVERY_POINT:/backup:ro" \
  alpine:3.21 sh -c 'rm -rf /target/* && tar -C /target -xzf /backup/app-data.tgz'
```

3. Recreate PostgreSQL and restore the dump. `RECOVERY_POINT` is the timestamp
   directory under `/opt/physicsos/backups/postgres`:

```sh
docker compose up -d postgres
docker compose exec -T postgres sh -c \
  'PGPASSWORD="$(cat /run/secrets/postgres_password)" dropdb \
    --username="$POSTGRES_USER" --if-exists "$POSTGRES_DB"'
docker compose exec -T postgres sh -c \
  'PGPASSWORD="$(cat /run/secrets/postgres_password)" createdb \
    --username="$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T postgres sh -c \
  'PGPASSWORD="$(cat /run/secrets/postgres_password)" pg_restore \
    --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
    --clean --if-exists --no-owner --no-acl' \
  < /opt/physicsos/backups/postgres/RECOVERY_POINT/postgres.dump
```

4. Recreate Redis and restore its snapshot:

```sh
docker compose stop redis
docker run --rm \
  -v physicsos_redis_data:/target \
  -v "$PWD/backups/RECOVERY_POINT:/backup:ro" \
  alpine:3.21 sh -c 'rm -rf /target/* && tar -C /target -xzf /backup/redis.tgz'
docker compose start redis
```

5. Start the app and validate:

```sh
docker compose up -d app
docker compose ps
curl --fail --show-error http://127.0.0.1:3080/readyz
```

Validate account/session counts against the backup manifest, open a restored
session, replay one saved PhysicsOS scene, and confirm new writes persist after
a `docker compose restart app`.

If any validation fails, stop the app, preserve logs and restored volumes, and
choose a later recovery point or repeat the restore. Do not reopen traffic on a
partially restored database.

## 9. Rollback

Rollback is application-first. Database down-migrations are prohibited unless
they are proven lossless and have their own tested procedure.

To deploy the previous image digest:

```sh
export PHYSICSOS_APP_IMAGE='registry.example/physicsos-app@sha256:PREVIOUS_DIGEST'
docker compose pull app
docker compose up -d --no-build app
docker compose ps app
curl --fail --show-error http://127.0.0.1:3080/readyz
```

Use expand/migrate/contract for schema changes so the previous app remains
compatible during rollback. If the new release wrote non-backward-compatible
data, stop writes and choose explicitly between forward repair and destructive
restore.

After rollback:

1. Verify `/healthz`, `/readyz`, login, one replay, and one bounded write.
2. Keep the failed image digest and logs for diagnosis.
3. Record the rollback reason, timestamp, impact window, and data decision.
4. Do not redeploy the failed digest until a regression test reproduces the
   failure and the fix passes root CI.

## 10. Server hardening

### 10.1 Verified production baseline

On 2026-09-26 the production host was checked with the effective OpenSSH
configuration, not only the visible drop-in files:

```text
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin without-password
```

`fail2ban` is installed and enabled with the `sshd` jail using the systemd
backend (`maxretry=5`, `findtime=10m`, `bantime=1h`). Verify it with:

```sh
systemctl is-enabled fail2ban
systemctl is-active fail2ban
fail2ban-client status sshd
sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|pubkeyauthentication) '
```

Every PhysicsOS container is configured with restart policy
`unless-stopped` and `json-file` logging limited to `max-size=20m` and
`max-file=5`. Verify the effective container settings rather than trusting the
Compose source alone:

```sh
cd /opt/physicsos
docker compose ps -q | xargs docker inspect --format \
  '{{.Name}} Restart={{.HostConfig.RestartPolicy.Name}} LogDriver={{.HostConfig.LogConfig.Type}} MaxSize={{index .HostConfig.LogConfig.Config "max-size"}} MaxFile={{index .HostConfig.LogConfig.Config "max-file"}}'
```

The host SSH configuration is already compliant, so do not rewrite
`sshd_config` during routine deployment. If a future host is missing these
settings, add a validated drop-in, run `sshd -t`, reload SSH, and keep the
existing key-based session open until a second key login succeeds.

### 10.1.1 Browser security headers

The public nginx site is hardened by
`scripts/deploy/install-nginx-security-headers.sh`. The script is idempotent,
backs up the site to `/var/backups/physicsos-operations/`, validates with
`nginx -t`, and reloads only after validation succeeds. It adds:

- HSTS (`Strict-Transport-Security`) with a one-year max age and subdomains
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- a restrictive `Permissions-Policy`

Use `PHYSICSOS_HSTS_MODE=report` only for a controlled pre-HSTS check; the
public-beta default is `enforce`. A Content-Security-Policy is intentionally
not emitted until the app's inline styles, workers, WebSockets, and generated
assets have a tested allowlist.

Verify the live response from outside the host:

```sh
curl -sS -o /dev/null -D - https://physics.dongsiwei.com/readyz |
  grep -Ei 'strict-transport-security|x-content-type-options|x-frame-options|referrer-policy|permissions-policy'
```

### 10.2 Production self-check evidence

The 2026-09-26 check returned:

```text
GET /healthz -> 200 {"status":"ok"}
GET /readyz  -> 200 {"status":"ready","checks":{"postgres":{"status":"ok"},"redis":{"status":"ok"}}}
```

The app container had `PHYSICSOS_STORAGE_BACKEND=postgres`,
`PHYSICSOS_SHARED_STATE_BACKEND=redis`, and both the `*_FILE` source paths and
their materialized plain environment names in the running app process.
PostgreSQL contained 34 tables in schema `physicsos`, including
`dsh_storage_units` and `dsh_storage_globals`, with nine live connections
identified as `physicsos-storage-postgres`. Redis reported
`total_connections_received=280` and `total_commands_processed=428` at the
time of final inspection. No JSON or memory fallback was configured or
observed. These are non-secret operational identifiers only; no production
records or secret values were read out.

Before traffic is enabled on a new release, repeat:

```sh
docker compose exec -T app node scripts/healthcheck.mjs http://127.0.0.1:3080/readyz
curl --fail --show-error http://127.0.0.1:3080/healthz
curl --fail --show-error http://127.0.0.1:3080/readyz
```

## 11. Operational checks

Daily:

- all Compose services healthy
- `/readyz` success and PostgreSQL/Redis disk headroom
- 5xx, latency, process restarts, queue backlog, and model-provider errors
- backup completion and off-host checksum

Weekly:

- restore one backup into an isolated environment
- verify session replay and one PhysicsOS scene
- confirm secret-file permissions and rotation status
- review image digests against the release record

Incident response:

| symptom                                      | first action                                                                                  |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| app unhealthy while dependencies are healthy | inspect app logs and `/readyz`; roll back if the prior digest passes                          |
| PostgreSQL unavailable                       | stop app writes, inspect `docker compose logs postgres`, restore service or recovery point    |
| Redis unavailable                            | expect fail-closed readiness; restore Redis before reopening traffic                          |
| migration failed                             | keep the old app, do not start the new app, fix forward only with a reviewed migration        |
| rollback needed                              | deploy the prior digest, verify health/login/replay, and preserve the failed release evidence |

Production is ready only when health, logs, metrics, alerts, backup, restore,
rollback, resource limits, and ownership are all defined and tested.

## 12. 公测前检查清单

- [ ] `.env.admin_password` 已设置为随机强密码，且首启日志确认 `PHYSICSOS-OPEN:admin`
      已种为 `SUPER_ADMIN`；公测期间不自助注册管理员。
- [ ] TLS 反代已启用，且 `PHYSICOS_TRUSTED_PROXIES` 是该反代的精确 IP（含 IPv6
      写法如有）；未配置时不要对外暴露。
- [ ] nginx 已运行 `scripts/deploy/install-nginx-security-headers.sh`，公网响应
      含 HSTS 与四项基础安全头，且 `nginx -t` 通过。
- [ ] `.env.image_api_key` 已设置；若有意关闭题图生成，已在 `compose.yml` 移除
      `image_api_key` secret 并记录该决定。
- [ ] `docker compose up -d postgres redis` 后两者 healthy，`/readyz` 返回成功。
- [ ] PostgreSQL 定时备份已启用且最近一次运行成功；完整恢复演练覆盖
      PostgreSQL + Redis + `app_data` 三件套并校验 manifest。
- [ ] 仍是单副本；若已多副本，`PHYSICSOS_SESSIONS_ROOT` 指向共享文件系统并验证过
      跨副本会话可见。
