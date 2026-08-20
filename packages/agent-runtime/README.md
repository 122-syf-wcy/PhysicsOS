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

## Implementation status

PHASE-01 只提供类型与 contract test。真实 Runtime 由后续阶段通过 `@physicsos/agent-dsh-adapter` 接入。
