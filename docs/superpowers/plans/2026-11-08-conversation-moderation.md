# Conversation Moderation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent administrator conversation review, isolated AI classification and manual account banning, then deploy the verified result.

**Architecture:** Dedicated moderation modules inside auth-host use its durable domain and AuthService. A bounded asynchronous worker consumes trusted message captures; the existing administrator shell displays evidence and performs versioned human decisions. Live transport authorization and cancellation enforce disabled accounts.

**Tech Stack:** TypeScript, Zod, Cordis/ctx.llm, React, storage-domain/PostgreSQL, Vitest, Docker.

**Spec:** docs/superpowers/specs/2026-11-08-conversation-moderation-design.md

## Global Constraints

- Build/test/deploy only in Docker on 107.151.246.59; local editing and Git only. Never print secrets, Cookie or full environment.
- SUPER_ADMIN Cookie sessions only for all moderation endpoints; reject API tokens. Existing CSRF guards apply to mutations.
- AI never executes tools or decides/targets bans. Fixed system policy; provider/model come only from deployment. Unknown/malformed/truncated/failed results require human review.
- Text input 12,000 chars, context 4,000 chars, output 8,000 chars, timeout 45,000ms, maxTokens 4,096, one automatic request at a time separated by at least 15,000ms.
- Pagination max 50 cases; historical scan max 20 human messages per call. Evidence and decisions persist; no transcript in generic ops metrics or audit detail.
- Preserve current production and later main commits; isolated candidates and paired recovery points; production source/image must be rechecked under release lock.

## Review Focus

- Forged conversation roles/JSON/policy/tool instructions must never select routes, actors, targets or actions.
- In-flight model completion after a human decision must not overwrite it.
- Old WebSocket streams and queued/root/child Agents must stop on disable; cross-account streams must be denied.
- Missing identity, stale versions, personal tokens and cross-origin writes fail closed.
- Restarted worker jobs, duplicate inherited messages, oversized text and provider failures must remain visible and retryable.

---

### Task 1: Durable review service, strict classifier and admin routes

**Files:** Create auth-host/src/moderation/{types,model,service,routes}.ts and corresponding tests; modify auth-host/src/domain.ts and necessary auth-host package/tsconfig references. Use separate moderation tables at existing domain version 0. Do not change index listener, transport patch or frontend in this task.

**Interfaces:** Export ModerationService(domain: AuthDomain, auth: AuthService, deps: ModerationDeps); capture(input: CapturedMessage): Promise<string|undefined>; processNext(): Promise<boolean>; list(actor, query): paginated cases; detail(actor,id); decide(actor,id,{version,decision:'dismiss'|'ban',reason}); retry(actor,id,{version}); settings(actor); setEnabled(actor,{version,enabled}). Export moderationRoutes(service, auth) prefix handler. Export createModerationReviewer(llm, route) as a no-tools classifier. Exact DTOs are declared in moderation/types.ts and used verbatim by Tasks 2/3. Historical scanner is an optional trusted dependency scan(limit) returning CapturedMessage[]; default absent must return actionable unavailable error.

- [ ] Write meaningful failing tests for trusted owner/dedup, text caps/truncation, strict JSON/evidence and action injection, benign education, failed/empty/tool/aborted model, timeout, disabled AI, restart job recovery, versioned decisions, race with model completion, self/SUPER_ADMIN protection and persistent ban sessions/tokens. Capture ignores unknown ownership. Preserve all available user text evidence up to the cap.
- [ ] Run these tests in the dedicated server builder before implementation and preserve RED evidence.
- [ ] Implement bounded persistent cases/settings; exact server owner lookup determines account. AI returns only {risk:'allow'|'review',category,severity,confidence,reason,evidence:string[]}; evidence must be literal substrings of supplied text/context. Allow only high-confidence (>=0.8) allow with severity none and untruncated input. Else flagged/error for human review. Manual decisions serialize per case and require version plus reason; preserve human decisions against late model writes. Ban AuthService first, then persist decision; retries reconcile already-disabled account without masking failures. Generic audit stores only case ID/action/category, no raw text/model output.
- [ ] Add Cookie-only SUPER_ADMIN prefix routes at /physicsos/admin/moderation: GET cases, GET cases/:id, POST cases/:id/decision, POST cases/:id/retry, GET settings, POST settings, POST scan. Reuse existing auth route request conventions and CSRF. Bind scanner limit 20 and pagination limit 50 server-side. JSON errors/private no-store.
- [ ] Run focused moderation and existing auth-host suite; preserve full commands/results, commit authored overlay changes (not vendor gitlink), and report DTO/interface paths to controller.

