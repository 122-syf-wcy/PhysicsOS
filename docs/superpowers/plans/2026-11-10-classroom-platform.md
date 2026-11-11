# Classroom Platform Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task. Steps use checkbox syntax.

**Goal:** Deliver the nine confirmed platform cleanup, usage, drawing and reliability changes, then deploy and push.
**Architecture:** Keep existing account/Canvas persistence and provider wiring, add isolated whiteboard and usage protocols, consolidate admin surfaces, and repair actual async/model failures with regressions.
**Tech Stack:** Existing TypeScript/React, Cordis/LLM tools, SVG/Pointer Events, IndexedDB, PostgreSQL and Docker.
**Spec:** docs/superpowers/specs/2026-11-10-classroom-platform-design.md

## Global Constraints

- Source editing/Git in this isolated worktree; build/test/deploy107.151.246.59 Docker only.
- Preserve deployed canvas, latest main features, website admin, all account data and secret mounts.
- No fake measurements, drawings, completion statuses or reduced captured data.
- Root owns common index/surface/locales/config/locks/upstream-patch integration and final release.

## Review Focus

- Cleaning a school with private Canvas blobs and duplicate usernames must preserve ownership/data.
- Usage settlement retries, inherited forks and children must not double charge or show missing telemetry as zero.
- Draw completion after user edits/account switch must not overwrite newer work or another account.
- Removed plugin controls must also be unavailable through public routes/RPC while internal modules still load.
- Model/tool malformed output, lost response, cancellation and restart must end in a true ready/error state.

### Task 1: School normalization, approval email and migration audit
**Files:** auth-host/src/{domain,service,schools,mail}.ts; associated tests; narrow cleanup tooling.
**Interfaces:** Shared valid/normalized school name; safe cleanup audit/mapping; existing approval notifier with QQ configuration.
- [ ] Write and run actual invalid-name/duplicate-name/merged-list/email regressions RED.
- [ ] Fix shared validation and uniqueness; add QQ text/HTML/asset.
- [ ] Audit live metadata and all references; implement validated reversible cleanup for exact rows.
- [ ] Run related contracts GREEN; Root executes only audited cleanup with paired backup.

### Task 2: Actual account usage
**Files:** learning-host/src/usage-*; UI usage module; Root common wiring.
**Interfaces:** Account-scoped usage event admission and GET summary; separate school/platform aggregate; token bucket/replacement rules.
- [ ] Pin idempotency, Shanghai day, account isolation, missing usage, replay/fork/child accounting RED.
- [ ] Implement durable unit/service/runtime with existing settlement semantics and exact ownership.
- [ ] Replace record presentation with typed usage view; preserve internal attempts/self-test services.
- [ ] Validate real server persistence, provider usage and UI counters GREEN.

### Task 3: Model review and visualization reliability
**Files:** auth-host/src/moderation/*; tool-physicsos/src/code-*; experiment-host job/artifact code and corresponding tests.
**Interfaces:** Valid bounded reviewer output; exact generation identity, singleflight, ready artifact/durable receipts; reusable existing multimodal provider seam.
- [ ] Reproduce screenshot failures using safe runtime metadata and genuine contract RED.
- [ ] Fix request/output negotiation and parser boundaries, duplicate/recovery/completion races.
- [ ] Preserve authority/tool isolation and no-op-free actual renderer output.
- [ ] Run focused real provider/Loader/artifact validation GREEN.

### Task 4: Admin, plugin and sidebar UI
**Files:** AdminWorkspace/Admin composition; SidebarRoot/RecentSpaces CSS; production plugin UI/RPC policy and existing browser regression.
**Interfaces:** Confirmed top-level tabs; nested account/system operations; one expanded sidebar scrolling owner; external plugin management disabled.
- [ ] Real menu/permission/scroll/plugin entry regressions RED.
- [ ] Consolidate components without dropping operation handlers; Root merges shared locale/navigation.
- [ ] Adjust expanded scroll layout and close public plugin entry/RPC paths.
- [ ] Validate teacher/admin/narrow layouts and actual wheel/key history reachability GREEN.

### Task 5: Persistent editable whiteboard
**Files:** Pure whiteboard model/parser/operations; UI whiteboard controller/components/styles; Root Canvas kind/persistence/common wiring.
**Interfaces:** Complete JSON strokes and vector elements; operation history; account document scope; image asset references and geometry viewBox.
- [ ] Drawing/edit/history/cancel/clear/export/restore/namespace/resource cases RED.
- [ ] Implement pointer coordinate and pressure behavior, selectors, SVG rendering and full screen.
- [ ] Connect actual durable persistence/outbox and document-kind list isolation.
- [ ] Verify light/dark/narrow, mouse/pen, ratio, reload/offline and account isolation GREEN.

### Task 6: Question-image to vector drawing
**Files:** Whiteboard generation job/controller/tool adapter using Task3 provider seam; server routes and typed drawing schema.
**Interfaces:** Authenticated original-image job, logged multimodal input, validated draw tool output, usage receipt, version-guarded diagram insertion.
- [ ] Model invalid/partial/ambiguous output, duplicates/lost response/late completion, geometry fidelity and cancellation RED.
- [ ] Implement original source retention, structured drawing tool and actual task phases.
- [ ] Render transition/reveal from real job events; preserve newer human strokes and editability.
- [ ] Live existing-provider image trial and exact primitive/bounds/labels/UI acceptance GREEN.

### Task 7: Integrate, verify, push and publish
- [ ] Merge common wiring/locked dependencies/overlay; preserve and commit earlier deployed Canvas plus this work.
- [ ] Run scoped server checks, build and sign; independent review of final permissions/async/data paths.
- [ ] Audit/backup production, apply safe school cleanup, verify isolated candidate complete journeys.
- [ ] Push final branch/main integration as authorized, deploy preserved-base candidate and check official domain/readyz.
- [ ] Retain recovery points and evidence; report factual remaining checks/limitations.

### Task 8: Chat image upload and actual vision (user added 2026-11-10)
- [ ] Reproduce `/api/session/prompt` HTTP500 with image-only input in server runtime; inspect safe exception metadata.
- [ ] Fix image admission/storage/request or capability declaration at the real failure boundary, retaining configured model vision capabilities.
- [ ] Test original bytes, supported formats, image-only prompt and actual model observation of image-exclusive content via the normal provider route.
- [ ] Include the fix in the same candidate, independent review, build, push and production release.
