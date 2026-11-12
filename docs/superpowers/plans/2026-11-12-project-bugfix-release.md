# Project reliability fixes and release plan

> **For agentic workers:** Apply systematic debugging, test-driven development and verification before completion. The user has authorized fixing, committing and deploying this audit.

**Goal:** Fix reproducible data, editor and physics defects on the current production baseline and deploy a verified candidate.

**Architecture:** Preserve existing API contracts, account isolation, signed plugins and source overlays. Fix comparisons, recovery scheduling and model applicability at their owning boundaries; reuse the existing Docker release pipeline.

**Tech Stack:** TypeScript, Vitest, Node tests, Docker, PostgreSQL, existing Harness overlays.

**Spec:** User request and `AGENTS.md`; release procedure in `docs/deployment-release.md`.

## Constraints

- Start from main `7b0a1ab`, retaining application release `25092c6`; leave Android handoff and its uncommitted submodule state intact.
- Run integration, tests and builds on `107.151.246.59` in Docker.
- Preserve production data, prior images, signed trust roots and a paired recovery point. Do not weaken publication guards.
- Commit only task-owned source, tests and delivery records; keep secrets and operational logs private.

## Confirmed fixes

- [x] Reproduce mixed-case ID pagination omission in learning attempts/scenes. Unify sorting and cursor comparisons without changing cursor format.
- [x] Reproduce incorrect assignment late receipts and sorting for offset timestamps, including existing records. Compare instants, retaining wire values.
- [x] Reproduce a dirty whiteboard draft staying unsaved after closing/reopening. Resume autosave only after successful remote reconciliation; preserve conflict and failed-read behavior.
- [x] Reproduce unsupported receding Doppler observers producing nonpositive frequency. Reject that domain while retaining valid near-limit and approaching cases.
- [ ] Verify the experiment unit round-trip comparator accepts only finite values within a few floating-point rounding units; preserve strict intent checks and rejection of genuinely wrong values.

## Verification and publication

- [ ] Review each fix and run its regression tests against real owning services/controllers/engines.
- [ ] Run core, web, host, tooling and deployment checks in Docker; record any pre-existing failure separately with reproduction.
- [ ] Commit and freeze the source, rebuild affected packages, validate runtime digests and plugin signatures.
- [ ] Start a candidate with isolated data and exercise login, scoped reads, editor and affected behavior.
- [ ] Recheck origin/main, server checkout and production image, then publish with paired backup and authenticated acceptance.
- [ ] Verify the public entry, record revision/image/recovery evidence and push the final report.

## Review focus

Account switches and stale editor completions must remain isolated; conflicts must retain local edits; pagination must have no omissions/duplicates; historical time-zone strings must work without migration; rejected physics domains must never receive a verification pass.
