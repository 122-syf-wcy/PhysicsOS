# Developer Prompt Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for inline implementation. Steps use checkbox tracking.

**Goal:** SUPER_ADMIN can edit/import/version a prompt draft, publish it explicitly, and restore a historical prompt without rebuilding the site.

**Architecture:** A separate storage-domain and service in experiment-host own one optimistic draft and immutable published versions. A generated frozen binding/default seed and shared pure Markdown formatter connect the admin panel and public developer page.

**Tech Stack:** existing TypeScript/Zod/storage-domain/React/plain developer JS; no new runtime dependency.

**Spec:** docs/superpowers/specs/2026-11-03-developer-prompt-management-design.md

## Global Constraints

- Existing convex-lens only. Only SUPER_ADMIN reads/writes management data; public readers receive published content only.
- User chose draft then manual publish. Published content/version/binding are immutable. History rollback changes pointer only.
- Prompt X.Y.Z <=32 characters is independent of package/schema/protocol versions. Body64KiB UTF-8, import128KiB, versions200, release events1000.
- Existing V2 template/SDK ZIP bytes remain unchanged. Published prompt binding freezes actual descriptor plus fixed contract Markdown.
- All tests/builds run in physicsos-experiments-build Docker on107.151.246.59. Local source/Git only; preserve vendor pointer and unrelated original workspace. No production deployment/push.

## Review Focus

- Background admin refresh/import response must not discard newer unsaved text; stale revision returns409 with local text retained (Tasks1/2).
- A draft bound before a deployed template/policy change must not publish silently against a new binding (Task1).
- Both public and admin preview/download use frozen binding, including after rollback; public APIs never expose drafts or actor identifiers (Tasks1/2).
- Complete exported Markdown and ordinary Markdown roundtrip predictably; malformed reserved markers/UTF-8/control bytes fail without mutation (Tasks1/2).
- Public prompt fetch failure/retry keeps ordinary docs and task input usable; no silent fallback to an obsolete published prompt (Tasks2/3).

### Task 1: Prompt format, storage, service and routes

**Files:** under overlays/harness/files/packages/physicsos/experiment-host/src create prompt-format.ts, prompt-seed.ts (generated), prompt-domain.ts, prompt-service.ts, prompt-routes.ts; modify index.ts. Add tests/prompt.spec.ts and prompt-routes.spec.ts. Create scripts/developers/generate-prompts.mjs and prompt-generation.test.mjs; generate public developers/prompt-format.js.

**Interfaces:**
- TemplateRelease={schemaVersion:2,experimentId:'convex-lens',url,sha256,bytes}; PromptBinding={release:TemplateRelease,contractMarkdown:string}; PromptDocument={id,version,body,sha256,binding,publishedAt:string|null}. Public document has no draft/actor/note. System default id='system-default',version='1.0.0',publishedAt=null; explicit UI labels distinguish default.
- Shared pure module exports renderPrompt(document,origin,task=''), importPromptMarkdown(text):string, validPromptDocument(value):boolean, validateBody(text):string. Format has exactly one `<!-- physicsos:editable:start -->`/end pair and fixed-contract pair. Reject reserved markers in editable body. Full exports import only marked editable body; plain MD imports as body. Prompt version is set in editor, not silently taken from arbitrary file metadata.
- Seed generator extracts existing agentInstructions(baseOnly) sections: fixed sections are 固定 V2 契约（必须）, 实验包边界（必须）, 物理与状态（必须）, 提交与验证（必须）; remaining operational sections seed editable body. It reads actual checked-in template-release.json. It produces prompt-seed.ts and stripped prompt-format.js without changing existing template/archives. Add deterministic --check.
- Independent domain physicsos_developer_prompts version0, single state row. State={revision,draft|null,versions[],activeId|null,releases[]}; draft stores version/body/note/bindingFingerprint/updatedBy/time. Versions extend public document with note/publishedBy. Releases attributed publish/activate events. Domain schema bounds fields; initialize validates state and active references/digests before serving.
- DeveloperPromptService(domain,seed) methods initialize(),close(),current(),published(id),admin(actor),save(actor,input),import(actor,input),publish(actor,input),activate(actor,input). Every mutation expectedRevision. save/import additionally version/body or filename/base64,note. publish requires expectedRevision; activate requires expectedRevision,id,expectedSha256. Queue writes, create complete next state, await table.put then update internal state; return sanitized copies. Rejected writes restore the prior durable row; failed restoration fences access until service/storage reopen. Default exists without persisted admin record.
- Routes prefix /physicsos/developer-prompts: GET /current and /versions/:id public; GET /admin SUPER_ADMIN; POST /admin/draft,/admin/import,/admin/publish,/admin/activate. Public history only published records. Request max192KiB JSON. Same-origin JSON/Fetch-Metadata CSRF, attributed non-body audit, stable safe error envelopes. Explicit admin GET check, not only guard's write floor. register from existing host; close both domains/services cleanly.

