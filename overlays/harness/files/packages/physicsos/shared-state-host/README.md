# PhysicsOS Shared State Host

`@deepseek-ai/dsh-shared-state-host` owns the two pieces of runtime state that
must be shared when PhysicsOS runs more than one application replica:

- `rateLimit` — atomic fixed-window counters keyed by a namespaced caller key;
- `once` — one-time claims used for approval responses, idempotent writes, and
  other operations that must happen at most once.

The package has no Redis dependency. It includes the small RESP2 client needed
for `EVAL`, `SET`, `GET`, and `DEL`, so the Harness vendor tree remains
installable without a new package. Rate-limit and claim mutations execute as
single Lua scripts, which keeps the read-modify-write sequence atomic across
replicas.

## Cordis Services

The plugin publishes three services:

| Service                | Shape                                        | Consumer                                |
| ---------------------- | -------------------------------------------- | --------------------------------------- |
| `physicsosSharedState` | `{ rateLimit, once, close }`                 | learning-host and class-host primitives |
| `physicsosRateLimiter` | `consume(policy, key)` compatibility adapter | auth-host `LIMITER_SERVICE`             |
| `physicsosOnceLedger`  | `claim`, `consume`, `release`                | apiproxy `/api/respond` receipt path    |

The compatibility adapter has the same `consume`, `reset`, and `snapshot`
surface as `auth-host/src/limiter.ts`. The primitives hash caller keys before
building Redis keys, so usernames, tokens, IP addresses, and device hashes do
not appear in Redis key names:

```text
<keyPrefix>:<namespace>:<sha256(rawKey)>
<keyPrefix>:once:<sha256(rawKey)>
```

The auth compatibility adapter uses `limiter:<policy>` as its namespace, so an
auth login bucket is stored as `physicsos:limiter:login:<sha256(rawKey)>`.

## Configuration

The memory backend is the safe single-process default. Production should set
`backend: redis` and provide a Redis URL from the deployment secret environment.
The URL and TLS fields are validated by Schemastery before a connection is
opened.

```yaml
- id: shared-state-host
  name: '@deepseek-ai/dsh-shared-state-host'
  config:
    backend: redis
    keyPrefix: physicsos
    defaultRateLimitLimit: 60
    defaultRateLimitWindowMs: 600000
    defaultOnceTtlSeconds: 900
    redis:
      url: redis://redis:6379/0
      connectTimeoutMs: 2000
      commandTimeoutMs: 2000
      maxRetries: 3
      retryBaseDelayMs: 100
      tls:
        rejectUnauthorized: true
        servername: ''
        ca: ''
```

TLS is selected by the `rediss://` URL scheme. `tls.servername` and `tls.ca`
are optional overrides for private Redis endpoints. Credentials in error
messages and logs are replaced with `<redacted>`.

## Production Boundary

`compose.yml` already provisions Redis 7, stores the connection URL in the
`redis_url` secret, and exposes `REDIS_URL_FILE=/run/secrets/redis_url` to the
application. The deployment composition must resolve that secret into the
plugin's `redis.url` field; this package does not read secret files directly.
The health host remains responsible for the `/readyz` Redis probe.

The row must load before `auth-host`: auth-host resolves
`physicsosRateLimiter` while it creates its service, so a later row would leave
the single-instance limiter in place. Place the shared-state row before
`learning-host`, `class-host`, and `auth-host` in `cordis.patch.yml`; those hosts
can then resolve `physicsosSharedState` or `physicsosOnceLedger` lazily per
request. The apiproxy receipt integration should resolve
`physicsosOnceLedger` in its composition and replace the process-local
`pendingResponses` map used by the `/api/respond` policy.

With one replica the memory backend is sufficient. With more than one replica,
the Redis backend is required: each replica must use the same key prefix and
Redis database. If Redis is unavailable, backend calls throw instead of
falling back to a per-process counter or claim table. Auth turns that into its
dependency-unavailable response; apiproxy should similarly fail closed rather
than accepting a response it cannot verify.

## Verification

Run the package tests with the repository's Vitest binary:

```sh
PHYSICSOS_TEST_REDIS_URL=redis://127.0.0.1:6379/15 pnpm vitest run \
  packages/physicsos/shared-state-host/tests
```

The conformance suite runs against memory and Redis. Redis cases are skipped
with a clear suite label when `PHYSICSOS_TEST_REDIS_URL` is unreachable. The
suite covers atomic concurrent counters and claims, TTL expiry, fake-clock
memory behavior, connection timeout/fail-closed behavior, credential
redaction, and graceful `QUIT` shutdown.
