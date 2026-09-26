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

`build:local` deliberately uses the committed `web/` fallback. That page is a
development smoke target, not a release artifact.

```sh
pnpm run desktop:build
```

The command removes Tauri, Apple, and Windows signing credentials from the child
environment and invokes `tauri build --debug --no-bundle`. On macOS it emits:

```text
apps/desktop/src-tauri/target/debug/physicsos-desktop
```

## macOS installer

Build a real release frontend, bundled Node sidecar, and unsigned DMG on macOS:

```sh
pnpm --dir apps/desktop run build:release -- --unsigned --bundles app,dmg
```

The installer is written under:

```text
apps/desktop/src-tauri/target/<rust-target>/release/bundle/dmg/
```

`--unsigned` disables updater artifacts and passes `--no-sign` to Tauri. The
result is not Developer ID signed or notarized. On first launch, macOS
Gatekeeper may block it. Either Control-click the app and choose **Open**, then
confirm through **System Settings > Privacy & Security > Open Anyway**, or
remove the quarantine attribute after copying it to Applications:

```sh
xattr -dr com.apple.quarantine /Applications/PhysicsOS.app
```

Verify the downloaded checksum before using this workaround for a distributed
unsigned build.

## Release package

Release builds use the shared Harness frontend, not `web/`. The packaging script
builds `@deepseek-ai/dsh-web-frontend`, verifies
`vendor/deepseek-harness/apps/web/dist/index.html`, copies it to
`apps/desktop/web-release/`, packages the sidecar, and invokes Tauri with
`frontendDist = "../web-release"`.

At runtime, the release shell starts the packaged Harness `web` host on a
loopback port, waits for its readiness line, and navigates the main window to
that origin. This is what injects `window.__DSH_BOOT__` and its client plugin
manifest. The static `web-release/` copy remains part of the bundle, while the
window is hidden until the host is ready.

Provide the production updater public key and endpoint through the environment:

```sh
export PHYSICSOS_DESKTOP_UPDATE_PUBKEY='<production minisign public key>'
export PHYSICSOS_DESKTOP_UPDATE_ENDPOINT='https://updates.physicsos.app/physicsos/update/latest.json?channel=stable'
pnpm run desktop:release
```

Alternatively, copy `release.config.example.json` to
`apps/desktop/release.config.json`, replace both updater fields, and keep the
file out of git. `PHYSICSOS_DESKTOP_RELEASE_CONFIG` can point at another file.
Environment values win over the file.

Release validation is a hard gate:

```sh
pnpm run desktop:release-config
```

It rejects the committed development key, the `physicsos.dev` placeholder host,
non-HTTPS endpoints, and a release build that still points at `web/`.

Bundles are written under:

```text
apps/desktop/src-tauri/target/<rust-target>/release/bundle/
```

The bundler can be narrowed explicitly:

```sh
# macOS
pnpm --dir apps/desktop run build:release -- --target aarch64-apple-darwin --bundles app,dmg

# Windows (run on Windows)
pnpm --dir apps/desktop run build:release -- --target x86_64-pc-windows-msvc --bundles nsis,msi
```

Without updater or code-signing secrets, prepend `--unsigned`. The release
script disables updater artifacts and does not require production updater
credentials. With all production updater secrets present, it creates signed
updater artifacts and keeps the normal strict release validation.

## Application icon

The release icon source was generated with the requested
`gpt-image-2.5-sunburst` image model from a PhysicsOS atom/electric-spark brief.
The committed source is:

```text
apps/desktop/design/app-icon-source-sunburst.png
```

Regenerate the platform assets after changing the source:

```sh
pnpm --dir apps/desktop exec tauri icon design/app-icon-source-sunburst.png
```

The image client reads the provider URL, model, key, prompt, and output path
from environment variables; the key is never written to the repository or the
manifest.

## Agent sidecar

Build and collect the sidecar before a release:

```sh
pnpm run desktop:sidecar
```

This runs the Harness host build, deploys `@deepseek-ai/dsh` with a hoisted
dependency tree, copies the vendored Cordis packages plus the PhysicsOS
bridge entry, and writes:

```text
apps/desktop/src-tauri/resources/agent-sidecar/sidecar.json
apps/desktop/src-tauri/resources/agent-sidecar/runtime/lib/bin.js
apps/desktop/src-tauri/resources/agent-sidecar/runtime/sidecar/bridge.mjs
apps/desktop/src-tauri/resources/agent-sidecar/runtime/node
```

The generated runtime is several hundred megabytes and is intentionally ignored
by git. Tauri bundles the directory as `agent-sidecar/`. The Rust shell resolves
`sidecar.json` from Tauri's resource directory first, falls back to the source
resource directory during development, and retains
`PHYSICSOS_AGENT_SIDECAR` as an explicit executable override.

The manifest's main `args` still launch the Harness `web` host. `sidecarArgs`
launches the bridge as the agent process:

```sh
<resource-dir>/agent-sidecar/runtime/node <resource-dir>/agent-sidecar/runtime/lib/bin.js
<resource-dir>/agent-sidecar/runtime/node <resource-dir>/agent-sidecar/runtime/sidecar/bridge.mjs
```

