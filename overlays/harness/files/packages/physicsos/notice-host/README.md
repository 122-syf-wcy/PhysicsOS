# @deepseek-ai/dsh-notice-host

PhysicsOS 反馈与公告 host plugin. One prefix (`/physicsos/notice`), two directions of travel:

| Surface | Who reads | Who writes |
| --- | --- | --- |
| `/feedback` | a student sees their OWN rows; a teacher and above see the tenant queue | any signed-in account |
| `/feedback/:id/reply` | — | teacher and above, own tenant only |
| `/announcements` | every signed-in account, tenant + platform scope | school admin and above |

Identity comes from the session through the `physicsosIdentity` service that `auth-host` publishes. This host is declared BEFORE `auth-host` in the shipped patch, so the service is resolved per request rather than at load time — the failure mode is covered by `tests/composition.spec.ts`, which boots the real chain and asserts the gate answers on a live session.

Reading feedback is row-filtered rather than door-filtered: a student calling the list endpoint is a legitimate screen ("what have I sent?"), so answering 403 would break it to enforce a rule about WHICH rows are visible.

## Configuration

No config keys. The plugin injects `webServer` and `storageDomain`, and opens the `physicsos_notice` domain.

## Data

`feedback` holds one row per report (author key resolved server-side, optional contact and page context, status, and the operator's attributed reply). `announcements` holds one row per notice, with `schoolId: null` meaning platform-wide and a retired row staying in the table while leaving the served list.

## Verification

- `tests/routes.spec.ts` — the rules over a real http server with a stubbed identity (18 cases: role floors, the student's own-rows filter, cross-tenant refusal, retirement, and the audit trail).
- `tests/composition.spec.ts` — the real cordis chain, proving the gate is armed rather than merely present.

## Model Experience

None, as the package serves browser REST surfaces and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Replies are pull-only: a student sees an operator's reply on their next `/feedback` read; nothing pushes it — no unread marker, no notification.
- Feedback and announcements carry plain text only; there are no attachments and no rendered markup.
- Retired announcements keep their rows (`retiredAt`); there is no hard delete.
