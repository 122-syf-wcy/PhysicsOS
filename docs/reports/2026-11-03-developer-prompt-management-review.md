# Final whole-feature review — developer prompt administration

**Range:** `6555882..996ef84` (four commits; 32 changed files).  
**Reviewer verdict:** **Ready to merge: Yes, with three non-blocking Minor follow-ups.**  
**Critical findings:** 0. **Important findings:** 0. **Minor findings:** 3.

This is the single final review of the prompt-management feature. I read the supplied review brief, design, implementation plan, durable acceptance report and ledger rulings, then reviewed the changes in logical passes: format/storage/service; HTTP/integration; editor/public consumption; generation/tests/acceptance. I used the requesting-code-review reviewer calibration, including reasonable-user expectations. This does not repeat the earlier V2 package review.

All file references below are relative to `/Users/dongsiwei/.codex/worktrees/experiment-contribution/PhysicsOS`.

## Strengths

- **Publication boundaries are explicit.** `overlays/harness/files/packages/physicsos/experiment-host/src/prompt-service.ts:160` serializes mutations, checks revision inside the queue, builds a separate next state, and updates the service cache only after durable `put` succeeds. Publish clears the draft and freezes body/version/binding together; activation selects the immutable ID and checks its digest. Public projection at line 64 excludes notes and actor fields.
- **Saved drafts cannot silently acquire a new deployed contract.** The canonical binding fingerprint is stored when saving and checked again at publish (`prompt-service.ts:219`, `:258`). Canonical field ordering also avoids JSONB key-order changes invalidating otherwise unchanged history (`:46`). Returned state and documents are cloned, preventing external mutation of cached history.
- **Authorization covers management reads as well as writes.** The explicit SUPER_ADMIN check at `overlays/harness/files/packages/physicsos/experiment-host/src/prompt-routes.ts:130` closes the existing guard's permissive GET behavior. Public routes are separated, management writes enforce JSON/same-origin checks, and successful audit entries do not contain prompt bodies.
- **Asynchronous editor responses preserve later input.** `overlays/harness/files/packages/client/ui-physicsos/src/client/AdminPromptTab.tsx:44` tracks request identity, component lifetime and an edit counter. Refresh preserves the current form; successful save/import responses replace it only when no later edit occurred. Publishing is disabled for an unsaved form or changed binding (`:314`). A failed write leaves the local text available for recovery.
- **One formatter connects all delivered text.** The server formatter is copied by a deterministic generator into the admin and public consumers. Draft preview/copy/download share the same rendered string; historical/current server Markdown routes render the frozen document. The public page stores the prompt and its release together, disables bound actions on failure, and retains the task text during retry (`overlays/harness/files/apps/web/public/physicsos/developers/app.js:33`). Its ordinary document navigation remains independent of the fetch.
- **Real acceptance complements focused tests.** The acceptance script exercises an actual native file import, editing, draft isolation, publication, exact clipboard/download text, rollback, a real stale revision, inert HTML, role boundaries and mobile overflow (`tests/acceptance/developer-prompts.mjs:113`). Its persistence mode checks stored current/history/draft after a separate candidate restart (`:26`). The durable report distinguishes those results from production PostgreSQL validation and broader repository claims.

## Issues

### Critical — none

No demonstrated critical defect was found in the reviewed changes.

### Important — none

No material blocker was found in publication immutability, permission enforcement, stale-edit handling, persistence recovery within the stated process boundary, or frozen template delivery.

### Minor

