# Experiment Upload Entry Implementation Plan

> Continue the user's authorized existing contribution design. Execute the bounded UI integration inline using superpowers:executing-plans; use one independent review at the end. Do not restart the completed host project.

**Goal:** Make the real experiment ZIP flow discoverable and directly usable from the product navigation.
**Architecture:** Graft the existing contribution surface/navigation into the verified branch and render shared ContributionPanel content in page mode, retaining the current dialog. Add a managed contribution hash route.
**Tech Stack:** React, TypeScript, existing surface store/router, server Docker, Vitest/Playwright.
**Spec:** docs/superpowers/specs/2026-11-03-experiment-upload-entry-design.md

## Global Constraints

- Build/test on107.151.246.59 in Docker only. Local source and Git only. No credentials/cookies/full environments in output.
- Continue2304ad1 in the existing managed worktree; original dirty question/paper work remains untouched.
- Convex-lens only; reuse existing contribution APIs and security boundary, no extra backend or dependencies.
- Page mode must not trap focus or act as a modal; dialog must retain existing behavior.

## Review Focus

- Reload/back/forward on contribution URL and async experiment navigation must not replace an active experiment unexpectedly.
- Adding a nav item must register its real shell panel; compact/mobile sidebar must expose its accessible label.
- Page mode must not inherit fixed modal sizing, Escape closing, or focus trapping.
- Backend errors, including nonJSON404 and401, must be understandable and never appear as successful submission.
- Student/administrator share the existing server role gates and version state; no new client-only authority.

### Task 1: Integrate the real upload workspace

**Files:** client ContributeWorkspace(.module.css), SidebarNav.tsx, icons/physics-icons.tsx, surface-store.ts, LabWorkspace.tsx, locales.ts, ExperimentPicker(.module.css), experiments/ContributionPanel(.module.css), contribution-api.ts, experiment-navigation.ts; corresponding focused tests.
**Interfaces:** `ContributionPanel` supports `{embedded:true}` in addition to the existing required `onClose` dialog form. Surface `contribute` maps to `physicsos-contribute`; managed URL `#/contribute`. HTTP API unchanged.

- [x] Write failing route tests for contribution startup/history and retained active scene; embedded-panel test for real form with no dialog/focus trap; API test for nonJSON failure and retry; nav/shell registration checks.
- [x] Run focused Vitest in server container; observe relevant failures.
- [x] Reuse original contribution surface/icon/navigation work and replace placeholder content with shared embedded uploader, specific support labels and links. Preserve original workspace files.
- [x] Add managed contribution URL and experiment-center entry; distinguish page/modal semantics and readable server errors.
- [x] Run focused regressions, changed-file lint, UI types/bundle and Vite build on server; sync public docs after generation.
- [x] Commit only the integration changes and document precise evidence.

### Task 2: Verify the visible entry and prepare handoff

**Files:** tests/acceptance/experiment-upload-entry.mjs; docs/reports/2026-11-03-experiment-upload-entry.md; updated public developer instructions if needed.
**Interfaces:** uses the existing isolated candidate launcher and credentials file; never production test accounts.

- [x] Real browser: home → sidebar upload → direct form; choose built ZIP, submit, see pending; administrator review from same surface; verify experiment-page dialog still works; reload/back preserve routing; mobile no horizontal overflow.
- [x] Verify served resources and capture desktop/mobile screenshots; keep candidate data separate from production.
- [x] Obtain one independent review of this follow-up change range, address material findings with targeted regression checks.
- [x] Record exact code/candidate/production status and publish preparation; do not imply local code is already on the formal website.
