# @deepseek-ai/dsh-auth-host

PhysicsOS 账户体系 host plugin — school-tenant registration and login, argon2id passwords, opaque cookie sessions, attempt rate limiting, and the `/physicsos/auth` REST surface over the `webServer` service and a `physicsos_auth` storage-domain unit.

## Model

The school is a first-class tenant, not a profile field:

```
school (tenant)
  └─ user   keyed `schoolId:username` → UNIQUE(school_id, username) is structural
       └─ session   keyed `sha256(token)` → raw tokens never persist
```

`reset_requests` is the audit trail for the V1 admin-driven password recovery flow.

## REST surface (`/physicsos/auth`)

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| POST | `/register` | `{schoolName, schoolId?, username, displayName, password}` | `201 {user}` + `Set-Cookie` (session issued on success) |
| POST | `/login` | `{username, password, rememberDevice?, schoolId?}` | `200 {user}` + `Set-Cookie` |
| POST | `/logout` | — | `200 {ok}` + expired cookie; session row revoked |
| GET | `/me` | — | `200 {user}` or `401 UNAUTHENTICATED` |
| POST | `/password/forgot` | `{username, schoolId?}` | `200 {ok}` uniform receipt; records a reset request when the account resolves uniquely |
| POST | `/school-requests` | `{schoolName, contact}` | `201 {request}` anonymous school application, IP-rate-limited |

Failures answer `{error:{code,message,...details}}` with `BAD_REQUEST`, `SCHOOL_NOT_FOUND`, `SCHOOL_AMBIGUOUS`, `SCHOOL_REQUIRED`, `USERNAME_TAKEN`, `INVALID_CREDENTIALS`, `RATE_LIMITED`, `UNAUTHENTICATED`.

### Tenant resolution

The school stays a first-class tenant internally, but the public wire never carries a school list — the user types a name, the host resolves it:

- **Register** resolves `schoolName` against the fixed tenant roster (`SEED_SCHOOLS`: the ops tenant plus the Guizhou middle/high-school list in `schools-data.ts`): unique exact `name`/`shortName` match wins, then unique substring match. An unmatched name is `SCHOOL_NOT_FOUND` — registration never mints a tenant, so spelling variants cannot fork one school into several. `SCHOOL_AMBIGUOUS` returns up to 16 `error.candidates` (region-labeled, shortest names first) for a disambiguation retry carrying `schoolId`.
- **Login** resolves the account globally — verifies the password against every active `(school, username)` pair (bounded at 16 candidates). Zero matches is the uniform `INVALID_CREDENTIALS`; one match issues the session for that tenant; more than one match is the only `SCHOOL_REQUIRED` case and returns `error.candidates` so the client can retry with `schoolId`.
- `schoolId` on register/login/forgot is therefore a disambiguation answer, never a field the user picks from a served list.

## Security posture

- Passwords hash to self-describing argon2id PHC strings (`node:crypto.argon2`, Node ≥ 24.7); the plugin refuses to load on older runtimes.
- The session cookie (`physicsos_session`) is `HttpOnly; SameSite=Lax; Path=/`, `Secure` over https; `rememberDevice` turns it into a 30-day persistent cookie, otherwise a browser-session cookie with a 12h server-side expiry.
- Login rejects collapse to `INVALID_CREDENTIALS`; a missing account still pays the argon2 cost through a dummy verify so timing does not enumerate users.
- Fixed-window attempt buckets cap failures per account (5/10min) and per source IP (20/10min); `password/forgot` shares the IP bucket.
- POSTs require `content-type: application/json` plus matching `Origin`/`Sec-Fetch-Site` when present — the cookie session carries no ambient authority cross-site.
- Registration pins `role: 'STUDENT'`; `TEACHER`/`SCHOOL_ADMIN`/`SUPER_ADMIN` exist in the schema for future admin-driven enrolment only.

## Config

All `AuthServiceConfig` fields (`sessionTtlMs`, `rememberTtlMs`, `accountAttemptLimit`, `ipAttemptLimit`, `attemptWindowMs`) are cordis.yml-configurable with secure defaults.

## Invariant

`auth-host-invariant` asserts every session row resolves to a live `(schoolId, username)` user key with a matching `userId`, and every user references an existing school — a violation means a write bypassed `AuthService`.

## Known Limitations and Deferred Work

- Password recovery is an audit-only flow: `POST /password/forgot` records the request for an admin channel that does not exist yet; no email/token reset ships in V1.
- Attempt buckets are process-local; a multi-instance deployment needs a shared limiter backend.
- Server-side ownership of scenes/questions/learning records is not wired — V1 authenticates identity and scopes client-side data by user; per-resource `userId`/`schoolId` columns are the next step.
- Roles beyond `STUDENT` have no enrolment or permission surface yet.
