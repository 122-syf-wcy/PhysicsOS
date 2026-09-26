# @deepseek-ai/dsh-update-host

PhysicsOS 更新通道 host plugin. One prefix (`/physicsos/update`), split by who may call it — the split is deliberate:

| Surface | Who reads | Who writes |
| --- | --- | --- |
| `GET /latest.json` | anyone — the desktop updater calls it before login, with no cookie | — |
| `GET /channels` | — | super admin |
| `GET /releases/:channel` | — | super admin |
| `POST /releases/:channel` | — | super admin (publish) |
| `POST /releases/:channel/:version/rollback` | — | super admin |
| `POST /releases/:channel/:version/yank` | — | super admin |

`latest.json` answers in the Tauri updater shape, narrows by `?channel=` (`stable` | `beta`) and `?platform=` (e.g. `darwin-aarch64`), and carries `cache-control: public, max-age=60` — publishing is not a per-minute event. Serving the signature publicly is safe by design: signatures exist for every client to verify, not to keep secret.

Three rules carry real weight, and each exists because the obvious implementation gets it wrong:

1. **Signatures must look like real signatures.** `looksLikeSignature` refuses empty strings, placeholder words, and repeated-character input. The server cannot verify a signature — only the client's embedded public key can — but it must refuse to host something that is obviously not one: an unsigned artifact inside `latest.json` is how "log and continue" updater bugs ship.
2. **Rollback is a pointer, not a delete.** The channel's `activeVersion` moves back to an older release; every release row stays, so "did we ever publish 0.2.0" always answers.
3. **Yank keeps the row.** `yankedAt` stops that version being served; the row stays visible in the console listing.

Identity comes from the session through the `physicsosIdentity` service that `auth-host` publishes. This host is declared BEFORE `auth-host` in the shipped patch, so the service is resolved per request rather than at load time — a missing identity service answers 503 on every guarded route rather than failing open. `tests/composition.spec.ts` boots the real chain and rolls back over a live wire.

## Configuration

No config keys. The plugin injects `webServer` and `storageDomain`, and opens the `physicsos_update` domain.

## Data

`releases` holds one row per published version, keyed `channel|version` — re-publishing the same version is a conflict, never an overwrite. `channels` holds one row per channel; its only job is the `activeVersion` pointer, which exists so that rollback is a move rather than a reconstruction. Every write files an audit event under the acting super admin.

## Verification

- `tests/routes.spec.ts` — the rules over a real http server with a stubbed identity (27 cases: public `latest.json` reads, version/signature/artifact-url shape gates, the super-admin floor, rollback and yank semantics, the missing-identity 503, and the audit trail).
- `tests/composition.spec.ts` — the real cordis chain, proving the gate is armed rather than merely present, and that rollback moves the pointer over a live session.

## Model Experience

None, as the package serves browser and desktop-updater REST surfaces and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The server never verifies signatures — `looksLikeSignature` is a shape gate, not a check. Trust terminates at the client's embedded public key; a compromised publish path can still host a correctly-shaped bad signature, which the updater then rejects at install time.
- Artifacts are referenced by URL, not hosted: this package serves the manifest (`latest.json`), not the binaries.
- No staged rollout — a channel's `activeVersion` flips for every client at once; percentage rollout needs a selection rule this table does not carry.
- Channels are fixed to `stable` and `beta` in the domain; adding a third is a code change, not a config key.
