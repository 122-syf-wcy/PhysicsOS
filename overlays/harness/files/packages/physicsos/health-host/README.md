# PhysicsOS Health Host

`@deepseek-ai/dsh-health-host` registers two exact routes on the Harness Web
server:

- `GET /healthz` is process liveness and never touches a dependency.
- `GET /readyz` checks PostgreSQL and Redis over TCP and returns `503` until
  every configured dependency answers.

Production secret wiring uses two files:

```text
DATABASE_URL_FILE=/run/secrets/database_url
REDIS_URL_FILE=/run/secrets/redis_url
```

The files contain `postgresql://...` and `redis://...` URLs. They are reread for
each readiness request, capped at 8 KiB, and never included in responses or
logs. With no configured checks, readiness fails closed with
`NO_READINESS_CHECKS`.

`deployment.patch.yml` binds the production web server to all container
interfaces and mounts the compiled plugin by absolute path. The Compose port
binding remains loopback-only by default.
