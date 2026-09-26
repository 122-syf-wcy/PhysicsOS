# `@deepseek-ai/dsh-ops-host`

`ops-host` is the read-only operations surface used by the PhysicsOS platform
administrator console. It exposes exactly one route:

```text
GET /physicsos/ops/metrics
GET /physicsos/ops/metrics?force=1
```

The response contains host disk usage, bounded directory occupancy, PostgreSQL
and Redis health/latency, live session/account aggregates, alerts, and cache
metadata. The route is session-authenticated and refuses every role except
`SUPER_ADMIN`.

## Collection and cache policy

The default collection cache is 15 seconds. Concurrent requests share one
in-flight collection, and `force=1` asks for a fresh sample while still sharing
an already-running collection. The cache is deliberately limited to small,
read-only operational numbers:

- filesystem and directory size summaries;
- database size and aggregate counts;
- dependency latency and memory totals;
- process uptime and runtime versions.

It must never contain session transcripts, student answers, credentials,
tokens, connection strings, usernames, IP addresses, or permission decisions.
Those values are either not collected or are reduced to a count before they
reach the response.

Directory scans are bounded by entry count and depth. They never follow
symlinks and never execute `du`, `df`, or another shell process. Because a
bounded scan is not an exact recursive quota, the result is marked
`partial: true` whenever a limit or permission boundary is reached.

## Configuration

The host reads the production wiring directly:

- `DSH_HOME`, default `/var/lib/physicsos`
- `PHYSICSOS_SESSIONS_ROOT`, default `<DSH_HOME>/sessions`
- `DATABASE_URL` or `DATABASE_URL_FILE`
- `REDIS_URL` or `REDIS_URL_FILE`
- `PHYSICSOS_STORAGE_SCHEMA`, default `physicsos`

`DATABASE_URL_FILE` and `REDIS_URL_FILE` are supported for compositions that
do not use the Docker entrypoint. Values are read once at plugin start and are
never serialized into the response.

The Cordis row may override `cacheTtlMs` (default 15000), `timeoutMs` (default
5000), `diskWarningPercent` (default 85), and `diskCriticalPercent` (default
92). The response repeats the effective disk thresholds so the read-only
administrator panel can color the same values the server evaluated.
