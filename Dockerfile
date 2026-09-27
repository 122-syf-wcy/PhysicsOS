# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.7.0-bookworm-slim

FROM ${NODE_IMAGE} AS builder

ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:${PATH}

RUN apt-get update \
    # python3/make/gcc/g++ compile the native packages that ship no Linux
    # prebuild: node-pty (only darwin/win32 binaries are published) and the
    # harness flock addon (`cc` builds the glibc Node-API module). Everything
    # else still installs with scripts disabled; both are built below.
    && apt-get install --yes --no-install-recommends ca-certificates git python3 make gcc g++ \
    && rm -rf /var/lib/apt/lists/* \
    # Install pnpm directly instead of through corepack: the PhysicsOS root pins
    # pnpm 11.9.0 while the vendored Harness pins 11.7.0, and a corepack-managed
    # pnpm refuses to serve the other version ("pnpm does not switch versions
    # when running under corepack"). A plain install resolves the pinned version
    # per directory, which is exactly what this two-version workspace needs.
    && npm install --global pnpm@11.9.0

WORKDIR /app
COPY . .

# The Docker context excludes VCS metadata. Initialize the pinned upstream tree
# so its patch can be applied with the same 3-way semantics as local bootstrap.
RUN git -C vendor/deepseek-harness init -q \
    && git -C vendor/deepseek-harness config user.email build@physicsos.local \
    && git -C vendor/deepseek-harness config user.name PhysicsOS-Build \
    && git -C vendor/deepseek-harness add -A \
    && git -C vendor/deepseek-harness commit -qm upstream-baseline

RUN node scripts/overlay/harness-overlay.mjs apply

# pnpm refuses when the invoked version differs from a project's pinned
# `packageManager`; the two trees here pin different versions on purpose, so the
# version check is downgraded to a warning for these installs only.
# node-pty publishes prebuilds for darwin/win32 only, so the Linux image has to
# compile it: allowlist exactly that one build script (inside the image only, so
# local macOS installs stay untouched), install with scripts enabled for the
# vendored tree, and rebuild the package explicitly.
RUN printf 'onlyBuiltDependencies:\n  - node-pty\n' >> vendor/deepseek-harness/pnpm-workspace.yaml \
    && pnpm install --frozen-lockfile \
    && pnpm -C vendor/deepseek-harness install --frozen-lockfile \
    && pnpm -C vendor/deepseek-harness rebuild node-pty

# The JSONL session backend takes its cross-process write lock through the
# native `flock` Node-API addon (@deepseek-ai/node-addon-system-<platform>-<arch>).
# Those platform packages are WORKSPACE members (native/system/packages/*) whose
# `bin/*.node` is gitignored build output: pnpm links the workspace directory
# as-is, so an image that skips this ships a platform package with no addon — and
# every new session's first durable write dies on a missing
# `…/linux-x64/bin/glibc/system.node`, leaving a bare session.lock and no
# transcript (the web host registers no console log exporter, so it fails
# silently). `build:native-system` is the harness's own `test` prerequisite.
# The trailing probe loads the addon and takes a real lock, so an image whose
# addon is missing or unloadable fails the BUILD instead of losing transcripts.
RUN pnpm -C vendor/deepseek-harness run build:native-system \
    && node --input-type=module -e "import {open} from 'node:fs/promises'; import {tryLockExclusive} from './vendor/deepseek-harness/native/system/packages/entry/lib/flock.js'; const h = await open('/tmp/flock-verify','w'); await tryLockExclusive(h.fd); await h.close(); console.log('native flock addon verified in image')"

RUN pnpm -C vendor/deepseek-harness run build:lib \
    && pnpm -C vendor/deepseek-harness --filter @deepseek-ai/dsh-health-host run bundle \
    && pnpm build \
    && rm -rf vendor/deepseek-harness/.git

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    DSH_HOME=/var/lib/physicsos \
    PHYSICSOS_STORAGE_BACKEND=postgres \
    PHYSICSOS_STORAGE_SCHEMA=physicsos \
    PHYSICSOS_SHARED_STATE_BACKEND=redis \
    DATABASE_URL_FILE=/run/secrets/database_url \
    REDIS_URL_FILE=/run/secrets/redis_url \
    DEEPSEEK_API_KEY_FILE=/run/secrets/deepseek_api_key \
    PHYSICSOS_ADMIN_PASSWORD_FILE=/run/secrets/admin_password \
    PHYSICSOS_IMAGE_API_KEY_FILE=/run/secrets/image_api_key \
    PHYSICOS_IMAGE_API_KEY_FILE=/run/secrets/image_api_key \
    PHYSICOS_TRUSTED_PROXIES="" \
    PHYSICSOS_SESSIONS_ROOT=/var/lib/physicsos/sessions \
    PHYSICSOS_PANDOC=/usr/bin/pandoc \
    PHYSICSOS_SOFFICE=/usr/bin/soffice \
    PHYSICSOS_DATABASE_SSL=false

# pandoc + LibreOffice 只在 runtime 安装：builder 阶段不需要它们，A4 导出也
# 不再是 docx 降级。fonts-noto-cjk 保证中文 PDF 不出现豆腐块。
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        pandoc \
        libreoffice-writer \
        fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system physicsos \
    && useradd --system --gid physicsos --home-dir /var/lib/physicsos physicsos \
    && install -d -o physicsos -g physicsos /var/lib/physicsos /app

WORKDIR /app

COPY --from=builder --chown=physicsos:physicsos /app/package.json ./package.json
COPY --from=builder --chown=physicsos:physicsos /app/node_modules ./node_modules
COPY --from=builder --chown=physicsos:physicsos /app/packages ./packages
COPY --from=builder --chown=physicsos:physicsos /app/vendor/deepseek-harness ./vendor/deepseek-harness
COPY --from=builder --chown=physicsos:physicsos \
    /app/overlays/harness/files/packages/physicsos/health-host \
    ./overlays/harness/files/packages/physicsos/health-host
COPY --from=builder --chown=physicsos:physicsos /app/scripts/healthcheck.mjs ./scripts/healthcheck.mjs
COPY --from=builder --chown=physicsos:physicsos /app/scripts/docker-entrypoint.mjs ./scripts/docker-entrypoint.mjs

USER physicsos

EXPOSE 3080
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "scripts/healthcheck.mjs", "http://127.0.0.1:3080/readyz"]

CMD ["node", "scripts/docker-entrypoint.mjs", \
    "node", "vendor/deepseek-harness/apps/cli/lib/bin.js", "web", \
    "--patch", "/app/overlays/harness/files/packages/physicsos/health-host/deployment.patch.yml", \
    "--port", "3080"]
