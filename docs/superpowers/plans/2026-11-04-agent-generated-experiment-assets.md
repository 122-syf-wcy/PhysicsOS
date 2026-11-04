# Agent Generated Experiment Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development. Root coordinates independent image-service and agent-tool integration via dispatching-parallel-agents.

**Goal:** PhysicsOS code child calls the configured Sunburst image service and uses private generated assets in a polished Warm Lab question experiment.

**Architecture:** Host-owned bounded asset sessions keyed by owner/generation/scene; child-only asset tool; original source contract plus frozen local images. Published visual prompt is authoritative.

**Tech Stack:** Existing TypeScript/Cordis, native fetch, private blob/package service, server Docker/Playwright.

**Spec:** ../specs/2026-11-04-agent-generated-experiment-assets.md

## Global Constraints
- Existing worktree; build/test/release on107.151.246.59 Docker only.
- No key/token/env leak; use existing mounted credential. No production switch until actual visual acceptance.
- Original scene, 8192 child budget, parent high/model, ownership, single same-turn job stay intact.
- Max2 asset requests/job, per-image180000ms, shared600000ms deadline.
- User authorizes design choices/deployment; no repeated approval gate.

## Review Focus
- Abort during network/download; repeated calls cannot exceed quota.
- Unsupported/oversize/remote-private image response is rejected without credential leak.
- Cross-owner, scene or generation reuse cannot freeze an asset.
- Repair reuses generated images within job; immutable artifact survives restart.
- Actual image loads and motion drawn from engine; output is neither background-only nor old renderer.

### Task1: Host asset generation and freezing
Files: experiment-host/src/question-code-assets.ts (new), question-code-service.ts, related host tests.
Interface: service.generateAsset({ownerSessionId,generationId,scene,prompt,kind:'environment'|'material',signal}) => {path,cssPath,sha256,width,height,kind,model}; service.assetManifest({ownerSessionId,generationId,scene}) returns same safe descriptors. create gains optional generationId. Handler is injected into host via default configuration and test dependency. Assets consumed by create are frozen in public/assets/generated and dist/assets/generated, metadata in ASSET-LICENSES.json, originals not modified.
- [x] RED tests: mock upstream success→owned image package, limit/abort/wrong owner/scene, b64/URL/image size/errors.
- [x] Implement service and integrate freezing, keep raw source equality and all existing negative guards.
- [x] Server focused/full host tests/types/lint/bundle and exact source verification.

### Task2: Child tool and prompt integration
Files: tool-physicsos/src/code-provider.ts, code-generation.ts, question-code-visual-brief.ts, index.ts and tool tests.
Interface: provider reads current generating scene/job from actual parent projection; calls host.generateAsset with parent identity, never model-supplied identity. Child advertises only structured_output and physics_generate_experiment_asset; non-image tools still refused. create passes generationId. repair prompt includes generated descriptors. Image metadata output contains no baseURL/key/remoteURL.
- [x] RED actual child tool-call test, quota/abort assertions and unchanged parent options.
- [x] Wire tool,600s shared limit, Warm Lab prompt and image loader instructions.
- [x] Server tool suite/types/lint/bundle.

### Task3: Visual and release integration
Files: host drawImage dataflow check/tests, client style/loading text if necessary, acceptance script and reports.
- [x] Preserve background-only rejection; allow genuine engine-driven drawImage geometry, enforce local resource existence.
- [x] Build candidate; real one question uses configured image tool and actual artwork; inspect desktop/mobile screenshots before accepting.
- [x] Verify raw sources/assets/owner/PG/restart and exact image. Keep failed evidence distinct.
- [ ] Atomic FF GitHub main; stopped-app paired backup, approved image switch and formal76/admin/prompt HTTPS regression.

### Task4: Bounded source parts after upstream long-output diagnosis
- [x] Real child test first: image tool→two code writes→metadata output yields exact concatenated source, source tool absent from parent; invalid/oversize/write quota rejected.
- [x] Scoped source buffer, percall2400chars/max10writes, metadata final schema; unchanged fourfield artifact contract and existing image guards.
- [x] Narrow wire contract supports metadata+write tool only; tests prove ordinary requests unchanged.
- [x] Reduce solved answer prompt to authoritative quantities/status, omit repeated provenance diagnostics (full facts remain in scene/session).
- [x] Server tests/build, actual child/image/code/visual/restart; then authorized release gates.
