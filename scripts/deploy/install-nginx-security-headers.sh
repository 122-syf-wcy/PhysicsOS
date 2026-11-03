#!/usr/bin/env bash
# Add the browser-security headers used by the public PhysicsOS reverse proxy.
#
# The TLS terminator is host-owned, so this is intentionally limited to one
# nginx server file. It is idempotent and leaves a backup before every change.
#
#   PHYSICSOS_NGINX_SITE=/etc/nginx/sites-available/physicsos \
#     scripts/deploy/install-nginx-security-headers.sh
set -euo pipefail

SITE=${PHYSICSOS_NGINX_SITE:-/etc/nginx/sites-available/physicsos}
SERVER_NAME=${PHYSICSOS_NGINX_SERVER_NAME:-physics.dongsiwei.com}
MODE=${PHYSICSOS_HSTS_MODE:-enforce}

fail() {
  printf 'install-nginx-security-headers: %s\n' "$*" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || fail 'run as root'
command -v nginx >/dev/null 2>&1 || fail 'nginx is not installed'
[[ -f "$SITE" ]] || fail "nginx site not found: $SITE"
[[ "$SERVER_NAME" =~ ^[A-Za-z0-9.-]+$ ]] || fail "invalid server name: $SERVER_NAME"
case "$MODE" in
  enforce) HSTS_MAX_AGE=31536000 ;;
  report) HSTS_MAX_AGE=300 ;;
  *) fail "PHYSICSOS_HSTS_MODE must be enforce or report, got: $MODE" ;;
esac

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="/var/backups/physicsos-operations/$STAMP/nginx-$SERVER_NAME"
install -d -m 0700 "$(dirname "$BACKUP")"
cp -a -- "$SITE" "$BACKUP"

# The marker makes this safe to run after Certbot edits the file. The Python
# edit is line-oriented so comments and unknown nginx directives survive.
SITE="$SITE" SERVER_NAME="$SERVER_NAME" HSTS_MAX_AGE="$HSTS_MAX_AGE" python3 - <<'PY'
import os
import re
import sys
from pathlib import Path

path = Path(os.environ["SITE"])
server_name = os.environ["SERVER_NAME"]
max_age = os.environ["HSTS_MAX_AGE"]
text = path.read_text()

lines = [
    "# BEGIN PhysicsOS security headers",
    f'add_header Strict-Transport-Security "max-age={max_age}; includeSubDomains" always;',
    'add_header X-Content-Type-Options "nosniff" always;',
    'add_header X-Frame-Options "DENY" always;',
    'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    'add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;',
    "# END PhysicsOS security headers",
]
marker_start = "# BEGIN PhysicsOS security headers"
marker_end = "# END PhysicsOS security headers"
out = []
i = 0
inserted = 0
while i < len(text.splitlines()):
    line = text.splitlines()[i]
    if line.strip() == marker_start:
        while i < len(text.splitlines()) and text.splitlines()[i].strip() != marker_end:
            i += 1
        i += 1
        continue
    out.append(line)
    if re.fullmatch(rf"\s*server_name\s+{re.escape(server_name)}\s*;", line):
        indent = line[: len(line) - len(line.lstrip())]
        out.extend(f"{indent}{entry}" for entry in lines)
        inserted += 1
    i += 1

if inserted == 0:
    print(f"no server_name {server_name} block found in {path}", file=sys.stderr)
    raise SystemExit(1)

path.write_text("\n".join(out) + "\n")
print(f"physicsos security headers installed in {inserted} server block(s)")
PY

# Two things one flat header block cannot express:
#
#   1. The paper workbench previews exported PDFs in an <iframe> on this same
#      origin, so those responses need SAMEORIGIN while everything else keeps
#      DENY. nginx replaces the inherited add_header set for a matched
#      location, so the location restates all five headers.
#   2. Certbot's managed blocks sit outside the security-header markers, so a
#      marker rewrite alone leaves this location stranded on re-runs.
#
# The block below is wrapped in its own markers for the same reason: re-running
# replaces it instead of appending a second copy.
SITE="$SITE" SERVER_NAME="$SERVER_NAME" HSTS_MAX_AGE="$HSTS_MAX_AGE" python3 - <<'PY'
import os
import re
import sys
from pathlib import Path

