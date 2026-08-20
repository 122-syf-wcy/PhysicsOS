# @physicsos/shared

## Purpose

PhysicsOS 跨 package 的稳定基础类型：Brand ID、时间、错误。

## Responsibilities

- branded ID
- ISO 时间辅助
- 统一错误类型（含明确的 UnimplementedError）

## Public API

见 `src/index.ts`。

## Allowed Dependencies

无运行时依赖。

## Forbidden Dependencies

React、DOM、DeepSeek Harness、Tauri、任何 Physics Engine 实现。
