#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${repo_root}"

# Corepack cannot serve the two deliberately different pnpm pins in this
# repository. Install the root version directly, as the production Dockerfile
# does, and let pnpm resolve the vendor version from its packageManager field.
export COREPACK_ENABLE_STRICT=0
export PNPM_HOME="${PNPM_HOME:-${HOME}/.local/share/pnpm}"
export PATH="${PNPM_HOME}:${PATH}"

git submodule update --init --recursive
node scripts/overlay/harness-overlay.mjs apply

npm install --global --no-audit --no-fund pnpm@11.9.0
pnpm install --frozen-lockfile

# The upstream lefthook postinstall cannot run from a pinned submodule.
# Installing dependencies is sufficient for development; builds stay explicit.
pnpm -C vendor/deepseek-harness install --frozen-lockfile --ignore-scripts

test "$(pnpm --version)" = "11.9.0"
test "$(cd vendor/deepseek-harness && pnpm --version)" = "11.7.0"
