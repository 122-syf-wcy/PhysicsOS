# Experiment Pages and 3D Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. User has explicitly authorized implementation; no additional design handoff is required. One fresh whole-change review follows verification.

**Goal:** Independent experiment navigation and a complete convex-lens teaching page with verified 2D/3D views.

**Architecture:** Existing engines and WorkspaceRuntime remain the source of facts. A shared session owns commits/frame playback; optional Three.js renders the same model. Account scene metadata carries the measurement notebook.

**Tech Stack:** React 18, TypeScript, CSS Modules, SVG, Three.js, Vitest, Playwright, server Docker.

**Spec:** docs/superpowers/specs/2026-11-02-experiment-pages-3d-design.md

## Global Constraints

- Server 107.151.246.59 confirmed by user; isolated container based on current image, no production data lease.
- Modify overlay sources; preserve all 76 experiments and current question provenance.
- Root main and production HEAD are 33023a2; original working copy has unrelated uncommitted edits.
- Existing runtime image omits root TypeScript configuration; supply it to the isolated test container.
- Three.js loads only on 3D selection; static demand rendering, DPR <= 1.5, complete disposal.

## Review Focus

- Login and asynchronous scene sync must not overwrite a requested URL or return to a stale experiment.
- A pointer cancellation or remount must never commit preview conditions or lose recorded observations.
- Near-focus/virtual image geometry must remain finite and cannot display a false real image on a screen.
- Rapid view switching/unmount during module loading must not leak listeners, contexts or saved state.
- Account scene restores and question branches must retain their own measurement/provenance history.

## Task 1: Transactional optics interaction and experiment session

Files: physics/optics-workspace-runtime.ts, physics/workspace-runtime.ts, experiments/experiment-session.ts, experiments/use-experiment-session.ts, PhysicsWorkspace.tsx; tests/experiment-session.client.spec.ts.

Interfaces: createExperimentSession(runtime, onSceneChange?) supplies getSnapshot, subscribe, commit(next), previewParameter(id,value), commitParameter(id,value), cancelPreview. useExperimentSession owns existing animation-clock behavior and throttled summaries.

- [ ] Test preview through real optics engine: f=10,u=15 gives v=30 without mutating the original scene; cancel restores u=30; release commits one revision; question input forks once.
- [ ] Run targeted Vitest in server container; observe failures before implementation.
- [ ] Implement transactional preview and shared session; integrate common workspace without changing existing controls.
- [ ] Rerun session, optics and animation tests; commit scoped files.

## Task 2: Notebook and independent navigation

Files: experiments/experiment-notebook.ts, experiments/experiment-navigation.ts, experiments/experiment-catalog.ts, index.ts, LabWorkspace.tsx, surface-store.ts, packages/physics-scene/src/scene.ts; tests/experiment-navigation.client.spec.ts and experiment-notebook.client.spec.ts.

Interfaces: notebook entries are typed immutable reading snapshots in scene metadata; session merges notebook on every physical write. startExperimentNavigation({surface,window,loadCatalog}) owns hash and surface subscriptions and returns cleanup. Catalog resolves templates and restored scene refs through existing constructors.

- [ ] Test recorded rows retain literal readings after edits, round-trip metadata, invalid persisted data ignored, bounded history, CSV/report preservation.
- [ ] Test direct template, saved-scene refresh, forward/back, missing/unknown template, stale async load, unrelated hash; real controller used.
- [ ] Run tests RED, implement notebook and route bridge after authenticated boot, run GREEN, commit.

## Task 3: Convex lens teaching page

Files: experiments/ConvexLensPage.tsx, experiments/ExperimentPage.module.css, experiments/LensBench2D.tsx, experiments/LensControls.tsx, experiments/ExperimentNotebook.tsx, ExperimentReportPanel.tsx, physics/experiment-report.ts, LabWorkspace.tsx.

Interfaces: page consumes existing PhysicsWorkspaceProps plus account-preserving notebook session; 2D bench consumes snapshot and preview/commit/cancel callbacks. Registry chooses lens page for supported single thin-lens scenes, otherwise current workspace.

- [ ] Test accessible numeric edits, all five preset outcomes, no static playback, observation recording, existing guide/report/agent/self-check entry points, question restore and generic fallback.
- [ ] Implement desktop/mobile layout, SVG stage direct manipulation, progressive task steps and notebook table with CSV.
- [ ] Run component and affected original tests, inspect server-built page in browser, commit.

## Task 4: Optional Three.js bench

Files: experiments/LensBench3D.tsx, experiments/lens-three-scene.ts, experiments/OptionalLensBench.tsx, optional/optics3d.ts, optional-modules.ts, tsdown.config.ts, package.json and overlay lock patch.

Interfaces: 3D view consumes identical snapshot and interaction channels as 2D; controls orbit, reset and zoom. buildLensScene(view) returns disposable Three.js graph and pickable object/screen.

- [ ] Test real Three scene transforms for real/virtual/no image; mesh disposal and bounded finite geometry; optional loader failures expose 2D fallback without changing runtime.
- [ ] Add pinned Three.js/types using server package manager, preserve lockfile reproducibility in upstream patch.
- [ ] Implement real apparatus, ray paths, restricted orbit, raycaster rail dragging, WebGL failure/context loss and responsive resize cleanup.
- [ ] Verify optional bundle network behavior and repeated switches in Chromium; run tests and commit.

## Task 5: Server verification and reviewable candidate

Files: tests/acceptance/experiment-pages-3d.mjs, docs/reports/2026-11-02-experiment-pages-3d.md.

- [ ] Run affected engine tests, all UI tests, web lint/typecheck and production bundle in isolated server container; document pre-existing failures individually.
- [ ] Boot isolated candidate with separate storage; desktop/mobile screenshots, URL restoration, 2D/3D parity, pointer interaction and failure fallback.
- [ ] Fresh reviewer reads diff and design; fix important findings and verify regressions.
- [ ] Provide candidate, screenshots, test evidence and remaining rollout scope. Preserve production until concrete release review.

## Progress and rulings

- User chose scheme three and said proceed directly; plan approval is already covered.
- Ruling: use namespaced hash URLs to preserve current host authentication/resource handling; external path aliases can be added later without changing page modules.
- Baseline: initial runtime-container tests blocked by absent /app/tsconfig.base.json; restored original config in test container only.
- Task 1: implemented shared session and optics preview/commit/cancel. Server Vitest session+optics: 21/21 passed. Runtime image NODE_ENV=production must be overridden with NODE_ENV=test for Vitest; otherwise React/jsdom import path fails before tests.
- Task 2: notebook metadata and navigation tests passed on server, 9/9 across three new suites. Restoring a template-only link creates a fresh instance; instance links only resolve the signed-in account's recent scenes.
