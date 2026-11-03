# Experiment Package V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A developer follows a bound convex-lens prompt, releases a valid V2 ZIP, uploads it, and an administrator makes it the default without a site rebuild.

**Architecture:** The host owns a portable Zod metadata contract and dependency-free wire module. Generated copies drive author tooling, schemas, prompts and client protocol; trusted optics supplies case evaluation. V1 frozen records remain usable, while new intake requires V2.

**Tech Stack:** TypeScript, Zod 4.4.3, Node >=24.7, React, existing Three.js SDK, server Docker/Vitest/Playwright.

**Spec:** docs/superpowers/specs/2026-11-03-experiment-package-contract-design.md

## Global Constraints

- Existing registered experiments only; initially `convex-lens`. No new-experiment registration.
- New manifest `schemaVersion: 2`, runtime `protocolVersion: 2`; engine `{id:"optics",contractVersion:1}`.
- Content version is stable `X.Y.Z`, no leading zeros, maximum 32 characters.
- New V1 uploads return `PACKAGE_UPGRADE_REQUIRED`; existing pending V1 remains reviewable and labelled 旧格式; approved V1, pinned sessions and rollback remain usable. Missing stored version fields mean V1.
- Preserve frozen ZIP SHA approval, server sequence defaults, authentication, opaque iframe, CSP, exact source/origin/channel checks and existing upload glass UI.
- Upload never installs, builds or executes package code. First-frame acknowledgement is compatibility evidence, not physics or security certification.
- Build/test only in Docker `physicsos-experiments-build` on `root@107.151.246.59`; local worktree is for source/Git. No production changes. Do not expose secrets or preview capabilities.
- Source truth is overlays/harness/files; sync applied copies for tests, do not commit vendor/deepseek-harness pointer. Preserve unrelated work.

## Review Focus

- Valid-looking unsupported IDs or altered generated units must fail identically in template and host (Task 1/3).
- Partly upgraded manifests and absent persisted version fields cannot silently select the wrong loader (Task 1/2).
- Wrong or late first-frame acknowledgements cannot authorize a new frame instance (Task 2).
- Release must remove stale dist assets and never package secrets/symlinks (Task 3).
- Downloaded prompt hash must match actual template bytes without a self-referential hash embedded in those bytes (Task 3/4).

## File and interface map

Canonical files under `overlays/harness/files/packages/physicsos/experiment-host/src/`:
- `contract-wire.ts`: pure snapshot/intent types, safety bounds, validators.
- `contract-v2.ts`: Zod manifest/metadata schemas, generated default documents and semantic validation.
- `contract-optics.ts`: trusted host case evaluator using `@physicsos/engine-optics` thinLensOutcome.
- `archive.ts`, `domain.ts`, `service.ts`, `embed.ts`, `routes.ts`, `identity.ts`: intake, persistence, wrapper and safe errors.
Generated copies are marked and compared by `scripts/developers/generate-contract.mjs`: wire to template `src/contract-wire.ts` and UI `experiments/contract-wire.ts`; metadata to template `tools/contract-v2.ts`. The metadata module only imports its sibling wire module; copy wire beside tooling too. This is generated data/code, not independently maintained validators.
A stripped standalone copy of engine `packages/engine-optics/src/imaging.ts` becomes template `tools/platform-optics.mjs` using Node stripTypeScriptTypes (it has only a type import). Canonical shared adapter converts centimetres to metres; host and tool invoke the same adapter with trusted thinLensOutcome. Do not duplicate the equation.

### Task 1: Canonical contract and version-aware server intake

**Files:** Create canonical files above and `scripts/developers/generate-contract.mjs`; modify host package dependencies/tsconfig and overlay lock patch if required; host source files except embed; host tests `contract-v2.spec.ts`, `archive.spec.ts`, `service.spec.ts`, `routes.spec.ts`, fixtures/support. Generated copies may be created for later consumers. Update host README.