- [x] Write service/format tests first: default; save invisible publicly; publish/immutable version; draft from history uses current binding; activate old exact ID/hash; concurrent stale revision409; changed seed binding blocks old draft; failed persistence doesn't advance cache; restart; 64KiB/128KiB bounds; invalid UTF8/NUL/extension/reserved markers; public projections redact actor/draft; generation parity.
- [x] Run new host tests in server Docker, capture RED missing module/feature. Implement bounded service/domain/format/generator/routes and integration.
- [x] Add HTTP tests anonymous default/public history, admin GET/write role403, unauth401, CSRF/media/body limits, stale409, draft leak absence. Run all host tests and affected type/bundle/lint; generator check, commit Task1 only.

### Task 2: Admin editor and live developer prompt consumption

**Files:** create client/AdminPromptTab.tsx, developer-prompt-api.ts, optional dedicated CSS; modify AdminWorkspace.tsx/locales.ts; generated UI prompt-format.ts copy if needed. Modify public developers/app.js; tests admin-prompt.client.spec.tsx and existing developer-docs.mjs; extend generated-copy checks.

**Interfaces:** typed client methods map Task1 endpoints; form has version/note/body, import picker, save draft, complete preview/copy/download, publish saved draft, history load-as-draft and activate. All mutation requests include loaded revision. Import may accept current file bytes as draft through server API; preview always uses displayed body/version and current seed binding. Admin payload includes current/default seed binding plus draft/history/revision.

- [x] Write RED tests for SUPER_ADMIN-only tab, initial default, editing/version/save, import then edit, immutable published history, explicit publish disabled while unsaved, activate, stale409 retaining typed input, late load/import not overwriting input, size/extension errors, safe preview and download equality.
- [x] Implement reusable glass admin controls and typed API. Add locales. Guard async request lifetimes/state so unmount and stale responses do not replace newer input. Loading/conflict/error have clear retry/refresh controls; refresh after conflict is explicit.
- [x] Public docs load /physicsos/developer-prompts/current using shared validator and formatter. Keep version/id/frozen binding in one state; display prompt version. Replace all bound copy/download/preview flows consistently, leave static docs available. Retry preserves task; no fallback on API failure. Frozen template download link follows published prompt binding, including old historical release after rollback.
- [x] Extend existing actual developer browser failure/retry tests for public prompt API and digest bound copy/download; preserve ordinary docs and no duplicate fetch behavior. Run focused UI/docs tests, types/lint/bundles/generation parity and commit.

### Task 3: Real admin publish workflow acceptance and handoff

**Files:** tests/acceptance/developer-prompts.mjs, docs/reports/2026-11-03-developer-prompt-management.md + screenshots; mark plan completion.

- [ ] Rebuild host/UI/Vite with public assets in existing Docker candidate; stop/restart only validated private candidate process. No production changes.
- [ ] Browser admin tab: import actual .md, change body/version, save; separate public docs unchanged before publish. Publish, reload docs and compare display/clipboard/download complete MD and frozen descriptor. Export/import roundtrip, create secondversion, rollback first, school-admin/anonymous forbidden admin, public no draft, error409 preserves text, safe malicious Markdown, mobile/nooverflow/quietconsole. Restart candidate and verify persisted active/history/draft.
- [ ] Run only necessary final affected checks. Inspect actual screenshots; write durable outcome, commands, decisions/limits, not-deployed state. Commit and run one independent whole-feature review from6555882 (not the prior V2 range). Address material findings with focused regression and preserve branch/worktree.
