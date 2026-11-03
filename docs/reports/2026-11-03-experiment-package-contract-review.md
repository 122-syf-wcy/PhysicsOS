# PhysicsOS V2 experiment contribution — final whole-plan review

Date: 2026-11-03. Reviewer: `/root/v2_final_review`.

Reviewed range: `27b32adc0336314e129dc27e7c678c344ea4a927..342223b`, using the supplied review package. Workspace: `/Users/dongsiwei/.codex/worktrees/experiment-contribution/PhysicsOS`. References below are relative to that workspace.

## Scope and method

Read the final review brief, design specification, completed implementation plan, durable acceptance report and progress/ruling ledger. Reviewed the change in logical passes: canonical contract and intake; version persistence and runtime; author release and generated identity; UI integration; storage compatibility and tests; acceptance evidence. Inspected unchanged approval/pinning/parser boundaries only where the V2 changes depend on them. Did not broadly reopen the earlier V1 plan.

This was a read-only source/artifact review; only this requested report was written. No local build or test, no server command, no suite rerun, no Git/index/HEAD mutation, no subagent dispatch. Runtime results are inherited evidence from the durable report and controller's independent log/screenshot inspection, not tests newly executed by this reviewer.

## Strengths

- **One executable metadata/resource contract crosses the author/server boundary.** The host schema fixes the registered experiment, coherent V2 versions, engine, entry and stable content version. Exact generated parameter metadata, bounded teaching content, engine-evaluated mandatory and extra cases, and resource-license coverage are checked before intake succeeds (`overlays/harness/files/packages/physicsos/experiment-host/src/contract-v2.ts:20`, `:93`, `:398`). The template invokes those generated validators and the same resource parser (`developer-kit/experiment-template/tools/validate.mjs:38`). The extraction preserves the existing HTML/CSS/JS/import-map/glTF checks rather than creating another incomplete parser (`overlays/harness/files/packages/physicsos/experiment-host/src/package-resources.ts:110`).
- **Physical facts and edit authority remain distinct.** Snapshot validation accepts finite positive authoritative heights/distances, including values outside editable intervals; the three writable intents retain bounded values and exact V2 keys (`overlays/harness/files/packages/physicsos/experiment-host/src/contract-wire.ts:86`, `:136`). The shared centimetre/SI adapter calls the existing optics engine and preserves signed virtual distances/inverted heights (`overlays/harness/files/packages/physicsos/experiment-host/src/contract-v2.ts:353`, `overlays/harness/files/packages/physicsos/experiment-host/src/contract-optics.ts:8`).
- **Migration selects the loader from trusted, coherent stored versions.** Both absent fields mean legacy V1; half-pairs and mismatched pairs fail. Intake refuses new V1, while frozen verification explicitly allows it and compares the archive's versions with the record. Wrapper selection receives that trusted runtime version (`overlays/harness/files/packages/physicsos/experiment-host/src/domain.ts:37`, `overlays/harness/files/packages/physicsos/experiment-host/src/archive.ts:268`, `overlays/harness/files/packages/physicsos/experiment-host/src/service.ts:390`, `overlays/harness/files/packages/physicsos/experiment-host/src/routes.ts:219`). Migration tests cover pending V1 approval, rejection/reupload, history, rollback and corrupted version selection (`overlays/harness/files/packages/physicsos/experiment-host/tests/service.spec.ts:217`).
- **Readiness means completion of the first draw for the correct instance.** The host pins the first frame/revision, keeps its fixed timeout, rejects unrelated acknowledgements, and revokes the old port on failure/retry/unmount (`overlays/harness/files/packages/client/ui-physicsos/src/client/experiments/CommunityExperimentFrame.tsx:35`). The SDK serializes callbacks while retaining only one in-flight and one latest pending full snapshot, captures revision before awaiting, and suppresses acknowledgements after disposal (`developer-kit/experiment-template/src/protocol.ts:35`). The renderer's promise settles from its scheduled draw, with explicit failure and disposal paths (`developer-kit/experiment-template/src/lens-renderer.ts:100`, `:212`). Candidate status is tied to a fresh preview instance and gates both the button and review handler (`overlays/harness/files/packages/client/ui-physicsos/src/client/experiments/ContributionPanel.tsx:180`, `:191`, `:461`).
- **Release and download identity are concrete and independently checkable.** The public release/pack commands execute checks, a clean build and validation before packing actual bytes; packing rejects a serialized ZIP above the host limit before writing success artifacts (`developer-kit/experiment-template/tools/release.mjs:7`, `developer-kit/experiment-template/tools/pack-release.mjs:8`). The generator emits matching digest-named/alias archives and an external descriptor, avoiding a self-referential digest inside the ZIP (`scripts/developers/generate.mjs:119`). Display/copy/download use the same prompt generator; descriptor failure leaves ordinary docs usable and bound actions unavailable (`overlays/harness/files/apps/web/public/physicsos/developers/standards.js:89`, `overlays/harness/files/apps/web/public/physicsos/developers/app.js:36`).
- **The Zod compatibility adjustment is narrow.** `DomainValueSchema` describes the parse/safeParse methods actually consumed by persistence, preserves the original schema objects and null-sentinel check, and does not rewrite runtime validation or upgrade the whole dependency graph. The patch exports the type, updates the affected catalog declarations and adds type/object-identity/null/parity coverage (`overlays/harness/upstream-changes.patch:17565`, `:17600`). The unchanged consumers use those methods at the durable boundary.
- **Tests address real integration risks.** Coverage includes mutated metadata, case tolerances, malformed stored versions, stale first-frame acknowledgements, blocked-render bursts, release short-circuiting, stale dist, missing CSS/JS resources, symlinks, descriptor failures and actual ZIP byte limits. The browser helper downloads the served archive, modifies source, runs normal release, compares actual hashes, and then exercises student upload and administrator review (`tests/acceptance/downloaded-experiment-release.mjs:89`). Browser assertions inspect real V2 replies, rendered canvas, explicit WebGL failure, frozen archive equality and saved/open/default/rollback behavior (`tests/acceptance/experiment-contribution.mjs:167`, `:191`, `:269`).

