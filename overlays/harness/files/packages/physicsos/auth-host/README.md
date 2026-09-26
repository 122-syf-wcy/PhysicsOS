# @deepseek-ai/dsh-auth-host

PhysicsOS 账户体系 host plugin — school-tenant registration and login, argon2id passwords, opaque cookie sessions, attempt rate limiting, the `/physicsos/auth` REST surface, and the shared `/api` account policy over the `webServer` service and a `physicsos_auth` storage-domain unit.

## Model

The school is a first-class tenant, not a profile field:

```
school (tenant)
  └─ user   keyed `schoolId:username` → UNIQUE(school_id, username) is structural
       └─ session   keyed `sha256(token)` → raw tokens never persist
```

`reset_requests` is the admin recovery queue and lifecycle trail. A request can
be pending, active, used, cancelled, expired, superseded, or failed delivery.
`password_reset_tokens` is keyed by the SHA-256 of the raw token; the raw value
exists only in the delivery message or the one-time admin issue response.

`api_resources` is the durable ownership ledger for Harness sessions and
workspaces. A non-admin account owns every session it creates and exactly one
host-created private workspace under `workspaceRoot`; legacy/unowned resources
remain visible only to a `SUPER_ADMIN`.

## Shared `/api` policy

The generic Harness API is a first-class authenticated surface when this host is mounted:

- every `/api` request needs a live `physicsos_session` cookie;
- `session.*`, `subagent.*`, goal, skill, and nested Typert payloads are checked against `api_resources`;
- `session.list`, `session.search`, workspace lists, archive state, and WebSocket mux/host frames are filtered to owned resources;
- `/api/respond` accepts a pending approval/question response only after the same account received that `rpcId`; the pending map is process-local with a 15-minute TTL;
- non-admin `session.create` ignores caller `cwd`/arbitrary workspace choices and always uses the account's private workspace plus the `physics-student` preset;
- host path/configuration methods and agent-preset mutation stay administrator-only;
- host-describe reports the account's private workspace, not the deployment root.

The policy is attached by `client-connection` as an optional `apiPolicy`
service wrapping the complete shared dispatcher, so both Typert Gateway methods
and legacy API Proxy methods pass the same gate.

