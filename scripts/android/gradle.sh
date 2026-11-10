#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != Linux || "${PHYSICSOS_ANDROID_TOOLCHAIN:-}" != 1 ]]; then
  printf '%s\n' 'Android builds run only in the server Android toolchain container.' \
    'This launcher does not install a local JDK, SDK, Gradle, or emulator.' >&2
  exit 78
fi

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_DIR="${PHYSICSOS_ANDROID_PROJECT_DIR:-${SCRIPT_DIR}/../../apps/android}"
if [[ "${1:-}" == prepare-wrapper ]]; then
  shift
  exec bash "${SCRIPT_DIR}/prepare-wrapper.sh" "$@"
fi
if [[ ! -f "${PROJECT_DIR}/settings.gradle.kts" || ! -f "${PROJECT_DIR}/gradlew" ]]; then
  printf '%s\n' 'Mount the PhysicsOS checkout and set PHYSICSOS_ANDROID_PROJECT_DIR to its Android project.' >&2
  exit 78
fi
if [[ ! -f "${ANDROID_HOME:?ANDROID_HOME must be supplied by the toolchain}/platforms/android-36/android.jar" ||
      ! -d "${ANDROID_HOME}/build-tools/36.0.0" ]]; then
  printf '%s\n' 'The locked Android 36 platform and build-tools 36.0.0 are missing from this image.' >&2
  exit 78
fi
for argument in "$@"; do
  case "$argument" in
    --scan|--debug|-d)
      printf '%s\n' 'Build scans and debug logging are disabled in this credential-bearing build workflow.' >&2
      exit 64
      ;;
  esac
done

# Plain output, one worker, no persistent daemon; compiler shares Gradle's heap.
# Secret values are passed only through protected mounts or inherited env vars.
exec sh "${PROJECT_DIR}/gradlew" --project-dir "${PROJECT_DIR}" \
  --no-daemon --max-workers=1 --console=plain \
  -Dorg.gradle.configuration-cache=false -Dorg.gradle.java.installations.auto-download=false "$@"
