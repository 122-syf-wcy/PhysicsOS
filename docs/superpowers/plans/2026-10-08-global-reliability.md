# Global reliability implementation plan

> **For agentic workers:** Use subagent-driven-development or executing-plans; tasks are isolated by file ownership and integrated by the root worker.

**Goal:** Repair the audited correctness, state recovery, isolation, performance, and release reliability gaps together.
**Architecture:** Keep PhysicsScene as truth; put verification/capabilities behind common boundaries. Persist discrete edits, cache revision-level computation, and fail safely at storage and deployment boundaries.
**Tech Stack:** TypeScript, React 18 Harness client, pnpm workspaces, Vitest, Playwright, PostgreSQL, Redis, Node, Tauri/Rust.
**Spec:** `docs/superpowers/specs/2026-10-08-global-reliability-design.md`

## Global constraints

- Preserve current persisted data and account ownership; do not touch real secrets or production data.
- Modify overlay source, not generated vendor copies. Coordinator alone applies/captures overlays and updates shared lockfiles.
- Worktree: isolated checkout on `codex/global-reliability`; original checkout is untouched.
- Current pinned Harness revision remains unchanged; this is a compatibility repair, not an upstream release upgrade.
- Regression tests exercise behavior and error paths. Never replace assertions with skips to make a gate pass.

## Review focus

- Two teachers creating the same ID must not change either tenant's existing content.
- A failed or concurrent registration must not leak invite consumption or corrupt keys.
- Edits followed by picker/refresh/offline recovery must retain exact parameters and revisions without render loops.
- Nonzero simulation start time and cached answers after mutation must preserve physical truth.
- Partial model streams, unavailable databases, and failed desktop startup must terminate visibly without silent success.

## Task 1: Backend isolation and lifecycle

**Files:** overlay `packages/physicsos/{paper-host,auth-host,model-pool-host,shared-state-host,health-host}` and their tests; storage backend only if required by these guarantees.
**Interfaces:** Preserve REST contracts; conflict is 409. Keep shared state and host readiness integration explicit.
- [x] Add and run failing tests for cross-school ID overwrite and invite write failure/concurrency.
- [x] Implement insert-only creation and correct guarded invite compensation/atomicity.
- [x] Add and run partial stream/timeout/cancel tests; separate retry from committed streaming.
- [x] Add authenticated protocol readiness and accidental-multiple-writer protection with loss handling.
- [x] Fix wall-clock-dependent host test; run relevant host suites and report commands/results.

## Task 2: Physics correctness and shared capabilities

**Files:** root `packages/{engine-*,physics-observation,physics-verifier,physics-core,question-core,agent-tools}`; a pure shared runtime package if required.
**Interfaces:** Preserve existing engine contracts; explicit failed verification and scene revision checks; advertised modern physics reaches the engine.
- [x] Add failing tests for `[1,2]` seconds with v0=10,a=2: final velocity 14, interval displacement 13, valid checks.
- [x] Correct absolute/interval semantics; extend shared engine request contract tests.
- [x] Add failed-result observation tests for all domains and fix shared guards.
- [x] Test stale question cache and eviction, fix revision/immutable-question semantics and capacity.
- [x] Share capability dispatch, wire modern physics and verified agent observations; run core regression suite.

## Task 3: Frontend state, performance, accessibility, learning

**Files:** overlay `packages/client/ui-physicsos/src` and `tests`, plus bundle config only with coordinator agreement.
**Interfaces:** Export current scene after discrete edits without recreating runtime on every frame. Preserve question forks and account-scoped stores.
- [x] Add failing edit→picker→continue and persisted-scene tests; write back latest scene/revision.
- [x] Add 600-frame simulation-count tests; cache electric/circuit revision results and mechanics static panels.
- [x] Implement dirty synchronization and online retry, with no redundant historical uploads.
- [x] Test modal keyboard ownership and mastery recovery; fix focus/shortcuts and recommendations.
- [x] Implement viable optional-module loading boundaries; document and test host requirements.
- [x] Run focused UI suites and report remaining browser acceptance needs.

## Task 4: Integration, release, backup, desktop, docs

**Files:** root manifests/lockfiles/scripts/workflows/docs, overlay tooling/upstream compatibility patch, `apps/desktop`.
**Interfaces:** Coherent isolated installs; exact-commit validation; full backups and isolated restore; bounded visible startup.
- [x] Install pinned workspaces coherently and verify React peer resolution and native dependencies.
- [x] Connect upstream/host/storage/browser/headless checks to CI and gate release image publication.
- [x] Make deployment readiness fatal, add complete backup/restore tooling and isolated verification.
- [x] Add desktop startup deadline, failure/retry diagnostics, and deterministic live test lifecycle.
- [x] Improve overlay verification/deletion handling, document patch inventory and product boundaries.
- [x] Apply source overlays, integrate lockfiles, run full checks and browser journeys.
- [x] Obtain independent review, resolve findings, and record actual final verification and external limitations.

## Progress

- Initial audit: core 1443 tests pass, Web React instances conflict, retired class fixture depends on elapsed calendar date, desktop live startup returns 405. Typecheck/lint and headless physics acceptance pass in original checkout.
- User authorized all fixes based on the audit. Independent workstreams are parallelized by non-overlapping ownership; integration and shared mutations remain serialized.

- Final: main test3031, upstream447, PostgreSQL26, headless16 checks, Rust14, browser journeys, typecheck/lint/build all pass. Four independent-review findings repaired and confirmed. Exact evidence and deployment limitations: `docs/reports/GLOBAL-RELIABILITY-2026-10-08.md`.

## Release storage repair (2026-10-09)

The restored release exposed an existing production routing regression after the Harness update: `PHYSICSOS_STORAGE_BACKEND=postgres` enables the PostgreSQL plugin, but the base domain configuration still selects JSON. The current JSON volume has 49 users and the current model channel; PostgreSQL last received business writes on 2026-09-27 and has 29 users. The current JSON snapshot is authoritative for this release. Do not merge the older PostgreSQL records into it.

Repair the deployment route and the PostgreSQL initialization failure at their source. Migrate the stopped application's complete JSON snapshot into a new, previously absent schema in one transaction, preserving unit versions, every key/value, global records, ownership, and encrypted model keys. Keep both the original JSON volume and the old PostgreSQL schema. The importer must reject ambiguous layouts, unsupported record versions, existing destinations, and any failed read-back comparison. Session log files remain on the same persistent volume.

- [x] Reproduce and fix the PostgreSQL initialization failure with focused server tests (29 backend checks and both real composition launch modes passed).
- [x] Add the JSON-to-PostgreSQL importer, failure/rollback tests, and exact read-back checks (28 checks and the 2,591-record restored snapshot passed).
- [ ] Verify the repaired runtime against the migrated restore copy, including one live writer lease, authentication, existing resources, a new session, restart, and browser journeys.
- [ ] Integrate the verified commit into `main` and push after rechecking the remote tip.
- [ ] Stop the old production app, capture a fresh encrypted backup, migrate the final stopped JSON snapshot, and switch only the app to the verified image/schema.
- [ ] Verify public readiness, current account/model data, session persistence, and a real model turn. Record rollback constraints after PostgreSQL accepts new business writes.
