# Canvas storage and capture protocol

This protocol describes the shared data layer, not a second UI, renderer, HTTP client, or storage engine. The canonical document/object DTOs are executable TypeScript contracts exported by `@physicsos/physics-workbench`; transports may use the wire interfaces in `protocol.ts` without importing feature plugins.

## Canonical content

Objects and manifests are plain finite JSON. Canonical serialization sorts object keys lexicographically, preserves array order and Unicode text, normalizes negative zero to zero, and emits JavaScript's finite-number round-trip representation. Strings are not NFC-normalized, since changing notebook text or a semantic identity would change content. Accessors, executable values, `toJSON`, class instances, custom array behavior, sparse arrays, symbols, dangerous prototype keys, and cycles are not serialized.

Storage computes lower-case SHA256 over the exact UTF-8 canonical bytes. `canonicalByteLength` gives those same bytes' size for quotas. The format's `schemaVersion: 1` is unrelated to `CanvasHead.version`. A parser validates structure, registered unit/dimension relationships, identity and references; it does not certify a claimed source or a physics verification level.

`copyJsonObject` is a runtime boundary for typed plain domain values. It omits absent optional properties on objects, but never changes missing samples to null or zero, drops array elements, serializes a callback, or unwraps an engine instance. Unknown wire input uses strict parsers rather than this optional-field conversion. `copyDiagnosticObject` is reserved for plain error details: overflow/non-finite values become `{ missing: 'non-finite-diagnostic', value: '<original diagnostic text>' }` while finite neighboring fields remain intact. This helper is not a route for publishing non-finite raw physical measurements; it still rejects executable or cyclic details.

## Dependency closure

`refsOf` enumerates every direct protocol reference:

1. Manifest current/origin scene refs, snapshot aliases, comparison datasets, and history.
2. Snapshot captured scene and datasets.
3. Dataset source scene.
4. History parents and entry scenes/snapshots.

Scene object IDs, question IDs, notebook observation IDs, renderer release digests, and arbitrary metadata are not durable canvas-blob references. Generic recursive guessing would either retain garbage or let malicious metadata demand unauthorized objects.

A complete graph includes the transitive closure of these references. Each referenced blob must exist, match the reference kind, and have the canonical digest that its map key names. Typed graph validation checks structure and object relationships; hash verification uses the caller's supplied SHA256 function. History cycles are invalid. A dataset points to its source scene, not back to its snapshot, so capture datasets do not form a snapshot/dataset cycle.

Snapshot request/result scene identities and revisions must agree with the captured scene object. Dataset origin must agree with its source scene object. A comparison member's dataset must belong to the snapshot selected by its alias, and its selected metric/axis must exist. Current scenes are independently owned by experiment instances. Historical scene blobs can share an ID/revision while preserving different presentation metadata or timeline views; exact digest references identify their captured content rather than a guessed ID/revision equivalence. Dataset IDs are scoped inside captures, not globally unique across repeated captures. A historical snapshot does not require its recorded instance to still exist in today's manifest.

Lazy client/host caches may hold additional blobs, but publication/export uses a complete reachable closure. GC and quota calculations must operate on validated protocol references, not presentation state. The host authorizes every requested digest in the account/document namespace before reading or copying it. `GraphLimits` provides caller-configurable byte, object, reference, nesting, JSON-node, and issue-count budgets; portable defaults do not replace an explicit host policy. A validated nesting ceiling of 512 protects the shared recursive codec. CSV export accepts an optional exact UTF-8 `maxBytes` admission limit and rejects an oversized export before accumulating the complete output, never truncating it.

## Head publication and outbox

The host provides create, list, open, object upload/download, commit, rename, copy, delete, restore, changes, and server verification operations.

- Create establishes the document and a real empty manifest before ordinary account/document uploads are possible. An optional initial digest must describe the server-accepted empty manifest, not bypass upload authorization.
- Upload parses the manifest or immutable object, checks exact canonical bytes/hash, and durably stores it without publishing a head.
- Commit compares `expectedVersion` (and generation when provided), checks the manifest and complete dependency closure, then atomically publishes the head and account change sequence.
- `mutationId` is idempotency identity. Repeating the same successful operation returns its original result; reusing it for different content must not succeed.
- Rename can either accept a previously stored renamed manifest or create one from the authorized current manifest.
- Copy can either publish a validated client-cloned graph or invoke the same shared clone logic over an authorized server graph.
- Delete/restore advances lifetime fencing and preserves the host's recovery material. These operations do not erase the meaning of historical captures.

A `CanvasWorkingCopy` carries base head/base manifest, local working manifest, local objects, and outbox entries. The data package does not open IndexedDB, schedule retries, or send HTTP. If a CAS conflict arrives, the client can load the remote head and run `mergeManifests(base, working, remote)`. Conflicts are reported as JSON Pointer paths with base/local/remote values, not overwritten silently. A graph-aware caller may explicitly reconcile independently appended histories by merging document content without its history head and then hashing a new history object whose parents are both retained heads. The manifest-only merge does not fabricate unhashed history objects or discard either history branch.

## Clone, origin restoration, and import

Editable canvas, node, edge, comparison member, snapshot alias, instance, and scene identities are regenerated through caller-provided ID generation. A copied experiment starts with a new owned current scene ID and a new origin scene ID. Its physical object IDs remain valid inside its independently owned scene/runtime. The clone must not restart from template defaults or discard question, release, notebook, lineage, custom metadata, or edited quantities.

