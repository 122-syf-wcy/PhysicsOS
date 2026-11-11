# Actual account usage

`physicsos_usage` is an independent version-0 unit. Existing `physicsos_learning` attempts and saved scenes remain intact. Visit and use counts describe product events admitted by the server; earlier unrecorded visits cannot be reconstructed from last-login timestamps. Historical token data is recovered only from owned durable Session settlements.

`GET /physicsos/usage` returns the authenticated account's summary, including for a platform administrator. `GET /physicsos/admin/usage` requires a school or platform administrator. School administrators may read only their own school; platform administrators may narrow with `schoolId`. `from` and `to` are inclusive Shanghai calendar dates. The default window is the latest thirty Shanghai days.

`POST /physicsos/usage/events` accepts `{id,kind,surface,action?}`. `kind` is `visit` or `use`; product surfaces and actions use the declared enums. Owner and timestamp are server-controlled. Repeating an identical account/event id returns the original durable event. Reusing it for different content returns a conflict. `x-physicsos-usage-owner` optionally pins the expected school and username; it can refuse a request and cannot grant authority. Responses are private and never cached.

Token buckets are disjoint: uncached input, cache reads, cache writes and output form the total. Reasoning is displayed separately but is already part of output. A settlement without reported usage increments `missingCalls`; it does not invent token counts. An intermediate and final settlement for the same turn/step/attempt replace one receipt. A logged retry starts another attempt. Durable receipt publication precedes the batch checkpoint, so replay after a checkpoint failure cannot repeat a charge.

Only events at or after a Session's exact inherited boundary contribute new usage. Direct session ownership comes from the auth resource ledger. Unclaimed descendants are attributed only through a real live Agent creator relation, retained as private parent metadata for restart recovery. A conflicting exact owner wins over a parent relation. A `parentSession` header alone grants no account ownership. Session text, prompts, outputs, credentials and provider keys are absent from this unit.

Trusted host callbacks record moderation, paper, image and diagram usage. Receipts without an account owner are system work, excluded from personal and school totals and returned separately in the platform aggregate. Browser routes never admit model receipts or numerical consumption.

All retention, request, replay and window limits are configurable through `UsageLimits`. Exceeding a limit rejects the complete operation and retains previously durable records. Runtime disposal detaches observers before service and domain disposal. All verification and deployment use the authoritative server and Docker environment.
