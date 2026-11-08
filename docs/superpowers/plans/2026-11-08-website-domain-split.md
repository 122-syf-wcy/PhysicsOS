# Website Domain Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Restore the system at https://physics.dongsiwei.com/ and publish the website at https://physicsos.dongsiwei.com/.

**Architecture:** The application owns root regardless of website assets. Nginx selects the website entry and exposes only its public API on the website host. Build a minimal layer on the exact current production image, then preserve recovery points and deploy on the server.

**Tech Stack:** TypeScript, Node, Docker, Nginx, Certbot.

**Spec:** docs/superpowers/specs/2026-11-08-website-domain-split-design.md

## Global Constraints

- Build, test, and deploy on 107.151.246.59 /opt/physicsos with Docker.
- Preserve all current main and production functionality, existing secrets, current and previous images, and data.
- Keep website administration in existing system administrator workspace.

## Review Focus

- System root and legacy hash/query/reset links must load the system without /app navigation.
- Website CTA/developer links cross to the system root.
- Website feedback retains same-origin validation and screenshots; website host cannot expose admin or private images.
- PWA launch remains original root with stable id.
- Nginx switches and image rollback must recover together without restoring stale database over new data.

### Task 1: Application root and cross-host links

**Files:** overlays/harness/upstream-changes.patch; overlays/harness/files/apps/web/public/physicsos/website/{index.html,legacy-routing.js}; overlays/harness/files/packages/physicsos/auth-host/src/reset.ts; scripts/website/*.spec.mjs; related password-reset tests.

- [x] Verify current routing tests in server container, then adjust meaningful root/cross-host/reset expectations and observe failures.
- [x] Remove automatic publicLanding configuration in web-app; restore PWA start_url /; reset path /?reset_token=; replace website product/developer links with system absolute root URLs; retain hash/query on legacy handoff.
- [x] Run website, reset and relevant routing tests; inspect overlay patch applicability. Compile changed runtime modules in an isolated current-image server container.

### Task 2: Domain vhost and candidate

**Files:** scripts/deploy/website-domain-nginx.conf; scripts/deploy/website-domain-runtime.Dockerfile; server-only operational scripts and private manifests.

- [x] Add website vhost with root/static/public content/public feedback allowlist, 32 MiB body allowance and public credential stripping; system /app compatibility redirects to root with query retained.
- [x] Build minimal layer over exact production image; preserve every unchanged production file; create isolated candidate from existing website candidate infrastructure without sharing production writable state.
- [x] Verify actual system root, website entry, links, public config, feedback/image handling, reset/PWA and unauthorized admin rejection using candidate browser and server tests; review changes independently.

### Task 3: Publish and verify

**Files:** docs/reports/2026-11-08-website-domain-split.md; server recovery directory.

- [x] Recheck current main, server revision and running image under release lock; back up config, database and application data and retain exact rollback tag.
- [x] Push checked changes, fast-forward server checkout, switch exact candidate image and Nginx; restore system immediately. Once DNS resolves, obtain website certificate and enable HTTPS vhost.
- [x] Verify system root/login/hash, both HTTPS hosts, website CTA/public API and private rejection, healthy dependencies and unchanged existing data; record exact image, revision and recovery paths.

最终结果：源码 8563e9d，实际镜像 cb6e2498，2026-11-08 成功切换。37 项相关测试、候选截图/配置重启保留、正式双域名与历史链接检查通过。后台独立 optional-admin bundle 随域名链接一并更新。详见 docs/reports/2026-11-08-website-domain-split.md。
