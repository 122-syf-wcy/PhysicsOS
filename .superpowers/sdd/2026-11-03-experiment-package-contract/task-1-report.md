# Task 1 report — canonical contract and version-aware host intake

Status: DONE. Base: 8b37e1f. Source: isolated worktree `/Users/dongsiwei/.codex/worktrees/experiment-contribution/PhysicsOS`. All execution, tests, formatting and builds ran inside the existing `physicsos-experiments-build` container on `root@107.151.246.59`; local changes are source/Git only. No production container, account, data, deployment, main branch or submodule pointer changes.

## Implementation

- Added canonical dependency-free `contract-wire.ts`, portable Zod `contract-v2.ts` and trusted host `contract-optics.ts`.
- Fixed V2 manifest and exact parameter schemas; bounded teaching/cases/licenses; all five required optical zones and every extra case evaluated by the platform engine; safe exact or directory-wildcard resource/notice coverage.
- JSON decode limit is 256 KiB per fixed document; invalid UTF-8/JSON, unknown or modified fields, invalid units and uncovered resources fail safely. Diagnostics cap at 20 and sanitize schema paths, use fixed messages/suggestions, never echo submitted values or unknown property names.
- Confirmed controller interface additions: `isSnapshot(value: unknown, options: {allowFixture?: boolean} = {})` defaults to platform-engine only. SDK/local tools must explicitly allow fixture source. `evaluateCaseWithOptics` lives in portable contract-v2; `evaluateCase` wraps it with host-owned `@physicsos/engine-optics`.
- Controller corrected initial brief's positive real-image heights to signed platform output before implementation: required heights -2/-4/-8/null/+8. Adapter converts cm to SI metres, then signs image height from engine orientation and image distance from image nature; tolerance is 1e-7 cm absolute plus 1e-9 relative. No duplicated lens equation.
- `validateArchive(bytes, {allowLegacy?: boolean} = {})` rejects new V1 intake with PACKAGE_UPGRADE_REQUIRED; frozen verification explicitly allows the unchanged V1 manifest parser. ZIP/CRC/local-header/descriptor/path/size/resource/importmap guards remain active. Added only exact safe root eslint.config.mjs/prettier.config.mjs filenames to preserve reproducible release checks.
- Public views return schemaVersion/protocolVersion; records persist the optional matched pair, infer V1 only when both are absent, reject malformed/mismatched pairs, and compare frozen ZIP versions during review/preview/rollback verification. Authentication, sequence/default publication and recovery tests remain green.
- REST includes safe issue fields. README describes V2 rules and retained V1 behavior.
- Dependency declared with existing root-link pattern; host references tsconfig.physicsos. Overlay lock patch adds the engine link importer. The existing server build install received a symlink for that declared root package (no local installation or broad dependency reinstall).
- Generator uses only Node built-ins and reads canonical bytes, so no incidental root/global Zod resolver is needed. It emits five marked consumers: SDK wire, tool wire/metadata, UI wire, and stripped trusted platform-optics.mjs. Generated files and local applied host/UI copies are synchronized.

## RED evidence

Transferred only scoped source/tests with `COPYFILE_DISABLE=1 tar --no-xattrs`, scp and docker cp/tar. Commands below ran with Docker cwd `/app/vendor/deepseek-harness` on the confirmed server:

1. `node_modules/.bin/vitest run packages/physicsos/experiment-host/tests/archive.spec.ts packages/physicsos/experiment-host/tests/contract-v2.spec.ts` — expected RED: 2 files failed; archive 13 failed / 28 passed; new canonical import missing and V2 archive/diagnostic support absent. Remote log `/tmp/task1-red.log`.
2. `node_modules/.bin/vitest run packages/physicsos/experiment-host/tests` — expected RED with added migration/REST/root-config tests: 6 files failed / 1 passed, 38 failed / 43 passed; missing canonical suite plus V2 intake failures reached service, routes and recovery. Remote log `/tmp/task1-red-suite.log`.

