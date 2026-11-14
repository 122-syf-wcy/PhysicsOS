# Syntax: docker/dockerfile:1
#
# Isolated browser-acceptance worker for generated question-code experiments.
#
# Why a separate image: the app image must never launch Chromium against
# student-authored JavaScript. This image holds one browser and one purpose.
# It receives only public candidate assets and engine snapshots, holds no
# account cookie, session, model key or storage credential, and answers with
# observations the app re-checks before publishing anything.
#
# Frame planning: when the caller does not pin frames, the worker builds them
# from the persisted scene with the Lab's own viewport runtime, so the drawn
# frame is compared against the same facts the student sees. That runtime
# imports `@physicsos/*` by package name; the build compiles those packages to
# JS and assembles a self-contained workspace (see build-validation-workspace).
#
# Security posture:
#   - Chromium's own sandbox stays ON (non-root user + the compose seccomp
#     profile that permits user namespaces). Never add `--no-sandbox`.
#   - The browser image tag and `playwright-core` are pinned together; drift
#     fails the build instead of failing at launch.
#   - No published port; the app reaches it over the compose network.

ARG NODE_IMAGE=node:24.7.0-bookworm-slim
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.62.1-noble

FROM ${NODE_IMAGE} AS build
WORKDIR /build
COPY packages ./packages
COPY viewport ./viewport
COPY scripts/deploy/build-validation-workspace.mjs ./build-workspace.mjs
COPY tsconfig.worker.json ./tsconfig.worker.json
RUN npm install --no-audit --no-fund --ignore-scripts --save-exact \
      typescript@6.0.3 @types/node@24 @playwright/test@1.62.1 playwright-core@1.62.1 \
    && npx tsc -p tsconfig.worker.json \
    && node build-workspace.mjs --root /build \
    && node -e "const v=require('playwright-core/package.json').version; if(v!=='1.62.1'){console.error('playwright-core drift: '+v);process.exit(1)}" \
    && test -f dist/packages/experiment-validation/src/server.js \
    && test -f dist/node_modules/@physicsos/physics-scene/src/index.js

FROM ${PLAYWRIGHT_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PHYSICSOS_VALIDATION_PORT=8099 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PHYSICSOS_FRAME_WORKSPACE=/app/dist
# `dist/` is the self-contained workspace: server.js and its siblings, the
# compiled viewport module, and node_modules/@physicsos/<pkg>.
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/dist ./dist
# The official image ships `pwuser`; running as it keeps the Chromium sandbox.
USER pwuser
WORKDIR /app/dist
EXPOSE 8099
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8099/healthz',{headers:{authorization:'Bearer '+process.env.PHYSICSOS_VALIDATION_TOKEN}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "packages/experiment-validation/src/server.js"]
