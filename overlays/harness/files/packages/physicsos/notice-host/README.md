# @deepseek-ai/dsh-notice-host

PhysicsOS 反馈与公告 host plugin. One prefix (`/physicsos/notice`), two directions of travel:

| Surface | Who reads | Who writes |
| --- | --- | --- |
| `/feedback` | a student sees their OWN rows; a teacher and above see the tenant queue | any signed-in account |
| `/feedback/:id/reply` | — | teacher and above, own tenant only |
| `/announcements` | every signed-in account, tenant + platform scope | school admin and above |
| `/platform-notice` | every signed-in account, together with that account's acknowledgement | platform `SUPER_ADMIN` only |
| `/platform-notice/ack` | — | any signed-in account, current version only |
| `/public/website` | anyone; enabled public fields only | — |
| `/public/website-feedback` | — | anonymous JSON intake with origin checks and shared limits |
| `/website` | `SUPER_ADMIN` | `SUPER_ADMIN`, optimistic `expectedVersion` saves |
| `/website-feedback` | `SUPER_ADMIN`, status/offset/limit inbox | — |
| `/website-feedback/:id/reply` | — | `SUPER_ADMIN` |
| `/website-feedback/:id/images/:imageId` | `SUPER_ADMIN`, through the owning feedback record | — |

Identity comes from the session through the `physicsosIdentity` service that `auth-host` publishes. This host is declared BEFORE `auth-host` in the shipped patch, so the service is resolved per request rather than at load time — the failure mode is covered by `tests/composition.spec.ts`, which boots the real chain and asserts the gate answers on a live session.

Reading feedback is row-filtered rather than door-filtered: a student calling the list endpoint is a legitimate screen ("what have I sent?"), so answering 403 would break it to enforce a rule about WHICH rows are visible.

## Configuration

The plugin injects `webServer` and `storageDomain`, and opens the `physicsos_notice` domain.
`trustedProxies` is an array of exact IP literals (default `[]`), wired to the same
`PHYSICOS_TRUSTED_PROXIES` setting as auth-host. Only those direct peers may supply
forwarded client addresses and scheme. The shared `physicsosRateLimiter` service
and screenshot `attachments` service are resolved lazily. Missing or failing
limiting refuses anonymous intake with 503. Limits are three attempts per client
per ten minutes, plus sixty attempts globally per hour, in website-only namespaces.

Website content and anonymous feedback use independent `website_content` and
`website_feedback` tables at domain version 0. No fabricated content is seeded.
Each content list has at most twelve items; name and quote/project are required,
while role, topic, description and project URL may be empty. Nonempty URLs and
avatars must be complete HTTP(S) addresses without credentials. Avatar storage is
URL configuration only. Feedback screenshots use real attachment batch validation,
normalization and durable storage, at most three files of 5 MiB each. Only the
anonymous screenshot route permits 22 MiB JSON; other routes remain at 64 KiB.
Feedback contact, body, context, image names and bytes never enter the audit ledger.

## Data

`feedback` holds one row per report (author key resolved server-side, optional contact and page context, status, and the operator's attributed reply). `announcements` holds one row per notice, with `schoolId: null` meaning platform-wide and a retired row staying in the table while leaving the served list.

`platform_notice` is the singleton PhysicsOS internal-testing notice. Every admin save advances its version by one, and `platform_notice_acks` stores one acknowledgement per account. The acknowledgement deliberately lives here rather than in `ui-onboarding` settings: the Harness settings document is deployment-wide, so using it would let one account dismiss the notice for everyone.

## Verification

- `tests/routes.spec.ts` — the rules over a real http server with a stubbed identity (18 cases: role floors, the student's own-rows filter, cross-tenant refusal, retirement, and the audit trail).
- `tests/platform-notice.spec.ts` — default copy, SUPER_ADMIN-only writes, bounds, account-scoped acknowledgement, audit summary, and monotonic concurrent saves.
- `tests/composition.spec.ts` — the real cordis chain, proving the gate is armed rather than merely present.

## Model Experience

None, as the package serves browser REST surfaces and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- Replies are pull-only: a student sees an operator's reply on their next `/feedback` read; nothing pushes it — no unread marker, no notification.
- Feedback and announcements carry plain text only; there are no attachments and no rendered markup.
- Retired announcements keep their rows (`retiredAt`); there is no hard delete.
