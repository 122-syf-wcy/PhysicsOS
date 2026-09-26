#!/usr/bin/env bash
# Install the host-side backup and SSH brute-force protections used in production.
set -euo pipefail

PROJECT_DIR=${PHYSICSOS_DIR:-/opt/physicsos}
BACKUP_SCRIPT="$PROJECT_DIR/scripts/deploy/backup-postgres.sh"
CRON_FILE=/etc/cron.d/physicsos-postgres-backup
LOGROTATE_FILE=/etc/logrotate.d/physicsos-postgres-backup
FAIL2BAN_JAIL=/etc/fail2ban/jail.d/physicsos-sshd.local
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CONFIG_BACKUP_ROOT=/var/backups/physicsos-operations/$STAMP

[[ "$(id -u)" -eq 0 ]] || {
  printf 'install-operations: run as root\n' >&2
  exit 1
}
[[ -x "$BACKUP_SCRIPT" ]] || {
  printf 'install-operations: backup script not executable: %s\n' "$BACKUP_SCRIPT" >&2
  exit 1
}

backup_existing() {
  local path=$1
  local target="$CONFIG_BACKUP_ROOT$path"
  if [[ -e "$path" ]]; then
    install -d -m 0700 "$(dirname "$target")"
    cp -a -- "$path" "$target"
  fi
}

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq cron fail2ban logrotate

backup_existing "$FAIL2BAN_JAIL"
install -d -m 0755 "$(dirname "$FAIL2BAN_JAIL")"
cat >"$FAIL2BAN_JAIL.tmp" <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
chmod 0644 "$FAIL2BAN_JAIL.tmp"
mv "$FAIL2BAN_JAIL.tmp" "$FAIL2BAN_JAIL"

backup_existing "$CRON_FILE"
cat >"$CRON_FILE.tmp" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""
15 2 * * * root PHYSICSOS_DIR=$PROJECT_DIR $BACKUP_SCRIPT >>/var/log/physicsos-postgres-backup.log 2>&1
EOF
chmod 0644 "$CRON_FILE.tmp"
mv "$CRON_FILE.tmp" "$CRON_FILE"

backup_existing "$LOGROTATE_FILE"
cat >"$LOGROTATE_FILE.tmp" <<'EOF'
/var/log/physicsos-postgres-backup.log {
  su root root
  weekly
  rotate 8
  compress
  delaycompress
  missingok
  notifempty
  create 0600 root root
}
EOF
chmod 0644 "$LOGROTATE_FILE.tmp"
mv "$LOGROTATE_FILE.tmp" "$LOGROTATE_FILE"

install -d -m 0700 "$PROJECT_DIR/backups/postgres"

# Re-assert the secret ownership invariant on every operations pass: the files
# are the only place it can live (Compose ignores uid/gid/mode for `file:`
# secrets), and a re-created secret would otherwise come back 0600 root and
# either break the app's boot or be world-readable.
if [[ -x "$PROJECT_DIR/scripts/deploy/secure-secrets.sh" ]]; then
  "$PROJECT_DIR/scripts/deploy/secure-secrets.sh"
fi

systemctl enable --now cron fail2ban
systemctl restart cron fail2ban
for attempt in {1..30}; do
  if fail2ban-client ping >/dev/null 2>&1; then
    break
  fi
  if ((attempt == 30)); then
    printf 'install-operations: fail2ban control socket did not become ready\n' >&2
    exit 1
  fi
  sleep 1
done
fail2ban-client status sshd

sshd -t
ssh_effective="$(sshd -T)"
grep -q '^passwordauthentication no$' <<<"$ssh_effective" || {
  printf 'install-operations: PasswordAuthentication is not disabled\n' >&2
  exit 1
}
grep -q '^kbdinteractiveauthentication no$' <<<"$ssh_effective" || {
  printf 'install-operations: KbdInteractiveAuthentication is not disabled\n' >&2
  exit 1
}

(
  cd "$PROJECT_DIR"
  docker compose config --quiet
)

printf 'install-operations: cron, fail2ban, backup directory, SSH checks, and Compose config are ready\n'
