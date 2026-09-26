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

| Variable                   | Default               | Purpose                                                       |
| -------------------------- | --------------------- | ------------------------------------------------------------- |
| `PHYSICOS_TRUSTED_PROXIES` | empty (trust nothing) | Exact proxy IP literals for forwarded headers                 |
| `PHYSICSOS_SESSIONS_ROOT`  | `DSH_HOME/sessions`   | Shared session root; required before scaling past one replica |
| `PHYSICSOS_PANDOC`         | `/usr/bin/pandoc`     | Pandoc binary used for A4 export                              |
| `PHYSICSOS_SOFFICE`        | `/usr/bin/soffice`    | LibreOffice binary; macOS dev can point at the app bundle     |

Validate the composed configuration without starting containers:

```sh
docker compose config --quiet
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

3. Recreate PostgreSQL and restore the dump:

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
    --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --clean --if-exists' \
  < backups/RECOVERY_POINT/postgres.dump
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

## 10. Operational checks

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

## 11. 公测前检查清单

- [ ] `.env.admin_password` 已设置为随机强密码，且首启日志确认 `PHYSICSOS-OPEN:admin`
      已种为 `SUPER_ADMIN`；公测期间不自助注册管理员。
- [ ] TLS 反代已启用，且 `PHYSICOS_TRUSTED_PROXIES` 是该反代的精确 IP（含 IPv6
      写法如有）；未配置时不要对外暴露。
- [ ] `.env.image_api_key` 已设置；若有意关闭题图生成，已在 `compose.yml` 移除
      `image_api_key` secret 并记录该决定。
- [ ] `docker compose up -d postgres redis` 后两者 healthy，`/readyz` 返回成功。
- [ ] 最近一次备份已完成并做过一次恢复演练（PostgreSQL + Redis + `app_data`
      三件套齐全，manifest 校验通过）。
- [ ] 仍是单副本；若已多副本，`PHYSICSOS_SESSIONS_ROOT` 指向共享文件系统并验证过
      跨副本会话可见。
