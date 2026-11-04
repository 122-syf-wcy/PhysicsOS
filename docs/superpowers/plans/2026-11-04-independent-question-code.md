# Independent Question Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Generate each question's independent code visualization and deliver a new glass experiment interface.

**Architecture:** Keep the verified scene/runtime, private immutable artifact and restricted child. Replace the wrapper prompt, enforce independent renderer creation and rebuild chat controls around the authored full-width stage.

**Tech Stack:** Existing TypeScript/React, Canvas/SVG, V3 MessagePort, Node24/Docker.

**Spec:** ../specs/2026-11-04-independent-question-code-design.md

## Global Constraints

- Edit isolated codex/experiment-contribution worktree; build/test/release at107.151.246.59 Docker only.
- No new credentials/dependencies, no plaintext secrets, no public autoapproval or model calls during history reads.
- One owner/scene/revision/turn job; child structured_output only, max8192, deadline300000ms including one repair.
- No imports/reexports of old renderer; standalone browser drawing, engine facts remain unchanged.
- Product source changes are captured in overlays; do not commit vendor pointer.

## Review Focus

- Legacy renderer alias/import or an empty wrapper must not acquire independent metadata.
- Legacy ready history must offer explicit upgrade without old canvas or automatic generation.
- A parameter/playback change must alter engine snapshots and the independent drawing without changing original solved scene/ref.
- Private resource/style assembly must preserve raw child source and closure/owner/hash/restart guarantees.
- The final screenshot must show an authored experimental scene, not merely different typography around the old SVG.

---

### Task1: Artifact contract and standalone shell

Files: packages/agent-tools/src/code-visualization.ts; overlay tool types/invariant; experiment-host question-code-context/domain/service; new question-code-render-contract.ts; tests/question-code.spec.ts; upstream schema patch where necessary.
Interface: CodeExperimentRef.rendererKind?:'independent'; CodeStyleContext.renderContract:string. Context contract names exact V3 clock/view/inspector fields, scene coordinates y-up, pre-scaled vectors; existing public prompt body/version remains available.

- [ ] RED: reject legacy imports/reexport/empty wrappers; valid ownCanvas source receives independent marker and frozen modern shell; source four strings unchanged; old row remains readable; resource/owner checks remain enforced.
- [ ] Implement marker and source/shell boundaries before freeze; expose compact accurate data contract, no old drawing code.
- [ ] GREEN host tests; targeted types/bundle/lint on server, source SHA sync.

### Task2: Restricted generation prompt

Files: tool-physicsos code-generation.ts/code-provider.ts/tests/code-generation.spec.ts and preset copy if needed.
Consumes renderContract; produces independent renderer via current restricted child.

- [ ] RED: prompt requests ownCanvas/SVG; oldSDK source rejected/shared repair deadline; timeout300000; one same-turn job retained.
- [ ] Remove baseRenderer/baseCSS wrapper instruction; provide original scene/answer + exact frame contract + latest published style body. Keep tools/owner/lifecycle guards.
- [ ] GREEN focused generation tests/types/bundle/lint; no paid request until Web package rebuilt.

### Task3: Experiment interface

Files: SceneChatCard.tsx/module.css; experiments/QuestionCodeCanvas.tsx/QuestionCodeControls.tsx; relevant client tests.
Consumes rendererKind and same ExperimentSession; produces full-width authored stage, glass controls and source/upgrade UI.

- [ ] RED: old ready without kind never mounts old iframe, manual upgrade only; modern ready uses generated title/new layout; original physics/controls preserved.
- [ ] Replace sidebar/revision chrome with complete experimental stage and compact glass tools; preserve parameter/choice/visibility/playback intents and exact original scene.
- [ ] GREEN client tests/types/UI/Vite in server, mobile/desktop screenshots.

### Task4: Acceptance and rollout

Files: existing chat-code acceptance/mocks and reports; server release tooling.

- [ ] Capture exact realV3 t0/apex/impact data as contract evidence, no invented model values.
- [ ] Mock Web + one necessary real independent-code question: banold source, ownCanvas drawn, engine identity/time/parameters; actual appearance reviewed.
- [ ] Final narrow review/sourceSHA/runtime audit/PG-files restart, private ownership and history upgrade.
- [ ] Atomic FF GitHub push; server backup/config migration/exact acceptedimage switch; HTTPS old76 workflow/read-only smoke; retain rollback points.
