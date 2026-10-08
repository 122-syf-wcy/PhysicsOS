# Full backup and isolated restore drill

The full backup command captures one recovery set: PostgreSQL custom archive,
Redis persistence, the complete `/var/lib/physicsos` volume (including session
files), every resolved Compose file secret, image identities/revision labels,
row/session counts, and SHA-256 checksums. The `.pbackup` file uses streamed
AES-256-GCM with a fresh nonce; metadata and secrets are inside authenticated
ciphertext. The encryption key is a separate recovery requirement.

Prerequisites: Node 24, Docker Engine with Compose v2 (`up --wait` support), host
`tar`, enough private disk space for temporary plaintext data and archive, and
access to the recorded images. Run as the deployment operator with Docker access
and permission to read Compose secrets. Do not enable shell tracing. The commands
do not contact model APIs.

## Create and retain a recovery set

Create the backup encryption key once, outside the deployment checkout and
backup destination. Retain a second protected copy separately; losing it makes
backups unrecoverable. This is a new backup key, not a replacement for the stable
`model_pool_secret` already used by the app.

```sh
sudo install -d -m 0700 /etc/physicsos /var/backups/physicsos/full
sudo sh -c 'umask 077; test ! -e /etc/physicsos/backup.key && openssl rand -hex 32 > /etc/physicsos/backup.key'
sudo node /opt/physicsos/scripts/deploy/backup-full.mjs \
  --project-dir /opt/physicsos \
  --output /var/backups/physicsos/full/2026-10-08T120000Z.pbackup \
  --key-file /etc/physicsos/backup.key \
  --offsite-dir /mnt/offsite/physicsos
```

Use a unique output filename each run. Output and offsite files are never
overwritten. The optional offsite directory should be an independently managed
mounted backup destination; the command copies ciphertext and verifies its
checksum, but does not establish the mount or retention policy. Verify the mount
before scheduling. Success prints only artifact paths, encrypted-file checksum
and non-secret recovery counts.

PostgreSQL must already be running. The command records running services, stops
the app, flushes and stops Redis when it was running, and captures the stores
while app writes are quiesced. It resumes only services it stopped, in Redis→app
order, even when capture fails or receives Ctrl-C/SIGTERM. It does not start an
app that was already stopped. Restart failure is fatal and identifies the
service requiring operator attention. An exclusive project-directory lock rejects
concurrent backups. The application must be the only writer; stop external
writers before capture.

Plaintext staging is private and removed on success/failure. A host crash,
SIGKILL or power loss cannot run cleanup: inspect original service states,
recover them using the original Compose project, and remove abandoned
`.physicsos-backup-work-*` / `.physicsos-backup-lock` only after confirming no
backup process is active. Treat staging as sensitive data. PostgreSQL-only
`backup-postgres.sh` is insufficient to recover model keys, Redis and sessions.

## Restore a fresh isolated project

Use a new `physicsos-restore-*` project, an empty target directory and a loopback
HTTP port different from production 3080. Existing labelled containers, volumes
and networks and colliding unlabelled volume/network names are refused. An
atomic Docker container reservation prevents concurrent restores sharing a name.

```sh
sudo node /opt/physicsos/scripts/deploy/restore-full.mjs \
  --artifact /var/backups/physicsos/full/2026-10-08T120000Z.pbackup \
  --key-file /etc/physicsos/backup.key \
  --target-dir /var/lib/physicsos-drills/2026-10-08 \
  --project physicsos-restore-20261008 \
  --port 13080 \
  --readiness-timeout-ms 120000
```

Authentication and manifest checks run before Docker resource creation. Restore
creates a new Compose JSON with isolated volumes/network, no build configuration,
a localhost-only HTTP mapping and an internal network without external egress.
PostgreSQL and Redis have no host ports. Production commands, bind mounts,
network names and port mappings are not copied. Database/Redis URL secrets point
to restored service DNS names; the selected Redis database is preserved. Model
encryption/admin/provider secrets stay byte-for-byte intact.

Published images can be pulled using the recorded repository digest. An
unpublished local image has only a local content ID: transfer it separately via
`docker save`/`docker load` before restoring on a new host. Backups contain image
identity and OCI revision labels, not image layers or a source checkout.

Before app startup, restore compares all PostgreSQL table row counts and session
file counts, and locally decrypts every stored model-pool key using the preserved
master secret. Plaintext credentials are discarded and never printed. An absent
model-key table yields count 0; no provider request is made. Redis must start and
answer an authenticated ping. Redis expiration deadlines continue aging, so old
sessions may expire during a drill. The app must pass `/readyz` by the deadline.

Success leaves `compose.restore.json`, private file secrets and
`restore-report.json` with counts, decrypted-key count, image identity and endpoint.
Review the report and [open the local drill](http://127.0.0.1:13080), or use an SSH
tunnel. Check a known teacher/student account, a persisted question/paper and
session history. Registration is closed and outbound networking disabled in the
drill; provider requests are expected to be unavailable.

Failed imports, count/decryption checks and readiness deadlines tear down only
resources created for the new project and remove decrypted staging. Private
target config/secrets remain for diagnosis; retry with a new empty target. A
Docker cleanup failure is reported as failure and requires inspection. Never
rename the project to production or point its volumes at production data.

After accepting the drill, remove its resources explicitly:

```sh
sudo docker compose \
  --project-directory /var/lib/physicsos-drills/2026-10-08 \
  --project-name physicsos-restore-20261008 \
  --file /var/lib/physicsos-drills/2026-10-08/compose.restore.json \
  down --volumes --remove-orphans
```

Retain the non-secret report with release evidence; dispose of private drill
secrets under the operator's retention policy. Production cutover is separate:
the command has no in-place production restore mode.

## Automated checks and limits

```sh
node --test scripts/deploy/backup-full.test.mjs
```

Tests replace only external Docker commands. They exercise real tar archives,
a streamed 1 MiB encryption round trip, ciphertext tampering, authenticated
archives with invalid manifest checksums, encrypted offsite copies, service
recovery, interrupted capture, project refusal/reservation and import/readiness
failure cleanup. Model-key checks use real HKDF/AES-GCM fixture credentials.

A disposable PostgreSQL drill can separately verify `pg_dump`, `pg_restore --list`,
restore and row-count SQL. Run a real Docker recovery on a host with a daemon and
recorded application images before declaring a recovery-time objective met.
Unit tests and a PostgreSQL-only drill do not prove container startup, Redis AOF
replay, secret ownership on that host or the restored browser journey.

## Schedule full encrypted backups

Set `PHYSICSOS_BACKUP_KEY_FILE` to a private, stable encryption key file before running `scripts/deploy/install-operations.sh`. The installer then schedules `backup-scheduled.mjs` daily at 02:15 in the server timezone; local encrypted archives are retained for 14 days after successful capture. `PHYSICSOS_BACKUP_OFFSITE_DIR` enables a verified copy to a separately mounted off-host destination. Preserve the encryption key outside the backup host. Without this setting the installer explicitly retains the existing PostgreSQL-only schedule; it does not claim complete backup coverage. No production schedule is changed by committing these files.

Full-backup scheduling requires host Node.js >=24.7; the installer verifies it before changing the system and pins the resolved executable path in cron. Ordinary deployment readiness uses the application container's bundled Node and does not require host Node.
