# Free Apparatus Canvas Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for integration and superpowers:dispatching-parallel-agents for independent apparatus interaction and server verification tasks.

**Goal:** Support direct apparatus assembly on the free experiment canvas and deploy the verified release.
**Architecture:** Reuse one persistent WorkbenchInstanceRuntime and circuit draft; expose native editing inside cards. Build a delta image over the actual live image.
**Tech Stack:** React, ReactFlow, TypeScript, Vitest, existing circuit engine, Docker.
**Spec:** docs/superpowers/specs/2026-11-10-free-apparatus-canvas-design.md

## Global Constraints
- Server 107.151.246.59 /opt/physicsos and Docker are authoritative for build/test/deploy.
- Preserve all current live functionality, latest main fixes, secrets and rollback images/data.
- User explicitly delegated decisions and authorized direct deployment without questions.

## Review Focus
- Small or pre-existing cards need usable apparatus space without destructive layout changes.
- Async insertion must select the committed apparatus and report failed changes.
- Drag coordinates remain scene-correct inside zoomed ReactFlow.
- Native construction must work even when a community renderer is pinned.
- Drafts without a closed circuit remain editable and do not report fabricated readings.

### Task 1: Restore the verified live baseline
- [x] Recover live code and tests over origin/main with three-way comparison against server 6d22340; preserve newer main edits.
- [x] Run baseline canvas/circuit tests in isolated Docker build container.

### Task 2: Apparatus interactions
Files: physics/CircuitBuilderPanel.tsx and CSS, PhysicsCanvas.tsx, circuit-renderer.tsx, renderer-registry.tsx, tests/circuit-apparatus.client.spec.tsx.
Interfaces: optional controlled panel selectedComponentId/onSelectComponent; variant default/compact; async editing.apply; PhysicsCanvas onDropPart(partId, ScenePoint) and componentSelection.
- [x] Write failing tests for async selection, dragged catalog data, projected position, selection, disconnection and wire preview; observe RED on server.
- [x] Implement optional interactions preserving existing lab defaults.
- [x] Run focused interaction and existing circuit tests GREEN.

### Task 3: Inline bench and entry
Files: canvas/CanvasInstanceViews.tsx, CanvasWorkspace.tsx, CanvasNodes.tsx, controller.ts, locales.ts, CanvasWorkspace.module.css; canvas-instance-display.client.spec.tsx.
- [x] Add RED tests that a construction card has a palette, committed add/rotate/delete/undo, and inspect card exposes builder entry.
- [x] Render compact palette beside native stage for construction; use runtime highlight to share selected state.
- [x] Add direct new-bench entry and size new construction nodes; expand undersized existing construction presentation.
- [x] Suppress external renderer only while constructing; preserve pinned release.
- [x] Run canvas suite and persistence/history tests GREEN.

### Task 4: Release verification and deployment
- [ ] Run focused engine/UI tests, affected typecheck/lint and UI/Vite build in server Docker.
- [x] Independently review changes and fix material defects.
- [ ] Validate candidate via isolated runtime/browser, including actual circuit assembly and reload.
- [ ] Recheck main, server checkout and running image; acquire release lock; tag exact old image and create fresh paired recovery.
- [ ] Switch official image and verify health plus public browser behavior; preserve rollback instructions.