Ordinary clone retains immutable historical objects and raw evidence unchanged. Alias association and node identities can map to the new editable document, but the old snapshot's recorded scene ID, revision, engine result, and values remain those actually captured. Copying evidence is not running the new scene or verifying it anew.

Origin restoration is a new edit of the current instance-owned scene ID. The caller increments current scene revision and instance edit revision, stores a new scene object, and leaves the origin scene object untouched. Replacing the owned identity/revision with the origin object's identity/revision would reconnect two supposedly independent runtimes and lose edit history.

Portable import first validates the complete graph and supplied canonical hashes. It regenerates editable identities and changes all imported snapshot provenance to `imported`. If a snapshot envelope changes, its digest and explicit referring aliases/history references change too; raw request/result/state/native data are not rewritten. Import cannot mint a server receipt or promote client data into a server-authenticated capture. The clone result exposes generated identity/digest mappings for host/client publication. `ids` uses escaped path segments such as `node/<oldId>` and `scene/<oldInstanceId>/<current|origin>/<oldSceneId>`. `instanceScenes` maps raw old instance IDs to their new current/origin references. `digests` includes only unambiguous reachable one-to-one mappings; a source scene shared by several owners or retained as historical evidence can legitimately have no single digest mapping.

## Held capture publication

The runtime retains exact accepted request, result, standard cursor state, native raw state, clock, cursor, declared semantic interpretations, and pre-hash analyses during normal frame processing. Capturing reads that held data. It does not invoke an engine, replay a timestep, reconstruct an optics scan from a label, or call a CSV presentation formatter.

Publication order is executable:

1. `publicCapturedResult(raw)` defensively copies and validates the held source.
2. `createSceneObject(capture.scene)` supplies complete immutable scene content. The caller hashes it and obtains `ObjectRef<'scene'>`.
3. `captureDatasets(capture, { sourceScene })` projects every raw stored state/measurement and binds native `AnalysisDataset` values to that real reference. The caller hashes/stores each dataset.
4. `createSnapshotObject({ ...capture, sceneRef, instanceId, instanceEditRevision, capturedAt, source, datasets })` preserves the complete held evidence and actual dataset refs. The caller hashes/stores the snapshot.
5. A snapshot alias and result node reference the new immutable snapshot; a later manifest commit publishes the graph.

A diagnostic-only unavailable runtime remains an honest `CapturedResult` but cannot produce a snapshot with invented result/state data. Native `rawState` is validated plain data, not a substitute for server verification. Result-level derivations and independently held cursor derivations retain their different scopes. When a runtime already selected a stored sample, the requested cursor remains unchanged and the captured state's evaluated time remains the sample's actual time. A nonzero offset requires unchanged membership in the held result and a request within its accepted range, and is recorded as `SAMPLED_STATE_CURSOR_OFFSET` rather than hidden by retiming or recomputation.

## Metric, axis, and comparison safety

Metrics have semantic key, target, component, dimension, registered unit, scale, and physical reference. Cross-instance target IDs can compare only through explicit role bindings. A physical dimension alone does not answer whether two readings measure the same phenomenon or share a reference zero.

Axes identify actual time, parameter, space, or static variables and their origin/reference. A current parameter/spatial cursor cannot retroactively label all `SimulationResult.states` as a sampled scan. If the runtime has a real native scan, its `AnalysisDataset` supplies explicit coordinates. Static models with one or many t=0 states keep every raw row under an explicit static axis; duplicate coordinates remain duplicate observations, not an invitation to invent averages.

Native overlays keep original point order/count. Unit conversion uses only registered multiplicative conversions and checks numeric overflow. Full raw dataset rows may retain finite values that overflow a requested SI/display conversion; the conversion yields an explicit missing reason, not zero or a corrupted value. Raw scene and core simulation quantity contracts still validate their required finite canonical representation.

Differences require exact compatible coordinates. Unmatched, ambiguous duplicate, missing, or overflowing coordinates/values are explicit missing results. There is no interpolation, nearest-neighbor alignment, smoothing, sampling reduction, or statistical calculation. Absolute temperature differences get a temperature-difference scale. Compatible logarithmic differences carry a log-ratio descriptor, not a bare linear SI reading.

Conditions are actual declared scalar/vector/primitive facts. Native scan analyses own their fixed-condition lists; the current scene's swept variable must not be reattached as a fixed control. Unresolved scales remain inspectable but numerically incomparable. Logarithmic condition comparison does not return a bare `Quantity` pretending to encode a log ratio.

## CSV and evidence authority

CSV serializes complete raw dataset descriptors, axes, metric cells, missing reasons/details, origin, conditions, row evidence, and metadata. It uses finite double round-trip tokens, robust quoting/newlines, and reversible formula-injection protection for textual spreadsheet cells. Consumers own downloading and file input. Parsed datasets still undergo the same full structural validation; CSV is not a path around graph/hash/authorization checks.

`SnapshotObject.source` records client-engine/server-engine/imported provenance only. The host's independent `CanvasVerificationReceipt` is not a `WorkbenchObject` and cannot be uploaded by a client. A receipt associates server-owned verification with a capture digest. Verification may create a new server-engine snapshot from actual accepted request/options and raw engine results; it does not rewrite the client snapshot or confer authority on imported evidence.

## Execution status

Source, contracts, and regression tests are real files in the isolated source tree. No local build, test, lint, typecheck, dependency install, Docker setup, or Git operation was run during authoring. The coordinating session must run the dedicated server Docker checks before claiming validation or deploying these contracts.
