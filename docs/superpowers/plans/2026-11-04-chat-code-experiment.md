# Chat code experiment implementation

> Execute with parallel independent host/tool/UI work, focused integration, one final review and server deployment.

Goal: main physics conversation invokes a restricted child to generate private code experiments, rendered in new experiment UI from exact question scenes.
Spec: ../specs/2026-11-04-chat-code-experiment-design.md
Constraints: no user questions/approval gates; existing serverDocker only; physics staysengine-owned; no publicautoapproval; privateowner isolation and durable identity; preserve deployed68bd8d0/DDC image behavior.

- [x] Private artifact service, strict owner lookup, template/style context, closed file validation, durable storage and refreshed authenticated preview.
- [x] Restricted child composition + main-tool orchestration, automatic generation after verified solve, parent-scoped durable metadata and cancellation/staleness handling.
- [x] New chat code UI/exact scene runtime, preserved answer evidence, no oldCanvas/autojump, explicit Lab/retry and event fold compatibility.
- [x] Mock-LLM real main→child→artifact→chat renderer, different question values, failures/ownership/reload/restart; scripted Web12 gates passed. Final configured-model one-question acceptance is recorded separately in the release report.
- [ ] Review, commit, candidate over actual runningimage, database/file recovery, GitHub push, deployment and HTTPS verification.

Review focus: inherited scoped tools cannot escape code-only child; solved scene is never replaced by a template; private assets survive restart while URLs are authorized/refreshed; same-revision status changes reach chat; stale/cancelled results cannot supersede later question state.
