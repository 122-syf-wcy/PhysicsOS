# @deepseek-ai/dsh-learning-host

PhysicsOS account-private learning records and experiment canvases. Existing attempts and saved scenes remain in `physicsos_learning`; `/physicsos/learning/canvases` uses the independent metadata-only `physicsos_canvas` unit and owner-private immutable files. Neither unit writes the anonymous `physicsos_auth.learning_counts` ledger.

## Identity and isolation

Every route resolves `physicsosIdentity` per request. Cookie identity supplies both the account and tenant; request bodies cannot supply either. Administrators receive no cross-account exception. Missing identity returns `503`; an absent or invalid session returns `401`. Canvas requests may include `x-physicsos-canvas-owner`, an encoded JSON object containing exactly `schoolId` and `username`; it is a rejection precondition, not authorization. A different actual account returns `401 ACCOUNT_CHANGED`, including a change detected before responding. Private responses use `no-store` and `nosniff`.

## Existing learning records

Paths below are relative to `/physicsos/learning`; existing learning format versions and tables are unchanged.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/attempts?limit&cursor` | Caller attempts, newest first |
| PUT | `/attempts/:id` | Idempotent immutable attempt upsert |
| GET | `/scenes?limit&cursor` | Caller saved scenes, newest first |
| PUT | `/scenes/:sceneId` | Saved-scene upsert |
| DELETE | `/scenes/:sceneId` | Idempotent saved-scene removal |

## Canvas REST

Paths below are relative to `/physicsos/learning/canvases`. Shared document and response types belong to `@physicsos/physics-workbench`; manifest `schemaVersion` is not the server head `version`. JSON mutations require same-origin requests and `application/json`.

| Method | Path | Request and durable result |
| --- | --- | --- |
| GET | `/?limit&cursor&search&state&sort&order` | `{items,nextCursor?}` head summaries; state is `live`, `deleted`, or `all`; sort is `updated`, `created`, or `title` |
| POST | `/` | `{id,title,mutationId}` establishes an empty manifest and head; returns `{head,manifest,replayed}` with `201`, or `200` on replay |
| GET | `/:id` | `{head,manifest}` after full immutable dependency verification; deleted documents return `410` |
| PUT | `/:id/objects/:digest` | Complete canonical UTF-8 JSON bytes for a manifest or WorkbenchObject; returns `{digest,kind,byteLength,bytes,existed}` |
| GET | `/:id/objects/:digest` | Verified original canonical bytes within this account and document |
| POST | `/:id/commit` | `{expectedVersion,expectedGeneration?,mutationId,manifestDigest}` publishes only a complete already-uploaded graph; returns `{head,manifest,replayed}` |
| POST | `/:id/rename` | `{expectedVersion,mutationId,title,manifestDigest?}` publishes an uploaded renamed manifest or creates it from the current manifest |
| DELETE | `/:id` | `{expectedVersion,mutationId}` retains a durable tombstone |
| POST | `/:id/restore` | `{expectedVersion,expectedGeneration?,mutationId}` restores only the expected deleted lifetime |
| POST | `/:id/copy` | `{expectedVersion,mutationId,id,title?}` clones the complete authorized source into new instance and scene identities; captured history remains unchanged |
| GET | `/changes?cursor&limit` | `{changes,cursor,hasMore}` includes committed head summaries and tombstones; cursor initially `0` |
| GET | `/policy` | Authenticated `{schemaVersion:1,limits}` with the deployment's complete aggregate GraphLimits; read-only configuration, not a document/storage migration |
| POST | `/:id/verify` | `{captureDigest,mutationId}` returns a persisted independent `{receipt,resultDigest?,replayed}`; resultDigest, when present, addresses a newly computed server snapshot |
| GET | `/:id/verifications?captureDigest&limit&cursor` | `{items:[{receipt,resultDigest?}],nextCursor?}` discovers every persisted receipt for the caller's document and exact captured snapshot, including receipts whose original response was lost |
| GET | `/:id/verifications/:receiptId` | The caller's persisted server receipt and evidence address |
| GET | `/:id/snapshots/:digest.csv` | Full raw dataset interchange, not a cropped or rounded renderer table |
| POST | `/gc` or `/:id/gc` | `{}` collects unreachable expired objects and returns actual removed object/byte counts |

Upload dependency objects before the objects that reference them, and upload the manifest last. SHA-256 addresses cover the complete canonical JSON envelope. Noncanonical bytes, missing dependencies, wrong kinds, cycles, malformed UTF-8, unsafe JSON, and oversized complete values are rejected. Client uploads cannot claim `source: 'server-engine'`. Renaming an alias or copying a Canvas never changes historical capture data or confers server certification.

Errors are `{error:{code,message,status,retryable,currentHead?,details?}}` with the actual HTTP status. `VERSION_CONFLICT` contains the current public head. A successful response is sent only after durable file, metadata, head, and retry receipt publication; a failure after the head commit may be retried with the same mutation identifier.

## Concurrency, retries, and changes

The service owns one queue per complete `(schoolId,userKey)` account. Create admission, cross-document quotas, copy, and collection run there. CAS, lifecycle state, and request-hash checks run inside the actual `KvTable.update` transform on the storage-domain write chain. The deployed PostgreSQL backend's existing single-writer lease is required; this service does not promise distributed multi-writer CAS.

Mutation identifiers are retained per account and Canvas. A receipt holds the original successful head and request hash; the head also carries its last commit so a receipt-write failure is repaired before another head mutation. Retrying identical content does not increment version, generation, or change sequence; using the identifier for different content returns `MUTATION_CONFLICT`. Versions and delete/restore generations only increase. Tombstones never release a Canvas identifier, and old commits cannot revive a deleted document.

Change cursors advance only through durable head summaries, including tombstones. Multiple intermediate mutations of the same document may coalesce to its latest head; this endpoint is a synchronization feed, not an audit log. A cursor ahead of the account's committed heads is rejected. List cursors are bound to filters and remain account-private; titles and update times may change while the caller pages.

## Durable files, quotas, and recovery

`canvasDshHome` overrides the existing Harness home resolver; otherwise it uses `DSH_HOME`, then the Harness default. Files live in `<home>/physicsos/canvases/v1/accounts/<owner-hash>/documents/<document-hash>`, not a session attachment pool. With production `DSH_HOME=/var/lib/physicsos`, these files belong to `app_data` and the existing full backup. Back up the metadata unit and private files together before switching images.

`physicsos_canvas` eagerly loads only head summaries, object metadata, mutation receipts, server receipts, and reservations. Raw scenes, snapshots, datasets, and history payloads are read lazily. Directories are application-owned `0700`; immutable files are `0400`. Publication uses private randomized staging, exclusive opens, measured complete bytes and SHA-256, file fsync, no-clobber hard-link publication, and publication/staging ancestor-directory fsyncs. Reads refuse symbolic links and verify length and digest before exposing bytes. Missing or corrupt referenced files are errors, never blank canvases.

Object reservations durably charge bytes before file writes. Metadata allocations reserve head and receipt capacity before the head commit. Server verification keeps a separately charged, owner-private first-attempt file so retrying a published attempt reuses its original timestamps, result bytes, and evidence digests instead of rerunning it. Accounting covers retained blobs, complete metadata envelopes, active and failed reservations, historical heads, tombstones, and full dependency closures. Failures conservatively retain charges. Collection marks current heads, retained head history, receipts, server evidence, and active reservations; it unlinks and directory-syncs unreachable files before removing their metadata charge. Retry cleanup removes abandoned staging before allocating another file. Metadata and filesystem writes are not a cross-medium transaction; reservations and commit capsules cover the interruption windows without claiming atomic rollback of both media.

Disposal unregisters REST first, refuses new Canvas requests, waits for complete admitted handlers and account queues, closes file operations, then closes domains. Requests still reading bodies count as in flight; configured deadlines bound that wait.

## Configuration

`canvasLimits` fields are validated positive safe integers except the two finite nonnegative comparison tolerances. Limits are deployment-configurable and overflow rejects without truncation. Shared JSON nesting has an explicit safety ceiling of `512`.

Authenticated clients resolve `/policy` before opening or admitting Canvas graphs and cache the validated policy by account for offline use. The same seven GraphLimits govern aggregate closure admission, synchronization, recovery, cloning, imports, and exports. Local admission checks the complete graph before a durable mutation; many individually valid objects cannot bypass the cumulative byte or JSON-node limit. Conservative shared portable defaults remain the fallback for anonymous/uncached offline work rather than replacing an explicit Host policy. Canvas identifiers `changes`, `gc`, and `policy` address reserved collection operations.

| Fields | Defaults |
| --- | --- |
| `maxRequestBytes`, `maxObjectBytes`, `maxVerificationAttemptBytes` | 32 MiB, 16 MiB, 64 MiB |
| `maxHeadBytes`, `maxMetadataBytes` | 4 MiB each |
| `maxDocumentBytes`, `maxAccountBytes` | 512 MiB, 4 GiB |
| `maxDocumentsPerAccount`, `maxObjectsPerDocument` | 1024, 32768 retained or reserved |
| `maxReferencesPerObject`, `maxClosureObjects` | 16384, 32768 |
| `maxGraphJsonNodes`, `maxGraphDepth`, `maxGraphReferences`, `maxGraphIssues` | 8000000, 256, 1000000, 128 |
| `maxHistoryEntries`, `maxVerificationEntries` | 4096 each |
| `defaultPageSize`, `maxPageSize` | 50, 200 |
| `maxTitleBytes`, `maxSearchBytes` | 4096 UTF-8 bytes each |
| `maxCsvBytes` | 512 MiB, including BOM and CRLF |
| `requestTimeoutMs`, `maxInFlightRequests` | 120000 ms, 128 |
| `reservationTtlMs` | 86400000 ms |
| `maxSimulationSamples`, `maxSimulationDurationSeconds`, `maxSimulationIterations` | 1000000, 86400 s, 5000000 |
| `absoluteTolerance`, `relativeTolerance` | `1e-8`, `1e-7` |

## Server verification and raw export

Server verification reads only an authorized immutable PhysicsScene and saved capture. The capture's engine ID selects only a server-registered engine descriptor; capability checks which may solve a model occur only after budget admission. That registered engine first supplies pure `getSimulationPlan` bounds for the original accepted SimulationRequest, including its real default horizon or documented numerical-settling upper bound and stored-sample/solver-iteration budgets; exceeding server policy refuses execution without changing the request. Verification then calls the real `physics-runtime` selected engine with those same options. It retains engine/verifier diagnostics and compares complete raw states, events, measurements, and derived values; it ignores only generated event/measurement IDs, not numerical readings. Engine failures, missing replay data, incompatible engine versions, mismatched raw values, unsupported replay bounds, and results carrying only schema or dimensional checks never receive a verified receipt. A request/cursor time and a nearest retained sample time remain distinct recorded facts.

The original snapshot is never overwritten. Independent server receipts associate with its digest; when the engine produces evidence, a new server snapshot and complete raw datasets are published separately. A `server-engine` label alone is not certification, and a `rejected`, `unsupported`, or `error` receipt is not a successful verification. The receipt identifies its compared engine-result/state scope; client-authored analysis datasets, raw presentation state, and diagnostics are explicitly unverified, not certified by association. CSV uses the saved datasets or derives them from the saved full SimulationResult without running another simulation; its reversible full-raw format retains conditions, descriptors, missing reasons, and row evidence.

### Receipt discovery and recovery

Receipt discovery requires `captureDigest`, the exact captured snapshot's lower-case 64-character SHA-256 address, rather than its scene digest. The service authorizes the caller's retained Canvas first, then filters existing receipt metadata by account, Canvas ID, and capture digest. Another account or a school administrator receives `404` for an unowned Canvas. Owned tombstones retain read access to these receipts. A valid digest with no matching receipts returns `{items:[]}`. Discovery reads metadata only; it does not load simulation payloads, run an engine, or write `physicsos_canvas`.

Pages sort by `checkedAt` and receipt ID in ascending order. Omit `cursor` for the first page and follow `nextCursor` until it is absent; one page is not the complete history. `limit` uses `defaultPageSize` when omitted and must be from `1` through `maxPageSize`. The opaque keyset cursor is bound to the authenticated account, Canvas, and capture. Reusing it with different otherwise-valid filters on an authorized Canvas, or supplying a malformed cursor, returns `400 BAD_CURSOR`; a missing/invalid capture digest or invalid page size returns `400 BAD_REQUEST`. Receipt cursors cannot be substituted for the integer `/changes` cursor.

Recovery preserves the accepted attempt rather than starting another verification:

1. Before `POST /:id/verify`, the client durably retains that Canvas/capture's mutation ID. If the response is lost, retry the same request with the same ID; the server reuses its published attempt and receipt.
2. A completely new browser restores the authorized Canvas and snapshot, lists all receipt pages by `captureDigest`, and reads every returned ID through `GET /:id/verifications/:receiptId`. This also discovers accepted receipts when the original browser closed before receiving the response or syncing any alias reference.
3. The client checks the returned Canvas, capture, and scene identities, plus the evidence address when viewing the associated server result. It caches actual server responses and merges references in alias metadata `verificationReceiptsById`, preserving legacy array/preference references and the frozen snapshot. Cached references support offline reopen; imported or copied references alone confer no server authority.

## Model Experience

Canvas operations do not call a model, alter prompts, consume model tokens, or change KV-cache contents. Server verification uses deterministic physics engines, not an LLM verdict.

## Known Limitations and Deferred Work

- Production file durability requires the supported Linux/POSIX storage and owner permissions. A filesystem that cannot fsync directories cannot acknowledge durable Canvas publication.
- Published head history and mutation receipts remain retained and count against quota; reaching a configured retention cap rejects a new mutation rather than silently pruning replay evidence.
- The synchronous engine cannot be interrupted inside its computation. Replay admission bounds its requested duration, iterations, and samples; cancellation is checked before and after execution.
- Existing saved-scene learning routes retain their shallow scene validation. Formal Canvas uploads use the full shared parser and immutable dependency validation instead.