1. **Validate control characters across the complete imported file before extracting its editable section.**
   - **Reference:** `overlays/harness/files/packages/physicsos/experiment-host/src/prompt-format.ts:54` and `:71`; caller `prompt-service.ts:240`.
   - **Trigger:** Append a NUL or ESC character after an otherwise valid complete platform export, or put it in the discarded contract/header text. Fatal UTF-8 decoding accepts these valid Unicode control characters. The importer validates markers, extracts only the editable body, and validates only that body, so the import proceeds and advances the draft revision. Also, `validateBody` trims before its control-character check, so leading/trailing VT or FF can disappear before rejection.
   - **Impact:** The stored body is clean, so this is not code execution or a public-data leak. It is a narrower-than-documented file validation contract: the design explicitly promises that uploads containing NUL/disallowed controls fail without mutation (`docs/superpowers/specs/2026-11-03-developer-prompt-management-design.md:17`). The current tests cover controls inside plain body text, not outside the editable markers.
   - **Recommendation:** Check forbidden control characters on the decoded complete input before trimming/extraction, then continue the existing body and marker validation. Add a focused import regression for a full export with controls before/inside/after the non-editable area and assert unchanged revision/draft.
   - **Evidence:** Deterministic source-path trace; no new test was run during review.

2. **Preserve significant indentation at the beginning of ordinary Markdown.**
   - **Reference:** `overlays/harness/files/packages/physicsos/experiment-host/src/prompt-format.ts:36`–`:39`.
   - **Trigger:** A valid Markdown body beginning with an indented code block, such as `    const x = 1\n    const y = 2`, loses the first line's four spaces because of `.trim()`. Subsequent lines retain their spaces. This happens on save, ordinary Markdown import, and rendering, so it changes the Markdown meaning rather than merely removing a BOM or normalizing line endings.
   - **Impact:** Code-oriented instructions can be reformatted unexpectedly. The result remains visible and editable, and the common heading/fenced-code paths work, so this is non-blocking text fidelity rather than a persistence loss issue.
   - **Recommendation:** Preserve horizontal indentation when normalizing author text. If empty outer lines are intentionally removed, trim whole blank lines rather than all whitespace, and use a separate whitespace-only emptiness check. Cover a leading indented code block through save/import/export.
   - **Evidence:** Deterministic source-path trace; no new test was run during review.

3. **Display the prompt-content digest on the public developer page.**
   - **Reference:** `overlays/harness/files/apps/web/public/physicsos/developers/app.js:99` and `:273`.
   - **Trigger:** A developer opens the published prompt page. The page shows the prompt version and the generated text contains the template ZIP SHA, but the public document's own `sha256` is never displayed. The design calls for clearly displaying both the body version and digest (`docs/superpowers/specs/2026-11-03-developer-prompt-management-design.md:32`).
   - **Impact:** The prompt is still correctly bound and downloadable, but developers cannot directly compare the prompt-content identity with an admin record without opening the JSON API. The template ZIP digest is a different value and should remain clearly distinguished.
   - **Recommendation:** Add a compact, selectable prompt-content SHA next to the published version or in its metadata area; label it separately from the template digest. Retain the existing shared copy/download text semantics.
   - **Evidence:** Read the public rendering paths and searched this file for SHA use; no public prompt-content digest rendering exists.

## Plan alignment and accepted refinements

The central user request is implemented: SUPER_ADMIN can edit/import/version a shared draft, save it without affecting readers, publish manually, and restore an immutable historical publication. The fixed experiment protocol and true template identity remain system-owned. The editor, public API and download paths use the same document model and formatter. No added runtime dependency or template repackaging was introduced by this range.

The five named review focuses are satisfied with the small input-boundary qualification above: later unsaved edits survive async responses/409; old draft bindings block publication; published and historical downloads use frozen bindings; normal/full Markdown imports extract the intended body and reject malformed reserved markers; public failure/retry preserves ordinary documentation and task input without an obsolete-prompt fallback.

The ledger refinements are justified by the implementation: actual storage uses `put`; ambiguous rejected writes trigger prior-row restoration and then a fence if recovery also fails; old `AGENTS.md` downloads and the contribution-panel template link now follow current publication; Unicode roundtrip and canonical field ordering address concrete content-identity errors. The current request that encounters a low-level storage failure can return the safe generic 500 envelope; subsequent fenced accesses return 503. I did not interpret this as a promise of a persistent crash-recovery journal.