**Interfaces:**
- `manifestV2Schema`, `manifestV2Example`, `parametersV2Document`, `teachingV2Example`, `casesV2Document`, `assetLicensesV2Example` exported from contract-v2.
- `ContractIssue = {code:string,file:string,path:string,message:string,suggestion:string}`; max 20 issues, bounded human-safe fixed messages and sanitized paths, never raw input.
- `validatePackageMetadata(files: ReadonlyMap<string,Uint8Array>, evaluate: CaseEvaluator): ContractIssue[]`; decode four fixed JSON files, cap each at 256 KiB. Manifest separately parsed with the same schema.
- `CaseInput = {objectDistanceCm:number,focalLengthCm:number,objectHeightCm:number}`; `CaseExpected = {imageDistanceCm:number|null,imageHeightCm:number|null,imageKind:'real'|'virtual'|'none'}`; `CaseEvaluator = (input:CaseInput)=>CaseExpected`.
- `evaluateCaseWithOptics(input, thinLensOutcome)` shared adapter; cm→m and output→cm, image height magnitude. Compare numbers using abs 1e-7 cm + rel 1e-9; null/kind exact.
- Wire exports `ExperimentSnapshot`, `ExperimentIntent`, `ParameterId`, `isSnapshot`, `isExperimentIntent`, `PARAMETER_CONTRACT`, `PROTOCOL_VERSION=2`. Preserve existing snapshot shape; accept fixture source only in SDK/local tool; production validates platform-engine. Three writable IDs only, each safety [1,200], runtime inspector further narrows. Display ranges u [1,80,.5], f [2,30,.5], screen [1,100,.5]. Height and visible/result/rays are read-only.
- `validateArchive(bytes, {allowLegacy?:boolean} = {})` defaults to new intake; legacy only for frozen verification. ValidatedArchive carries manifest union V1|V2.
- Public PackageView adds schemaVersion/protocolVersion 1|2. Persist optional pair for old records; require matching pair when present, infer V1 only when both absent. Wrapper runtime version later comes from trusted stored record.

**Exact metadata:**
- parameters document `{schemaVersion:2,experimentId:'convex-lens',parameters:[{id,label,unit:'cm',access:'read-write',default,safety:{min,max},display:{min,max,step}}],readOnlySnapshot:['parameters.objectHeightCm','visible.image','visible.rays','result','rays']}`. Fixed order u/f/s; labels 物距/焦距/光屏距离; defaults 30/10/15. Schema expresses exact generated values; cannot add/rewrite parameters.
- teaching `{schemaVersion:2,experimentId:'convex-lens',title,steps,limitations}`; title trimmed nonblank 1..120, steps and limitations 1..12 strings of 1..500, strict keys.
- cases `{schemaVersion:2,experimentId:'convex-lens',unit:'cm',cases:[{id,input,expected}]}`; 5..50 unique slug IDs max64. Inputs u/f/h finite [1,200]. Required IDs beyond-2f, at-2f, between-f-2f, at-f, within-f with u=30/20/15/10/5, f=10,h=4. All cases including extras evaluated by engine. Expected v=15/20/30/null/-10, height=2/4/8/null/8 and kinds real/real/real/none/virtual.
- licenses array 1..1000 `{path,name,license,source,notice?}` strict; path/notice bounded safe package-relative paths, optional single trailing `/*` for path only, path restricted to dist. Every entry matches existing files; cover, dist/assets and dist/vendor resources have license coverage; notice exact file exists. name1..120, license1..80 SPDX-style identifier (allow Apache-2.0/MIT and LicenseRef-*), source1..500 either HTTPS URL or `original`. Template uses https://github.com/mrdoob/three.js and original. Checking structure/coverage does not assert legal ownership.

- [ ] Write failing tests for valid V2; version leading zero, pre-release and >32; unsupported ID; mixed protocol; wrong unit/extra parameter; whitespace teaching; bad JSON; missing/duplicate/edited required case; wrong extra case near focal tolerance; missing license target/notice/coverage.
- [ ] Run focused new tests in server Docker and capture expected RED (missing modules/unsupported V2).
- [ ] Implement canonical modules and generator. Link host engine-optics using existing root link pattern and tsconfig reference; preserve frozen V1 parser. Error codes include PACKAGE_UPGRADE_REQUIRED, UNSUPPORTED_EXPERIMENT, INCOMPATIBLE_PROTOCOL, INVALID_MANIFEST, INVALID_METADATA; safe issue fields reach REST. Existing ZIP/resource guards stay strict.
- [ ] Add migration tests for old pending V1 approve, rejected V1 reupload rejected, V1 history/rollback unchanged, V2 stored/exported pair, malformed half-pair rejected. Update normal fixtures to V2; explicit legacy fixture remains for migration tests.
- [ ] Run host suite, host types/lint/bundle, generator check; record commands and results. Commit task files only.

### Task 2: Versioned runtime first-frame readiness

**Files:** host embed/routes and wrapper tests; UI CommunityExperimentFrame.tsx, contribution-protocol.ts, contribution-api.ts, ContributionPanel.tsx and relevant tests; template src/protocol.ts, main.ts, tests/protocol.test.mjs, tools/dev.mjs and preview scripts as needed; generated wire consumer imports.

**Interfaces:** consumes Task 1 versions/wire. For V2 each port snapshot includes `protocolVersion:2, frameId:string, snapshot`; host-created monotonically distinct frameId per port/instance. SDK replies `{type:'experiment/rendered',protocolVersion:2,frameId,revision}` only after awaited onFrame success. Errors `{type:'experiment/error',protocolVersion:2,code:'SNAPSHOT_INVALID'|'RENDER_FAILED'}` with fixed safe messages in UI; no arbitrary error HTML/strings. Connected reply includes version but is never V2 ready. V1 old messages unchanged.

