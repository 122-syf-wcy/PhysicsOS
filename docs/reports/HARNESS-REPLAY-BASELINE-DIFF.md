# Harness Replay Baseline Diff

> 生成时间：2026-08-18 22:40 UTC+8
> 状态：**DIAGNOSTIC ONLY — 并行运行，不可用于正式 Gate 判定**

## 环境记录

| 项目 | 值 |
|------|-----|
| OS | Microsoft Windows NT 10.0.26200.0 |
| Node | v24.18.0 |
| pnpm | 11.9.0 |
| PowerShell | 5.1.26100.9168 |
| pwsh | **未安装** |
| bash | C:\windows\system32\bash.exe (WSL) |
| git | 2.45.1.windows.1 |
| Upstream commit | `47f943859bef60e4160492346772ded9b24f765a` |

## Build 结论

### Baseline Build Command
```
cd d:\PhysicsOS\_baseline-harness
pnpm install --frozen-lockfile
npm run build
```

### Baseline Build Result
- **PASS** (exit 0, `✓ built in 5.92s`)
- 日志：`docs/reports/baseline-build-original.log`

### PhysicsOS Build Command
```
cd d:\PhysicsOS\vendor\deepseek-harness
npm run build
```

### PhysicsOS Build Result
- **PASS** (exit 0, `✓ built in 4.21s`)
- 日志：`docs/reports/physicsos-harness-build.log`

### Build Config Diff

| 文件 | Baseline (HEAD) | PhysicsOS | 差异 |
|------|----------------|-----------|------|
| `package.json` | 无 `@types/react` devDep | 添加 `@types/react: ~18.3.1` | PhysicsOS 补丁 |
| `tsconfig.client.json` | 无 `ui-physicsos` ref | 添加 `ui-physicsos` ref | PhysicsOS 补丁 |
| `packages/bundle/web-app/package.json` | 无 `ui-physicsos` dep | 添加 `ui-physicsos` dep | PhysicsOS 补丁 |
| `packages/bundle/web-app/cordis.patch.yml` | 无 `ui-physicsos` slot | 添加 `ui-physicsos` slot | PhysicsOS 补丁 |
| `tsconfig.base.json` | `skipLibCheck: true` | `skipLibCheck: true` | **无差异** |

### TypeScript Error Root Cause

第一次基线 build 失败时报出 5 个 `error TS2322/TS2375`，全部关于 `bigint` 不属于 `ReactNode`。

**根因**：我自己用 PowerShell `Set-Content -Encoding utf8` 写入 `_baseline-harness\package.json` 时产生了 UTF-8 BOM，导致 PostCSS config 搜索时 `JSON.parse` 失败。恢复原始 `package.json` 后 build 通过。

**结论**：`@types/react@18.3.31` 在 `skipLibCheck: true` 下不触发类型错误。原始 upstream 在当前 Windows + Node 24 环境下 build 正常。**不存在 UPSTREAM_BASELINE_BUILD_BLOCKED**。

### 是否属于 Windows Upstream Issue

否。基线 build 在原始状态下通过。

## Replay 结论（DIAGNOSTIC ONLY）

> **重要限制**：两侧 replay 是**并行运行**的，共享 CPU、浏览器进程池、临时目录。
> PhysicsOS 侧因资源竞争出现大量 timeout 型失败（34s timeout 频繁出现）。
> 这些数字只能作为方向性参考，不能用于正式 Regression Attribution。
> 正式对账必须串行重跑。

### Baseline Replay

```
Test Files  36 failed | 40 passed (76)
Tests       25 failed | 153 passed | 90 skipped (268)
Exit code: 1
```

### PhysicsOS Replay

```
Test Files  59 failed | 17 passed (76)
Tests       29 failed | 64 passed | 175 skipped (268)
Exit code: 1
```

## Failure Diff（按 test file）

### A. 两边都失败（36 个文件）

