#!/usr/bin/env bash
# Rebuild one workspace package (or a client bundle) so a local run picks up
# source edits.
#
# The web app resolves packages from `lib/`, so a source change is invisible
# until this runs. It applies the overlay first, because the overlay files are
# the source of truth and `lib/` is compiled from the vendored copy:
#
#   scripts/dev/rebuild-package.sh packages/physicsos/paper-host
#   scripts/dev/rebuild-package.sh packages/client/ui-physicsos --client
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
HARNESS="$ROOT/vendor/deepseek-harness"

PKG=${1:-}
[[ -n "$PKG" ]] || { echo 'usage: rebuild-package.sh <packages/group/name> [--client]' >&2; exit 1; }
MODE=${2:-}

case "$PKG" in
  packages/*/*) ;;
  *) echo "expected a workspace path like packages/physicsos/paper-host, got: $PKG" >&2; exit 1 ;;
esac

[[ -d "$HARNESS/$PKG" ]] || { echo "no such package in the vendored tree: $PKG" >&2; exit 1; }

echo "applying overlay → $HARNESS"
node "$ROOT/scripts/overlay/harness-overlay.mjs" apply >/dev/null

cd "$HARNESS"
echo "typecheck → $PKG"
node node_modules/typescript/bin/tsc -b "$PKG/tsconfig.json"

echo "bundle → $PKG"
npx tsdown --config "$PKG/tsdown.config.ts"

# A client package is consumed through the web bundle, not on its own.
if [[ "$MODE" == "--client" ]]; then
  name=$(node -e "process.stdout.write(require('./$PKG/package.json').name)")
  echo "web bundle → $name"
  pnpm --filter "$name" run bundle
fi

echo "rebuilt $PKG"
