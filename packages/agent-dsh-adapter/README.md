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

Harness 直连 Adapter 仍是明确抛错的骨架。桌面本地运行已新增两条实现：

- `LocalSidecarAgentTransport`：把 `AgentTransport` 映射到 JSON-RPC 风格的本地
  sidecar channel，校验每个事件并只在对应 run 的终止事件到达后结束流。
- `TauriSidecarRpc`：把 `sidecar_start` / `sidecar_request` 与
  `sidecar://event` 适配成该 channel。

sidecar 进程路径只从 shell 环境变量 `PHYSICSOS_AGENT_SIDECAR` 读取，渲染进程
不能指定任意可执行文件。真正接入 Harness 公开 API 时仍需补齐 Harness DTO 映射
与 Session / Resume / Cancel / Fork contract tests。