- [ ] Write RED tests: connected-only timeout; matching first rendered sets ready; wrong frame/revision/version cannot set ready; rejected callback reports render failure; unmount/reload revokes old ports; V1 connected remains usable; package with absent versions loads as V1.
- [ ] Run exact focused files on server; capture RED.
- [ ] Implement SDK awaited frame processing and disposal (prevent ack after disposal), startup errors sent through SDK where possible. Keep timeout 15 s and rate limit 120/s; do not reset timeout indefinitely on updates. Pin first outstanding frame token until acknowledged; snapshot updates after first render remain normal. Validate host snapshots using canonical wire before sending.
- [ ] Wrapper selects version from service's trusted record. Versioned source/origin/token checks at both hops; raw entry and CSP unchanged. UI shows V2 waiting/ready/failure and pending/history V1 旧格式. Upload failures show bounded issue file/path/suggestion.
- [ ] Run changed runtime/UI/host wrapper suites, template protocol tests, types/lint and bundle. Commit.

### Task 3: Bound author prompt and reproducible release

**Files:** scripts/developers/{generate,prepare-template,resources,standards.test}.mjs; public developers/{standards,app,content}.js and downloads; template tools/{validate,pack,release}.mjs, configs, metadata, docs and tests. Add scripts/developers/contract-generation.test.mjs and template release tests.

**Interfaces:** consume canonical documents/validator and trusted stripped optics from Task1; V2 SDK Task2. New authoritative archive `physicsos-experiment-template-v2.zip`, root folder same basename. `template-release.json` records format2, experimentId, URL, SHA256 and byte length. UI selector only supported contract convex-lens; task description separate optional text field.

- [ ] RED tests for unsupported prompt ID, same base instructions in display/download/template, manifest/schema canonical parity, malformed metadata parity, generated copies drift, stale dist cleanup, failed check stops release, ZIP hash/report matches bytes, secrets/symlinks excluded or rejected.
- [ ] `npm run release` executes check → build (clean) → validate:package → pack; pack direct command also invokes release so old shortcut cannot package stale dist. Split internal pack implementation from public command to avoid recursion. Pack only an explicit allowlist; emit release ZIP plus JSON report `{schemaVersion:2,experimentId,version,sha256,bytes,checks:[...]}` for actual completed steps. Avoid an unsigned report being treated as authority.
- [ ] Template validator calls canonical metadata, same resource/path checks as host where portable; preserve existing checks and explicitly identify host-only ZIP/auth checks. Use shared canonical rules for manifest, IDs, versions, units/cases/licenses. Install pinned zod4.4.3 dev dependency and update lockfile via server. TS source imports use .ts with rewriteRelativeImportExtensions in browser build to let Node24 tests/tools import shared modules reliably.
- [ ] Generate JSON schemas through Zod (including exact parameter constants) and real prompt from registered profile. Same generator for base AGENTS, display and downloaded bound prompt. External prompt includes actual immutable template URL+SHA, fixed contract fields, editable boundaries and release command. Template-internal AGENTS points to external trusted template-release descriptor for archive SHA (a ZIP cannot embed its own hash); base instructions remain identical. Do not interpolate user task text into schema/ID/code. Remove obsolete workflow claims and publish accurate protocol/metadata docs.
- [ ] Run downloaded standalone template npm ci and npm run release in Docker, local tooling suites there, generated --check, and host validate produced ZIP. Commit generated resources and lockfiles.

### Task 4: Full developer workflow acceptance and handoff

**Files:** new scripts/developers/package-contract-acceptance.mjs; docs/reports/2026-11-03-experiment-package-contract.md and screenshots as useful; update design/plan completion.

- [ ] Download actual served V2 template and prompt from rebuilt isolated candidate. Compare descriptor hash against bytes, extract and make a small visible view change + version bump from source, run release, and upload actual release ZIP as student.
- [ ] Verify actionable rejection for wrong unit/ID/protocol/missing resource. SUPER_ADMIN previews V2 first frame, exact frozen archive, approves. New session selects approved package, already-open/saved identity remains pinned, rollback changes default and retains newer history. Pending legacy V1 review remains covered by integration fixture/tests.
- [ ] Browser check desktop/mobile upload, prompt selection/copy/download, liquid-glass buttons, V2 error states, clean console. Use existing candidate-only home/model fixture; never production accounts/data. Store screenshots without credentials or capability URLs.
- [ ] Run final necessary focused tests/build checks once after integration changes; independently review diff and resolve material findings. Report actual verification and production-not-deployed status. Commit handoff; no main push or deployment.