Packaging downloads the checksum-pinned official Node 24.21.0 runtime for the
target platform and places it at `runtime/node` or `runtime/node.exe`. The
manifest invokes that relative executable, so the app does not depend on Node
being installed or on `PATH`. The archive URL, platform, version, and SHA-256
are recorded at `runtime/node-runtime.json`.

Windows packaging must run on Windows so pnpm deploys the target-specific
native optional dependencies. The workflow builds NSIS and MSI installers on
the Windows runner and exercises the bundled `node.exe` smoke path. The bundled
Node runtime, signing, installation, and first-launch behavior still require
validation on a real Windows host; macOS cannot execute `node.exe`.

## CI installers

`.github/workflows/desktop-release.yml` runs for `v*` tags and manual
dispatches. It builds macOS arm64, macOS x86_64, and Windows x86_64 NSIS/MSI
installers, then uploads the packages and any updater `.sig` files as workflow
artifacts. Missing signing secrets select an unsigned build rather than failing.

| Secret                               | Purpose                                         |
| ------------------------------------ | ----------------------------------------------- |
| `PHYSICSOS_DESKTOP_UPDATE_PUBKEY`    | Tauri updater public key trusted by the app     |
| `PHYSICSOS_DESKTOP_UPDATE_ENDPOINT`  | HTTPS `latest.json` endpoint                    |
| `TAURI_SIGNING_PRIVATE_KEY`          | Tauri updater private key                       |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Updater key password, if encrypted              |
| `APPLE_CERTIFICATE`                  | Base64-encoded Developer ID Application `.p12`  |
| `APPLE_CERTIFICATE_PASSWORD`         | `.p12` password                                 |
| `APPLE_SIGNING_IDENTITY`             | Developer ID Application identity               |
| `APPLE_ID`                           | Apple notarization account                      |
| `APPLE_PASSWORD`                     | Apple app-specific password                     |
| `APPLE_TEAM_ID`                      | Apple team ID                                   |
| `WINDOWS_CERTIFICATE`                | Base64-encoded Windows code-signing certificate |
| `WINDOWS_CERTIFICATE_PASSWORD`       | Windows certificate password                    |
| `WINDOWS_CERTIFICATE_THUMBPRINT`     | Optional certificate thumbprint                 |

The updater public key, endpoint, and private key must all be present to enable
signed updater artifacts. macOS still requires the Apple certificate and
identity for code signing; Windows requires either the encoded certificate or
a certificate thumbprint.

### Agent bridge protocol

The Rust allowlist and 120-second unary request timeout are unchanged. The
bridge emits a `ready` event with protocol version `1`; `TauriSidecarRpc.start`
waits for that handshake before returning. The manifest stays at version `1`.

The bridge connects to the local `dsh web` host at
`PHYSICSOS_HARNESS_URL` (default `http://127.0.0.1:38971`). On every request the
Tauri shell reads the current `physicsos_session` cookie from the main WebView
and adds it to the sidecar params under a reserved field. The bridge strips that
field before mapping the request, never logs it, and never writes it to disk.

Implemented methods:

- `session/create` calls the real `session.create` RPC, stores the returned
  session id, and returns the `PhysicsAgentSession` view the adapter expects.
- `session/send` opens the account-scoped `/api/events.mux` WebSocket, queues
  one text prompt through `session.prompt`, and streams text/tool/terminal
  events tagged with a generated run id.
- `run/cancel` calls the real `session.cancel` RPC and emits one terminal
  `run_failed` event with code `RUN_CANCELLED`.
- `run/resume` reattaches to a run that is still active in this bridge process.
  It does not replay completed history: an unknown or finished run fails with
  `RUN_NOT_RESUMABLE`.

The bridge fails closed for inputs the Harness prompt wire cannot represent:
attachments return `UNSUPPORTED_ATTACHMENTS`; scene/question/model-policy
metadata returns `UNSUPPORTED_SESSION_CONTEXT`; Harness questions and approval
prompts return a terminal `SIDECAR_INTERACTION_UNSUPPORTED` event and cancel the
run. `scene_changed`, `observation_changed`, and `verification_completed` are
PhysicsOS domain events, not Harness events, so the sidecar does not fabricate
them.

Run the bridge tests with:

```sh
node --test apps/desktop/sidecar/bridge.test.mjs
node --test apps/desktop/sidecar/bridge.live.test.mjs
```

The live test starts a temporary local `dsh web`, injects a local OpenAI-
compatible mock model, authenticates an admin, and asserts a real
`session.create` plus one prompt turn through the bridge.

## Updater key rotation

Generate a new production key outside the repository:

```sh
pnpm --dir apps/desktop exec tauri signer generate -w ~/.tauri/physicsos-updater.key
```

Store the printed public key in the release environment or release config. Store
the private key and password only in the release secret manager. A new public
key changes the trust root, so the first release carrying it must be distributed
through an existing trusted build; subsequent updates use the new key.

Release signing also needs `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. macOS distribution needs an Apple
Developer ID certificate plus notarization credentials; Windows distribution
needs its code-signing certificate. Publish the signed `.sig` and matching
`latest.json` to the configured endpoint after all platform artifacts exist.
