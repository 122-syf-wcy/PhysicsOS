# Small verified layer over the exact running production image.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG BASE_IMAGE
ARG SOURCE_REVISION
COPY --chown=999:999 web-app/ /app/vendor/deepseek-harness/packages/bundle/web-app/
COPY --chown=999:999 auth-host/ /app/vendor/deepseek-harness/packages/physicsos/auth-host/
COPY --chown=999:999 ui-physicsos/optional-admin.js /app/vendor/deepseek-harness/packages/client/ui-physicsos/lib/optional-admin.js
COPY --chown=999:999 ui-physicsos/src/ /app/vendor/deepseek-harness/packages/client/ui-physicsos/src/
COPY --chown=999:999 website/ /app/vendor/deepseek-harness/apps/web/public/physicsos/website/
COPY --chown=999:999 website/ /app/vendor/deepseek-harness/apps/web/dist/physicsos/website/
COPY --chown=999:999 manifest.webmanifest /app/vendor/deepseek-harness/apps/web/public/manifest.webmanifest
COPY --chown=999:999 manifest.webmanifest /app/vendor/deepseek-harness/apps/web/dist/manifest.webmanifest
COPY --chown=999:999 source-manifest.json /app/domain-split-source-manifest.json
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
LABEL physicsos.domain-split.base-image=$BASE_IMAGE
