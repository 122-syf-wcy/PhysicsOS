# Final independent review — all registered experiment contributions

Reviewed range: `6d277ef..1730261` on `codex/experiment-contribution`.

Verdict: **Approve with minor documentation nits. No Critical or Important findings.** This is a source-review verdict for integration and the planned candidate validation; it is not a production-deployment approval or a claim that production has been switched.

The final all-76 extension in the design and plan supersedes the original lens-only proposal. I reviewed the handwritten backend, wire protocol, SDK generator/tooling, admin/upload workflow, generic workspace integration, public prompt page, relevant tests, and the supplied progress/report evidence. I did not execute builds or tests, contact the server, mutate source/index/HEAD, or spawn agents. The pre-existing dirty vendor worktree was not modified. This report is my only file change.

## Findings

### Critical

None found.

### Important

None found.

### Minor

1. **The selected template card still says it is a convex-lens sample.** `overlays/harness/files/packages/client/ui-physicsos/src/client/experiments/ContributionPanel.tsx:337`. Trigger: select any non-lens experiment on the upload page. The download URL correctly follows the selected target, but the visible caption remains “从可运行的凸透镜样板开始”. This can make an author doubt whether the selected template is correct. Use target-neutral text or the selected label. This does not affect downloaded bytes, validation, or publication.

2. **Generated target source recommends a configure command that does not exist.** `scripts/developers/generate-universal-templates.mjs:187`, emitted into `developer-kit/universal-experiment-template/src/target.js:1` and each target download. Trigger: an author follows the source comment `npm run configure -- <id>` to change target. `tools/configure.mjs` accepts only `--version X.Y.Z`, so this fails. The README and developer prompt correctly say to download the other target's template. Make the generated comment agree with that workflow. Runtime identity checks are unaffected.

## Reviewed behavior and evidence

- **Target intake:** routes carry the selected ID; the service requires a registered profile and compares it with the validated manifest before persistence. V3 fixes protocol/schema versions and engine domain, enforces exact canonical parameter/choice metadata, rejects unknown inputs and out-of-range case values, and rejects contributor `expected` fields through strict case schemas. V1/V2 remain lens-only. Resource validation is reused, not bypassed by V3.
- **Publication isolation/recovery:** the old `convex-lens` storage key and recovery journal remain intact. `activePointers` changes only the selected target, retains the legacy lens `activeId`, and carries forward other map entries. Rollback checks target, current target pointer, approved state, and matching release history; absent historical experiment IDs retain their legacy lens meaning. Rejection preserves current pointers. Existing recovery persistence carries the whole state, including the new map.
- **Administrative review:** the tab and service queue require SUPER_ADMIN; archive/preview ownership checks remain enforced server-side. Candidate runtime creation uses the package's experiment ID. Actual uploaded resources are loaded through the existing trusted wrapper/opaque child boundary. Preview instances have separate status identity, preventing a stale candidate's ready state from enabling a new candidate. V2/V3 approval requires the exact first frame acknowledgment; render errors revoke it. Frozen ZIP download uses the stored archive digest, and approval re-verifies archive and asset integrity.
- **V3 boundary:** outer source/origin/channel/version checks and a single MessagePort remain in place. Snapshot serialization exposes only selected render facts, explicitly rejects failed physics and nonfinite values, and is followed by the bounded plain-data codec. Intents require exact fields, current runtime IDs/options/bounds, allowed playback rates, and valid seek range. The port is rate-limited and closed on failure/unmount; temporary preview state is cancelled. V3 uses the animation frame source, while V1/V2 behavior remains on its prior interface.
- **Published workspaces:** generic canvas selection checks target, approval, entry, and V3. Saved community pins resolve exact ID/hash; missing or mismatched releases produce an explicit error instead of silently replacing them. Fresh scenes pin the selected release once. Matching explicit official pins render locally without a catalog request. The lens-specific page continues to select its prior release format and now passes its target to the shared frame for V3 support.
- **SDK and public author flow:** the generator derives 76 profiles from the application templates/runtime, freezes the platform renderer rather than a contributor solver, copies the same validators into the SDK, and emits target-specific metadata, fixture, identity, ZIP and prompt. Sorted generated CSS mappings and deterministic archive encoding address repeatability. The public page selects target-specific template/prompt endpoints, preserves task text, uses the complete preview for header download, and disables prompt actions while loading or after failure. The two minor stale strings above are the exceptions found.
- **Supporting repairs:** the wave marker now exposes its computed longitudinal displacement; Doppler and double-bar inspector descriptors include their canonical defaults without an intake-only exception. Relevant regression tests cover those changes.

I inspected assertions behind the recorded server validation: all-76 target/archive and snapshot coverage, per-target publication/restart and legacy-state tests, resource confinement and copied-validator parity, frame token/failure/unmount/rate tests, missing/offline/pinned workspace tests, real-renderer shape/resource checks, and the representative upload/admin/publish/resume/browser acceptance script. The supplied report records backend 156/156 plus later focused passes, 76 real SDK renderings across 12 domains, final universal 84/84, affected UI/types/lint passes, and successful representative end-to-end and public-doc browser runs. These are inherited execution evidence; I did not independently rerun them.

## Declined scope and remaining release work

- Did not dump the large base64 template data, unmodified third-party renderer internals, or binary screenshots; reviewed their generator, integration boundaries, license handling, and parity/browser evidence instead. Generated whitespace/type padding is not a functional finding.
- Did not treat first-frame acknowledgment as proof that arbitrary contributor code is scientifically correct. The UI explicitly describes it as an aid to human review, and physical facts remain platform-owned. Exhaustive parameter-space validation and 76 separate publication journeys are not claimed by the evidence.
- Did not reopen the diagnosed candidate HTTP/1.1 tab-connection starvation or SwiftShader screenshot issue: the report identifies controlled harness causes, and no unrelated product-navigation change is present.
- Main/server/image reconciliation, backup and restore points, building over the healthy D6 runtime, PostgreSQL-clone candidate checks, production switching, and final HTTPS/GitHub verification remain the root agent's release work. The source review does not substitute for those gates.
