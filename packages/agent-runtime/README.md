# @physicsos/agent-runtime

## Purpose

PhysicsOS 自己的稳定 Agent Contract。上层只依赖本 package，不依赖 DeepSeek Harness。

## Responsibilities

- `PhysicsAgentRuntime`
- `AgentTransport`
- `PhysicsAgentSession` / `PhysicsAgentRun`
- `AgentClientEvent`

## Allowed Dependencies

`@physicsos/shared`

## Forbidden Dependencies

DeepSeek Harness 任何 internal package、React、Physics Engine 实现。

## Status / 未接线到生产

- 本 package 目前只有类型与 contract test（243 行），没有实现。
- 全仓没有任何生产路径 import `@physicsos/agent-runtime`。唯一引用它的是
  `packages/agent-dsh-adapter`，而该 adapter 自身也没有生产消费者。
- 当前产品链路**不经过本 package**。真实 Agent 链是 Harness Agent Loop →
  Harness Tool Runtime → `tool-physicsos`（用 `defineTool` 注册工具）→
  `@physicsos/agent-tools` → 物理引擎 / verifier。
- 处置建议见 `docs/adr/0002-agent-runtime-adapter-disposition.md`。
