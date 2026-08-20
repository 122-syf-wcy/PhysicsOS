# @physicsos/platform-bridge

## Purpose

隔离浏览器 / 未来 Tauri 的平台能力。业务组件禁止出现 `window.__TAURI__`。

## Responsibilities

- `PlatformBridge` 契约
- `BrowserPlatformBridge`（PHASE-01）
- `TauriPlatformBridge` 预留（未实现，明确抛 UnimplementedError）

## Allowed Dependencies

`@physicsos/shared`

## Forbidden Dependencies

DeepSeek Harness、Physics Engine、React 业务页面。
