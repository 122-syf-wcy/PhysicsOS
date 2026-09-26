#!/usr/bin/env bash
# Create and verify one PostgreSQL custom-format backup.
set -euo pipefail

PROJECT_DIR=${PHYSICSOS_DIR:-/opt/physicsos}
BACKUP_ROOT=${PHYSICSOS_BACKUP_DIR:-"$PROJECT_DIR/backups/postgres"}
RETENTION_DAYS=${PHYSICSOS_BACKUP_RETENTION_DAYS:-14}
POSTGRES_SERVICE=${PHYSICSOS_POSTGRES_SERVICE:-postgres}
STAMP=${PHYSICSOS_BACKUP_STAMP:-"$(date -u +%Y%m%dT%H%M%SZ)"}
BACKUP_DIR="$BACKUP_ROOT/$STAMP"
DUMP_FILE="$BACKUP_DIR/postgres.dump"
PARTIAL_FILE="$BACKUP_DIR/postgres.dump.partial"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { printf 'backup-postgres: %s\n' "$*" >&2; exit 1; }

[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || fail 'PHYSICSOS_BACKUP_RETENTION_DAYS must be a non-negative integer'
[[ -f "$PROJECT_DIR/compose.yml" ]] || fail "compose.yml not found under $PROJECT_DIR"

umask 077
install -d -m 0700 "$BACKUP_ROOT" "$BACKUP_DIR"
[[ ! -e "$DUMP_FILE" ]] || fail "backup already exists: $DUMP_FILE"

compose=(docker compose --project-directory "$PROJECT_DIR")
cleanup() {
  rm -f -- "$PARTIAL_FILE" "$BACKUP_DIR/postgres.list.partial"
}
trap cleanup EXIT

log "dumping PostgreSQL to $DUMP_FILE"
"${compose[@]}" exec -T "$POSTGRES_SERVICE" sh -c '
  PGPASSWORD="$(cat /run/secrets/postgres_password)" pg_dump \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=custom \
    --no-owner \
    --no-acl
' >"$PARTIAL_FILE"

[[ -s "$PARTIAL_FILE" ]] || fail 'pg_dump produced an empty archive'

log 'validating archive table of contents with pg_restore --list'
postgres_image="$("${compose[@]}" ps -q "$POSTGRES_SERVICE" |
  xargs -r docker inspect --format '{{.Config.Image}}')"
[[ -n "$postgres_image" ]] || fail 'could not resolve the PostgreSQL image'
docker run --rm --network none \
  -v "$BACKUP_DIR:/backup:ro" \
  --entrypoint pg_restore \
  "$postgres_image" --list /backup/postgres.dump.partial \
  >"$BACKUP_DIR/postgres.list.partial"
[[ -s "$BACKUP_DIR/postgres.list.partial" ]] || fail 'pg_restore --list produced no table of contents'

mv "$PARTIAL_FILE" "$DUMP_FILE"
mv "$BACKUP_DIR/postgres.list.partial" "$BACKUP_DIR/postgres.list"
(
  cd "$BACKUP_DIR"
  sha256sum postgres.dump >postgres.dump.sha256
)

{
  printf 'created_at=%s\n' "$STAMP"
  printf 'host=%s\n' "$(hostname)"
  printf 'project_dir=%s\n' "$PROJECT_DIR"
  printf 'postgres_service=%s\n' "$POSTGRES_SERVICE"
  printf 'archive=postgres.dump\n'
  printf 'verified_with=pg_restore --list\n'
  cat "$BACKUP_DIR/postgres.dump.sha256"
} >"$BACKUP_DIR/manifest.txt"

if ((RETENTION_DAYS > 0)); then
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d \
    -name '20??????T??????Z' -mtime "+$RETENTION_DAYS" \
    ! -path "$BACKUP_DIR" -print0 |
    while IFS= read -r -d '' old_backup; do
      log "removing expired backup $old_backup"
      rm -rf -- "$old_backup"
    done
fi

trap - EXIT
log "backup complete: $BACKUP_DIR"