The unchecked final Task 3 plan lines and “review in progress” report status are handoff bookkeeping for this review, not evidence that the accepted browser workflow is missing. They should be updated by the executor after ruling on this report.

## Verification and evidence limits

- I read the service/format/HTTP tests, admin component/shell tests, updated public-document browser tests, generation check, and complete new acceptance script. I did **not** rerun suites, builds, installs or browser workflows, and made no server calls or server changes.
- The durable report records: initial complete host 137 pass; final prompt format/service/HTTP 25 pass; UI 7 pass plus 4 affected checks after Unicode changes; public docs browser 7 pass; generation 1 pass/three copies; affected types/bundles/lint/Vite exit 0; final real workflow exit 0; separate candidate-restart persistence exit 0. These are inherited execution evidence, not fresh reviewer test runs.
- I independently inspected the local frozen ZIP bytes: SHA-256 `f9165baa152c62ad73c1d51f9e62e68abe53e480d642bd5a655393f25061b936`, 232146 bytes, matching the recorded unchanged release. I did not unpack/re-review its experiment implementation. The generated formatter copies were judged from their deterministic generator and parity evidence instead of a redundant independent code review of duplicates.
- The four local screenshot artifacts are real PNG files at the documented desktop/mobile dimensions. The controller's four-image visual inspection is recorded in the supplied evidence; I did not claim a new screenshot acceptance run.
- Named unchanged integration checks were limited to the existing identity guard's GET behavior, storage-domain `put` commit/cache/event order, host registration/origin handling, the public downloads block, and archive generation's preservation of prior digest filenames. These reads support specific new-feature boundaries; no broad review of unrelated host or V2 behavior was performed.
- Source/index/HEAD remained unchanged. The initial and final source status retained only the pre-existing dirty vendor worktree indication. This report is the sole review artifact written.

## Behaviors declined as outside this review's scope

Each line is explicit so the executor can rule on it; none is silently treated as tested or guaranteed.

- **New experiments, model/system prompts, or arbitrary experiment registration:** user/spec scope is the existing convex-lens developer prompt only.
- **Per-admin private drafts, autosave, navigation recovery of unsaved edits, or collaborative merging:** the agreed product model is one shared draft with explicit save and revision conflict handling. I evaluated late-response/refresh/409 text preservation; I did not add a broader autosave or cross-navigation persistence requirement.
- **Storage-level CAS across multiple writing processes:** explicitly deferred by the design and ledger; the existing deployment boundary is a single writing process. This review does not certify horizontal multiwriter operation.
- **A persistent recovery journal guaranteeing rollback after process death during failed writes:** explicitly not provided. The live-process restore/fence behavior is reviewed; crash recovery still requires reopening and checking valid durable state.
- **Production PostgreSQL behavior, production rollout/rollback, or production reverse-proxy validation:** the authorized evidence is the private JSON-backed candidate, and this task is a merge review. No production deployment was requested or performed.
- **Repeating prior V2 physics, renderer, ZIP security or package release acceptance:** that work was separately reviewed and its archive is unchanged. Only concrete new prompt/template-link integration and byte identity were checked here.
- **Whole-repository security certification, unrelated warnings, or unrelated code cleanup:** the range and named integration boundaries define this review. Scoped clean checks are not evidence of a globally clean or secure repository.

## Assessment

**Ready to merge: Yes.** The requested draft/manual-publish workflow and its high-risk concurrency, authorization, immutable-binding and persistence boundaries are implemented coherently and backed by focused and real candidate acceptance evidence. The three Minor findings are precise, non-blocking gaps in file validation, Markdown fidelity and public metadata; the executor should record their disposition and complete the review bookkeeping. This verdict authorizes no production deployment and makes no multiwriter or production PostgreSQL guarantee.
