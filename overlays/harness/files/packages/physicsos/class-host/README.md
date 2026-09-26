# @deepseek-ai/dsh-class-host

PhysicsOS class, assignment, submission, review, and completion host plugin.
One prefix (`/physicsos/class`) over the shared `physicsosIdentity` service and
the `physicsos_class` storage domain.

| Surface                                                    | Who reads                                                                                 | Who writes                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| `/classes`                                                 | students see classes they belong to; teachers see classes they own; admins see the tenant | teacher and above                             |
| `/classes/:id/members`                                     | owner or school admin                                                                     | owner or school admin, by canonical `userKey` |
| `/classes/:id/assignments`                                 | class members, owner, or admin                                                            | owner or school admin                         |
| `/classes/:id/assignments/:id/submission`                  | the submitting student                                                                    | the submitting student, if a member           |
| `/classes/:id/assignments/:id/submissions`                 | owner or school admin                                                                     | —                                             |
| `/classes/:id/assignments/:id/submissions/:userKey/review` | —                                                                                         | owner or school admin                         |
| `/classes/:id/dashboard`                                   | owner or school admin                                                                     | —                                             |

The identity service is resolved per request because this host can load before
`auth-host` publishes it. Every service method re-checks tenant and ownership;
the route guard is an outer door, not the only check.

## Bounds

- Request bodies: 32 KiB.
- Class name: 80 characters; description: 500 characters.
- Membership: 500 users per class.
- Assignments: 500 per class; listed at most 200 at a time.
- Submission text: 16,000 characters; reviews at most 2,000 characters.
- List limits: classes 500, members 500, submissions 500.

## Verification

- `tests/routes.spec.ts` covers role enforcement, tenant isolation, membership,
  target/due validation, submission receipts, review, dashboard counts,
  payload bounds, and audit.
- `tests/composition.spec.ts` boots the real Cordis chain with `class-host`
  before `auth-host` and runs the full workflow on live session cookies.
