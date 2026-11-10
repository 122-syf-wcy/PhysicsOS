#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
MODE="${1:-debug}"
if (( $# > 0 )); then shift; fi
case "$MODE" in
  debug) tasks=(:app:assembleDebug) ;;
  verify) tasks=(:app:lintDebug :app:testDebugUnitTest :app:assembleDebug) ;;
  release) tasks=(:app:validateReleaseSigning :app:lintRelease :app:testReleaseUnitTest :app:assembleRelease :app:bundleRelease) ;;
  benchmark-apks) tasks=(:app:assembleBenchmarkRelease :benchmark:assembleBenchmarkRelease) ;;
  write-locks) tasks=(:app:dependencies :benchmark:dependencies --write-locks) ;;
  *)
    printf '%s\n' 'Usage: scripts/android/build.sh [debug|verify|release|benchmark-apks|write-locks] [Gradle options]' \
      'Run inside the server toolchain. Device tests/profile generation require a separate authorized device executor.' >&2
    exit 64
    ;;
esac
exec bash "${SCRIPT_DIR}/gradle.sh" "${tasks[@]}" "$@"
