# Developer surfaces polish and release implementation plan

> **For agentic workers:** Use superpowers:executing-plans inline; steps use checkboxes.

**Goal:** Polish new developer/upload/admin surfaces and ship the verified result to GitHub and production.
**Architecture:** Existing React/CSS Modules and shared glass tokens; unchanged APIs and publication contracts.
**Tech Stack:** React, CSS, Vite, Playwright, Docker.
**Spec:** docs/superpowers/specs/2026-11-04-developer-surfaces-polish-design.md

## Global Constraints

- Server `107.151.246.59`; builds/tests in Docker only. Preserve original workspace and vendor pointer.
- No API/contract/authorization changes. Existing native chooser remains behind an accessible styled trigger.
- User authorized GitHub and production release; preserve recovery points and secrets.

## Review Focus

- Keyboard file chooser and import remain available, including disabled state.
- Long versions/filenames/digests and 390px mobile do not overflow.
- Scoped visual CSS does not affect unrelated admin tabs or experiment controls.
- Draft/current distinction and save/publish enablement remain correct.
- Runtime artifact packaging retains running functionality and required workspace links.

### Task 1: Polish and verify the developer surfaces

**Files:** AdminPromptTab.tsx/module.css; ContributeWorkspace.tsx/module.css; ContributionPanel.tsx/module.css; public developers/styles.css; new screenshots/report.
**Interfaces:** Consumes existing prompt/contribution APIs; produces the same user actions and role boundaries with new presentation.

- [x] Reorganize prompt overview/editor/preview/history, replace visible native MD chooser, unify glass controls.
- [x] Improve upload resource cards/header and review cards; polish public prompt/download controls and typography.
- [x] Sync changed source into existing build container, format, run affected client tests/types/lint, bundle UI and Vite. Expected: pass.
- [x] Run existing actual prompt and contribution workflow acceptance; inspect desktop/mobile/light/dark screenshots and file chooser keyboard interaction. Expected: unchanged workflows, visible glass controls, no horizontal overflow.
- [x] Commit only intended source/docs/artifacts; independent review of this task's diff and deployment packaging.

### Task 2: Package, publish and verify production

**Files:** Release report and reproducible artifact packaging instructions/script if required.
**Interfaces:** Consumes validated Task 1 assets plus previously validated branch functionality; produces production image and GitHub main revision.

- [x] Reconcile remote main/server HEAD/running runtime with branch; verify resource headroom. Expected: no lost server changes.
- [x] Build candidate image on server from known runtime base and complete required compiled artifacts, preserving native/dependency links; validate in isolated candidate including production PostgreSQL storage path if feasible.
- [x] Retain image and database/file recovery points; push reviewed branch/main without force, synchronize server and switch app with health readiness checks. Expected: healthy app, existing data retained.
- [x] Verify HTTPS public pages, authenticated admin/upload UI, dynamic prompt/template download, sandbox framing and core existing routes. Expected: no console/network regression.
- [x] Commit/push report and screenshots; record actual revision, image, recovery paths and validation limits.