Initial GREEN attempt found three named failures: `accepts complete metadata and engine-evaluated cases` used exact float equality for -10.000000000000002/+8.000000000000002 (assertions corrected to numeric tolerance), `downloads the exact frozen review ZIP only for its owner or SUPER_ADMIN, even after approval` had obsolete intentionally invalid V1 metadata (fixture now keeps valid V2 metadata and distinct review notes), and `scans 400 KB of unmatched script openings within a bounded subprocess` could not resolve the newly declared optics package before its link existed (declared link installed in existing build container). All three passed in the full GREEN suite.

## GREEN and completion checks

- `node_modules/.bin/vitest run packages/physicsos/experiment-host/tests` — **7 files, 112 tests passed**, including real Cordis composition, ZIP/security tests, signed optics, metadata failures, V1 approval/rejected reupload/history/rollback, matched/half-pair persistence and integrity mismatch. Duration 29.99s; remote log `/tmp/task1-green-final.log`.
- `node node_modules/typescript/bin/tsc -b packages/physicsos/experiment-host/tsconfig.json` — exit 0; remote log `/tmp/task1-types.log`.
- `pnpm --filter @deepseek-ai/dsh-experiment-host bundle` — final exit 0, tsc and tsdown successful; three host JS artifacts, 66.12 kB total. Remote log `/tmp/task1-bundle-final.log`.
- `node_modules/.bin/oxlint packages/physicsos/experiment-host` — final **0 warnings, 0 errors** on 21 files; remote log `/tmp/task1-lint-verified.log`. Earlier lint errors were unsafe dynamic test `any`, Vitest matcher assignment types, one unnecessary type parameter and formatting; changed tests use narrowed unknown values and all errors were resolved. Server's root Prettier was used, then harness oxlint --fix applied its different arrow/indent style.
- From Docker cwd `/app`: `node scripts/developers/generate-contract.mjs` followed by `node scripts/developers/generate-contract.mjs --check` — generated and verified **5 files**, repeated after final canonical formatting/type-only cleanup.
- Source/Git integrity: `git apply --numstat overlays/harness/upstream-changes.patch` parses the modified lock patch. The first staged whitespace check found that Node stripTypeScriptTypes preserves spaces where type declarations were removed; the shell continued into an unpublished commit despite that failed check. Generator output now normalizes each line with trimEnd; server generator --check and final git diff --check/git diff --cached --check were rerun successfully before amending that commit. No local tests/builds/installations were run.

No unresolved test failures. Test runner emits existing vite-tsconfig-paths notices, pnpm reports irrelevant non-Linux native platform packages, and Node prints its ExperimentalWarning for built-in stripTypeScriptTypes; these are warnings, not validation failures. Verification covered the entire owned host package and real composition, not the unrelated thousands of upstream Harness packages.

## Self-review and handoff

Checked final canonical schemas, signed adapter and tolerance, bounded diagnostics, immutable archive integrity/version verification, V1 parser preservation, optional-pair migration, resource/path/license guards, generated byte parity, declared dependency/lock/reference, scoped staging and source/Git status. Generated template tooling's pinned Zod install and release/JSON-schema runtime integration are Task 3; V2 runtime first-frame protocol is Task 2 and was not implemented here. Root AGENTS.md remains excluded from release-source host allowlist as before; if Task 3 packages it, add that exact safe name there in coordination. License checking is structural only and is not legal ownership certification. No deployment performed.

Owned files: experiment-host README/package/tsconfig; src/{contract-wire,contract-v2,contract-optics,archive,domain,identity,routes,service}; tests/{contract-v2,archive,fixtures,routes,service}; scripts/developers/generate-contract.mjs; five generated copies listed above; overlays/harness/upstream-changes.patch importer change; this report. Controller's design/plan edits and vendor pointer are excluded from commit.
