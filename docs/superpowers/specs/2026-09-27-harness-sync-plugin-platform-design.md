# PhysicsOS Harness Sync and Plugin Platform Design

## Decision

PhysicsOS performs one controlled upgrade of its vendored DeepSeek Harness
instead of continuously tracking upstream `master`. The target is the latest
published release tag, `dsh-v0.1.7-rc.2`
(`477b4f420553e8a52c2fbccc464d7561b239c443`).

After the upgrade is validated and released, PhysicsOS pins the resulting
upstream commit. Later upgrades are deliberate maintenance windows, not
automatic production synchronization.

## Required Outcomes

1. The official Harness release is merged into the vendored tree.
2. PhysicsOS overlays and compatibility patches are reapplied.
3. Account isolation, session ownership, PostgreSQL persistence, Redis shared
   state, model-pool routing, physics tools, and the Web Client retain their
   existing contracts.
4. Typecheck, lint, tests, production builds, and container readiness pass
   before promotion.
5. Administrator tabs share one page, toolbar, card, form, table, and empty
   state system.
6. The plugin center lists supported official plugins from the pinned release
   and PhysicsOS plugins from a signed manifest.
7. Plugin installation is allowlisted, signature-checked,
   compatibility-checked, and constrained to declared capabilities. Arbitrary
   uploaded code never executes directly in the production container.

## Architecture

### Controlled Harness Synchronization

The root repository keeps `vendor/deepseek-harness` as a pinned submodule.
`overlays/harness/files` is the source of PhysicsOS-owned packages and assets.
`overlays/harness/upstream-changes.patch` is the compatibility patch against
the pinned revision.

Upgrades run in an isolated worktree:

1. Check out the target release in the submodule.
2. Reapply the PhysicsOS overlay.
3. Rebase the compatibility patch.
4. Resolve interface changes without weakening ownership, authentication, or
   sandbox boundaries.
5. Build and test the complete workspace.
6. Commit the submodule pointer and root-side compatibility changes.

Production receives only a tested image. The previous image and database
backup remain available for rollback.

### Administrator UI Consistency

Every administrator tab shares:

- one page header and horizontal tab strip;
- one summary/stat row when counts exist;
- one filter and bulk-action toolbar;
- one content region using a table, card list, or empty state;
- shared spacing, typography, focus, radius, and responsive rules.

Tab components remain independently testable but stop defining competing
outer page spacing and card systems.

### Plugin Center

The center has two catalogs:

- **Official catalog:** a generated inventory from the pinned Harness release,
  listing package identity, version, compatibility, activation state, and
  PhysicsOS support.
- **PhysicsOS catalog:** a signed manifest for plugins built for PhysicsOS,
  listing version, Harness range, capabilities, server/client entries,
  integrity digest, and publisher.

The first release supports preinstalled verified plugins and administrator
enable/disable controls. New third-party code requires a signed manifest and
explicit administrator installation. Plugins receive only declared
capabilities; unrestricted filesystem, process, and secret access are denied
by default.

## Failure Handling

- Upgrade build or test failure: discard the isolated worktree; production is
  unchanged.
- Production readiness failure: restore the previous image and preserve
  database migration state.
- Plugin integrity failure: refuse activation and write an audit event.
- Plugin compatibility failure: keep disabled and show required versus
  installed Harness ranges.

## Verification

Verification includes root typecheck, lint, core/web/agent/deploy/desktop
tests, host composition tests, account isolation, model-pool failover and
streaming, PostgreSQL and Redis readiness, production Web build, container
health, and rollback-image presence.

## Release Policy

The first public release uses the synchronized Harness revision and the
PhysicsOS product shell. There is no automatic upstream updater in
production. The administrator UI may show an informational upgrade notice,
but promotion is a deliberate operator action.
