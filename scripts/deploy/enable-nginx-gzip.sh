#!/usr/bin/env bash
# Enable response compression on the PhysicsOS reverse proxy.
#
# The stock Ubuntu nginx.conf leaves `gzip_types` commented out, which means
# only text/html is compressed — the client plugin bundles (the product UI is
# ~5.5 MB of JavaScript) crossed the wire uncompressed. This script flips the
# commented gzip directives on in the host-owned nginx.conf. It is idempotent
# and leaves a backup before the first change.
#
# Measured effect (2026-09-30): a 40,330-byte plugin chunk served as 11,210
# bytes (‑72%) once enabled.
#
#   scripts/deploy/enable-nginx-gzip.sh
set -euo pipefail

CONF=${PHYSICSOS_NGINX_CONF:-/etc/nginx/nginx.conf}

if grep -q '^gzip_types ' "$CONF"; then
  echo "gzip_types already active in $CONF — nothing to do"
  exit 0
fi

cp "$CONF" "$CONF.bak-gzip"

sed -i \
  -e 's|^[[:space:]]*# gzip_vary on;|gzip_vary on;|' \
  -e 's|^[[:space:]]*# gzip_proxied any;|gzip_proxied any;|' \
  -e 's|^[[:space:]]*# gzip_comp_level 6;|gzip_comp_level 6;|' \
  -e 's|^[[:space:]]*# gzip_http_version 1.1;|gzip_http_version 1.1;|' \
  -e 's|^[[:space:]]*# gzip_types \(.*\);|gzip_types \1 application/wasm image/svg+xml;|' \
  "$CONF"

# gzip_min_length is not present in the stock file at all.
grep -q '^gzip_min_length ' "$CONF" || sed -i '/^gzip_comp_level 6;/a gzip_min_length 1024;' "$CONF"

nginx -t
systemctl reload nginx
echo "compression enabled (backup: $CONF.bak-gzip)"
