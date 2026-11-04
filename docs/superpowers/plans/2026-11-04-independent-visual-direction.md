# Independent Visual Direction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Make generated question scenes visibly distinct from the rejected beige/axis template and readable on mobile.

**Architecture:** Add an explicit visual brief with small native material examples, give it precedence over legacy visual guidance, and keep the restricted child responsible for authored scene geometry. Engine and source/hash/ownership/persistence boundaries stay in the existing implementation.

**Tech Stack:** Existing TypeScript, Canvas/SVG, server Docker and Playwright.

**Spec:** ../specs/2026-11-04-independent-question-code-design.md

## Global Constraints

- Work in existing codex/experiment-contribution; build/test/release at107.151.246.59 Docker.
- Zero new credentials/dependencies; no plaintext secrets; no production change before actual appearance acceptance.
- Native independent source, zero imports/old renderer, same read-only engine facts.
- Existing child output ceiling8192, shared300000ms deadline, maxone repair; no parent model/high change.
- Original failed runs and raw sources remain unchanged; no source edits disguised as actual child output.

## Review Focus

- Reference helpers alone cannot be accepted as a complete renderer.
- Actual title/conditions are not overwritten by legacy template family names.
- Near-zero formatting/label avoidance must not compute or alter physical results.
-219×360 authored stage keeps the phenomenon visible and labels/readouts separated.
- Runtime proof and reference preview do not replace actual configured-model appearance acceptance.

### Task1: Visual brief and material reference

Files: new overlay tool-physicsos/src/question-code-visual-brief.ts; temporary standalone preview under /tmp.

Interface: exports QUESTION_CODE_VISUAL_BRIEF:string containing navy/purple glass-stage direction, legible layout/label rules and brief native Canvas material helpers without full renderFrame, imports or physics.

- [x] Author brief and narrow native material/scene preview from existing engine snapshots.
- [x] Inspect desktop and219px preview; do not claim it is a real model result.
- [x] Report source/API/no-solver boundary and preview evidence.

### Task2: Prompt precedence and compact output

Files: tool-physicsos/src/code-generation.ts and its existing tests.

Consumes QUESTION_CODE_VISUAL_BRIEF. Gives the new authored visual brief priority over legacy body style, requires original-question title, compact source and readable mobile scene, retaining all lifecycle/privacy constraints.

- [x] Add meaningful captured-child-request regression for new-vs-legacy visual precedence and unchanged original source facts/budget/repair.
- [x] Wire brief and updated instructions; keep public prompt data as physics/teaching/package guidance.
- [x] Server focused/full tool tests, bundle and typed lint; no source/parent metadata leak.

### Task3: Final appearance and release

- [ ] Scripted preview confirms helpers/compact scene can be rendered; source acceptance retains original negative guards.
- [ ] Freeze exact source/image, then one necessary configured-model generation under unchanged existing profile.
- [ ] Review actual desktop/mobile scene first; verify native geometry, original physics/source equality, owner/PG/restart.
- [ ] Preserve existing production DDC recovery point; accepted-image switch and formal HTTPS76/admin/prompt regression; atomic FF main push.
