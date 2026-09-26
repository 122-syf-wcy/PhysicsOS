# syntax=docker/dockerfile:1.7

ARG NODE_IMAGE=node:24.7.0-bookworm-slim

FROM ${NODE_IMAGE} AS builder

ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:${PATH}

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@11.9.0 --activate

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

RUN pnpm install --frozen-lockfile \
    && pnpm -C vendor/deepseek-harness install --frozen-lockfile --ignore-scripts

RUN pnpm -C vendor/deepseek-harness run build:lib \
    && pnpm exec tsc -p overlays/harness/files/packages/physicsos/health-host/tsconfig.json \
    && pnpm build \
    && rm -rf vendor/deepseek-harness/.git

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    DSH_HOME=/var/lib/physicsos

RUN groupadd --system physicsos \
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

USER physicsos

EXPOSE 3080
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD ["node", "scripts/healthcheck.mjs", "http://127.0.0.1:3080/readyz"]

CMD ["node", "vendor/deepseek-harness/apps/cli/lib/bin.js", "web", \
    "--patch", "/app/overlays/harness/files/packages/physicsos/health-host/deployment.patch.yml", \
    "--port", "3080"]
