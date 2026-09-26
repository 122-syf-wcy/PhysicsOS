# @deepseek-ai/dsh-learning-host

PhysicsOS personal learning host plugin. It serves `/physicsos/learning` over
the `physicsos_learning` storage-domain unit:

| Method | Path                     | Result                                                    |
| ------ | ------------------------ | --------------------------------------------------------- |
| GET    | `/attempts?limit&cursor` | the caller's attempts, newest first, cursor-paginated     |
| PUT    | `/attempts/:id`          | idempotent immutable attempt upsert                       |
| GET    | `/scenes?limit&cursor`   | the caller's saved scenes, newest first, cursor-paginated |
| PUT    | `/scenes/:sceneId`       | idempotent saved-scene upsert                             |
| DELETE | `/scenes/:sceneId`       | idempotent saved-scene removal                            |

The account and tenant come exclusively from the session through the
`physicsosIdentity` service. No endpoint accepts `userKey` or `schoolId` from
the wire, and there is no administrator read path for personal rows. Hosts are
declared before auth-host, so identity is resolved lazily per request; missing
identity fails closed with `503`, and an unresolved session with `401`.

## Privacy Boundary

`physicsos_learning` is separate from `physicsos_auth.learning_counts`.
Personal attempts may contain prompts and answers, while aggregate counters
remain anonymous school-by-day knowledge observations. Saving an attempt here
does not update the aggregate ledger.

## Client Wiring

The package is intentionally not added to shared bundle wiring in this task.
The controller must add it to the overlay path list, host project references,
root host typecheck/lint/test commands, and the shipped cordis composition.
The client controller must create `createLearningApi()`, pass it to
`createLearningRecordController` and `createPhysicsSurfaceController`, then
call both `sync()` methods after the authenticated storage namespace exists.

## Verification

- `tests/routes.spec.ts` covers authentication, tenant/account isolation,
  pagination, idempotency, scene updates, and scene deletion.
- `tests/composition.spec.ts` boots the real storage/auth/learning chain,
  proves cross-session reads, and proves personal saves do not enter the
  aggregate dashboard.
- `tests/client-sync.spec.ts` covers local migration, offline-first writes,
  remote merge, scene tombstones, request encoding, and error codes.

## Known Limitations and Deferred Work

- The client sync methods are exposed but shared `client/index.ts` wiring is
  owned by the controller, so the shipped application does not call them until
  that wiring lands.
- Sync cursors are opaque but not signed; they only narrow the caller's own
  rows and cannot grant access to another account or tenant.
- Saved scenes are bounded by request size and a shallow structural contract,
  not full physics-engine validation; the Lab remains the validator of the
  rendered scene.