## REST surface (`/physicsos/auth`)

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/register` | `{schoolName, schoolId?, username, displayName, password, deviceId?}` | `201 {user}` + `Set-Cookie` (session issued on success) |
| POST | `/login` | `{username, password, rememberDevice?, schoolId?, deviceId?}` | `200 {user}` + `Set-Cookie` |
| POST | `/logout` | — | `200 {ok}` + expired cookie; session row revoked |
| GET | `/me` | — | `200 {user}` or `401 UNAUTHENTICATED` |
| POST | `/usage/learning` | `{knowledgeId, correct}` | `201 {cell}` signed-in only; folds the report into one `learning_counts` cell keyed `schoolId|date|knowledgeId` — school from the session, date from the server clock, no account on the row |
| POST | `/devices` | `{deviceId}` (hash-shaped hex) | `200 {device}` signed-in only; idempotent re-seen, `403 DEVICE_REVOKED` on a revoked machine |
| POST | `/password/forgot` | `{username, schoolId?}` | `200 {ok}` uniform receipt; queues or directly delivers a one-time reset when the account resolves uniquely |
| POST | `/password/reset` | `{token, newPassword}` | `200 {ok}`; password changed, every session and sibling token revoked |
| POST | `/school-requests` | `{schoolName, contact}` | `201 {request}` anonymous school application, IP-rate-limited |

Admin surface (`/physicsos/auth` continued; `SCHOOL_ADMIN` scoped to their own tenant, `SUPER_ADMIN` platform-wide):

| Method | Path | Result |
| --- | --- | --- |
| GET | `/school-requests` | pending join applications |
| POST | `/school-requests/:id/(approve\|reject)` | onboard or refuse an applicant |
| GET | `/schools` | tenant list |
| POST | `/schools` | create a tenant (super admin) |
| POST | `/schools/:id/status` | suspend/reactivate a tenant |
| GET | `/users` | account list (`?schoolId&role&q`), tenant-scoped for school admins |
| POST | `/users` | create an account (CSV import's per-row call) |
| POST | `/users/:key/(status\|reset-password\|revoke-sessions)` | suspend/reactivate, reset password, kill all sessions |
| GET | `/devices` | registered machines with risk signals |
| POST | `/devices/:id/revoked` | revoke/restore by physical machine — new logins 403, live sessions 401 on next resolve |
| GET | `/password-resets` | tenant-scoped recovery queue (`?status&schoolId&q&limit`) |
| POST | `/password-resets/:id/issue` | mint and return a one-time link; invalidates every older token |
| POST | `/password-resets/:id/cancel` | cancel the request and revoke its current token |
| GET | `/dashboard` | aggregate counts + learning-analytics cells for the admin console |
| GET | `/audit` | tenant-scoped audit events |

Failures answer `{error:{code,message,...details}}` with `BAD_REQUEST`, `SCHOOL_NOT_FOUND`, `SCHOOL_AMBIGUOUS`, `SCHOOL_REQUIRED`, `USERNAME_TAKEN`, `INVALID_CREDENTIALS`, `INVALID_RESET_TOKEN`, `RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE`, `DEVICE_REVOKED`, `UNAUTHENTICATED`, `FORBIDDEN`.

### Tenant resolution

The school stays a first-class tenant internally, but the public wire never carries a school list — the user types a name, the host resolves it:

- **Register** resolves `schoolName` against the fixed tenant roster (`SEED_SCHOOLS`: the ops tenant plus the Guizhou middle/high-school list in `schools-data.ts`): unique exact `name`/`shortName` match wins, then unique substring match. An unmatched name is `SCHOOL_NOT_FOUND` — registration never mints a tenant, so spelling variants cannot fork one school into several. `SCHOOL_AMBIGUOUS` returns up to 16 `error.candidates` (region-labeled, shortest names first) for a disambiguation retry carrying `schoolId`.
- **Login** resolves the account globally — verifies the password against every active `(school, username)` pair (bounded at 16 candidates). Zero matches is the uniform `INVALID_CREDENTIALS`; one match issues the session for that tenant; more than one match is the only `SCHOOL_REQUIRED` case and returns `error.candidates` so the client can retry with `schoolId`.
- `schoolId` on register/login/forgot is therefore a disambiguation answer, never a field the user picks from a served list.

## Security posture

- Passwords hash to self-describing argon2id PHC strings (`node:crypto.argon2`, Node ≥ 24.7); the plugin refuses to load on older runtimes.
- The session cookie (`physicsos_session`) is `HttpOnly; SameSite=Lax; Path=/`, `Secure` over https; `rememberDevice` turns it into a 30-day persistent cookie, otherwise a browser-session cookie with a 12h server-side expiry.
- Login rejects collapse to `INVALID_CREDENTIALS`; a missing account still pays the argon2 cost through a dummy verify so timing does not enumerate users.
- Fixed-window attempt buckets cap failures per account (5/10min), per source IP (20/10min), registration (60/10min), learning reports (120/10min per account), and forgot/reset attempts (10/10min by IP and subject).
- Reset tokens are hashed with SHA-256 at rest, expire after 30 minutes, are single-use, and are invalidated by a newer issue, cancellation, account disable, admin reset, or successful redemption.
- POSTs require `content-type: application/json` plus matching `Origin`/`Sec-Fetch-Site` when present — the cookie session carries no ambient authority cross-site.
- Registration pins `role: 'STUDENT'`; `TEACHER`/`SCHOOL_ADMIN`/`SUPER_ADMIN` exist in the schema for future admin-driven enrolment only.
- Proxy-derived client IP/scheme is trusted only when the direct peer is an exact literal in `trustedProxies`.
- Generic `/api` fails closed when the identity host is absent, and account ownership is persisted rather than inferred from a client-supplied id.

## Config

All `AuthServiceConfig` fields (`sessionTtlMs`, `rememberTtlMs`,
`accountAttemptLimit`, `ipAttemptLimit`, `applyAttemptLimit`,
`registrationAttemptLimit`, `learningAttemptLimit`, `passwordResetAttemptLimit`,
`passwordResetTtlMs`, `attemptWindowMs`, `attemptBucketLimit`,
`trustedProxies`) are cordis.yml-configurable with secure defaults.
`workspaceRoot` controls where account-private Harness workspaces are created
(default `dshHomePath('physicsos-users')`).

## Password-reset delivery

The default adapter is `admin-queue`: `POST /password/forgot` creates a pending
row and no token. An administrator issues the token through
`POST /physicsos/admin/password-resets/:id/issue`; the response is the only
time the raw value exists, and the admin UI must deliver it out of band.

A deployment may provide a Cordis service named
`physicsosPasswordResetDelivery`:

```ts
export default {
  kind: 'smtp',
  mode: 'direct',
  async deliver({ username, token, expiresAt, resetPath }) {
    // Send resetPath (or token) to the account's verified channel. Never log it.
  },
}
```

The provider must be declared before `auth-host` in the composition. A direct
delivery failure revokes the just-issued token and marks the request
`delivery_failed`; it never leaves a token valid but undelivered.

## Shared limiter and Redis boundary

`AuthService` consumes a `LimiterBackend`; the bundled
`InMemoryLimiterBackend` is the reference for one process. A multi-instance
deployment provides a Cordis service named `physicsosRateLimiter` before
`auth-host`. The provider contract is:

1. key each bucket as `physicsos:limiter:<policy>:<sha256(rawKey)>` — raw IPs,
   usernames, and tokens never appear in Redis keys;
2. execute one atomic Lua script per decision (`INCR`; `PEXPIRE windowMs` only
   for a new key; return count and PTTL);
3. throw on Redis errors. `auth-host` translates that to
   `503 DEPENDENCY_UNAVAILABLE`; there is no unlimited fallback.

`snapshot()` is optional for remote providers because an exact cross-instance
bucket count is not needed for authentication and may be expensive.

## Ownership migration

Legacy Harness sessions/workspaces without `api_resources` rows are migrated
with an explicit manifest:

```json
{
  "ownership": [
    { "kind": "session", "resourceId": "sess_123", "schoolId": "GZU", "username": "2023123456" },
    { "kind": "workspace", "resourceId": "ws_123", "schoolId": "GZU", "username": "2023123456" }
  ]
}
```

```sh
pnpm --filter @deepseek-ai/dsh-auth-host run migrate:ownership -- \
  --storage-root "$DSH_HOME/storages" \
  --manifest ./ownership.json

# Re-run with --apply after reviewing the dry-run summary.
```

Unknown owners or malformed entries abort before the first write. An existing
resource with a different owner is reported as a conflict and is never
rewritten; the command exits 2 when conflicts exist.

## Invariant

`auth-host-invariant` asserts every session row resolves to a live `(schoolId, username)` user key with a matching `userId`, and every user references an existing school — a violation means a write bypassed `AuthService`.

## Model Experience

None, as the package serves browser REST surfaces and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Pending `/api/respond` ownership is process-local; a multi-instance deployment needs a shared one-time response ledger.
- The bundled limiter is process-local; a multi-instance deployment must provide the documented Redis-compatible `physicsosRateLimiter` service.
- Reset tokens are durable in the auth domain, but cross-process compare-and-set depends on the deployment's shared storage limits; ownership migration remains an explicit manifest-driven operation.
- Server-side ownership of PhysicsOS scenes/questions/learning records is not wired; V1 scopes those client-side, and per-resource `userId`/`schoolId` columns remain deferred.
- Roles beyond `STUDENT` have no enrolment or permission surface yet.
