# Global reliability repair design

The user approved implementing the global audit recommendations together. This work preserves the current personal physics learning product and fixes the concrete failures found in the 2026-10-08 audit. Source changes are isolated on `codex/global-reliability`; no production deployment, secret rotation, or production data mutation is part of local verification.

## Required behavior

1. Creating a paper blueprint, annotation, or bank item cannot overwrite an existing record, including another school's or a platform record. Concurrent creation is serialized and returns a conflict without changing the original. Failed registration restores the invite's original key and usage, including concurrent attempts.
2. Physical simulation states and derived values agree for nonzero start times. Observation refuses failed or mismatched results. Agent observation carries verification, and solved-question caches cannot associate stale answers with a newer scene revision or grow without bound.
3. Modern physics works through all advertised entry points. Shared engine capabilities replace duplicated dispatch where practical, with an explicit supported-entry contract.
4. Parameter edits and circuit construction persist the latest scene and revision. Returning from the picker, refreshing, and remote synchronization recover that scene. Dirty learning records retry on network recovery without replaying every acknowledged record.
5. A fixed scene revision is simulated once per playback window; animation evaluates only the current state. Static panel data retains revision-scoped references. Optional PDF/admin/domain loading must have real artifact/network boundaries where supported by the host loader.
6. Modals own keyboard focus and suppress background playback shortcuts. Recommendations recognize improvement after old mistakes. Product documentation consistently excludes LMS workflows.
7. Root and Harness installations resolve coherent React instances without cross-worktree symlinks. CI tests the release commit, integration seams, and deterministic clocks. Release publication follows successful verification. Deployment readiness failures are fatal, and readiness checks database protocols rather than TCP alone.
8. Model routing retries only before response commitment. Broken or stalled streams terminate clearly and do not trigger paid replay. Shared business snapshots remain single-writer until real cross-process consistency exists; accidental concurrent app writers must fail safely.
9. Full backup includes database, Redis state, session/attachment volume, essential encryption keys, and image/version metadata. Restore verifies checksums and validates recovered functionality in an isolated environment. Desktop startup has bounded readiness and actionable failure UI/logging.

## Approach

Use existing APIs and tests, preserving persisted record formats where possible. Add regression tests before behavioral changes. Prefer a guarded single-writer deployment to silently introducing incomplete distributed cache semantics. Keep pure physics independent of Harness. Overlay files remain source of truth; only the integration coordinator applies/captures overlays and updates shared lockfiles. Avoid broad cosmetic rewrites.

## Acceptance

Each repaired bug has a regression demonstrating the former failure. Run root typecheck/lint/tests/build, modified upstream integration tests, headless physics acceptance, key browser journeys, storage/protocol integration where locally available, and desktop checks. Record unavailable external checks explicitly; do not infer production recovery or deployment success from local unit tests.
