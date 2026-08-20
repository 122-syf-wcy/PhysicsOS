# @physicsos/agent-dsh-adapter

## Purpose

PhysicsOS 与 DeepSeek Harness 之间的**唯一** Adapter。上层只看见 `PhysicsAgentRuntime`。

## Responsibilities

- 把 Harness Session / Run / Stream 映射到 PhysicsOS Contract
- 隔离 Harness internal package
- 不改 Harness Agent Loop / Session Store / Web UI

## Allowed Dependencies

- `@physicsos/agent-runtime`
- `@physicsos/shared`
- 未来：DeepSeek Harness **公开** API（仅本 package）

## Forbidden Dependencies

- 禁止被 `apps/web` 直接 import Harness
- 禁止把 Harness 类型泄漏到 UI / Physics Core

## PHASE-01 status

骨架 + 边界 + contract test。所有方法抛出 `UnimplementedError`，**不返回假成功**。

## Implementation plan

1. 阅读 `vendor/deepseek-harness` 的公开 API / `docs/architecture.md`
2. 在 Adapter 内定义 Harness DTO → PhysicsOS DTO 映射
3. 实现 `HttpSseAgentTransport`（Web）
4. 预留 `LocalIpcAgentTransport`（Desktop sidecar）
5. 补 Session / Resume / Cancel / Fork contract tests
6. 升级 Harness 只走本 package + `docs/HARNESS-UPSTREAM.md` 流程
