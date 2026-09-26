# PhysicsOS Desktop

The Tauri 2 shell wraps the existing PhysicsOS web build. It does not fork the
business UI.

## Development

Initialize the Harness submodule, install the root workspace, then run:

```sh
git submodule update --init --recursive vendor/deepseek-harness
pnpm install
pnpm --dir apps/desktop dev
```

`tauri.conf.json` starts `pnpm --dir ../.. dev` and loads the Harness web UI at
`http://127.0.0.1:3080`.

## Local unsigned package

```sh
node scripts/desktop/package-local.mjs
```

The script removes Tauri, Apple, and Windows signing credentials from the child
environment and invokes `tauri build --debug --no-bundle`.

## Signed updates

The Rust shell registers `tauri-plugin-updater`. `update_check` checks the
configured `/physicsos/update/latest.json` endpoint and `update_install` accepts
only the exact version returned by that check. Tauri verifies the artifact
signature with the public key compiled into the app before installation.

Private updater keys, Apple notarization credentials, and Windows certificates
belong only in the release environment. They are not required for local builds.

## Controller wiring

`pnpm-workspace.yaml` currently excludes `apps/*`, so a controller must add the
desktop package to the root workspace and root verification scripts. The shell
also becomes active only after the shared client obtains
`createPlatformBridge('tauri')` and supplies `window.__TAURI__.core.invoke`.
