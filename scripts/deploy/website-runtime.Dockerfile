# Package verified website outputs over the exact production base, retaining
# all other deployed capabilities and the original runtime configuration.
ARG WEBSITE_BUILD_IMAGE
ARG BASE_IMAGE
FROM ${WEBSITE_BUILD_IMAGE} AS website_outputs
FROM ${BASE_IMAGE}
ARG SOURCE_REVISION
ARG BASE_IMAGE
COPY --from=website_outputs --chown=999:999 /app/vendor/deepseek-harness/packages/client/ui-physicsos /app/vendor/deepseek-harness/packages/client/ui-physicsos
COPY --from=website_outputs --chown=999:999 /app/vendor/deepseek-harness/packages/client/ui-settings-account /app/vendor/deepseek-harness/packages/client/ui-settings-account
COPY --from=website_outputs --chown=999:999 /app/vendor/deepseek-harness/packages/physicsos/class-host /app/vendor/deepseek-harness/packages/physicsos/class-host
COPY --from=website_outputs --chown=999:999 /app/vendor/deepseek-harness/packages/physicsos/paper-host /app/vendor/deepseek-harness/packages/physicsos/paper-host
COPY --from=website_outputs --chown=999:999 /app/vendor/deepseek-harness/packages/physicsos/notice-host /app/vendor/deepseek-harness/packages/physicsos/notice-host
COPY --from=website_outputs --chown=999:999 /app/vendor/deepseek-harness/packages/physicsos/auth-host /app/vendor/deepseek-harness/packages/physicsos/auth-host
COPY --from=website_outputs --chown=999:999 /app/vendor/deepseek-harness/packages/host/frontend-static /app/vendor/deepseek-harness/packages/host/frontend-static
COPY --from=website_outputs --chown=999:999 /app/vendor/deepseek-harness/packages/bundle/web-app /app/vendor/deepseek-harness/packages/bundle/web-app
COPY --from=website_outputs --chown=999:999 /app/vendor/deepseek-harness/apps/web/dist /app/vendor/deepseek-harness/apps/web/dist
COPY --from=website_outputs --chown=999:999 /app/vendor/deepseek-harness/apps/web/public/physicsos/website /app/vendor/deepseek-harness/apps/web/public/physicsos/website
COPY --from=website_outputs --chown=999:999 /app/vendor/deepseek-harness/apps/web/public/manifest.webmanifest /app/vendor/deepseek-harness/apps/web/public/manifest.webmanifest
COPY --from=website_outputs --chown=999:999 /app/vendor/deepseek-harness/pnpm-lock.yaml /app/vendor/deepseek-harness/pnpm-lock.yaml
COPY --from=website_outputs --chown=999:999 /app/website-source-manifest.json /app/website-source-manifest.json
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
LABEL physicsos.website.base-image=$BASE_IMAGE