这些是 **UPSTREAM_WINDOWS_REPLAY_ISSUE**，不是 PhysicsOS 引入的：

```
apps/web/tests/agent-preset-authoring.e2e.ts
apps/web/tests/agent-preset-selection.e2e.ts
apps/web/tests/approval-composer.e2e.ts
apps/web/tests/background-job-list.e2e.ts
apps/web/tests/bash-abort-row.e2e.ts
apps/web/tests/chat-continuous-conversation.e2e.ts
apps/web/tests/chat-long-interactions.e2e.ts
apps/web/tests/chat-scroll-contract.e2e.ts
apps/web/tests/code-mode-round.e2e.ts
apps/web/tests/composer-tab-geometry.e2e.ts
apps/web/tests/details-session-lifecycle.e2e.ts
apps/web/tests/goal-multi-turn-actions.e2e.ts
apps/web/tests/hmr-live.e2e.ts
apps/web/tests/markdown-cjk-strong.e2e.ts
apps/web/tests/markdown-images.e2e.ts
apps/web/tests/markdown-inline-code-links.e2e.ts
apps/web/tests/math-rendering.e2e.ts
apps/web/tests/message-actions.e2e.ts
apps/web/tests/message-feedback-protocol.snapshot.ts
apps/web/tests/message-feedback.e2e.ts
apps/web/tests/minimal-preset.snapshot.ts
apps/web/tests/navigation-panes.e2e.ts
apps/web/tests/plugin-config.e2e.ts
apps/web/tests/produced-file-mentions.e2e.ts
apps/web/tests/produced-files.e2e.ts
apps/web/tests/pwsh-terminal.e2e.ts
apps/web/tests/replay-round-trip.e2e.ts
apps/web/tests/seeded-history.e2e.ts
apps/web/tests/shipped-composition.e2e.ts
apps/web/tests/sidebar-scrollbar.e2e.ts
apps/web/tests/skill-tool-row.e2e.ts
apps/web/tests/smoke-real.e2e.ts
apps/web/tests/stats-paged-history.e2e.ts
apps/web/tests/trajectory-virtualization.e2e.ts
apps/web/tests/turn-tail-actions.e2e.ts
apps/web/tests/workspace-management.e2e.ts
```

### B. 只有 Baseline 失败（PhysicsOS 通过）（0 个文件）

无。

### C. 只有 PhysicsOS 失败（PHYSICSOS_REGRESSION 候选）（23 个文件）

> **警告**：由于并行运行，这 23 个文件很可能包含因资源竞争导致的 false positive。
> 必须串行重跑后才能确认。

```
apps/web/tests/cold-blank-session.e2e.ts
apps/web/tests/composer-draft-scroll.e2e.ts
apps/web/tests/cordis-tool-round.e2e.ts
apps/web/tests/feedback-command.e2e.ts
apps/web/tests/goal-bar.e2e.ts
apps/web/tests/goal-command-presentation.e2e.ts
apps/web/tests/image-display.snapshot.ts
apps/web/tests/lifecycle-chrome.e2e.ts
apps/web/tests/live-interactions.e2e.ts
apps/web/tests/permission-policy-context.e2e.ts
apps/web/tests/plan-review.e2e.ts
apps/web/tests/question-composer.e2e.ts
apps/web/tests/queue-actions.e2e.ts
apps/web/tests/schedule-after.e2e.ts
apps/web/tests/sidebar-subagent-activity.e2e.ts
apps/web/tests/skill-invocation-policy.e2e.ts
apps/web/tests/skill-user-invoke.e2e.ts
apps/web/tests/startup-auto-selection.e2e.ts
apps/web/tests/steering.e2e.ts
apps/web/tests/subagent-conversation.e2e.ts
apps/web/tests/subagent-interrupt-ui.e2e.ts
apps/web/tests/web-search-round.e2e.ts
apps/web/tests/workflow-run.e2e.ts
```

