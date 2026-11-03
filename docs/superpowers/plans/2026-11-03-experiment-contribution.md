# Experiment Contribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. User explicitly authorized the upload/review/display loop; continue through verification without another design approval round.

**Goal:** A real upload, review, publish and rollback loop for convex-lens experiment files.

**Architecture:** Existing independent page and template, a new host plugin, immutable static assets, and a MessageChannel bridge to the real optics runtime. Package identity stays fixed for an open session.

**Tech Stack:** TypeScript, React, Three.js, Cordis, storage-domain, Node, server Docker, Vitest and Playwright.

**Spec:** docs/superpowers/specs/2026-11-03-experiment-contribution-design.md

## Global Constraints

- Build and test on 107.151.246.59 in isolated Docker only; never print secrets, cookies or complete environments.
- Production /opt/physicsos main 33023a2 and image 45c40254bef0 are the baseline; preserve later live changes before deployment.
- First supported upload target is convex-lens, browser-static / protocolVersion 1 / optics contractVersion 1 / renderer three / physicsos-warm-lab-v1.
- ZIP limit 20 MiB; expanded bytes 40 MiB; file bytes 20 MiB; file count 1000.
- All signed-in accounts may upload; only SUPER_ADMIN may publish/reject/rollback globally.
- Author fields: name (1–80 chars), bio (0–300), github (optional canonical https://github.com/username), optional avatarDataUrl (PNG/JPEG/WebP <=256 KiB), note <=500 chars.
- Pure 3D sample. No 2D switch or WebGL fallback to 2D. Package code never executes on the server.

## Review Focus

- Malicious ZIP names, duplicates, overflows and compressed bombs cannot escape limits or write outside package storage.
- A school admin or another contributor cannot read drafts or publish globally; no internal actor IDs in public metadata.
- Approval races, stale rollback and interrupted writes retain a valid immutable default and restart safely.
- An uploaded frame cannot read parent credentials, navigate the app, contact unrelated origins or keep sending commands after unmount.
- Changing defaults affects new sessions only; preview/cancel and observation history remain tied to engine facts.

## Task 1: Host intake, review, immutable assets and release state

**Files:** New overlays/harness/files/packages/physicsos/experiment-host/{src,tests,package.json,tsconfig.json,tsdown.config.ts}; root handles overlay/bundle registration separately.

**Interfaces:** REST prefix /physicsos/experiments. JSON errors {error:{code,message}}.

- GET /physicsos/experiments/convex-lens -> {active: PackageView|null, items: PackageView[], canReview:boolean}. items are own drafts + approved versions, or all for SUPER_ADMIN.
- POST /physicsos/experiments/convex-lens/packages with JSON {zipBase64,author:{name,bio?,github?,avatarDataUrl?},note?} -> 201 {item:PackageView}.
- GET /physicsos/experiments/packages/:id/preview -> {entryUrl:string} for owner/SUPER_ADMIN.
- POST /physicsos/experiments/packages/:id/review {action:'approve'|'reject',expectedSha256:string,reason?:string} -> {item:PackageView}.
- POST /physicsos/experiments/convex-lens/rollback {packageId:string,expectedActiveId:string} -> {item:PackageView}; only previously approved targets.
- PackageView has id, experimentId, version, sha256, status ('pending'|'approved'|'rejected'), author {name,bio?,github?,avatarUrl?}, note?, createdAt, publishedAt?, rejectionReason?, entryUrl? (approved only). No account/storage details.
- Asset prefix /physicsos/experiment-assets. Expose an assets handler separately as well as same-server registration, so a deployment can use a separate origin. Config assetOrigin optional. Every HTML response has mandatory sandbox and path-scoped CSP even opened directly. Pending asset URLs use expiring random capability path, released URLs use immutable package id/hash.

- [x] Write tests proving valid template ZIP intake, review and rollback, immutable digest, owner/admin visibility, authorization, CSRF/size/content-type, malformed archive classes, failed writes, restart restoration and active-state sequence.
- [x] Run failing tests in server container before implementation.
- [x] Implement validation, file storage, domain/service, route and Cordis plugin using notice-host patterns. A path named differently from its central ZIP entry must be rejected. Never run package scripts.
- [x] Run own complete suite and plugin typecheck; log exact commands and output. Commit only owned files.

## Task 2: Real physics bridge and contribution UI

**Files:** ui-physicsos/src/client/experiments/{contribution-api.ts,contribution-protocol.ts,ContributionPanel.tsx,ContributionPanel.module.css,CommunityExperimentFrame.tsx,ConvexLensPage.tsx}; associated tests; observation metadata if needed.

**Interfaces:** Task 1 REST contract. Snapshot sent to template is developer-kit/experiment-template/src/protocol.ts ExperimentSnapshot with source platform-engine; engine inspector values remain in cm. Allowed intents map objectDistanceCm/object-distance, focalLengthCm/focal-length, screenDistanceCm/screen-distance to session preview/commit/cancel. Reject unknown/out-of-range/nonfinite values.

- [x] Test mapping against real optics: f=10/u=30 yields v=15; u=f yields null; virtual images stay virtual; preview does not persist, cancel restores, commit once. Test invalid messages/source/channel and disposal.
- [x] Observe failing tests, then implement authenticated fetch client, sandbox frame, one-use handshake, timeout/reload and pinned release.
- [x] Add real ZIP/file metadata form and admin review panel, loading/errors, candidate preview using separate engine runtime, and confirmed stale-safe rollback. Author/GitHub/avatar and status are visible.
- [x] Make official lens sample default three-only; integrate published file without altering parameters/report/notebook or other experiments. Record package release in observation metadata.
- [x] Run relevant component/runtime tests and commit scoped files.

## Task 3: Composition, candidate and acceptance

**Files:** scripts/overlay/harness-overlay.mjs, overlays/harness/upstream-changes.patch, docs/developer content and generated downloads, tests/acceptance/experiment-contribution.mjs, deployment support and report.

- [x] Integrate old docs and page branches in isolated worktree; retain root uncommitted changes. Update AGENTS confirmed server address.
- [x] Register new host in real web bundle, workspace, TS project references and lock patch; add composition coverage for identity service resolved after host boot.
- [x] Build server candidate using current isolated dependency tree; boot with separate home/storage and ports, no production secrets or data.
- [x] Real browser lifecycle: upload served template ZIP, preview via sandbox, approve, fresh page automatic load, second version and pinned old session, rollback, denial of cross-account access, desktop/mobile screenshots and restart persistence.
- [x] Update documents to exact supported capability and generate matching downloads. Run required suites, lint/typecheck/build; report pre-existing failures precisely.
- [x] Fresh independent code review, fix important findings, verify final commit and present reviewable candidate. Deployment only after concrete candidate is ready and authorization resolved.
