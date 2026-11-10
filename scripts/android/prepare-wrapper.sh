#!/usr/bin/env bash
# Generate only the official wrapper JAR; no project plugin resolution or SDK install.
set -euo pipefail
if [[ "$(uname -s)" != Linux || "${PHYSICSOS_ANDROID_TOOLCHAIN:-}" != 1 ]]; then
  printf '%s\n' 'Generate the wrapper inside the server Android toolchain, not on the editing machine.' >&2
  exit 78
fi
if (( $# != 0 )); then
  printf '%s\n' 'prepare-wrapper.sh takes no arguments.' >&2
  exit 64
fi
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_DIR="${PHYSICSOS_ANDROID_PROJECT_DIR:-${SCRIPT_DIR}/../../apps/android}"
GRADLE_VERSION=8.13
GRADLE_SHA256=20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78
WRAPPER_SHA256=81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f
GRADLE_COMMAND="${GRADLE_HOME:-/opt/gradle/gradle-${GRADLE_VERSION}}/bin/gradle"
TARGET="${PROJECT_DIR}/gradle/wrapper/gradle-wrapper.jar"
if [[ ! -x "$GRADLE_COMMAND" || ! -f "${PROJECT_DIR}/settings.gradle.kts" ]]; then
  printf '%s\n' 'The locked Gradle 8.13 toolchain and writable Android checkout are required.' >&2
  exit 78
fi
if [[ -e "$TARGET" ]]; then
  actual="$(sha256sum "$TARGET")"
  if [[ "${actual%% *}" == "$WRAPPER_SHA256" ]]; then
    printf '%s\n' 'Official Gradle 8.13 wrapper JAR is already verified.'
    exit 0
  fi
  printf '%s\n' 'An existing wrapper JAR has an unexpected checksum; refusing to overwrite it.' >&2
  exit 78
fi

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TEMP_DIR"' EXIT
printf '%s\n' 'rootProject.name = "PhysicsOSWrapperBootstrap"' > "${TEMP_DIR}/settings.gradle.kts"
"$GRADLE_COMMAND" --project-dir "$TEMP_DIR" --no-daemon --max-workers=1 --console=plain \
  -Dorg.gradle.jvmargs='-Xmx256m -XX:MaxMetaspaceSize=256m -Dfile.encoding=UTF-8' \
  wrapper --gradle-version "$GRADLE_VERSION" --distribution-type bin \
  --gradle-distribution-sha256-sum "$GRADLE_SHA256" --network-timeout 120000
actual="$(sha256sum "${TEMP_DIR}/gradle/wrapper/gradle-wrapper.jar")"
if [[ "${actual%% *}" != "$WRAPPER_SHA256" ]]; then
  printf '%s\n' 'Generated wrapper JAR did not match Gradle’s published SHA-256 checksum.' >&2
  exit 78
fi
install -m 0644 "${TEMP_DIR}/gradle/wrapper/gradle-wrapper.jar" "$TARGET"
printf '%s\n' 'Official Gradle 8.13 wrapper JAR generated and SHA-256 verified.'
