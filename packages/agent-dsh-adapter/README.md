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

## Status / 未接线到生产

- 全仓没有任何生产路径 import `@physicsos/agent-dsh-adapter`。引用它的只有它自己的
  `package.json`、`src/adapter.contract.test.ts` 和 `src/boundary.ts`。
- 直接 Harness Adapter（`deepseek-harness-adapter.ts`）是 PHASE-01 骨架：
  `createSession` / `send` / `resume` / `cancel` / `getSession` / `forkSession`
  全部 `Promise.reject(new UnimplementedError(...))`，不返回伪造的成功结果。
- 桌面产品**没有**走本 package。桌面 Agent 通道是 `apps/desktop/sidecar/bridge.mjs`
  （JSON-RPC stdio 到本地 Harness web host）。
- 处置建议见 `docs/adr/0002-agent-runtime-adapter-disposition.md`。

## 包内已实现（尚未被生产引用）

`boundary.ts`、`local-sidecar-transport.ts`、`tauri-sidecar-rpc.ts` 是真实实现：

- `LocalSidecarAgentTransport`：把 `AgentTransport` 映射到 JSON-RPC 风格的本地
  sidecar channel，校验每个事件并只在对应 run 的终止事件到达后结束流。
- `TauriSidecarRpc`：把 `sidecar_start` / `sidecar_request` 与
  `sidecar://event` 适配成该 channel。

它映射的 `session/create`、`session/send`、`run/cancel`、`run/resume` 与桌面桥
`apps/desktop/sidecar/bridge.mjs` 已实现的方法同名，但本 package 目前没有任何地方
构造这些 transport，也没有生产入口使用它们。直接 Harness Adapter 的
`getSession` / `forkSession` 仍是显式未实现边界。
