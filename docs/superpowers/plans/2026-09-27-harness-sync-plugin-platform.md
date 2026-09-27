# Harness Sync, Admin UI, and Plugin Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the pinned Harness release, unify the administrator UI, and ship a safe first-version plugin center without replacing PhysicsOS's product architecture.

**Architecture:** The root repository keeps the Harness submodule pinned. Upgrades run in isolation, reapply PhysicsOS overlays, and pass the full verification gate before promotion. Administrator UI and plugin catalog code live in PhysicsOS overlay packages so upstream changes cannot overwrite them.

**Tech Stack:** TypeScript, React, Cordis host plugins, PostgreSQL storage domains, pnpm, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-27-harness-sync-plugin-platform-design.md`

## Global Constraints

- Upgrade target: `dsh-v0.1.7-rc.2` (`477b4f420553e8a52c2fbccc464d7561b239c443`).
- Do not weaken account ownership, authentication, session isolation, or sandbox boundaries.
- Do not execute unsigned or unverified plugin code in the production container.
- Keep PhysicsOS-owned files under `overlays/harness/files`.
- Do not auto-deploy upstream `master`.
- Keep the production rollback image, a filesystem backup of the sessions root, and a database backup before promotion (see Task 6 Step 4).

## Review Focus

- A session owned by account A must remain invisible and immutable to account B after the upgrade.
- A plugin package incompatible with the pinned Harness version must remain disabled.
- A malformed or unsigned plugin manifest must never reach an executable entry point.
- Administrator tabs with zero rows must use the same empty-state geometry and controls.
- A production readiness failure must leave the previous image available and the service recoverable.

---

### Task 1: Prepare the Controlled Upgrade

**Files:**
- Modify: `vendor/deepseek-harness` submodule pointer
- Modify: `overlays/harness/upstream-changes.patch`
- Modify: `overlays/harness/files/**`

**Interfaces:**
- Consumes: the pinned submodule at `47f943859bef60e4160492346772ded9b24f765a`.
- Produces: a buildable submodule at `dsh-v0.1.7-rc.2` with PhysicsOS overlays reapplied.

Status: **done** on this branch. Submodule pinned at `477b4f42` (`dsh-v0.1.7-rc.2`) in `0a2a6b1`; build boundary in `37377a8`; 0.1.7 protocol migration and gate repair in `94cc797`.

- [x] **Step 1: Record the rollback revision and create an upgrade branch in the isolated worktree.**

Run: `git rev-parse HEAD && git submodule status`
Expected: the current root commit and the pinned Harness commit are printed.

- [x] **Step 2: Check out `dsh-v0.1.7-rc.2` inside the submodule and run overlay apply.**

Run: `git -C vendor/deepseek-harness checkout dsh-v0.1.7-rc.2 && node scripts/overlay/harness-overlay.mjs apply`
Expected: the overlay reports every PhysicsOS path and applies or reports the compatibility patch state.

- [x] **Step 3: Resolve upstream interface changes without changing PhysicsOS contracts.**

Keep account identity, storage-domain names, session ownership, model-pool provider routing, and physics tool names stable. Record every changed upstream interface in `docs/13-DEPLOYMENT-OPERATIONS.md`.

- [x] **Step 4: Run the focused compatibility suite.**

Run: `pnpm run typecheck && pnpm run lint && pnpm run test:agent`
Expected: all commands exit `0`; no isolation, model-pool, or composition test fails.

- [x] **Step 5: Commit the submodule pointer and compatibility changes.**

```bash
git add vendor/deepseek-harness overlays/harness docs/13-DEPLOYMENT-OPERATIONS.md
git commit -m "chore(harness): sync PhysicsOS on dsh 0.1.7 release"
```

### Task 2: Unify the Administrator Page Shell

**Files:**
- Modify: `overlays/harness/files/packages/client/ui-physicsos/src/client/AdminWorkspace.tsx`
- Modify: `overlays/harness/files/packages/client/ui-physicsos/src/client/AdminWorkspace.module.css`
- Modify: `overlays/harness/files/packages/client/ui-physicsos/src/client/Admin*Tab.tsx`
- Test: `overlays/harness/files/packages/client/ui-physicsos/tests/admin-shell.client.spec.tsx`

**Interfaces:**
- Consumes: the existing `AdminWorkspaceProps` and role-shaped tab list.
- Produces: shared `AdminPage`, `AdminToolbar`, `AdminStats`, `AdminCard`, `AdminEmpty`, and `AdminTable` primitives exported from an admin-local component module.

Status: **done** — commit `6b8b1ae`; focused client tests 46/46.

- [x] **Step 1: Write the failing shell test.**

Assert that each visible tab renders one page header, one tablist, one consistent content region, and no tab-local outer margin wrapper.

- [x] **Step 2: Run the test and verify it fails.**

Run: `pnpm -C vendor/deepseek-harness exec vitest run packages/client/ui-physicsos/tests/admin-shell.client.spec.tsx`
Expected: FAIL because the shared primitives do not exist.

- [x] **Step 3: Implement the primitives and migrate every administrator tab.**

Use a single max-width container, a 12/16/24 spacing scale, shared card radius, one toolbar shape, and one empty-state component. Do not change host API behavior.

- [x] **Step 4: Run the client tests.**

Run: `pnpm -C vendor/deepseek-harness exec vitest run packages/client/ui-physicsos/tests`
Expected: all tests pass.

- [x] **Step 5: Commit.**

```bash
git add overlays/harness/files/packages/client/ui-physicsos
git commit -m "feat(admin): unify administrator page layout"
```

### Task 3: Add the Official Plugin Catalog

**Files:**
- Create: `overlays/harness/files/packages/physicsos/plugin-center/package.json`
- Create: `overlays/harness/files/packages/physicsos/plugin-center/src/domain.ts`
- Create: `overlays/harness/files/packages/physicsos/plugin-center/src/catalog.ts`
- Create: `overlays/harness/files/packages/physicsos/plugin-center/src/index.ts`
- Create: `overlays/harness/files/packages/physicsos/plugin-center/tests/catalog.spec.ts`
- Modify: `scripts/overlay/harness-overlay.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: the pinned Harness package inventory and `dsh-v0.1.7-rc.2` version metadata.
- Produces: `PluginCenter.state()` and a read-only `/physicsos/plugins` state route with stable plugin ids, versions, compatibility, source, and status.

Status: **done** — commit `05c554a` (with Task 4); focused plugin-center suite 21/21.

- [x] **Step 1: Write the failing catalog test.**

Test that a known official plugin is present, that an incompatible version is marked `incompatible`, and that no entry includes an absolute filesystem path.

- [x] **Step 2: Run the test and verify it fails.**

Run: `pnpm -C vendor/deepseek-harness exec vitest run packages/physicsos/plugin-center/tests/catalog.spec.ts`
Expected: FAIL with `plugin-center` unresolved.

- [x] **Step 3: Implement the catalog and host route.**

Persist only administrator enable/disable state. Official packages remain installed from the pinned image; the catalog never downloads executable code at runtime.

- [x] **Step 4: Run focused tests.**

Run: `pnpm -C vendor/deepseek-harness exec vitest run packages/physicsos/plugin-center/tests`
Expected: all tests pass.

- [x] **Step 5: Commit.**

```bash
git add overlays/harness/files/packages/physicsos/plugin-center scripts/overlay/harness-overlay.mjs package.json
git commit -m "feat(plugins): add official plugin catalog"
```

### Task 4: Add PhysicsOS Plugin Manifests

**Files:**
- Create: `overlays/harness/files/packages/physicsos/plugin-center/src/manifest.ts`
- Create: `overlays/harness/files/packages/physicsos/plugin-center/tests/manifest.spec.ts`
- Create: `overlays/harness/files/packages/physicsos/plugin-center/plugins/manifest.json`

**Interfaces:**
- Consumes: catalog entries from Task 3.
- Produces: validated manifest entries with `id`, `version`, `harnessRange`, `capabilities`, `entry`, `publisher`, and `sha256`.

Status: **done** — commit `05c554a`; shipped manifest catalogs 12 preinstalled plugins under an Ed25519 signature and SHA-256 digests. Signing key rotated and re-verified in `bc080ed`.

- [x] **Step 1: Write failing manifest tests.**

Reject unsigned entries, unknown capabilities, duplicate ids, path traversal, missing digest, and a Harness range that excludes the pinned version.

- [x] **Step 2: Run the tests and verify they fail.**

Run: `pnpm -C vendor/deepseek-harness exec vitest run packages/physicsos/plugin-center/tests/manifest.spec.ts`
Expected: FAIL because validation is absent.

- [x] **Step 3: Implement schema validation and digest verification.**

Do not add a code-download path. The first release only describes preinstalled packages and their capabilities.

- [x] **Step 4: Run tests.**

Run: `pnpm -C vendor/deepseek-harness exec vitest run packages/physicsos/plugin-center/tests/manifest.spec.ts`
Expected: PASS.

- [x] **Step 5: Commit.**

```bash
git add overlays/harness/files/packages/physicsos/plugin-center
git commit -m "feat(plugins): validate PhysicsOS plugin manifests"
```

### Task 5: Add the Plugin Center Administrator Tab

**Files:**
- Create: `overlays/harness/files/packages/client/ui-physicsos/src/client/PluginCenterApi.ts`
- Create: `overlays/harness/files/packages/client/ui-physicsos/src/client/AdminPluginTab.tsx`
- Modify: `overlays/harness/files/packages/client/ui-physicsos/src/client/AdminWorkspace.tsx`
- Modify: `overlays/harness/files/packages/client/ui-physicsos/src/client/locales.ts`
- Test: `overlays/harness/files/packages/client/ui-physicsos/tests/admin-plugin.client.spec.tsx`

**Interfaces:**
- Consumes: `/physicsos/plugins` catalog state from Tasks 3 and 4.
- Produces: a `plugins` administrator tab with official/PhysicsOS source filters, compatibility status, capability disclosure, and enable/disable controls.

Status: **done** — commit `a4e0bf1`; focused 6/6 and admin regression 52/52.

- [x] **Step 1: Write the failing UI test.**

Assert that official and PhysicsOS groups render, incompatible plugins cannot be enabled, and capability labels are visible before activation.

- [x] **Step 2: Run the test and verify it fails.**

Run: `pnpm -C vendor/deepseek-harness exec vitest run packages/client/ui-physicsos/tests/admin-plugin.client.spec.tsx`
Expected: FAIL because `AdminPluginTab` does not exist.

- [x] **Step 3: Implement the tab and wire it into the administrator shell.**

The tab is SUPER_ADMIN-only and follows the shared admin primitives from Task 2.

- [x] **Step 4: Run client tests.**

Run: `pnpm -C vendor/deepseek-harness exec vitest run packages/client/ui-physicsos/tests`
Expected: all tests pass.

- [x] **Step 5: Commit.**

```bash
git add overlays/harness/files/packages/client/ui-physicsos
git commit -m "feat(plugins): add administrator plugin center"
```

### Task 6: Full Verification and Production Promotion

**Files:**
- Modify: `docs/13-DEPLOYMENT-OPERATIONS.md`
- Modify: `docs/reports/ISOLATION-AUDIT.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: a tested production image and explicit rollback evidence.

Status: **in progress — not done.** The four static gates pass at `94cc797` (see `docs/reports/BETA-LAUNCH-REPORT.md` §10), but the real-browser acceptance run and every production step below remain open.

- [ ] **Step 1: Run root verification.**

Run: `pnpm run typecheck && pnpm run lint && pnpm run test`
Expected: all commands exit `0`.

- [ ] **Step 2: Build the production image and start it against the isolated compose project.**

Run: `docker compose -p physicsos_upgrade build app && docker compose -p physicsos_upgrade up -d`
Expected: `app`, `postgres`, and `redis` become healthy and `/readyz` reports both dependencies `ok`.
Note: the host has roughly 23G free of 78G, enough for one image rebuild but not many. Prune superseded images (`docker image prune`) before building so the rebuild does not exhaust the disk.

- [ ] **Step 3: Run account isolation and model-pool smoke tests.**

Verify cross-account session denial, workspace ownership, model streaming, failover, and the expected public model identity.

- [ ] **Step 4: Record rollback image and backups (sessions root + PostgreSQL) before promotion.**

Tag the previous image; take a filesystem-level backup of the sessions root (`/var/lib/physicsos/sessions`) and a `pg_dump`; confirm both are readable — all before switching the primary compose project.

Why this is a hard precondition: the running deployment stores session logs in the oldest on-disk format (`{"type":"session","version":0,...}`). Harness 0.1.7 ships the `v0 → v1 → v2 → v3 → v4` migration chain (`packages/session/session-format-v0-to-v1` … `-v3-to-v4`, with `catalog-migration.ts` selecting `historicalSessionFormatCatalog` for `version <= 3`), so 0.1.7 migrates those logs forward in place. After promotion the previous release (rollback revision `14157e1`, submodule pinned at `47f9438`) would be reading already-migrated data. The rollback image is therefore only a true rollback **together with** the sessions-root + database backup taken before promotion. Do not down-convert in place on rollback; restore from the backup.

- [ ] **Step 5: Promote and commit the verified release.**

```bash
git add docs/13-DEPLOYMENT-OPERATIONS.md docs/reports/ISOLATION-AUDIT.md
git commit -m "docs: record synchronized Harness release verification"
```

---

## Deferred Items (recorded, not done)

These are known open items that are **not** completed by Tasks 1–5. They must stay visible until a later task closes them.

- **Deprecated `session.snapshotEvents()` migration.** In `overlays/harness/files/packages/physicsos/tool-physicsos/src/index.ts` (line ~195) and `src/invariant.ts` (line ~53), two call sites of the synchronous `session.snapshotEvents()` remain suppressed with `// oxlint-disable-next-line typescript/no-deprecated -- ... migration deferred.` rather than being migrated to the 0.1.7 async event API. This is a deferred migration, not a finished one.
- **No automatic upstream tracking.** PhysicsOS does not follow upstream `master`. This upgrade is the single controlled window from `47f943859bef60e4160492346772ded9b24f765a` to `dsh-v0.1.7-rc.2`. Afterwards only a "new version available" notice with a manual upgrade path is planned; see `docs/ROADMAP.md`.
- **Real-browser acceptance is not yet green.** `pnpm run test:acceptance` (`node tests/acceptance/glass-surfaces.mjs`) does not pass at the time of writing; it is a Task 6 gate and is owned by the web boot fix.
