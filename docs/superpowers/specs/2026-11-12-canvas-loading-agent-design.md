# Canvas, drawing assistant and loading visuals

The user asks for a clean canvas matching the supplied Infinite Canvas references, a real AI drawing/checking assistant, smoother intelligent pen input, and three startup-character image assets replacing the raw loading paragraphs.

## Approach

Keep ReactFlow and the existing verified experiment instances. Add a versioned annotation scene in canvas metadata, a bounded server model agent that produces review/drawing proposals, and compact controls with an optional right-side assistant. This keeps existing documents, undo, persistence and real physics results usable. The builder selects this approach from the user's reference and current code; it is not a new local Codex/MCP connection screen.

## Visual decisions

Warm white paper, subtle fine grid, small top title/status, compact outline/assets controls and a single bottom tool row; zoom stays separate. Right-side Agent panel opens on demand, becoming a drawer on narrow screens. Tools retain accessible labels and keyboard focus. Existing experiments remain real interactive nodes.

Loading uses the established splash identities: tousled black-haired boy in cream buttoned knit shirt, round-glasses girl in navy stripes/cardigan, silver tabby cat with cream back patch and blue collar. Generate three isolated assets with the requested image provider/model and the splash master as reference. Main-area loading gets one centered illustrated composition; compact cards get a small version; an idle shell overlay gets no loading placeholder. CSS supplies fade/rise, gentle float and a soft indeterminate sweep, with reduced-motion support. Ready content renders immediately without a forced hold.

## Drawing and persistence

`manifest.metadata.physicsosAnnotations` holds a versioned scene made of existing whiteboard vector primitives. A shared codec in physics-whiteboard validates it; images/code/unsafe references are excluded. CanvasController mutations update annotations through existing history/local persistence/sync and preserve unrelated metadata. Old documents read as an empty layer. Undo and export/import retain stroke data and canvas ownership.

Raw coalesced samples, pressure and timing remain intact. Pointer moves append to an active buffer and update only the preview once per animation frame; pointer-up commits once. Cancellation discards the live gesture. Display smoothing and rounded geometry operate on the render representation. Shape assistance proposes a line/circle/rectangle conversion and keeps the original ink available for undo. Pan/zoom uses ReactFlow world coordinates and remains available in hand/selection modes.

## AI behavior

A new canvas assistant service reads the authenticated, saved canvas head and selected instances on the server. It uses the existing configured platform LLM with constrained submit-review/submit-drawing tools, existing image admission, actual usage receipts, cancellation and bounded output. Requests bind owner, canvas, saved head/revision and a viewport snapshot. Suggestions never modify experiment physics or assert model output as engine verification.

The UI offers check/draw, prompt, real task status, cancellation and candidate preview. Accepting applies validated annotation primitives as one history operation only after rechecking the current canvas/revision/account. Rejection/cancellation changes nothing. The model provider stays server-side; the user-specified image generation credential is used only for the requested IP assets.

## Validation

Server Docker only: lazy loading/overlay behavior, no forced readiness delay, stroke samples/pressure/world transform/cancellation, annotation persistence and undo, stale/foreign assistant jobs and actual usage idempotency, candidate acceptance, old-document compatibility and responsive panel behavior. Browser checks use owned candidate data; production deployment retains prior image and paired recovery point.