## Issues

### Critical — must fix

None found.

### Important — should fix

None found. No unresolved whole-plan integration defect or material departure from the approved scope was identified.

### Minor — nice to have

No new code defect identified. The following previously deferred items remain non-blocking and are explicitly triaged rather than silently omitted:

- Resource failures still use fixed generic guidance (`overlays/harness/files/packages/physicsos/experiment-host/src/package-resources.ts:10`, `overlays/harness/files/packages/physicsos/experiment-host/src/archive.ts:57`). This is the approved Task 3 behavior, and Task 4 wording/report now agree. A future bounded owner/reference diagnostic would help contributors locate missing assets; current shared validation still rejects them.
- Full Cordis catalog generation is blocked by the pre-existing shared-state-host JSDoc issue. The three affected declarations have focused source/printer parity coverage; the report correctly does not claim a successful full generator run (`docs/reports/2026-11-03-experiment-package-contract.md:77`). No expansion into unrelated catalog repairs is required for this plan.
- Eleven moderate author-tool advisories, four pre-existing PostgreSQL skips, and Node experimental/runner warnings remain limitations of the available evidence. The scoped high-severity Zod dependency was updated. These observations do not support a full-repository security certification, clean full build, or production database qualification; none is claimed by the handoff report (`docs/reports/2026-11-03-experiment-package-contract.md:75`, `:77`; progress ledger).

## Plan compliance and integration assessment

| Requirement | Assessment |
| --- | --- |
| Existing experiment only, initially convex-lens | Met: manifest and prompt profile restrict the registered ID; no registration or new upload service was introduced. |
| Canonical contract and generated consumers | Met: metadata, wire and resource rules are shared; the trusted engine adapter is reused. JSON Schema is documented as structural, with semantic enforcement in the executable validator. |
| V2 intake with retained frozen V1 | Met: coherent version pairs, explicit legacy verification, trusted wrapper version, legacy UI labels and original bounded V1 intent behavior are preserved. |
| Actual first frame, failure and lifecycle handling | Met: exact first frame/revision, serialized/coalesced SDK processing, draw completion, fixed timeout, revocation and current-candidate approval eligibility agree across layers. |
| Bound downloadable template and prompt | Met: real immutable archive identity, shared base instructions, explicit external descriptor inside AGENTS, task text separate from contract values, failure/retry behavior. |
| Clean rebuild and independent server validation | Met: public release/pack flow cleans/rebuilds, allowlists source/configs, excludes local-only material, rejects symlinks and excessive ZIP bytes; intake never installs/builds/executes uploaded source. |
| SHA-bound approval, defaults, pinning and rollback | Met: existing serialized approval/rollback and recovery remain authoritative; clients do not choose ordering by version or timestamp. Page selection remains pinned to package ID/SHA and browser evidence covers saved and still-open sessions. |
| Existing upload presentation | Met within the available evidence: upload UI structure/styles retained; only selected preview mount scrolls into view. The reported offscreen RAF failure and focused correction fit the first-draw contract. Controller inspected all 13 screenshots, including final embedded review and mobile layouts. |
| No production deployment/main push | Met by task scope and the reported environment boundary; this review performed no deployment action. |

