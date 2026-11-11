# Model usage outbox

This small Node utility lets direct model callers retain usage before the shared statistics service acknowledges it. Auth and paper hosts each own a `usage_receipts` table in their existing durable unit; the bridge knows only structural table/sink interfaces and does not depend on Cordis or storage-domain.

`begin()` records a stable provider-attempt identity and original `occurredAt`. Call it after input preflight and just before starting the stream. Pass the caller abort signal to `begin()`: cancellation during persistence durably removes the new row before admission returns. If cancellation is noticed after admission but before stream dispatch, call `abandon()`; it removes the unused receipt instead of producing missing-call coverage. Already dispatched calls still use `finish()`.

`finish()` preserves copied numerical usage (or explicit missing coverage), then schedules delivery. Sink absence, transient failures and lost responses keep the same durable receipt for retry; acknowledged rows are removed. Restart converts interrupted started calls into missing-usage receipts without rerunning any model.

`withOwner()` captures only the server-authenticated actor for an asynchronous operation; no scope means system usage. `run()` tracks model work through shutdown. `close()` cancels the exposed signal, waits for tracked work, makes one bounded delivery attempt, and leaves unacknowledged durable rows for restart. Local persistence failures remain in memory for retry and are reported; shutdown refuses to silently discard an unpersisted receipt.

The caller's model deadline remains authoritative. Sink delivery has an independent five-second bound and never delays the classifier/paper result. The utility contains no model-visible input and no provider request, token estimate, raw prompt, credential or output-text storage.

Run this package's tests and the auth/paper receipt integration tests in the project's server Docker environment.
