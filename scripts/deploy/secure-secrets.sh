#!/usr/bin/env bash
# Enforce the host-side ownership of every file-based Compose secret.
#
# Docker Compose may ignore service-level `uid`/`gid`/`mode` for `file:`
# secrets, so the source files are the authoritative place for the invariant:
#
#   physicsos:physicsos 0400
#
# The app container runs as uid/gid 999 (`physicsos`), and the Postgres/Redis
# entrypoints read the files as root before dropping privileges — all keep
# access. Root can always read the files, so backup/operations are unaffected.
# Every other identity (e.g. `docker compose exec -u 1000:1000 app`) is denied,
# which is what the P0 isolation audit asked for. This script is idempotent and
# refuses to leave a secret at a looser mode.
set -euo pipefail

PROJECT_DIR=${PHYSICSOS_DIR:-/opt/physicsos}
SECRET_UID=${PHYSICSOS_SECRET_UID:-999}
SECRET_GID=${PHYSICSOS_SECRET_GID:-999}
SECRET_MODE=${PHYSICSOS_SECRET_MODE:-0400}
VERIFY_UID=${PHYSICSOS_SECRET_VERIFY_UID:-1000}

fail() {
  printf 'secure-secrets: %s\n' "$*" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || fail 'run as root'
[[ "$SECRET_MODE" =~ ^0?[0-7]{3}$ ]] || fail "invalid PHYSICSOS_SECRET_MODE: $SECRET_MODE"
[[ -f "$PROJECT_DIR/compose.yml" ]] || fail "compose.yml not found under $PROJECT_DIR"
command -v python3 >/dev/null 2>&1 || fail 'python3 is required to read the composed secret file list'

cd "$PROJECT_DIR"

# Take the (mount name, source file) pairs from the composed configuration
# rather than hardcoding them: a secret added later cannot silently escape the
# invariant, and the in-container path is the mount name, not the file name.
# Emits `name<TAB>file<TAB>app-mounted` per secret, so the ownership pass covers
# every file while the read verification only probes what the app mounts.
mapfile -t secret_entries < <(
  docker compose config --format json |
    python3 -c '
import json, sys
config = json.load(sys.stdin)
secrets = config.get("secrets") or {}
app = ((config.get("services") or {}).get("app") or {}).get("secrets") or []
mounted = {entry.get("source") for entry in app if isinstance(entry, dict)}
for name, entry in sorted(secrets.items()):
    path = entry.get("file") if isinstance(entry, dict) else None
    if path:
        print(name, path, "yes" if name in mounted else "no", sep="\t")
'
)

(( ${#secret_entries[@]} > 0 )) || fail 'compose.yml declares no file-based secrets'

for entry in "${secret_entries[@]}"; do
  name=${entry%%$'\t'*}
  rest=${entry#*$'\t'}
  file=${rest%%$'\t'*}
  mounted=${rest#*$'\t'}
  [[ -f "$file" ]] || fail "secret file is missing: $file"
  chown "$SECRET_UID:$SECRET_GID" "$file"
  chmod "$SECRET_MODE" "$file"
  printf 'secure-secrets: %s -> %s %s\n' "$file" "$(stat -c '%u:%g' "$file")" "$(stat -c '%a' "$file")"
done

# Prove the invariant against the live container: the app identity can read
# every secret, and a non-999 identity cannot read any of them.
if [[ -n "$(docker compose ps -q app 2>/dev/null)" ]]; then
  verified=0
  for entry in "${secret_entries[@]}"; do
    rest=${entry#*$'\t'}
    name=${entry%%$'\t'*}
    mounted=${rest#*$'\t'}
    [[ "$mounted" == "yes" ]] || continue
    target=/run/secrets/$name
    docker compose exec -T app sh -c "test -r '$target'" ||
      fail "app (uid 999) cannot read $target"
    if docker compose exec -T -u "$VERIFY_UID:$VERIFY_UID" app sh -c "cat '$target' >/dev/null 2>&1" 2>/dev/null; then
      fail "uid $VERIFY_UID can still read $target — secret mode is too loose"
    fi
    verified=$((verified + 1))
  done
  (( verified > 0 )) || fail 'app service mounts no file-based secrets to verify'
  printf 'secure-secrets: verified app-readable and uid-%s-denied for %s secrets\n' \
    "$VERIFY_UID" "$verified"
else
  printf 'secure-secrets: app container not running; skipped read verification\n'
fi