The deliberate adjustments are reasonable: authoritative facts are not clamped to intent bounds; coalescing full snapshots bounds memory; the template's own digest is external; exact ESLint/Prettier config roots keep frozen source rebuildable; the structural storage interface accommodates the scoped Zod patch; preview scrolling makes the promised actual draw possible. The revised hostile-navigation fixture waits for real rendering before attempting navigation, retaining both blocked-request and raw-entry-denial assertions. These are justified refinements, not missing plan functionality.

## Evidence and its limits

Independent read-only artifact inspection during this review found:

- All seven directly copied canonical wire/metadata/resource/parser/limit source consumers match canonical source plus the generated banner byte for byte.
- The immutable template is 232146 bytes with SHA-256 `f9165baa152c62ad73c1d51f9e62e68abe53e480d642bd5a655393f25061b936`; descriptor values and the convenience alias match those exact bytes.
- All 63 archive entries match their current standalone template source files.
- The standalone lock contains 103 package records, no linked records and no non-HTTPS resolved locations.

Reviewed test source and inherited reported server-Docker evidence cover host 114 pass, storage 35 plus the actual-produced-ZIP host check, developer browser 7/7, tooling 65 pass with four declared skips, focused runtime/UI/renderer checks, types/bundles/lint, generated artifacts, three actual standalone releases and browser upload/persistence/containment acceptance. The initial combined acceptance command is correctly reported as having completed business assertions and then failed its obsolete hostile fixture; only the corrected containment slice is claimed exit 0. The controller independently inspected the safe server PASS summaries and screenshots. I did not reinterpret those as a new full-suite run.

## Recommendations

No implementation fix or additional suite rerun is required by this review. Keep the generic resource diagnostic and catalog/dependency/environment limits visible in the durable handoff. Preserve the digest-named archive when future templates are generated. Any later production release still needs its own current-main/server/image reconciliation and server-side backup/candidate/switch/rollback procedure under the project instructions.

## Declined to judge

- New-experiment registration, arbitrary IDs or additional physics engines: explicitly excluded by the user's existing-experiments scope.
- Broad correctness/security re-review of the earlier V1 plan: separately reviewed work outside this range; only concrete version, parser, approval and pinning integration boundaries were inspected here.
- Browser first-frame acknowledgement as server-side author/physics/security certification: explicitly not the design; authenticated frozen-SHA approval and human review remain authoritative.
- Proving submitted source and dist correspond despite a malicious author modifying tooling/reports: intake deliberately does not build or execute source, and author reports are not authority; this requires a separate provenance/build design.
- Exact physical parity of the pre-existing local preview fixture equation with the trusted engine: local preview is explicitly fixture-labelled; production snapshots and case validation use the engine. Replacing the preview model is outside this plan.
- Arbitrary user-authored secrets hidden inside otherwise allowed source/JSON content: the plan supplies path/file isolation and excludes local environment material, not a semantic secret scanner; no certification of arbitrary author content is implied.
- Full unrelated Cordis catalog/JSDoc cleanup and a whole-repository clean-build claim: the baseline blocker is documented; only the changed declarations and their owner are in this task's verification scope.
- Whole-dependency-graph advisory remediation: this plan addressed its introduced high-severity Zod issue; the declared moderate author-tool advisories are a separate maintenance scope.
- Production PostgreSQL behavior, deployment/migration execution, image switching and rollback rehearsal: candidate acceptance used isolated JSON storage and no production deployment was authorized in this plan.
- Exhaustive real-mobile-GPU/browser matrix and another real-browser V1 smoke run: current evidence is Chromium/SwiftShader plus reviewed legacy integration fixtures; those broader claims are not made.

## Assessment

**Ready to merge? Yes — for the reviewed V2 plan.**

The canonical contract, generated developer kit, V2 runtime and existing publication/pinning boundaries form a coherent implementation, supported by appropriately scoped server-Docker and real-browser evidence. No Critical or Important finding remains; declared limitations do not prevent merging this change and do not imply production deployment readiness or completion.
