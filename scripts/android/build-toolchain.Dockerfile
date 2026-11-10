# syntax=docker/dockerfile:1.7
# Build on the server only, after checking available disk/memory. The context is
# scripts/android, not the entire repository; no source tree or secrets enter it.
# Official Temurin tag/digest queried 2026-11-10. Android Linux tools are amd64.
FROM eclipse-temurin:17.0.21_9-jdk-jammy@sha256:057a0daec60e87c96571bf5c9c7792065bcb19e804d584cd37d4144038a35717

SHELL ["/bin/bash", "-euo", "pipefail", "-c"]

ENV ANDROID_HOME=/opt/android-sdk \
    GRADLE_HOME=/opt/gradle/gradle-8.13 \
    GRADLE_USER_HOME=/home/android/.gradle \
    ANDROID_USER_HOME=/home/android/.android \
    PHYSICSOS_ANDROID_TOOLCHAIN=1 \
    PHYSICSOS_ANDROID_PROJECT_DIR=/workspace/apps/android
ENV PATH="${GRADLE_HOME}/bin:${ANDROID_HOME}/cmdline-tools/22.0/bin:${ANDROID_HOME}/platform-tools:${PATH}"

# Versions and publisher checksums are immutable. Google publishes SHA-1 for
# SDK package archives in repository2-1.xml; command-line tools also have the
# Studio download table's SHA-256. Gradle publishes SHA-256 for its distribution.
RUN test "$(uname -m)" = x86_64 \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p "${ANDROID_HOME}/cmdline-tools" "${ANDROID_HOME}/platforms" "${ANDROID_HOME}/build-tools" /opt/gradle /tmp/android-tools \
    && curl --fail --location --retry 4 --connect-timeout 30 --max-time 900 \
       https://dl.google.com/android/repository/commandlinetools-linux-15859902_latest.zip -o /tmp/android-tools/cmdline.zip \
    && printf '%s\n' '4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583  /tmp/android-tools/cmdline.zip' | sha256sum --check --strict \
    && unzip -q /tmp/android-tools/cmdline.zip -d /tmp/android-tools/cmdline \
    && mv /tmp/android-tools/cmdline/cmdline-tools "${ANDROID_HOME}/cmdline-tools/22.0" \
    && curl --fail --location --retry 4 --connect-timeout 30 --max-time 900 \
       https://dl.google.com/android/repository/platform-36_r02.zip -o /tmp/android-tools/platform.zip \
    && printf '%s\n' '2c1a80dd4d9f7d0e6dd336ec603d9b5c55a6f576  /tmp/android-tools/platform.zip' | sha1sum --check --strict \
    && unzip -q /tmp/android-tools/platform.zip -d /tmp/android-tools/platform \
    && mv "$(find /tmp/android-tools/platform -mindepth 1 -maxdepth 1 -type d)" "${ANDROID_HOME}/platforms/android-36" \
    && curl --fail --location --retry 4 --connect-timeout 30 --max-time 900 \
       https://dl.google.com/android/repository/build-tools_r36_linux.zip -o /tmp/android-tools/build-tools.zip \
    && printf '%s\n' 'b0b6376977657e8ad9b969bacf4093601da2c6fb  /tmp/android-tools/build-tools.zip' | sha1sum --check --strict \
    && unzip -q /tmp/android-tools/build-tools.zip -d /tmp/android-tools/build-tools \
    && mv "$(find /tmp/android-tools/build-tools -mindepth 1 -maxdepth 1 -type d)" "${ANDROID_HOME}/build-tools/36.0.0" \
    && curl --fail --location --retry 4 --connect-timeout 30 --max-time 900 \
       https://dl.google.com/android/repository/platform-tools_r37.0.1-linux.zip -o /tmp/android-tools/platform-tools.zip \
    && printf '%s\n' '477254aa5f903c15cf51001717bdf347fb6b53e0  /tmp/android-tools/platform-tools.zip' | sha1sum --check --strict \
    && unzip -q /tmp/android-tools/platform-tools.zip -d "${ANDROID_HOME}" \
    && curl --fail --location --retry 4 --connect-timeout 30 --max-time 900 \
       https://downloads.gradle.org/distributions/gradle-8.13-bin.zip -o /tmp/android-tools/gradle.zip \
    && printf '%s\n' '20f1b1176237254a6fc204d8434196fa11a4cfb387567519c61556e8710aed78  /tmp/android-tools/gradle.zip' | sha256sum --check --strict \
    && unzip -q /tmp/android-tools/gradle.zip -d /opt/gradle \
    && printf 'y\n%.0s' {1..100} > /tmp/android-tools/license-answers \
    && sdkmanager --sdk_root="${ANDROID_HOME}" --licenses < /tmp/android-tools/license-answers > /tmp/android-tools/licenses.log \
    && test -f "${ANDROID_HOME}/platforms/android-36/android.jar" \
    && test -x "${ANDROID_HOME}/build-tools/36.0.0/aapt2" \
    && test -x "${ANDROID_HOME}/platform-tools/adb" \
    && rm -rf /tmp/android-tools /root/.android "${ANDROID_HOME}/.temp" \
    && groupadd --gid 10001 android \
    && useradd --uid 10001 --gid android --create-home --shell /bin/bash android \
    && mkdir -p /workspace /home/android/.gradle /home/android/.android \
    && chown -R android:android /home/android /workspace

COPY --chmod=0755 gradle.sh prepare-wrapper.sh build.sh /usr/local/bin/
USER android
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/gradle.sh"]
CMD [":app:assembleDebug"]