### D. 因前序 fixture 崩溃导致的 cascading skip

PhysicsOS 侧 175 skipped（vs Baseline 90 skipped），差额 85 个 skip 几乎全部是 cascading：
- 前序 workspace bootstrap 失败 → 后续测试无法创建 workspace → 全部 skip
- 资源竞争导致 browser context 超时 → 整个文件 skip

## 已观察的 Root Cause 线索

### 1. `unknown tool "bash"` 错误

多个两边都失败的测试中反复出现：
```
Error: unknown tool "bash"
```

这是 replay fixture 中录制了 `bash` tool 调用，但当前 Windows 环境下 harness 不会注册 `bash` tool（只注册 `pwsh`）。这是 **UPSTREAM_WINDOWS_REPLAY_ISSUE**。

### 2. Workspace bootstrap 卡死

PhysicsOS 侧 `turn-tail-actions.e2e.ts` 的失败栈：
```
TimeoutError: locator.click: Timeout 30000ms exceeded.
Call log:
  - waiting for getByRole('textbox', { name: 'Choose workspace' })
```

PhysicsOS 修改了 `support.ts` 中的 workspace 选择文案（`'选择工作区'` → `'新建物理世界'`），但 `connectFreshWorkspace`（英文版）仍使用 `'Choose workspace'`。这个差异可能导致 workspace 选择失败。

### 3. `hmr-live.e2e.ts` 瞬间失败（29ms）

两边都在 29ms 内失败，说明这是 **upstream 原生 Windows HMR 问题**，与 PhysicsOS 无关。

### 4. `startup-auto-selection.e2e.ts` 120s 超时

- Baseline 侧：PASS（7332ms）
- PhysicsOS 侧：FAIL（120000ms timeout）

这是并行运行的典型受害者。串行重跑时可能通过。

## PID Artifact Audit

根仓有 4 个未跟踪的 PID 文件：
```
DRELOCA~1ASUSTempdsh-subprocess-spec-4IgulWgrandchild-1787024101634.pid
DRELOCA~1ASUSTempdsh-subprocess-spec-4IgulWpipe-holder-1787024113463.pid
DRELOCA~1ASUSTempdsh-subprocess-spec-4IgulWtree-wait-1787024137866.pid
DRELOCA~1ASUSTempdsh-subprocess-spec-4IgulWzombie-group-1787024108461.pid
```

来源：`packages/subprocess/subprocess-local/tests/spawn.spec.ts` 中的测试用例创建临时 PID 文件（`spillDir` 下），用于验证 process group 终止逻辑。文件名中的 `dsh-subprocess-spec` 前缀匹配测试代码中的 `spawnSubprocess(spec(...))` 模式。

正常 teardown 应该在测试结束后清理 `spillDir`。这些文件残留是因为之前某次测试运行异常退出（可能被 kill 或 timeout）导致 cleanup 未执行。

**结论**：这些是测试临时产物，不是 production bug。正确的处理是在测试 teardown 中增加 `spillDir` 清理。不应加入 `.gitignore`。

## 下一步

1. **串行重跑** Baseline replay（单独运行，无竞争）
2. **串行重跑** PhysicsOS replay（单独运行，无竞争）
3. 用串行结果重新生成 Diff
4. 对真正的 PHYSICSOS_REGRESSION 逐项定位 root cause
5. 对 UPSTREAM_WINDOWS_REPLAY_ISSUE 分类记录

## 当前判定

```
MAGNETIC_RUNTIME_VERTICAL_SLICE_IMPLEMENTED
HARNESS_REPLAY_GATE_BLOCKED
```

- Upstream baseline 在 Windows 下 replay 本身就有 36 个文件失败（25 个 test 失败），属于 UPSTREAM_WINDOWS_REPLAY_ISSUE
- PhysicsOS 侧可能有新增 regression，但当前并行数据不可信
- 需要串行重跑确认