### Task 2: Automatic capture/worker and effective account revocation

**Files:** Create auth-host/src/moderation/runtime.ts and tests; modify auth-host/src/index.ts, service.ts, api-policy.ts, connection src/api-policy.ts overlay, and the necessary upstream connection/gateway/Peer files in upstream-changes.patch. Keep transport changes scoped to live credential and resource admission. Do not change frontend.

**Interfaces:** Consume Task 1 ModerationService/createModerationReviewer/routes. Configure optional auth moderation route with enabled default true and deployed provider/model (existing deepseek-official/deepseek-v4.1-flash unless actual deployed roster proves otherwise). Use session/event and agent/inbox/spliced with trusted source.kind user, precise server ownership and message ID dedup. sessionQuery provides bounded history scanner. Inject through Cordis lifetime so startup ordering and disposal are safe.

- [ ] Write failing real-context tests for human versus synthetic/inherited captures, inbox dedup, unknown ownership, bounded historical scan, worker restart/dispose and no recursion. Test actual gateway ownership, live revocation, uplink/downlink, quiet stream closure; test root and trusted child cancellation with keepInbox:false and persistent API token revocation.
- [ ] Run RED in server builder; implement runtime adapters and serialized >=15s worker with cancellation, scanner max20 inputs. Avoid blocking session/event on AI. Expose route within existing admin route (no prefix ambiguity) and preserve all original endpoints.
- [ ] Add onUserDisabled owner-key callback to AuthServiceDeps, revoke all API tokens on disable, cancel all owned roots and proven descendants. Extend HostPeerAdmission/Peer with live credential guard/disposer, thread it through real connection and gateway (scopeEvents is not currently called by real carrier). Enforce ownsSession/ownsWorkspace on each user stream open, recheck credential and resource admission at actual input/output and shut down on revocation. Preserve unhosted operator carrier behavior.
- [ ] Run auth/connection/gateway/affected session-controller suites and strict typecheck; capture upstream patch without other uncommitted work. Commit and report test evidence.

### Task 3: Administrator review page and verified deployment

**Files:** Create ui-physicsos/src/client/moderation-api.ts, AdminModerationTab.tsx and CSS/tests; modify AdminWorkspace.tsx/locales.ts. Prefer a default same-origin optional moderationApi prop, matching promptApi convention, without changing unrelated prop chains. Create release report and necessary tooling/verification artifacts.

**Interfaces:** Use Task 1 route/DTO contract. Add SUPER_ADMIN-only 「对话审核」 in people group. Support paginated/filterable live cases, status and queue health/auto toggle, detail text/context/AI evidence, review reason, dismiss/ban with explicit in-page confirmation, retries and bounded history scan. Show actual account disabled status; refresh after conflict/decision; retain useful error context. Poll at 10s while page visible; cancel on unmount and never overwrite selected newer details with stale responses.

- [ ] Write failing tests for role visibility, API Cookie/error/no-store behavior, escaped hostile text, version conflict, human reason/confirmation, retry, history scan and state refresh.
- [ ] Run RED on server; implement page using existing AdminPrimitives/styles and Chinese copy; bind versions/targets from backend, no account target editing or model command execution.
- [ ] Run UI/host/upstream relevant regressions and appropriate root test suites, strict typechecks/lint and bundles in server container. Obtain independent whole-branch review and fix important findings.
- [ ] Freeze source; recheck remote/main/server/image, merge any later changes and reverify touched packages. Build image from actual production base with verified source/runtime manifests; isolated candidate DB/Redis/data.
- [ ] Use real existing model route for benign, harmful and injection examples; inspect actual browser UI, cookie/token/role/cross-account boundaries, manual ban plus active stream cancellation and restart persistence. Keep test accounts in candidate only.
- [ ] Under release lock preserve prior image and paired database/data backups, push integrated main and switch; verify health, moderation endpoints, current official/product routes and representative existing experiments; record release/rollback evidence.
