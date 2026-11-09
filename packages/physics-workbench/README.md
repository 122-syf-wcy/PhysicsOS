# Physics workbench

`@physicsos/physics-workbench` is the shared data boundary for persistent experiment canvases. It contains no React, rendering, engine implementation, network client, database, filesystem, or browser download code. The client owns working copies and its outbox; the host owns account authorization, durable blobs, quotas, compare-and-swap heads, and verification receipts.

## Document and identity

A `CanvasManifest` is a version-1 editable document containing viewport, nodes, edges, instances, snapshot aliases, comparisons, and an optional history reference. Its `schemaVersion` is not a server revision. `CanvasHead.version` is the server CAS token; `generation` fences deletion/restoration lifetimes, and `changeSeq` is account-wide change publication order.

Node kinds are experiment, result, note, comparison, and group. Layout, position locking, and single-parent group membership are plain data. Group cycles and dangling node/edge/instance/alias/comparison references are rejected. Notes contain plain or Markdown text, not executable HTML or React values. There is no template-count, card-count, or domain-card limit in this package.

Every experiment has a distinct `instanceId` and an owned current `PhysicsScene.id`. `instanceEditRevision` is independent of the scene's revision and the host's head version. `buildMode` is `inspect` or `construct`; source kind records template, question, community, question-code, import, or free-build provenance without changing editing mode or claiming trust. Template and renderer releases are separate. The scene's existing release, notebook, lineage, source question, and safe metadata extensions remain part of scene content.

Immutable objects are stored independently:

| Kind | Content | Direct dependencies |
| --- | --- | --- |
| `scene` | Complete `PhysicsScene` | None |
| `snapshot` | Held request/result/state, native raw state, cursor, clock, engine identity, diagnostics | Captured scene and datasets |
| `dataset` | Explicit axes, metrics, native rows, fixed conditions, origin | Source scene |
| `history` | Dated operations and parent history | Parent histories, referenced scenes and snapshots |

Each `ObjectRef` names a kind and lower-case SHA256 digest. A stored object's payload does not contain its own digest. Snapshot aliases can be renamed, repositioned, associated, or removed without rewriting captured values. A historical snapshot can reference an instance that is no longer in the current manifest. Opening a stored result does not invoke an engine.

## Public boundaries

- `createManifest`, `parseManifest`, `parseObject`, and `parseStoredValue` create or validate detached immutable DTOs.
- `canonicalStringify`, `canonicalBytes`, and `canonicalByteLength` provide stable JSON and exact UTF-8 accounting. The storage caller supplies SHA256; the package does not import Node crypto.
- `refsOf` enumerates only protocol-owned object references. A similar-looking object in arbitrary metadata does not become a dependency.
- `validateGraph`, `parseGraph`, `exportGraph`, `cloneGraph`, and `importGraph` work with the complete object closure rather than embedding every scene and result in one editable document.
- `mergeManifests` performs a conservative three-way merge and returns conflict paths instead of silently selecting a side.
- `publicCapturedResult`, `createSnapshotObject`, `bindRuntimeDataset`, `datasetFromSimulationResult`, and `captureDatasets` preserve real held evidence and prepare comparable datasets.
- `metricCompatibility`, `axisCompatibility`, `prepareComparison`, `differenceSeries`, and `compareConditions` validate meaning and prepare native comparisons without interpolation or statistics.
- `datasetsToCsv` and `parseDatasetsCsv` round-trip full raw datasets. Consumers own file picking and downloads.

Readers return `{ ok: true, value }` or `{ ok: false, issues }` with JSON Pointer issue paths. Low-level readers and constructors throw `WorkbenchDataError`. Safety validation rejects non-finite numbers, executable values, accessors, class instances, symbol/non-enumerable properties, sparse arrays, cycles, invalid units, and dangerous property keys. Runtime helpers can use `copyJsonObject` to detach typed domain data and omit absent optional object properties; strict wire parsers never silently drop undefined data. `copyDiagnosticObject` is a separate error-detail helper that preserves non-finite calculation failures as explicit missing-reason objects. It must not be used to sanitize raw samples into fictional measurements.

## Captures and comparisons

`CapturedResult` is the raw runtime handoff. Standard `state` remains a core `SimulationState`; domain-specific phase, immersion, rotation, optical imaging, and comparison readings go in validated `rawState`. A diagnostic-only capture is representable, but it cannot create a result snapshot without actual retained result/state/native raw state.