path = Path(os.environ["SITE"])
max_age = os.environ["HSTS_MAX_AGE"]
text = path.read_text()

start_marker = "# BEGIN PhysicsOS paper-preview location"
end_marker = "# END PhysicsOS paper-preview location"

# Drop any previous copy first, wherever it sits.
lines = text.splitlines()
kept, skipping = [], False
for line in lines:
    if line.strip() in {start_marker, "# BEGIN PhysicsOS experiment locations"}:
        skipping = True
        continue
    if line.strip() in {end_marker, "# END PhysicsOS experiment locations"}:
        skipping = False
        continue
    if not skipping:
        kept.append(line)

block = [
    start_marker,
    "location ~ ^/physicsos/paper/jobs/[^/]+/files/ {",
    "    proxy_pass http://127.0.0.1:3080;",
    "    proxy_http_version 1.1;",
    "    proxy_set_header Host $host;",
    "    proxy_set_header X-Real-IP $remote_addr;",
    "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "    proxy_set_header X-Forwarded-Proto $scheme;",
    "    proxy_set_header X-Forwarded-Host $host;",
    "",
    f'    add_header Strict-Transport-Security "max-age={max_age}; includeSubDomains" always;',
    '    add_header X-Content-Type-Options "nosniff" always;',
    '    add_header X-Frame-Options "SAMEORIGIN" always;',
    '    add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
    '    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;',
    "    proxy_read_timeout 300s;",
    "}",
    end_marker,
    "# BEGIN PhysicsOS experiment locations",
    "location ^~ /physicsos/experiments/ {",
    "    client_max_body_size 32m;",
    "    proxy_pass http://127.0.0.1:3080;",
    "    proxy_http_version 1.1;",
    "    proxy_set_header Host $host;",
    "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
    "    proxy_set_header X-Forwarded-Proto $scheme;",
    "    proxy_read_timeout 120s;",
    "}",
    "location ^~ /physicsos/experiment-assets/ {",
    "    proxy_pass http://127.0.0.1:3080;",
    "    proxy_http_version 1.1;",
    "    proxy_set_header Host $host;",
    "    proxy_set_header X-Forwarded-Proto $scheme;",
    '    proxy_set_header Cookie "";',
    "    proxy_hide_header Set-Cookie;",
    "    # The host supplies package-scoped CSP + sandbox on every document.",
    "    # Own add_header rules suppress inherited X-Frame-Options DENY.",
    f'    add_header Strict-Transport-Security "max-age={max_age}; includeSubDomains" always;',
    '    add_header X-Content-Type-Options "nosniff" always;',
    '    add_header Referrer-Policy "no-referrer" always;',
    '    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;',
    "}",
    "# END PhysicsOS experiment locations",
]

# Insert as the last directive of the TLS server block. Walk forward, tracking
# brace depth from the `server {` that owns a `listen 443`, and splice the block
# before the brace that closes it at depth zero.
depth = 0
in_tls = False
inserted = False
for idx, line in enumerate(kept):
    stripped = line.strip()
    if not in_tls and re.match(r"^server\s*\{", stripped):
        window = "\n".join(kept[idx:idx + 14])
        if "listen 443" in window:
            in_tls = True
            depth = 1
            continue
    if in_tls:
        if "{" in stripped:
            depth += stripped.count("{")
        if "}" in stripped:
            depth -= stripped.count("}")
            if depth == 0:
                kept[idx:idx] = block
                inserted = True
                break

if not inserted:
    print(f"could not locate the https server block in {path}", file=sys.stderr)
    raise SystemExit(1)

path.write_text("\n".join(kept) + "\n")
print("physicsos paper-preview location installed")
PY

nginx -t
systemctl reload nginx
printf 'install-nginx-security-headers: mode=%s backup=%s\n' "$MODE" "$BACKUP"
