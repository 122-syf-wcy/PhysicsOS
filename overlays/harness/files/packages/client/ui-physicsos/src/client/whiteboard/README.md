# Classroom whiteboard

The isolated SVG surface preserves complete JSON vectors, raw pointer samples and pressure. Drawing, selection/move, editable text and shapes, operation undo/redo, confirmed clear, original-image comparison, fullscreen, durable saves and SVG/PNG/complete JSON exports are implemented here.

Root registers `WhiteboardSurface` and the `physicsos.whiteboard.workspace` factory, spreads `whiteboardZh`/`whiteboardEn` into the physicsos locale, and injects one `createWhiteboardController` with the authenticated namespace. `createWhiteboardHttpApi()` uses `/physicsos/whiteboards`; `createIndexedDbWhiteboardCache()` retains drafts and pending operation receipts by account plus document ID. Call `resetNamespace()` on every account change and `dispose()` at plugin disposal. There is no external editor dependency.

## Persistence and geometry

The server reuses account authority, CAS mutation receipts, the existing storage-domain facility and private Canvas blob storage, under a separate whiteboard namespace. Original bytes are retained unchanged. Source IDs, SHA-256 hashes, dimensions and pixel-space viewBoxes are checked before model output can be inserted. Full JSON exports include original image data; PNG is an intentionally rasterized view, capped at 8192 pixels on its longest edge, while SVG/JSON retain complete geometry.

Undo and redo differences live in the document, so regular navigation and reload preserve them. Diagram and source insertion use the same history owner. Completed unapplied jobs and the latest terminal outcome remain discoverable in account document recovery metadata.

The server stores one immutable geometry object per distinct stroke, small element objects, history differences and revision manifests. Unchanged content is shared across saves; old full-document blobs remain readable. Complete JSON transport and export retain the original values and existing whole-document limits.

The controller persists each save receipt before sending, retries the same receipt after lost responses, preserves intervening edits, and guards completions by account/document lifecycle. Generation states reflect the real durable job. Only validated actual primitives can reveal; cancellation and foreign-source results cannot overwrite the current board. Transient polling errors retain the last real job state and retry.

## Model Experience

The UI does not call a provider or execute generated code. It submits an owned image ID to the server drawing job. The pure physics-whiteboard package provides a bounded JSON primitive schema and validation; ambiguous information is explicit uncertainty.

### Token and KV-cache effect

None from this browser package. Server generation accounts for its actual model usage.

## Verification

Run `physics-whiteboard` model tests and UI `whiteboard-*.client.spec.*` in the server Docker workspace. `whiteboard-editor.browser.mjs` exercises the real candidate with an isolated authorized storage state, full pointer strokes, editable text and shapes, undo/redo, confirmed clear, fullscreen, export and save/reload. Candidate and live provider checks are required in addition to unit tests.

## Known Limitations and Deferred Work

Simultaneous edits from another device produce an explicit CAS conflict with the full local draft retained. Export the draft before choosing server reload. Image loading requires the owned server resource; the local document outbox does not duplicate all source image bytes.