`publicCapturedResult` copies and validates held data. It does not simulate, seek, choose a nearest sample, or consult a formatted table. If a runtime has already selected a stored sample, its evaluated state time can differ from the requested cursor: both are preserved, membership in the held result and the requested range are checked, and a `SAMPLED_STATE_CURSOR_OFFSET` diagnostic records the difference. `SnapshotObject` preserves all raw states, measurements, result-level and per-state derived quantities, events, formulas, assumptions, checks, trace, and engine metadata. Generic event extensions are retained as safe JSON. A result-level derived quantity is not relabeled as the current cursor reading.

`AnalysisDataset` / `RuntimeDataset` is exactly `Omit<DatasetObject, 'sourceScene'>`. Runtime analysis can therefore carry every real row and axis before its scene has a digest. `bindRuntimeDataset` inserts the caller's real source reference and checks origin scene identity/revision. It never publishes a placeholder digest. Native analyses own their fixed conditions; the current value of a swept parameter is not reinserted as a control condition.

Every metric records semantic key, target identity, scalar/vector component, dimension, registered unit, scale, and optional physical reference. Every axis records time/parameter/space/static kind, independent-variable identity, unit, and origin/reference. Dimensional compatibility alone is insufficient:

- Absolute temperature and temperature rise are different scales.
- Kinetic, gravitational, photon, and other energies are different semantic quantities.
- Frequency and photon flux must not compare merely because a numerical unit happens to resemble an inverse second.
- Logarithmic sound levels/losses need explicit base, factor, and physical reference. Their dimensionless numeric coordinates are not multiplied into linear SI values.
- Unsupported inverse-temperature or categorical raw readings use `unresolved` semantics and retain their reason instead of receiving a fictional unit conversion.

Raw vector values project to x/y/z metrics, retaining the original registered unit. Missing readings have reasons; they are not zero. Actual sample order and count are retained. Static cursor data gets an explicit static axis. A generic result cannot invent a parameter/spatial scan from the current cursor; unmapped scope rows retain raw time in evidence and leave axes unspecified until a native analysis supplies the genuine mapping.

Overlay preparation preserves native grids. Differences use compatible exact coordinates only; duplicate, unmatched, or missing coordinates produce explicit missing reasons. There is no interpolation, resampling, nearest-neighbor matching, decimation, mean, confidence interval, or statistical significance calculation. Condition comparisons use actual scalar/vector/primitive inputs and exact SI values unless the caller declares numerical tolerances.

The existing unit registry provides multiplicative conversions, including SI and registered aliases. It does not provide Celsius/Fahrenheit offset conversion. This package does not invent those units. Canonical JSON normalizes negative zero to zero and otherwise uses JavaScript's lossless finite-number JSON representation; CSV follows the same signed-zero policy without significant-digit formatting.

## Storage, clone, import, and authority

The server establishes a new document and empty manifest before ordinary account/document object uploads. Commit requests carry `expectedVersion`, `mutationId`, and `manifestDigest`; the host validates hashes and dependency closure before publishing a new head. Idempotent retries return the original successful mutation. Delete and restore preserve recovery points at the host layer.

Graph cloning gives editable nodes, instances, and scenes fresh identities. It does not rewrite historical capture IDs, revisions, raw values, or evidence. Origin restoration is a new edit of the instance's current owned scene identity, not replacement with the origin object's identity or revision.

Import validates a complete portable graph, rebuilds editable identities, and degrades captured source authority to `imported`. Imported raw evidence remains inspectable. A client-supplied `source: 'server-engine'` is not certification: ordinary uploads must not mint it, and the host keeps verification receipts in a separate server-owned store associated with the capture digest. Copying an authorized historical blob does not issue a new receipt.

See [the executable protocol](docs/protocol.md) for publication order, graph safety, and merge/capture integration details.

## Validation status

The package includes truthful typed fixtures and regression tests for wire parsing, all scene collections and unions, metadata preservation, graph closure/cycles, identity cloning/import, delete/edit merge conflicts, raw samples, semantic/unit comparisons, and full-raw CSV. Source and tests were authored in the isolated source copy. Build, lint, typecheck, and test commands must be executed by the coordinating session in the dedicated Docker environment on `107.151.246.59`; they were not executed on the authoring machine.
